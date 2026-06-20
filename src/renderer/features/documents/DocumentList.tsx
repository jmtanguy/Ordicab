import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'

import type {
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentTrashEntry,
  DocumentWatchStatus
} from '@shared/types'

import { Button } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { cn } from '@renderer/lib/utils'
import {
  useDocumentStore,
  usePieceStore,
  type DocumentContentState,
  type DocumentPreviewState
} from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'

import { DocumentMetadataPanel } from './DocumentMetadataPanel'
import { DocumentPreviewPanel } from './DocumentPreviewPanel'

const FOLDER_ROW_HEIGHT = 40
const FILE_ROW_HEIGHT = 52
const MIN_VIEWPORT_HEIGHT = 480
const SSR_INITIAL_ROW_COUNT = 24
const INDENT_PX = 18
const ALL_EXTENSIONS_VALUE = '__all__'
const INTERNAL_DOCUMENTS_MIME = 'application/x-ordicab-documents'
const INTERNAL_FOLDER_MIME = 'application/x-ordicab-folder'
const MOVE_TARGET_ROOT = '__root__'

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
  return node.kind === 'folder' ? `folder:${node.path}` : `file:${node.document.path}`
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
  fg: 'text-ink-muted',
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
  '.csv': { bg: 'bg-[#dfeede]', fg: 'text-success-deep', label: 'CSV' },
  '.xls': { bg: 'bg-[#dfeede]', fg: 'text-success-deep', label: 'XLS' },
  '.xlsx': { bg: 'bg-[#dfeede]', fg: 'text-success-deep', label: 'XLS' },
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

function GripIcon(): React.JSX.Element {
  return (
    <svg width="10" height="14" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.3" />
      <circle cx="7" cy="3" r="1.3" />
      <circle cx="3" cy="8" r="1.3" />
      <circle cx="7" cy="8" r="1.3" />
      <circle cx="3" cy="13" r="1.3" />
      <circle cx="7" cy="13" r="1.3" />
    </svg>
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
          } else if (event.key === 'Enter') {
            event.preventDefault()
            if (valid) onConfirm(trimmed)
          }
        }}
        aria-invalid={!valid}
        aria-label={placeholder}
        className={cn(
          'h-7 min-w-0 flex-1 rounded-md border bg-white px-2 text-sm text-ink outline-none transition focus:ring-2 focus:ring-aurora/30',
          valid
            ? 'border-hairline focus:border-aurora'
            : 'border-destructive-border focus:border-destructive'
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
        className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-destructive-tint hover:text-destructive"
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

function BulkTagInput({
  placeholder,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel
}: {
  placeholder: string
  confirmLabel: string
  cancelLabel: string
  disabled?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const hasTags = value.split(',').some((tag) => tag.trim().length > 0)

  return (
    <form
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        if (hasTags) onConfirm(value)
      }}
      className="flex min-w-0 flex-1 items-center gap-1"
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
        aria-label={placeholder}
        className="h-7 min-w-0 flex-1 rounded-md border border-hairline bg-white px-2 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
      />
      <Button type="submit" variant="ghost" size="sm" disabled={!hasTags || disabled}>
        {confirmLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>
        {cancelLabel}
      </Button>
    </form>
  )
}

function TrashPanel({
  dossierId,
  onClose
}: {
  dossierId: string
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { showToast } = useToast()
  const listTrash = useDocumentStore((state) => state.listTrash)
  const restoreTrash = useDocumentStore((state) => state.restoreTrash)
  const deleteTrashEntry = useDocumentStore((state) => state.deleteTrashEntry)
  const [entries, setEntries] = useState<DocumentTrashEntry[] | null>(null)
  const [confirmingDeletionId, setConfirmingDeletionId] = useState<string | null>(null)
  const [busyDeletionId, setBusyDeletionId] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? 'en'

  const refresh = async (): Promise<void> => {
    setEntries((await listTrash({ dossierId })) ?? [])
  }

  useEffect(() => {
    void (async () => {
      setEntries((await listTrash({ dossierId })) ?? [])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId])

  const formatDeletedAt = (value: string): string => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value))
    } catch {
      return value
    }
  }

  const describeEntry = (entry: DocumentTrashEntry): string => {
    if (entry.kind === 'folder' && entry.folderPath) {
      return entry.folderPath
    }
    const names = entry.items.map((item) => item.relativePath.split('/').pop() ?? item.relativePath)
    const visible = names.slice(0, 3).join(', ')
    return names.length > 3 ? `${visible}… (+${names.length - 3})` : visible
  }

  const handleRestore = async (deletionId: string): Promise<void> => {
    setBusyDeletionId(deletionId)
    const ok = await restoreTrash({ dossierId, deletionId })
    setBusyDeletionId(null)
    if (ok) {
      showToast(t('documents.trash_restored', { defaultValue: 'Documents restaurés' }))
      await refresh()
    }
  }

  const handleDelete = async (deletionId: string): Promise<void> => {
    setBusyDeletionId(deletionId)
    const ok = await deleteTrashEntry({ dossierId, deletionId })
    setBusyDeletionId(null)
    setConfirmingDeletionId(null)
    if (ok) {
      showToast(t('documents.trash_purged', { defaultValue: 'Supprimé définitivement' }))
      await refresh()
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-ink">
          {t('documents.trash_panel_title', { defaultValue: 'Corbeille' })}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('documents.trash_panel_close', { defaultValue: 'Fermer' })}
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-aurora/10 hover:text-aurora"
        >
          ×
        </button>
      </div>

      <p className="text-xs text-ink-subtle">
        {t('documents.trash_panel_hint', {
          defaultValue:
            'Les éléments supprimés sont conservés 30 jours dans le dossier, puis purgés automatiquement.'
        })}
      </p>

      {entries === null ? (
        <p className="rounded-xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
          {t('documents.loading')}
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
          {t('documents.trash_panel_empty', { defaultValue: 'La corbeille est vide.' })}
        </p>
      ) : (
        <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
          {entries.map((entry) => {
            const isBusy = busyDeletionId === entry.deletionId
            const isConfirming = confirmingDeletionId === entry.deletionId
            const itemCount = entry.items.length
            return (
              <li
                key={entry.deletionId}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {entry.kind === 'folder' ? (
                      <span className="mr-1.5 rounded-full bg-deep-space px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                        {t('documents.trash_panel_folder', { defaultValue: 'Dossier' })}
                      </span>
                    ) : null}
                    {describeEntry(entry)}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {formatDeletedAt(entry.deletedAt)}
                    {itemCount > 0
                      ? ` · ${t('documents.trash_panel_count', {
                          count: itemCount,
                          defaultValue: '{{count}} fichier(s)'
                        })}`
                      : ''}
                  </p>
                </div>
                {isConfirming ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-destructive">
                      {t('documents.trash_panel_delete_confirm', {
                        defaultValue: 'Supprimer définitivement ?'
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleDelete(entry.deletionId)}
                      className="text-destructive hover:bg-destructive-tint"
                    >
                      {t('documents.trash_panel_delete_yes', { defaultValue: 'Confirmer' })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => setConfirmingDeletionId(null)}
                    >
                      {t('documents.trash_panel_delete_no', { defaultValue: 'Annuler' })}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleRestore(entry.deletionId)}
                    >
                      {t('documents.trash_panel_restore', { defaultValue: 'Restaurer' })}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => setConfirmingDeletionId(entry.deletionId)}
                      className="text-destructive hover:bg-destructive-tint"
                    >
                      {t('documents.trash_panel_delete', { defaultValue: 'Supprimer' })}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
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
      className="relative z-20 flex items-center gap-1.5 rounded-full border border-destructive-border bg-destructive-tint px-2 py-0.5"
    >
      <span className="text-xs font-semibold text-destructive">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        aria-label={confirmLabel}
        className="rounded-full px-2 py-0.5 text-xs font-semibold text-destructive transition hover:bg-[#f7dada] disabled:opacity-50"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onCancel}
        aria-label={cancelLabel}
        className="rounded-full px-2 py-0.5 text-xs text-ink-muted transition hover:bg-white/60 hover:text-ink disabled:opacity-50"
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
  const trashFilesAction = useDocumentStore((state) => state.trashFiles)
  const restoreTrashAction = useDocumentStore((state) => state.restoreTrash)
  const importFilesAction = useDocumentStore((state) => state.importFiles)
  const moveFilesAction = useDocumentStore((state) => state.moveFiles)
  const moveFolderAction = useDocumentStore((state) => state.moveFolder)
  const mergePdfsAction = useDocumentStore((state) => state.mergePdfs)
  const splitPdfAction = useDocumentStore((state) => state.splitPdf)
  const clearTreeError = useDocumentStore((state) => state.clearTreeError)
  const pieces = usePieceStore((state) => state.piecesByDossierId[dossierId])
  const loadPieces = usePieceStore((state) => state.load)
  const { showToast } = useToast()
  // null = no external drag in progress; '' = dossier root is the drop target.
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null)
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [filenameFilter, setFilenameFilter] = useState('')
  const [extensionFilter, setExtensionFilter] = useState(ALL_EXTENSIONS_VALUE)
  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [renamingFilePath, setRenamingFilePath] = useState<string | null>(null)
  const [confirmDeleteFolderPath, setConfirmDeleteFolderPath] = useState<string | null>(null)
  const [confirmDeleteFilePath, setConfirmDeleteFilePath] = useState<string | null>(null)
  const [isTrashOpen, setIsTrashOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>(
    () => (getLocalStorageItem('documents-sort-by') as SortBy) ?? 'name'
  )
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(
    () => activePreviewDocumentId !== null
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [isBulkTagging, setIsBulkTagging] = useState(false)
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

    if (!documents.some((document) => document.path === editingDocumentId)) {
      setEditingDocumentId(null)
    }
  }, [documents, editingDocumentId])

  useEffect(() => {
    if (activePreviewDocumentId) {
      setIsPreviewOpen(true)
    }
  }, [activePreviewDocumentId])

  // Cotation lookup: the delete confirmation warns when a document is a pièce
  // du bordereau (the pièce entry itself survives with a "source manquante"
  // state — its number is permanent and never reassigned).
  useEffect(() => {
    void loadPieces({ dossierId })
  }, [dossierId, loadPieces])

  const pieceNumberByDocumentUuid = useMemo(
    () => new Map((pieces ?? []).map((piece) => [piece.documentUuid, piece.pieceNumber])),
    [pieces]
  )

  const searchTerms = filenameFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  const editingDocument = documents.find((document) => document.path === editingDocumentId) ?? null
  const activePreviewDocument =
    documents.find((document) => document.path === activePreviewDocumentId) ?? null
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
  // Visible file ids in render order — shift-click ranges follow the on-screen
  // order (sort, filter, and folder expansion included).
  const visibleFileIds = useMemo(
    () => flatNodes.flatMap((node) => (node.kind === 'file' ? [node.document.path] : [])),
    [flatNodes]
  )

  // Drop selected ids whose documents disappeared (delete, move, dossier switch).
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) {
        return previous
      }
      const existing = new Set(documents.map((document) => document.path))
      const next = new Set([...previous].filter((id) => existing.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [documents])

  useEffect(() => {
    if (selectedIds.size === 0) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedIds(new Set())
        setSelectionAnchorId(null)
        setIsBulkTagging(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIds.size])

  const clearSelection = (): void => {
    setSelectedIds(new Set())
    setSelectionAnchorId(null)
    setIsBulkTagging(false)
  }

  const handleFileRowClick = (event: React.MouseEvent, documentPath: string): void => {
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((previous) => {
        const next = new Set(previous)
        if (next.has(documentPath)) {
          next.delete(documentPath)
        } else {
          next.add(documentPath)
        }
        return next
      })
      setSelectionAnchorId(documentPath)
      return
    }

    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = visibleFileIds.indexOf(selectionAnchorId)
      const targetIndex = visibleFileIds.indexOf(documentPath)
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [from, to] =
          anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        setSelectedIds(new Set(visibleFileIds.slice(from, to + 1)))
        return
      }
    }

    setSelectedIds(new Set([documentPath]))
    setSelectionAnchorId(documentPath)
    openPreviewForDocument(documentPath)
  }

  const applyBulkTags = async (tagsInput: string): Promise<void> => {
    const newTags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
    if (newTags.length === 0 || selectedIds.size === 0) {
      setIsBulkTagging(false)
      return
    }

    const targets = documents.filter((document) => selectedIds.has(document.path))
    let savedCount = 0
    for (const document of targets) {
      const mergedTags = [...new Set([...document.tags, ...newTags])]
      const ok = await onSaveMetadata({
        dossierId,
        documentPath: document.path,
        description: document.description,
        tags: mergedTags
      })
      if (ok) {
        savedCount += 1
      }
    }

    setIsBulkTagging(false)
    showToast(
      t('documents.bulk_tags_applied', {
        count: savedCount,
        defaultValue: 'Tags ajoutés à {{count}} document(s)'
      }),
      savedCount === targets.length ? 'success' : 'warning'
    )
  }

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

  const openPreviewForDocument = (documentPath: string): void => {
    setIsPreviewOpen(true)
    void onOpenPreview({ dossierId, documentPath })
  }

  const getDragKind = (event: React.DragEvent): 'external' | 'documents' | 'folder' | null => {
    const types = Array.from(event.dataTransfer.types)
    if (types.includes(INTERNAL_DOCUMENTS_MIME)) return 'documents'
    if (types.includes(INTERNAL_FOLDER_MIME)) return 'folder'
    if (types.includes('Files')) return 'external'
    return null
  }

  const handleTargetDragOver = (event: React.DragEvent, targetPath: string): void => {
    const kind = getDragKind(event)
    if (!kind) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = kind === 'external' ? 'copy' : 'move'
    if (dropTargetPath !== targetPath) {
      setDropTargetPath(targetPath)
    }
  }

  const handleContainerDragLeave = (event: React.DragEvent): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropTargetPath(null)
    }
  }

  const handleTargetDragLeave = (targetPath: string): void => {
    setDropTargetPath((current) => (current === targetPath ? null : current))
  }

  const resetDragState = (): void => {
    setDraggingRowKey(null)
    setDropTargetPath(null)
  }

  const handleMoveDocuments = async (
    documentPaths: string[],
    targetFolderPath: string
  ): Promise<void> => {
    const result = await moveFilesAction({ dossierId, documentPaths, targetFolderPath })
    if (!result || (result.moved.length === 0 && result.failed.length === 0)) {
      return
    }
    if (result.failed.length === 0) {
      showToast(
        t('documents.move_success', {
          count: result.moved.length,
          defaultValue: '{{count}} document(s) déplacé(s)'
        })
      )
    } else if (result.moved.length > 0) {
      showToast(
        t('documents.move_partial', {
          moved: result.moved.length,
          failed: result.failed.length,
          defaultValue: '{{moved}} déplacé(s), {{failed}} en échec'
        }),
        'warning'
      )
    } else {
      showToast(
        t('documents.move_failed', {
          error: result.failed[0]?.error ?? '',
          defaultValue: 'Déplacement impossible : {{error}}'
        }),
        'error'
      )
    }
  }

  const handleTrashDocuments = async (documentPaths: string[]): Promise<void> => {
    const cotedNumbers = documents
      .filter(
        (document) =>
          documentPaths.includes(document.path) &&
          document.uuid &&
          pieceNumberByDocumentUuid.has(document.uuid)
      )
      .map((document) => pieceNumberByDocumentUuid.get(document.uuid!)!)
      .sort((left, right) => left - right)
    const result = await trashFilesAction({ dossierId, documentPaths })
    if (!result) {
      return
    }
    if (result.trashedCount > 0 && cotedNumbers.length > 0) {
      showToast(
        t('documents.trash_coted_warning', {
          defaultValue:
            'Pièce(s) n°{{numbers}} du bordereau : la cotation est conservée avec la mention « source manquante ».',
          numbers: cotedNumbers.join(', n°')
        }),
        'warning',
        { durationMs: 8000 }
      )
    }
    if (result.deletionId === null) {
      if (result.failed.length > 0) {
        showToast(
          t('documents.trash_failed', {
            error: result.failed[0]?.error ?? '',
            defaultValue: 'Suppression impossible : {{error}}'
          }),
          'error'
        )
      }
      return
    }
    const deletionId = result.deletionId
    showToast(
      t('documents.trash_success', {
        count: result.trashedCount,
        defaultValue: '{{count}} document(s) supprimé(s)'
      }),
      result.failed.length === 0 ? 'success' : 'warning',
      {
        actionLabel: t('documents.trash_undo', { defaultValue: 'Annuler' }),
        onAction: () => {
          void restoreTrashAction({ dossierId, deletionId })
        },
        durationMs: 8000
      }
    )
  }

  const selectedPdfIdsInOrder = visibleFileIds.filter(
    (id) => selectedIds.has(id) && id.toLowerCase().endsWith('.pdf')
  )
  const canMergeSelection =
    selectedIds.size >= 2 && selectedPdfIdsInOrder.length === selectedIds.size

  const handleMergeSelectedPdfs = async (): Promise<void> => {
    const result = await mergePdfsAction({
      dossierId,
      documentPaths: selectedPdfIdsInOrder,
      outputFilename: t('documents.pdf_merge_default_name', { defaultValue: 'Fusion.pdf' })
    })
    if (result) {
      showToast(
        t('documents.pdf_merge_success', {
          name: result.relativePaths[0] ?? '',
          defaultValue: 'PDF fusionné : {{name}}'
        })
      )
    }
  }

  const handleSplitPdf = async (documentPath: string): Promise<void> => {
    const result = await splitPdfAction({ dossierId, documentPath, mode: 'each-page' })
    if (result) {
      showToast(
        t('documents.pdf_split_success', {
          count: result.relativePaths.length,
          defaultValue: 'PDF divisé en {{count}} fichier(s)'
        })
      )
    }
  }

  const handleExternalImportDrop = (event: React.DragEvent, targetPath: string): void => {
    const api = getOrdicabApi()
    if (!api) {
      return
    }

    const sourcePaths = Array.from(event.dataTransfer.files)
      .map((file) => api.webUtils.getPathForFile(file))
      .filter((path) => path.length > 0)

    if (sourcePaths.length === 0) {
      showToast(
        t('documents.import_no_paths', {
          defaultValue: 'Ces éléments ne peuvent pas être importés.'
        }),
        'warning'
      )
      return
    }

    void importFilesAction({ dossierId, targetFolderPath: targetPath, sourcePaths }).then(
      (result) => {
        if (!result) {
          return
        }
        if (result.failed.length === 0) {
          showToast(
            t('documents.import_success', {
              count: result.imported.length,
              defaultValue: '{{count}} fichier(s) importé(s)'
            })
          )
        } else if (result.imported.length > 0) {
          showToast(
            t('documents.import_partial', {
              imported: result.imported.length,
              failed: result.failed.length,
              defaultValue: '{{imported}} importé(s), {{failed}} en échec'
            }),
            'warning'
          )
        } else {
          showToast(
            t('documents.import_failed', {
              count: result.failed.length,
              defaultValue: "Échec de l'import"
            }),
            'error'
          )
        }
      }
    )
  }

  const handleTargetDrop = (event: React.DragEvent, targetPath: string): void => {
    const kind = getDragKind(event)
    if (!kind) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resetDragState()

    if (kind === 'external') {
      handleExternalImportDrop(event, targetPath)
      return
    }

    if (kind === 'documents') {
      let documentPaths: string[] = []
      try {
        const parsed: unknown = JSON.parse(event.dataTransfer.getData(INTERNAL_DOCUMENTS_MIME))
        if (Array.isArray(parsed)) {
          documentPaths = parsed.filter((id): id is string => typeof id === 'string')
        }
      } catch {
        return
      }
      if (documentPaths.length > 0) {
        void handleMoveDocuments(documentPaths, targetPath)
      }
      return
    }

    const fromPath = event.dataTransfer.getData(INTERNAL_FOLDER_MIME)
    if (!fromPath || fromPath === targetPath) {
      return
    }
    void moveFolderAction({ dossierId, fromPath, targetFolderPath: targetPath }).then((ok) => {
      if (ok) {
        showToast(
          t('documents.move_folder_success', {
            defaultValue: 'Dossier déplacé'
          })
        )
      }
    })
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
          <p className="text-xs uppercase tracking-[0.16em] text-ink-muted">
            {t('documents.section_badge')}
          </p>
          {totalDocumentCount > 0 ? (
            <span className="text-xs text-ink-subtle">{countLabel}</span>
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
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsTrashOpen(true)}>
            <span className="inline-flex items-center gap-1.5">
              <TrashGlyph />
              {t('documents.trash_panel_title', { defaultValue: 'Corbeille' })}
            </span>
          </Button>
          {onNavigateToGenerate ? (
            <Button type="button" variant="ghost" size="sm" onClick={onNavigateToGenerate}>
              {t('documents.generate_action')}
            </Button>
          ) : null}
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-aurora/30 bg-aurora/5 px-3 py-2">
          <span className="rounded-full bg-aurora/15 px-2.5 py-0.5 text-xs font-semibold text-aurora">
            {t('documents.selection_count', {
              count: selectedIds.size,
              defaultValue: '{{count}} sélectionné(s)'
            })}
          </span>

          {isBulkTagging ? (
            <BulkTagInput
              placeholder={t('documents.bulk_tags_placeholder', {
                defaultValue: 'tags séparés par des virgules'
              })}
              confirmLabel={t('documents.bulk_tags_confirm', { defaultValue: 'Ajouter' })}
              cancelLabel={t('documents.bulk_tags_cancel', { defaultValue: 'Annuler' })}
              disabled={isSavingMetadata}
              onCancel={() => setIsBulkTagging(false)}
              onConfirm={(value) => void applyBulkTags(value)}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isSavingMetadata}
              onClick={() => setIsBulkTagging(true)}
            >
              {t('documents.bulk_tags_action', { defaultValue: 'Ajouter des tags' })}
            </Button>
          )}

          {!isBulkTagging && canMergeSelection ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isMutatingTree}
              onClick={() => void handleMergeSelectedPdfs()}
            >
              {t('documents.pdf_merge_action', { defaultValue: 'Fusionner les PDF' })}
            </Button>
          ) : null}

          {!isBulkTagging ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isMutatingTree}
              onClick={() => void handleTrashDocuments([...selectedIds])}
              className="text-destructive hover:bg-destructive-tint"
            >
              {t('documents.bulk_trash_action', { defaultValue: 'Supprimer' })}
            </Button>
          ) : null}

          {!isBulkTagging ? (
            <select
              value=""
              disabled={isMutatingTree}
              onChange={(event) => {
                const value = event.target.value
                if (!value) {
                  return
                }
                const targetFolderPath = value === MOVE_TARGET_ROOT ? '' : value
                void handleMoveDocuments([...selectedIds], targetFolderPath)
              }}
              aria-label={t('documents.move_to_action', { defaultValue: 'Déplacer vers…' })}
              className="h-8 rounded-full border border-hairline bg-white px-3 text-xs text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
            >
              <option value="">
                {t('documents.move_to_action', { defaultValue: 'Déplacer vers…' })}
              </option>
              <option value={MOVE_TARGET_ROOT}>
                {t('documents.move_to_root', { defaultValue: 'Racine du dossier' })}
              </option>
              {folderPaths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            onClick={clearSelection}
            aria-label={t('documents.selection_clear', { defaultValue: 'Tout désélectionner' })}
            title={t('documents.selection_clear', { defaultValue: 'Tout désélectionner' })}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-white/70 hover:text-ink"
          >
            ×
          </button>
        </div>
      ) : null}

      {!isLoading && documents.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
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
              className="h-10 w-full rounded-full border border-hairline bg-white pl-9 pr-4 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-aurora focus:ring-2 focus:ring-aurora/30"
            />
          </div>

          <select
            id="document-list-extension"
            value={extensionFilter}
            onChange={(event) => setExtensionFilter(event.target.value)}
            aria-label={t('documents.filter_extension_label')}
            className="h-10 rounded-full border border-hairline bg-white px-4 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
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
            className="h-10 rounded-full border border-hairline bg-white px-4 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
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
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col overflow-y-auto rounded-[28px] border border-hairline-strong bg-parchment p-5 shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15"
          >
            <DocumentMetadataPanel
              key={`${dossierId}:${editingDocument.path}:${editingDocument.description ?? ''}:${editingDocument.tags.join('\u0000')}`}
              document={editingDocument}
              disabled={isSavingMetadata}
              onCancel={() => setEditingDocumentId(null)}
              onSave={onSaveMetadata}
            />
          </div>
        </div>
      ) : null}

      {isTrashOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,122,138,0.18)] p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col overflow-y-auto rounded-[28px] border border-hairline-strong bg-parchment p-5 shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15"
          >
            <TrashPanel dossierId={dossierId} onClose={() => setIsTrashOpen(false)} />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive-border bg-destructive-tint p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {treeError ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive-border bg-destructive-tint p-3 text-sm text-destructive">
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
            <span className="truncate text-xs text-ink-muted">
              {t('documents.folder_create_in', { defaultValue: 'Dans' })}{' '}
              <span className="font-semibold text-ink">{creatingFolderAt}/</span>
            </span>
          ) : (
            <span className="text-xs uppercase tracking-[0.12em] text-ink-muted">
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
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
          {t('documents.loading')}
        </p>
      ) : null}

      {!isLoading && documents.length === 0 && folderPaths.length === 0 && !creatingFolderAt ? (
        <p
          onDragOver={(event) => handleTargetDragOver(event, '')}
          onDragLeave={handleContainerDragLeave}
          onDrop={(event) => handleTargetDrop(event, '')}
          className={cn(
            'rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink',
            dropTargetPath === '' && 'border-aurora bg-aurora/5'
          )}
        >
          {t('documents.empty')}
        </p>
      ) : null}

      {!isLoading && documents.length > 0 && !hasVisibleDocuments ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
          {t('documents.no_results')}
        </p>
      ) : null}

      {!isLoading && hasVisibleDocuments ? (
        <div
          onDragOver={(event) => handleTargetDragOver(event, '')}
          onDragLeave={handleContainerDragLeave}
          onDrop={(event) => handleTargetDrop(event, '')}
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-hairline bg-white shadow-[0_1px_2px_rgba(15,122,138,0.04)]',
            dropTargetPath === '' && 'ring-2 ring-inset ring-aurora/60'
          )}
        >
          <div className="flex h-9 items-center gap-3 border-b border-deep-space bg-parchment-bright px-4 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
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
                  const folderNode = node
                  const folderRowKey = getTreeNodeKey(folderNode)

                  return (
                    <div
                      key={folderRowKey}
                      ref={(element) => rowVirtualizer.measureElement(element)}
                      data-index={virtualItem.index}
                      data-folder-row={node.path}
                      draggable={!isRenaming}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(INTERNAL_FOLDER_MIME, folderNode.path)
                        event.dataTransfer.effectAllowed = 'move'
                        // Mutating the DOM during dragstart aborts the drag in Chromium.
                        window.setTimeout(() => setDraggingRowKey(folderRowKey), 0)
                      }}
                      onDragEnd={resetDragState}
                      onDragOver={(event) => handleTargetDragOver(event, folderNode.path)}
                      onDragLeave={() => handleTargetDragLeave(folderNode.path)}
                      onDrop={(event) => handleTargetDrop(event, folderNode.path)}
                      className={cn(
                        'group absolute inset-x-0 border-b border-deep-space transition-colors duration-150 last:border-b-0 hover:bg-parchment-bright',
                        !isRenaming && 'cursor-grab',
                        dropTargetPath === folderNode.path &&
                          'bg-aurora/10 ring-2 ring-inset ring-aurora/60',
                        draggingRowKey === folderRowKey && 'opacity-50'
                      )}
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
                        {!isRenaming ? (
                          <span
                            aria-hidden="true"
                            title={t('documents.drag_hint', {
                              defaultValue: 'Glisser pour déplacer'
                            })}
                            className="shrink-0 cursor-grab text-ink-subtle opacity-40 transition group-hover:opacity-100"
                          >
                            <GripIcon />
                          </span>
                        ) : null}
                        <svg
                          className="shrink-0 text-ink-subtle transition-transform duration-200"
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
                          <span className="truncate text-sm font-semibold uppercase tracking-[0.04em] text-ink">
                            {folderNode.name}
                          </span>
                        )}

                        {!isRenaming && folderNode.totalDescendants > 0 ? (
                          <span className="ml-auto shrink-0 rounded-full bg-deep-space px-2 py-0.5 text-xs font-medium text-ink-muted">
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
                                  const result = await deleteFolderAction({
                                    dossierId,
                                    path: folderNode.path
                                  })
                                  if (!result) {
                                    return
                                  }
                                  setConfirmDeleteFolderPath(null)
                                  const deletionId = result.deletionId
                                  showToast(
                                    t('documents.folder_trash_success', {
                                      name: folderNode.name,
                                      defaultValue: 'Dossier « {{name}} » supprimé'
                                    }),
                                    'success',
                                    {
                                      actionLabel: t('documents.trash_undo', {
                                        defaultValue: 'Annuler'
                                      }),
                                      onAction: () => {
                                        void restoreTrashAction({ dossierId, deletionId })
                                      },
                                      durationMs: 8000
                                    }
                                  )
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
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora disabled:cursor-not-allowed disabled:opacity-30"
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
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora"
                                >
                                  <PencilGlyph />
                                </button>
                                <button
                                  type="button"
                                  aria-label={t('documents.folder_delete_action', {
                                    defaultValue: 'Supprimer'
                                  })}
                                  title={t('documents.folder_delete_action', {
                                    defaultValue: 'Supprimer'
                                  })}
                                  disabled={isMutatingTree}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    clearTreeError()
                                    setConfirmDeleteFolderPath(folderNode.path)
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-destructive-tint hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
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

                const isPreviewActive = activePreviewDocumentId === node.document.path
                const hasMetadata = Boolean(
                  node.document.description || node.document.tags.length > 0
                )
                const tags = [...node.document.tags].sort((a, b) => a.localeCompare(b))
                const visibleTags = tags.slice(0, 1)
                const hiddenTags = tags.slice(visibleTags.length)
                const overflowTagCount = hiddenTags.length
                const allTagsLabel = tags.join(', ')
                const isFileRenaming = renamingFilePath === node.document.path
                const isFileConfirmingDelete = confirmDeleteFilePath === node.document.path
                const isSelected = selectedIds.has(node.document.path)
                const isPdfRow = node.document.filename.toLowerCase().endsWith('.pdf')
                const fileNode = node
                const fileRowKey = getTreeNodeKey(fileNode)
                const fileParentPath = node.document.relativePath.includes('/')
                  ? node.document.relativePath.slice(0, node.document.relativePath.lastIndexOf('/'))
                  : ''

                return (
                  <div
                    key={fileRowKey}
                    ref={(element) => rowVirtualizer.measureElement(element)}
                    data-index={virtualItem.index}
                    data-document-row={node.document.path}
                    draggable={!isFileRenaming}
                    onDragStart={(event) => {
                      const draggedIds = selectedIds.has(fileNode.document.path)
                        ? [...selectedIds]
                        : [fileNode.document.path]
                      event.dataTransfer.setData(
                        INTERNAL_DOCUMENTS_MIME,
                        JSON.stringify(draggedIds)
                      )
                      event.dataTransfer.effectAllowed = 'move'
                      // Mutating the DOM during dragstart aborts the drag in Chromium.
                      window.setTimeout(() => setDraggingRowKey(fileRowKey), 0)
                    }}
                    onDragEnd={resetDragState}
                    onDragOver={(event) => handleTargetDragOver(event, fileParentPath)}
                    onDragLeave={() => handleTargetDragLeave(fileParentPath)}
                    onDrop={(event) => handleTargetDrop(event, fileParentPath)}
                    className={cn(
                      'group absolute inset-x-0 border-b border-deep-space transition-colors duration-150 last:border-b-0 hover:z-30 focus-within:z-30',
                      !isFileRenaming && 'cursor-grab',
                      isPreviewActive ? 'bg-aurora/6' : 'hover:bg-parchment-bright',
                      isSelected && 'bg-aurora/12 hover:bg-aurora/12',
                      draggingRowKey === fileRowKey && 'opacity-50'
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
                        onClick={(event) => handleFileRowClick(event, fileNode.document.path)}
                      />
                    ) : null}

                    <div
                      className="pointer-events-none relative z-10 flex h-full items-center gap-3 pr-3"
                      style={{ paddingLeft: `${16 + fileNode.depth * INDENT_PX}px` }}
                    >
                      {!isFileRenaming ? (
                        <span
                          aria-hidden="true"
                          title={t('documents.drag_hint', {
                            defaultValue: 'Glisser pour déplacer'
                          })}
                          className="shrink-0 cursor-grab text-ink-subtle opacity-40 transition group-hover:opacity-100"
                        >
                          <GripIcon />
                        </span>
                      ) : null}
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
                            onConfirm={async (rawFilename) => {
                              // Si l'utilisateur n'a pas saisi d'extension, réutiliser
                              // celle du fichier d'origine automatiquement.
                              const dot = fileNode.document.filename.lastIndexOf('.')
                              const originalExt =
                                dot > 0 ? fileNode.document.filename.slice(dot) : ''
                              const hasExtension = rawFilename.lastIndexOf('.') > 0
                              const newFilename =
                                !hasExtension && originalExt
                                  ? `${rawFilename}${originalExt}`
                                  : rawFilename
                              if (newFilename === fileNode.document.filename) {
                                setRenamingFilePath(null)
                                return
                              }
                              const ok = await renameFileAction({
                                dossierId,
                                documentPath: fileNode.document.path,
                                newFilename
                              })
                              if (ok) setRenamingFilePath(null)
                            }}
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <p className="min-w-0 truncate text-sm font-medium text-ink">
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
                              <p className="truncate text-xs text-ink-subtle">
                                {fileNode.document.description}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>

                      {!isFileRenaming && !isFileConfirmingDelete ? (
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
                                  className="shrink-0 rounded-full bg-deep-space px-1.5 py-0.5 text-xs text-ink-muted"
                                >
                                  +{overflowTagCount}
                                </span>
                              ) : null}
                            </div>
                            {hiddenTags.length > 0 ? (
                              <div className="pointer-events-none invisible absolute top-full right-0 z-50 mt-1 flex max-w-70 flex-wrap items-center gap-1 rounded-xl border border-hairline bg-white p-2 opacity-0 shadow-[0_8px_24px_rgba(15,122,138,0.16)] transition-opacity duration-150 group-hover/tagcell:visible group-hover/tagcell:opacity-100">
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

                          <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-ink-muted md:block">
                            {formatTimestamp(fileNode.document.modifiedAt, locale)}
                          </span>
                        </>
                      ) : null}

                      <div
                        className={cn(
                          'pointer-events-auto flex shrink-0 items-center justify-end gap-1',
                          isFileConfirmingDelete ? 'w-auto' : isPdfRow ? 'w-32' : 'w-24'
                        )}
                      >
                        {isFileConfirmingDelete ? (
                          <ConfirmDeleteTray
                            label={
                              fileNode.document.uuid &&
                              pieceNumberByDocumentUuid.has(fileNode.document.uuid)
                                ? t('documents.file_delete_confirm_label_piece', {
                                    defaultValue:
                                      'Pièce n°{{number}} du bordereau — supprimer ? (la cotation restera, marquée « source manquante »)',
                                    number: pieceNumberByDocumentUuid.get(fileNode.document.uuid)
                                  })
                                : t('documents.file_delete_confirm_label', {
                                    defaultValue: 'Supprimer ?'
                                  })
                            }
                            confirmLabel={t('documents.file_delete_confirm_action', {
                              defaultValue: 'Confirmer'
                            })}
                            cancelLabel={t('documents.file_delete_cancel_action', {
                              defaultValue: 'Annuler'
                            })}
                            disabled={isMutatingTree}
                            onCancel={() => setConfirmDeleteFilePath(null)}
                            onConfirm={async () => {
                              setConfirmDeleteFilePath(null)
                              await handleTrashDocuments([fileNode.document.path])
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
                                setEditingDocumentId(fileNode.document.path)
                              }}
                              className={cn(
                                'flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora',
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
                            {isPdfRow ? (
                              <button
                                type="button"
                                aria-label={t('documents.pdf_split_action', {
                                  defaultValue: 'Diviser le PDF (une page par fichier)'
                                })}
                                title={t('documents.pdf_split_action', {
                                  defaultValue: 'Diviser le PDF (une page par fichier)'
                                })}
                                disabled={isMutatingTree}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  clearTreeError()
                                  void handleSplitPdf(fileNode.document.path)
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora disabled:cursor-not-allowed disabled:opacity-30"
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
                                  <path d="M3 2.5h6l4 4v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
                                  <path d="M2 8.5h12" strokeDasharray="2 2" />
                                </svg>
                              </button>
                            ) : null}
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
                                setRenamingFilePath(fileNode.document.path)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-aurora/10 hover:text-aurora"
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
                                setConfirmDeleteFilePath(fileNode.document.path)
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100 hover:bg-destructive-tint hover:text-destructive"
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
              'absolute inset-y-0 right-0 z-30 flex w-full max-w-full transform border-l border-hairline bg-[#fbfaf6] shadow-[-12px_0_28px_rgba(15,122,138,0.08)] transition-transform duration-300 ease-out sm:w-[min(92vw,28rem)] lg:w-[min(60vw,40rem)] xl:w-[min(55vw,52rem)] 2xl:w-[min(50vw,64rem)]',
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
                    documentPath: activePreviewDocument.path
                  })
                }
              }}
              onExtractContent={(forceRefresh, readCacheOnly) => {
                if (activePreviewDocument) {
                  void handleExtractContent({
                    dossierId: activePreviewDocument.dossierId,
                    documentPath: activePreviewDocument.path,
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
