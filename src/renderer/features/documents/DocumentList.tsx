import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'

import type {
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentWatchStatus
} from '@shared/types'

import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import {
  useDocumentStore,
  type DocumentContentState,
  type DocumentPreviewState
} from '@renderer/stores'

import { DocumentMetadataPanel } from './DocumentMetadataPanel'
import { DocumentPreviewPanel } from './DocumentPreviewPanel'

const FOLDER_ROW_HEIGHT = 40
const FILE_ROW_HEIGHT = 52
const MIN_VIEWPORT_HEIGHT = 480
const SSR_INITIAL_ROW_COUNT = 24
const INDENT_PX = 18
const ALL_EXTENSIONS_VALUE = '__all__'

type SortBy = 'name' | 'date-desc' | 'date-asc'

function getLocalStorageItem(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function setLocalStorageItem(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore preference persistence failures in restricted environments.
  }
}
interface FolderNode {
  kind: 'folder'
  name: string
  path: string
  depth: number
  totalDescendants: number
}

interface FileNode {
  kind: 'file'
  document: DocumentRecord
  depth: number
}

type TreeNode = FolderNode | FileNode

function getTreeNodeKey(node: TreeNode): string {
  return node.kind === 'folder' ? `folder:${node.path}` : `file:${node.document.id}`
}

function buildFolderMap(
  documents: DocumentRecord[],
  extraFolderPaths: readonly string[] = []
): Map<string, { subfolders: Set<string>; files: DocumentRecord[] }> {
  const map = new Map<string, { subfolders: Set<string>; files: DocumentRecord[] }>()

  const ensure = (path: string): { subfolders: Set<string>; files: DocumentRecord[] } => {
    if (!map.has(path)) {
      map.set(path, { subfolders: new Set(), files: [] })
    }

    return map.get(path)!
  }

  ensure('')

  for (const document of documents) {
    const parts = document.relativePath.split('/')

    for (let index = 1; index < parts.length; index += 1) {
      const folderPath = parts.slice(0, index).join('/')
      const parentPath = parts.slice(0, index - 1).join('/')
      ensure(folderPath)
      ensure(parentPath).subfolders.add(folderPath)
    }

    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    ensure(parentPath).files.push(document)
  }

  for (const folderPath of extraFolderPaths) {
    if (!folderPath) continue
    const parts = folderPath.split('/')
    for (let index = 1; index <= parts.length; index += 1) {
      const currentPath = parts.slice(0, index).join('/')
      const parentPath = parts.slice(0, index - 1).join('/')
      ensure(currentPath)
      ensure(parentPath).subfolders.add(currentPath)
    }
  }

  return map
}

function countDescendants(
  map: Map<string, { subfolders: Set<string>; files: DocumentRecord[] }>,
  path: string
): number {
  const node = map.get(path)
  if (!node) {
    return 0
  }

  return (
    node.files.length +
    [...node.subfolders].reduce((sum, subfolder) => sum + 1 + countDescendants(map, subfolder), 0)
  )
}

function flattenVisible(
  map: Map<string, { subfolders: Set<string>; files: DocumentRecord[] }>,
  expandedPaths: Set<string>,
  folderPath: string,
  depth: number,
  sortBy: SortBy = 'name'
): TreeNode[] {
  const node = map.get(folderPath)
  if (!node) {
    return []
  }

  const result: TreeNode[] = []

  for (const subfolder of [...node.subfolders].sort()) {
    result.push({
      kind: 'folder',
      name: subfolder.split('/').pop() ?? subfolder,
      path: subfolder,
      depth,
      totalDescendants: countDescendants(map, subfolder)
    })

    if (expandedPaths.has(subfolder)) {
      result.push(...flattenVisible(map, expandedPaths, subfolder, depth + 1, sortBy))
    }
  }

  for (const file of [...node.files].sort((left, right) => {
    if (sortBy === 'date-desc') return right.modifiedAt.localeCompare(left.modifiedAt)
    if (sortBy === 'date-asc') return left.modifiedAt.localeCompare(right.modifiedAt)
    return left.relativePath.localeCompare(right.relativePath)
  })) {
    result.push({
      kind: 'file',
      document: file,
      depth
    })
  }

  return result
}

function formatTimestamp(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function getDocumentExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) {
    return ''
  }

  return filename.slice(lastDotIndex).toLowerCase()
}

interface FileIconTheme {
  bg: string
  fg: string
  label: string
}

const FILE_ICON_FALLBACK: FileIconTheme = {
  bg: 'bg-[#e8e4d6]',
  fg: 'text-[#5c5c5a]',
  label: 'DOC'
}

const FILE_ICON_THEMES: Record<string, FileIconTheme> = {
  '.pdf': { bg: 'bg-[#fbe4dc]', fg: 'text-[#a8462f]', label: 'PDF' },
  '.doc': { bg: 'bg-[#dde7f4]', fg: 'text-[#2c5b91]', label: 'DOC' },
  '.docx': { bg: 'bg-[#dde7f4]', fg: 'text-[#2c5b91]', label: 'DOC' },
  '.odt': { bg: 'bg-[#dde7f4]', fg: 'text-[#2c5b91]', label: 'ODT' },
  '.rtf': { bg: 'bg-[#dde7f4]', fg: 'text-[#2c5b91]', label: 'RTF' },
  '.txt': { bg: 'bg-[#ece9df]', fg: 'text-[#4a4a48]', label: 'TXT' },
  '.md': { bg: 'bg-[#ece9df]', fg: 'text-[#4a4a48]', label: 'MD' },
  '.csv': { bg: 'bg-[#dfeede]', fg: 'text-[#3c6132]', label: 'CSV' },
  '.xls': { bg: 'bg-[#dfeede]', fg: 'text-[#3c6132]', label: 'XLS' },
  '.xlsx': { bg: 'bg-[#dfeede]', fg: 'text-[#3c6132]', label: 'XLS' },
  '.jpg': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'JPG' },
  '.jpeg': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'JPG' },
  '.png': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'PNG' },
  '.gif': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'GIF' },
  '.tif': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'TIF' },
  '.tiff': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'TIF' },
  '.webp': { bg: 'bg-[#ecdef0]', fg: 'text-[#6b3a8c]', label: 'IMG' },
  '.eml': { bg: 'bg-[#daeaee]', fg: 'text-[#0f6577]', label: 'EML' },
  '.msg': { bg: 'bg-[#daeaee]', fg: 'text-[#0f6577]', label: 'MSG' }
}

function getFileIconTheme(filename: string): FileIconTheme {
  const extension = getDocumentExtension(filename)
  if (!extension) return FILE_ICON_FALLBACK
  return (
    FILE_ICON_THEMES[extension] ?? {
      ...FILE_ICON_FALLBACK,
      label: extension.replace('.', '').toUpperCase().slice(0, 3)
    }
  )
}

function FileIcon({ filename }: { filename: string }): React.JSX.Element {
  const theme = getFileIconTheme(filename)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold tracking-wider',
        theme.bg,
        theme.fg
      )}
    >
      {theme.label}
    </span>
  )
}

const EMPTY_FOLDER_PATHS: readonly string[] = Object.freeze([])

const FORBIDDEN_FS_NAME_CHARS_RE = /[\\/:*?"<>|]/

function isValidFsName(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..') return false
  if (trimmed.startsWith('.')) return false
  if (FORBIDDEN_FS_NAME_CHARS_RE.test(trimmed)) return false
  return true
}

function NewFolderIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4z" />
      <path d="M8 7v4M6 9h4" />
    </svg>
  )
}

function PencilGlyph(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5 13.5 4.5 5 13 2.5 13.5 3 11Z" />
      <path d="M10 4 12 6" />
    </svg>
  )
}

function TrashGlyph(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4.5 4.5 5 13.5h6L11.5 4.5" />
    </svg>
  )
}

function NameEditor({
  initialValue,
  placeholder,
  confirmLabel,
  cancelLabel,
  invalidLabel,
  disabled,
  onConfirm,
  onCancel
}: {
  initialValue: string
  placeholder?: string
  confirmLabel: string
  cancelLabel: string
  invalidLabel: string
  disabled?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const trimmed = value.trim()
  const valid = isValidFsName(trimmed)

  return (
    <form
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onConfirm(trimmed)
      }}
      className="pointer-events-auto relative z-20 flex flex-1 items-center gap-1"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        aria-invalid={!valid}
        aria-label={placeholder}
        className={cn(
          'h-7 min-w-0 flex-1 rounded-md border bg-white px-2 text-sm text-[#1a1a1a] outline-none transition focus:ring-2 focus:ring-aurora/30',
          valid ? 'border-[#e5e3da] focus:border-aurora' : 'border-[#e8c7c7] focus:border-[#9c2f2f]'
        )}
      />
      <button
        type="submit"
        disabled={!valid || disabled}
        aria-label={valid ? confirmLabel : invalidLabel}
        title={valid ? confirmLabel : invalidLabel}
        className="flex h-7 w-7 items-center justify-center rounded-full text-aurora transition hover:bg-aurora/10 disabled:cursor-not-allowed disabled:text-[#bcbab1] disabled:hover:bg-transparent"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onCancel}
        aria-label={cancelLabel}
        title={cancelLabel}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] transition hover:bg-[#fbf0f0] hover:text-[#9c2f2f]"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </form>
  )
}

function ConfirmDeleteTray({
  label,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel
}: {
  label: string
  confirmLabel: string
  cancelLabel: string
  disabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="relative z-20 flex items-center gap-1.5 rounded-full border border-[#e8c7c7] bg-[#fbf0f0] px-2 py-0.5"
    >
      <span className="text-xs font-semibold text-[#9c2f2f]">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        aria-label={confirmLabel}
        className="rounded-full px-2 py-0.5 text-xs font-semibold text-[#9c2f2f] transition hover:bg-[#f7dada] disabled:opacity-50"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onCancel}
        aria-label={cancelLabel}
        className="rounded-full px-2 py-0.5 text-xs text-[#5c5c5a] transition hover:bg-white/60 hover:text-[#1a1a1a] disabled:opacity-50"
      >
        {cancelLabel}
      </button>
    </div>
  )
}

function getExtractionDotClass(state: DocumentRecord['textExtraction']['state']): string {
  if (state === 'extracted') return 'bg-[#5a8a3a]'
  if (state === 'extractable') return 'bg-[#c79822]'
  return 'bg-[#bcbab1]'
}

function getExtractionLabel(
  state: DocumentRecord['textExtraction']['state'],
  t: (key: string) => string
): string {
  if (state === 'extracted') return t('documents.extraction_badge_extracted')
  if (state === 'extractable') return t('documents.extraction_badge_extractable')
  return t('documents.extraction_badge_unavailable')
}

export function DocumentList({
  dossierId,
  documents,
  error,
  isLoading,
  isSavingMetadata,
  watchStatus,
  activePreviewDocumentId,
  previewState,
  contentState,
  onSaveMetadata,
  onOpenPreview,
  onOpenFile,
  onExtractContent,
  onNavigateToGenerate
}: {
  dossierId: string
  documents: DocumentRecord[]
  error?: string | null
  isLoading: boolean
  isSavingMetadata: boolean
  watchStatus: DocumentWatchStatus | null
  activePreviewDocumentId: string | null
  previewState: DocumentPreviewState
  contentState: DocumentContentState
  onSaveMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  onOpenPreview: (input: DocumentPreviewInput) => Promise<void>
  onOpenFile: (input: DocumentPreviewInput) => Promise<void>
  onExtractContent?: (input: DocumentPreviewInput) => Promise<boolean>
  onNavigateToGenerate?: () => void
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const { t, i18n } = useTranslation()
  void watchStatus
  const folderPaths = useDocumentStore(
    (state) => state.foldersByDossierId[dossierId] ?? EMPTY_FOLDER_PATHS
  )
  const isMutatingTree = useDocumentStore((state) => state.isMutatingTree)
  const treeError = useDocumentStore((state) => state.treeError)
  const createFolderAction = useDocumentStore((state) => state.createFolder)
  const renameFolderAction = useDocumentStore((state) => state.renameFolder)
  const deleteFolderAction = useDocumentStore((state) => state.deleteFolder)
  const renameFileAction = useDocumentStore((state) => state.renameFile)
  const deleteFileAction = useDocumentStore((state) => state.deleteFile)
  const clearTreeError = useDocumentStore((state) => state.clearTreeError)
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [filenameFilter, setFilenameFilter] = useState('')
  const [extensionFilter, setExtensionFilter] = useState(ALL_EXTENSIONS_VALUE)
  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null)
  const [confirmDeleteFolderPath, setConfirmDeleteFolderPath] = useState<string | null>(null)
  const [confirmDeleteFilePath, setConfirmDeleteFilePath] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>(
    () => (getLocalStorageItem('documents-sort-by') as SortBy) ?? 'name'
  )
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(
    () => activePreviewDocumentId !== null
  )
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const initial = new Set<string>()

    for (const document of documents) {
      const firstSegment = document.relativePath.split('/')[0]

      if (firstSegment && document.relativePath.includes('/')) {
        initial.add(firstSegment)
      }
    }

    return initial
  })

  useEffect(() => {
    if (!editingDocumentId) {
      return
    }

    if (!documents.some((document) => document.id === editingDocumentId)) {
      setEditingDocumentId(null)
    }
  }, [documents, editingDocumentId])

  useEffect(() => {
    if (activePreviewDocumentId) {
      setIsPreviewOpen(true)
    }
  }, [activePreviewDocumentId])

  const searchTerms = filenameFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  const editingDocument = documents.find((document) => document.id === editingDocumentId) ?? null
  const activePreviewDocument =
    documents.find((document) => document.id === activePreviewDocumentId) ?? null
  const handleExtractContent =
    typeof onExtractContent === 'function' ? onExtractContent : async () => false
  const availableExtensions = useMemo(() => {
    const counts = new Map<string, number>()

    for (const document of documents) {
      const extension = getDocumentExtension(document.filename)

      if (!extension) {
        continue
      }

      counts.set(extension, (counts.get(extension) ?? 0) + 1)
    }

    return [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => ({ value, count }))
  }, [documents])
  const filteredDocuments = useMemo(() => {
    const filtered = documents.filter((document) => {
      const matchesFilename =
        searchTerms.length === 0 ||
        searchTerms.every(
          (term) =>
            document.filename.toLowerCase().includes(term) ||
            (document.description ?? '').toLowerCase().includes(term) ||
            document.tags.some((tag) => tag.toLowerCase().includes(term))
        )
      const matchesExtension =
        extensionFilter === ALL_EXTENSIONS_VALUE ||
        getDocumentExtension(document.filename) === extensionFilter

      return matchesFilename && matchesExtension
    })

    return filtered.sort((a, b) => {
      if (sortBy === 'date-desc') return b.modifiedAt.localeCompare(a.modifiedAt)
      if (sortBy === 'date-asc') return a.modifiedAt.localeCompare(b.modifiedAt)
      return a.filename.localeCompare(b.filename)
    })
  }, [documents, extensionFilter, searchTerms, sortBy])
  const isFiltering = searchTerms.length > 0 || extensionFilter !== ALL_EXTENSIONS_VALUE
  const folderMap = useMemo(
    () => buildFolderMap(filteredDocuments, isFiltering ? [] : folderPaths),
    [filteredDocuments, folderPaths, isFiltering]
  )
  const flatNodes = useMemo(
    () => flattenVisible(folderMap, expandedPaths, '', 0, sortBy),
    [folderMap, expandedPaths, sortBy]
  )

  const toggleFolder = (path: string): void => {
    setExpandedPaths((previous) => {
      const next = new Set(previous)

      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }

      return next
    })
  }

  const openPreviewForDocument = (documentId: string): void => {
    setIsPreviewOpen(true)
    void onOpenPreview({ dossierId, documentId })
  }

  // TanStack Virtual is the approved large-list path for this surface.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    estimateSize: (index) => {
      const node = flatNodes[index]

      if (!node) {
        return FILE_ROW_HEIGHT
      }

      return node.kind === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT
    },
    getItemKey: (index) => {
      const node = flatNodes[index]

      return node ? getTreeNodeKey(node) : index
    },
    getScrollElement: () => parentRef.current,
    overscan: 8,
    initialRect: { height: MIN_VIEWPORT_HEIGHT, width: 0 }
  })

  const virtualItems =
    typeof window === 'undefined'
      ? flatNodes
          .slice(0, Math.min(flatNodes.length, SSR_INITIAL_ROW_COUNT))
          .map((node, index) => ({
            index,
            key: getTreeNodeKey(node),
            size: node.kind === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT,
            start:
              flatNodes
                .slice(0, index)
                .reduce(
                  (sum, currentNode) =>
                    sum + (currentNode.kind === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT),
                  0
                ) ?? 0
          }))
      : rowVirtualizer.getVirtualItems()

  const totalSize =
    typeof window === 'undefined'
      ? flatNodes.reduce(
          (sum, node) => sum + (node.kind === 'folder' ? FOLDER_ROW_HEIGHT : FILE_ROW_HEIGHT),
          0
        )
      : rowVirtualizer.getTotalSize()

  const locale = i18n.resolvedLanguage ?? 'en'
  const hasVisibleDocuments = filteredDocuments.length > 0 || flatNodes.length > 0
  const isDrawerVisible = isPreviewOpen && activePreviewDocument !== null
  const totalDocumentCount = documents.length
  const filteredCount = filteredDocuments.length
  const countLabel =
    filteredCount === totalDocumentCount
      ? t('documents.count_total', {
          count: totalDocumentCount,
          defaultValue: '{{count}} fichier(s)'
        })
      : t('documents.count_filtered', {
          count: filteredCount,
          total: totalDocumentCount,
          defaultValue: '{{count}} sur {{total}}'
        })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <p className="text-xs uppercase tracking-[0.16em] text-[#5c5c5a]">
            {t('documents.section_badge')}
          </p>
          {totalDocumentCount > 0 ? (
            <span className="text-xs text-[#8a8a85]">{countLabel}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isMutatingTree || creatingFolderAt !== null}
            onClick={() => {
              clearTreeError()
              setCreatingFolderAt('')
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <NewFolderIcon />
              {t('documents.new_folder_action', { defaultValue: 'Nouveau sous-dossier' })}
            </span>
          </Button>
          {onNavigateToGenerate ? (
            <Button type="button" variant="ghost" size="sm" onClick={onNavigateToGenerate}>
              {t('documents.generate_action')}
            </Button>
          ) : null}
        </div>
      </div>

      {!isLoading && documents.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a85]"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" strokeLinecap="round" />
            </svg>
            <input
              id="document-list-search"
              type="search"
              value={filenameFilter}
              onChange={(event) => setFilenameFilter(event.target.value)}
              placeholder={t('documents.filter_search_placeholder')}
              aria-label={t('documents.filter_search_label')}
              className="h-10 w-full rounded-full border border-[#e5e3da] bg-white pl-9 pr-4 text-sm text-[#1a1a1a] outline-none transition placeholder:text-[#8a8a85] focus:border-aurora focus:ring-2 focus:ring-aurora/30"
            />
          </div>

          <select
            id="document-list-extension"
            value={extensionFilter}
            onChange={(event) => setExtensionFilter(event.target.value)}
            aria-label={t('documents.filter_extension_label')}
            className="h-10 rounded-full border border-[#e5e3da] bg-white px-4 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
          >
            <option value={ALL_EXTENSIONS_VALUE}>{t('documents.filter_extension_all')}</option>
            {availableExtensions.map((extension) => (
              <option key={extension.value} value={extension.value}>
                {`${extension.value} (${extension.count})`}
              </option>
            ))}
          </select>

          <select
            id="document-list-sort"
            value={sortBy}
            onChange={(event) => {
              const value = event.target.value as SortBy
              setLocalStorageItem('documents-sort-by', value)
              setSortBy(value)
            }}
            aria-label={t('documents.filter_sort_label')}
            className="h-10 rounded-full border border-[#e5e3da] bg-white px-4 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
          >
            <option value="name">{t('documents.filter_sort_name')}</option>
            <option value="date-desc">{t('documents.filter_sort_date_desc')}</option>
            <option value="date-asc">{t('documents.filter_sort_date_asc')}</option>
          </select>
        </div>
      ) : null}

      {editingDocument ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,122,138,0.18)] p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col overflow-y-auto rounded-[28px] border border-[#d1cfc6] bg-[#f4f3ee] p-5 shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15"
          >
            <DocumentMetadataPanel
              key={`${dossierId}:${editingDocument.id}:${editingDocument.description ?? ''}:${editingDocument.tags.join(' ')}`}
              document={editingDocument}
              disabled={isSavingMetadata}
              onCancel={() => setEditingDocumentId(null)}
              onSave={onSaveMetadata}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-[#e8c7c7] bg-[#fbf0f0] p-4 text-sm text-[#9c2f2f]">
          {error}
        </div>
      ) : null}

      {treeError ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-[#e8c7c7] bg-[#fbf0f0] p-3 text-sm text-[#9c2f2f]">
          <span>{treeError}</span>
          <button
            type="button"
            onClick={clearTreeError}
            aria-label={t('documents.tree_error_dismiss', { defaultValue: 'Fermer' })}
            className="rounded-full px-2 py-0.5 text-xs hover:bg-white/60"
          >
            ×
          </button>
        </div>
      ) : null}

      {creatingFolderAt !== null ? (
        <div className="flex items-center gap-2 rounded-xl border border-aurora/30 bg-[#f3fafb] p-2.5">
          <NewFolderIcon />
          {creatingFolderAt ? (
            <span className="truncate text-xs text-[#5c5c5a]">
              {t('documents.folder_create_in', { defaultValue: 'Dans' })}{' '}
              <span className="font-semibold text-[#1a1a1a]">{creatingFolderAt}/</span>
            </span>
          ) : (
            <span className="text-xs uppercase tracking-[0.12em] text-[#5c5c5a]">
              {t('documents.folder_create_at_root', { defaultValue: 'À la racine' })}
            </span>
          )}
          <NameEditor
            initialValue=""
            placeholder={t('documents.folder_name_placeholder', { defaultValue: 'Nom du dossier' })}
            confirmLabel={t('documents.folder_create_confirm', { defaultValue: 'Créer' })}
            cancelLabel={t('documents.folder_create_cancel', { defaultValue: 'Annuler' })}
            invalidLabel={t('documents.folder_name_invalid', {
              defaultValue: 'Nom de dossier invalide'
            })}
            disabled={isMutatingTree}
            onCancel={() => setCreatingFolderAt(null)}
            onConfirm={async (name) => {
              const parentPath = creatingFolderAt
              const ok = await createFolderAction({ dossierId, parentPath, name })
              if (ok) {
                setCreatingFolderAt(null)
                setExpandedPaths((previous) => {
                  const next = new Set(previous)
                  next.add(parentPath ? `${parentPath}/${name}` : name)
                  if (parentPath) next.add(parentPath)
                  return next
                })
              }
            }}
          />
        </div>
      ) : null}

      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
          {t('documents.loading')}
        </p>
      ) : null}

      {!isLoading && documents.length === 0 && folderPaths.length === 0 && !creatingFolderAt ? (
        <p className="rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
          {t('documents.empty')}
        </p>
      ) : null}

      {!isLoading && documents.length > 0 && !hasVisibleDocuments ? (
        <p className="rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
          {t('documents.no_results')}
        </p>
      ) : null}

      {!isLoading && hasVisibleDocuments ? (
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e5e3da] bg-white shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
          <div className="flex h-9 items-center gap-3 border-b border-deep-space bg-[#fbf9f4] px-4 text-xs font-medium uppercase tracking-[0.12em] text-[#8a8a85]">
            <span className="flex-1">{t('documents.column_name', { defaultValue: 'Nom' })}</span>
            <span className="hidden w-40 shrink-0 md:block">
              {t('documents.column_tags', { defaultValue: 'Tags' })}
            </span>
            <span className="hidden w-24 shrink-0 text-right md:block">
              {t('documents.column_date', { defaultValue: 'Date' })}
            </span>
            <span className="w-24 shrink-0" aria-hidden="true" />
          </div>

          <div ref={parentRef} className="h-[calc(100%-2.25rem)] overflow-auto">
            <div style={{ height: totalSize, position: 'relative' }}>
              {virtualItems.map((virtualItem) => {
                const node = flatNodes[virtualItem.index]

                if (!node) {
                  return null
                }

                if (node.kind === 'folder') {
                  const isExpanded = expandedPaths.has(node.path)
                  const isRenaming = renamingFolderPath === node.path
                  const isConfirmingDelete = confirmDeleteFolderPath === node.path
                  const isEmpty = node.totalDescendants === 0
                  const folderNode = node

                  return (
                    <div
                      key={getTreeNodeKey(node)}
                      ref={(element) => rowVirtualizer.measureElement(element)}
                      data-index={virtualItem.index}
                      data-folder-row={node.path}
                      className="group absolute inset-x-0 border-b border-deep-space transition-colors duration-150 last:border-b-0 hover:bg-[#fbf9f4]"
                      style={{
                        minHeight: FOLDER_ROW_HEIGHT,
                        height: FOLDER_ROW_HEIGHT,
                        transform: `translateY(${virtualItem.start}px)`
                      }}
                    >
                      {!isRenaming ? (
                        <button
                          type="button"
                          aria-label={
                            isExpanded
                              ? t('documents.folder_collapse_action', { defaultValue: 'Replier' })
                              : t('documents.folder_expand_action', { defaultValue: 'Déplier' })
                          }
                          className="absolute inset-0 z-0 w-full cursor-pointer rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aurora/40"
                          onClick={() => toggleFolder(folderNode.path)}
                        />
                      ) : null}

                      <div
                        className="pointer-events-none relative z-10 flex h-full items-center gap-2 pr-3"
                        style={{ paddingLeft: `${16 + folderNode.depth * INDENT_PX}px` }}
                      >
                        <svg
                          className="shrink-0 text-[#8a8a85] transition-transform duration-200"
                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M3 1.5l4 3.5-4 3.5V1.5z" />
                        </svg>
                        <svg
                          className="shrink-0 text-aurora/70"
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.764c.415 0 .813.165 1.107.46L8.5 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5z" />
                        </svg>

                        {isRenaming ? (
                          <NameEditor
                            initialValue={folderNode.name}
                            placeholder={t('documents.folder_name_placeholder', {
                              defaultValue: 'Nom du dossier'
                            })}
                            confirmLabel={t('documents.folder_rename_confirm', {
                              defaultValue: 'Renommer'
                            })}
                            cancelLabel={t('documents.folder_rename_cancel', {
                              defaultValue: 'Annuler'
                            })}
                            invalidLabel={t('documents.folder_name_invalid', {
                              defaultValue: 'Nom de dossier invalide'
                            })}
                            disabled={isMutatingTree}
                            onCancel={() => setRenamingFolderPath(null)}
                            onConfirm={async (newName) => {
                              if (newName === folderNode.name) {
                                setRenamingFolderPath(null)
                                return
                              }
                              const ok = await renameFolderAction({
                                dossierId,
                                fromPath: folderNode.path,
                                newName
                              })
                              if (ok) setRenamingFolderPath(null)
                            }}
                          />
                        ) : (
                          <span className="truncate text-sm font-semibold uppercase tracking-[0.04em] text-[#1a1a1a]">
                            {folderNode.name}
                          </span>
                        )}

                        {!isRenaming && folderNode.totalDescendants > 0 ? (
                          <span className="ml-auto shrink-0 rounded-full bg-deep-space px-2 py-0.5 text-xs font-medium text-[#5c5c5a]">
                            {folderNode.totalDescendants}
                          </span>
                        ) : !isRenaming ? (
                          <span className="ml-auto" aria-hidden="true" />
                        ) : null}

                        {!isRenaming ? (
                          <div className="pointer-events-auto flex shrink-0 items-center gap-1">
                            {isConfirmingDelete ? (
                              <ConfirmDeleteTray
                                label={t('documents.folder_delete_confirm_label', {
                                  defaultValue: 'Supprimer ?'
                                })}
                                confirmLabel={t('documents.folder_delete_confirm_action', {
                                  defaultValue: 'Confirmer'
                                })}
                                cancelLabel={t('documents.folder_delete_cancel_action', {
                                  defaultValue: 'Annuler'
                                })}
                                disabled={isMutatingTree}
                                onCancel={() => setConfirmDeleteFolderPath(null)}
                                onConfirm={async () => {
                                  const ok = await deleteFolderAction({
                                    dossierId,
                                    path: folderNode.path
                                  })
                                  if (ok) setConfirmDeleteFolderPath(null)
                                }}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  aria-label={t('documents.folder_new_child_action', {
                                    defaultValue: 'Nouveau sous-dossier ici'
                                  })}
                                  title={t('documents.folder_new_child_action', {
                                    defaultValue: 'Nouveau sous-dossier ici'
                                  })}
                                  disabled={isMutatingTree || creatingFolderAt !== null}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    clearTreeError()
                                    setExpandedPaths((previous) => {
                                      const next = new Set(previous)
                                      next.add(folderNode.path)
                                      return next
                                    })
                                    setCreatingFolderAt(folderNode.path)
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  <NewFolderIcon />
                                </button>
                                <button
                                  type="button"
                                  aria-label={t('documents.folder_rename_action', {
                                    defaultValue: 'Renommer'
                                  })}
                                  title={t('documents.folder_rename_action', {
                                    defaultValue: 'Renommer'
                                  })}
                                  disabled={isMutatingTree}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    clearTreeError()
                                    setRenamingFolderPath(folderNode.path)
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora"
                                >
                                  <PencilGlyph />
                                </button>
                                <button
                                  type="button"
                                  aria-label={
                                    isEmpty
                                      ? t('documents.folder_delete_action', {
                                          defaultValue: 'Supprimer'
                                        })
                                      : t('documents.folder_delete_blocked_action', {
                                          defaultValue: 'Le dossier doit être vide'
                                        })
                                  }
                                  title={
                                    isEmpty
                                      ? t('documents.folder_delete_action', {
                                          defaultValue: 'Supprimer'
                                        })
                                      : t('documents.folder_delete_blocked_action', {
                                          defaultValue: 'Le dossier doit être vide'
                                        })
                                  }
                                  disabled={isMutatingTree || !isEmpty}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    clearTreeError()
                                    setConfirmDeleteFolderPath(folderNode.path)
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-[#fbf0f0] hover:text-[#9c2f2f] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#5c5c5a]"
                                >
                                  <TrashGlyph />
                                </button>
                              </>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                }

                const isPreviewActive = activePreviewDocumentId === node.document.id
                const hasMetadata = Boolean(
                  node.document.description || node.document.tags.length > 0
                )
                const tags = [...node.document.tags].sort((a, b) => a.localeCompare(b))
                const visibleTags = tags.slice(0, 1)
                const hiddenTags = tags.slice(visibleTags.length)
                const overflowTagCount = hiddenTags.length
                const allTagsLabel = tags.join(', ')
                const isFileRenaming = renamingFilePath === node.document.id
                const isFileConfirmingDelete = confirmDeleteFilePath === node.document.id
                const fileNode = node

                return (
                  <div
                    key={getTreeNodeKey(node)}
                    ref={(element) => rowVirtualizer.measureElement(element)}
                    data-index={virtualItem.index}
                    data-document-row={node.document.id}
                    className={cn(
                      'group absolute inset-x-0 border-b border-deep-space transition-colors duration-150 last:border-b-0 hover:z-30 focus-within:z-30',
                      isPreviewActive ? 'bg-aurora/6' : 'hover:bg-[#fbf9f4]'
                    )}
                    style={{
                      minHeight: FILE_ROW_HEIGHT,
                      height: FILE_ROW_HEIGHT,
                      transform: `translateY(${virtualItem.start}px)`
                    }}
                  >
                    {isPreviewActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-0.75 bg-aurora"
                      />
                    ) : null}

                    {!isFileRenaming ? (
                      <button
                        type="button"
                        aria-label={t('documents.preview_show_action')}
                        className="absolute inset-0 z-0 w-full cursor-pointer rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-aurora/40"
                        onClick={() => openPreviewForDocument(fileNode.document.id)}
                      />
                    ) : null}

                    <div
                      className="pointer-events-none relative z-10 flex h-full items-center gap-3 pr-3"
                      style={{ paddingLeft: `${16 + fileNode.depth * INDENT_PX}px` }}
                    >
                      <FileIcon filename={fileNode.document.filename} />

                      <div className="min-w-0 flex-1">
                        {isFileRenaming ? (
                          <NameEditor
                            initialValue={fileNode.document.filename}
                            placeholder={t('documents.file_name_placeholder', {
                              defaultValue: 'Nom du fichier'
                            })}
                            confirmLabel={t('documents.file_rename_confirm', {
                              defaultValue: 'Renommer'
                            })}
                            cancelLabel={t('documents.file_rename_cancel', {
                              defaultValue: 'Annuler'
                            })}
                            invalidLabel={t('documents.file_name_invalid', {
                              defaultValue: 'Nom de fichier invalide'
                            })}
                            disabled={isMutatingTree}
                            onCancel={() => setRenamingFilePath(null)}
                            onConfirm={async (newFilename) => {
                              if (newFilename === fileNode.document.filename) {
                                setRenamingFilePath(null)
                                return
                              }
                              const ok = await renameFileAction({
                                dossierId,
                                documentId: fileNode.document.id,
                                newFilename
                              })
                              if (ok) setRenamingFilePath(null)
                            }}
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium text-[#1a1a1a]">
                                {fileNode.document.filename}
                              </p>
                              <span
                                className={cn(
                                  'h-1.5 w-1.5 shrink-0 rounded-full',
                                  getExtractionDotClass(fileNode.document.textExtraction.state)
                                )}
                                title={getExtractionLabel(
                                  fileNode.document.textExtraction.state,
                                  t
                                )}
                                aria-label={getExtractionLabel(
                                  fileNode.document.textExtraction.state,
                                  t
                                )}
                              />
                            </div>
                            {fileNode.document.description ? (
                              <p className="truncate text-xs text-[#8a8a85]">
                                {fileNode.document.description}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>

                      {!isFileConfirmingDelete ? (
                        <>
                          <div
                            aria-label={allTagsLabel || undefined}
                            className="group/tagcell pointer-events-auto relative hidden w-40 shrink-0 items-center gap-1 overflow-visible md:flex"
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                              {visibleTags.map((tag) => (
                                <span
                                  key={tag}
                                  title={allTagsLabel}
                                  className="truncate rounded-full border border-aurora/40 bg-aurora/15 px-2 py-0.5 text-xs text-aurora"
                                >
                                  {tag}
                                </span>
                              ))}
                              {overflowTagCount > 0 ? (
                                <span
                                  title={allTagsLabel}
                                  className="shrink-0 rounded-full bg-deep-space px-1.5 py-0.5 text-xs text-[#5c5c5a]"
                                >
                                  +{overflowTagCount}
                                </span>
                              ) : null}
                            </div>
                            {hiddenTags.length > 0 ? (
                              <div className="pointer-events-none invisible absolute top-full right-0 z-50 mt-1 flex max-w-70 flex-wrap items-center gap-1 rounded-xl border border-[#e5e3da] bg-white p-2 opacity-0 shadow-[0_8px_24px_rgba(15,122,138,0.16)] transition-opacity duration-150 group-hover/tagcell:visible group-hover/tagcell:opacity-100">
                                {hiddenTags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full border border-aurora/40 bg-aurora/15 px-2 py-0.5 text-xs text-aurora"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-[#5c5c5a] md:block">
                            {formatTimestamp(fileNode.document.modifiedAt, locale)}
                          </span>
                        </>
                      ) : null}

                      <div
                        className={cn(
                          'pointer-events-auto flex shrink-0 items-center justify-end gap-1',
                          isFileConfirmingDelete ? 'w-auto' : 'w-24'
                        )}
                      >
                        {isFileConfirmingDelete ? (
                          <ConfirmDeleteTray
                            label={t('documents.file_delete_confirm_label', {
                              defaultValue: 'Supprimer ?'
                            })}
                            confirmLabel={t('documents.file_delete_confirm_action', {
                              defaultValue: 'Confirmer'
                            })}
                            cancelLabel={t('documents.file_delete_cancel_action', {
                              defaultValue: 'Annuler'
                            })}
                            disabled={isMutatingTree}
                            onCancel={() => setConfirmDeleteFilePath(null)}
                            onConfirm={async () => {
                              const ok = await deleteFileAction({
                                dossierId,
                                documentId: fileNode.document.id
                              })
                              if (ok) setConfirmDeleteFilePath(null)
                            }}
                          />
                        ) : isFileRenaming ? null : (
                          <>
                            <button
                              type="button"
                              aria-label={
                                hasMetadata
                                  ? t('documents.metadata_edit_action')
                                  : t('documents.metadata_add_action')
                              }
                              title={
                                hasMetadata
                                  ? t('documents.metadata_edit_action')
                                  : t('documents.metadata_add_action')
                              }
                              disabled={isSavingMetadata}
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditingDocumentId(fileNode.document.id)
                              }}
                              className={cn(
                                'flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora',
                                (isPreviewActive || hasMetadata) && 'opacity-100',
                                hasMetadata && 'text-aurora'
                              )}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M8.5 1.5H2.5v6L9 14l5.5-5.5z" />
                                <circle cx="5.5" cy="4.5" r="0.75" fill="currentColor" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label={t('documents.file_rename_action', {
                                defaultValue: 'Renommer le fichier'
                              })}
                              title={t('documents.file_rename_action', {
                                defaultValue: 'Renommer le fichier'
                              })}
                              disabled={isMutatingTree}
                              onClick={(event) => {
                                event.stopPropagation()
                                clearTreeError()
                                setRenamingFilePath(fileNode.document.id)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora"
                            >
                              <PencilGlyph />
                            </button>
                            <button
                              type="button"
                              aria-label={t('documents.file_delete_action', {
                                defaultValue: 'Supprimer le fichier'
                              })}
                              title={t('documents.file_delete_action', {
                                defaultValue: 'Supprimer le fichier'
                              })}
                              disabled={isMutatingTree}
                              onClick={(event) => {
                                event.stopPropagation()
                                clearTreeError()
                                setConfirmDeleteFilePath(fileNode.document.id)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-[#fbf0f0] hover:text-[#9c2f2f]"
                            >
                              <TrashGlyph />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {isDrawerVisible ? (
            <button
              type="button"
              aria-label={t('documents.preview_close_action')}
              className="absolute inset-0 z-20 cursor-default bg-[rgba(15,122,138,0.06)] backdrop-blur-[1px] transition-opacity duration-200 lg:hidden"
              onClick={() => setIsPreviewOpen(false)}
            />
          ) : null}

          <div
            className={cn(
              'absolute inset-y-0 right-0 z-30 flex w-full max-w-full transform border-l border-[#e5e3da] bg-[#fbfaf6] shadow-[-12px_0_28px_rgba(15,122,138,0.08)] transition-transform duration-300 ease-out sm:w-105 lg:w-120 xl:w-140',
              isDrawerVisible ? 'translate-x-0' : 'pointer-events-none translate-x-full'
            )}
            aria-hidden={!isDrawerVisible}
          >
            <DocumentPreviewPanel
              activeDocument={activePreviewDocument}
              previewState={previewState}
              contentState={contentState}
              onClose={() => setIsPreviewOpen(false)}
              onOpen={() => {
                if (activePreviewDocument) {
                  void onOpenFile({
                    dossierId: activePreviewDocument.dossierId,
                    documentId: activePreviewDocument.id
                  })
                }
              }}
              onExtractContent={(forceRefresh, readCacheOnly) => {
                if (activePreviewDocument) {
                  void handleExtractContent({
                    dossierId: activePreviewDocument.dossierId,
                    documentId: activePreviewDocument.id,
                    forceRefresh,
                    readCacheOnly
                  })
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
