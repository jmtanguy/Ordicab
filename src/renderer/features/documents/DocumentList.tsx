import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'

import type {
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentWatchStatus
} from '@shared/types'

import { Card, Button } from '@renderer/components/ui'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'

import { DocumentMetadataPanel } from './DocumentMetadataPanel'
import { DocumentPreviewPanel } from './DocumentPreviewPanel'

const FOLDER_ROW_HEIGHT = 44
const FILE_ROW_HEIGHT = 84
const FILE_ROW_HEIGHT_WITH_ONE_META = 108
const FILE_ROW_HEIGHT_WITH_BOTH_META = 132
const MIN_VIEWPORT_HEIGHT = 420
const SSR_INITIAL_ROW_COUNT = 16
const INDENT_PX = 16
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
type ExtractDialogPhase = 'idle' | 'confirm' | 'running' | 'done'

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
  documents: DocumentRecord[]
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
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function getFileRowHeight(document: DocumentRecord): number {
  const hasDescription = Boolean(document.description)
  const hasTags = document.tags.length > 0
  if (hasDescription && hasTags) return FILE_ROW_HEIGHT_WITH_BOTH_META
  if (hasDescription || hasTags) return FILE_ROW_HEIGHT_WITH_ONE_META
  return FILE_ROW_HEIGHT
}

function getDocumentExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.')

  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) {
    return ''
  }

  return filename.slice(lastDotIndex).toLowerCase()
}

function getExtractionBadgeTone(state: DocumentRecord['textExtraction']['state']): string {
  if (state === 'extracted') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
  if (state === 'extractable') return 'border-amber-300/30 bg-amber-300/10 text-amber-100'
  return 'border-slate-600/40 bg-slate-800/60 text-slate-300'
}

function getExtractionBadgeLabel(
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
  onExtractPendingContent,
  onClearContentCache,
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
  onExtractPendingContent?: (input: { dossierId: string }) => Promise<{
    attempted: number
    succeeded: number
    failed: number
  }>
  onClearContentCache?: (input: { dossierId: string }) => Promise<boolean>
  onNavigateToGenerate?: () => void
}): React.JSX.Element {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const { t, i18n } = useTranslation()
  void watchStatus
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [filenameFilter, setFilenameFilter] = useState('')
  const [extensionFilter, setExtensionFilter] = useState(ALL_EXTENSIONS_VALUE)
  const [sortBy, setSortBy] = useState<SortBy>(
    () => (getLocalStorageItem('documents-sort-by') as SortBy) ?? 'name'
  )
  const [extractDialogPhase, setExtractDialogPhase] = useState<ExtractDialogPhase>('idle')
  const [extractProgress, setExtractProgress] = useState<{
    current: number
    total: number
    succeeded: number
    failed: number
    currentFilename: string | null
    wasAborted: boolean
  }>({ current: 0, total: 0, succeeded: 0, failed: 0, currentFilename: null, wasAborted: false })
  const abortRequestedRef = useRef(false)

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
  const pendingExtractableCount = documents.filter(
    (document) =>
      document.textExtraction.isExtractable && document.textExtraction.state !== 'extracted'
  ).length
  const totalExtractableCount = documents.filter(
    (document) => document.textExtraction.isExtractable
  ).length
  const allExtracted = totalExtractableCount > 0 && pendingExtractableCount === 0
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
  const folderMap = useMemo(() => buildFolderMap(filteredDocuments), [filteredDocuments])
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

  // TanStack Virtual is the approved large-list path for this surface.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    estimateSize: (index) => {
      const node = flatNodes[index]

      if (!node) {
        return FILE_ROW_HEIGHT
      }

      return node.kind === 'folder' ? FOLDER_ROW_HEIGHT : getFileRowHeight(node.document)
    },
    getItemKey: (index) => {
      const node = flatNodes[index]

      return node ? getTreeNodeKey(node) : index
    },
    getScrollElement: () => parentRef.current,
    overscan: 6,
    initialRect: { height: MIN_VIEWPORT_HEIGHT, width: 0 }
  })

  const virtualItems =
    typeof window === 'undefined'
      ? flatNodes
          .slice(0, Math.min(flatNodes.length, SSR_INITIAL_ROW_COUNT))
          .map((node, index) => ({
            index,
            key: getTreeNodeKey(node),
            size: node.kind === 'folder' ? FOLDER_ROW_HEIGHT : getFileRowHeight(node.document),
            start:
              flatNodes
                .slice(0, index)
                .reduce(
                  (sum, currentNode) =>
                    sum +
                    (currentNode.kind === 'folder'
                      ? FOLDER_ROW_HEIGHT
                      : getFileRowHeight(currentNode.document)),
                  0
                ) ?? 0
          }))
      : rowVirtualizer.getVirtualItems()

  const totalSize =
    typeof window === 'undefined'
      ? flatNodes.reduce(
          (sum, node) =>
            sum + (node.kind === 'folder' ? FOLDER_ROW_HEIGHT : getFileRowHeight(node.document)),
          0
        )
      : rowVirtualizer.getTotalSize()

  const locale = i18n.resolvedLanguage ?? 'en'
  const hasVisibleDocuments = filteredDocuments.length > 0

  return (
    <Card className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
            {t('documents.section_badge')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToGenerate ? (
            <Button type="button" variant="ghost" size="sm" onClick={onNavigateToGenerate}>
              {t('documents.generate_action')}
            </Button>
          ) : null}
          {onExtractPendingContent ? (
            allExtracted ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={extractDialogPhase !== 'idle' || !onClearContentCache}
                onClick={async () => {
                  if (!onClearContentCache) return
                  await onClearContentCache({ dossierId })
                  setExtractDialogPhase('confirm')
                }}
              >
                {t('documents.reextract_all_action')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={extractDialogPhase !== 'idle' || pendingExtractableCount === 0}
                onClick={() => setExtractDialogPhase('confirm')}
              >
                {extractDialogPhase === 'running'
                  ? t('documents.extract_all_running_action')
                  : t('documents.extract_all_action', { count: pendingExtractableCount })}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {!isLoading && documents.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_13rem]">
          <label
            htmlFor="document-list-search"
            className="flex flex-col gap-2 text-sm text-slate-100"
          >
            <span>{t('documents.filter_search_label')}</span>
            <input
              id="document-list-search"
              type="search"
              value={filenameFilter}
              onChange={(event) => setFilenameFilter(event.target.value)}
              placeholder={t('documents.filter_search_placeholder')}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            />
          </label>

          <label
            htmlFor="document-list-extension"
            className="flex flex-col gap-2 text-sm text-slate-100"
          >
            <span>{t('documents.filter_extension_label')}</span>
            <select
              id="document-list-extension"
              value={extensionFilter}
              onChange={(event) => setExtensionFilter(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            >
              <option value={ALL_EXTENSIONS_VALUE}>{t('documents.filter_extension_all')}</option>
              {availableExtensions.map((extension) => (
                <option key={extension.value} value={extension.value}>
                  {`${extension.value} (${extension.count})`}
                </option>
              ))}
            </select>
          </label>

          <label
            htmlFor="document-list-sort"
            className="flex flex-col gap-2 text-sm text-slate-100"
          >
            <span>{t('documents.filter_sort_label')}</span>
            <select
              id="document-list-sort"
              value={sortBy}
              onChange={(event) => {
                const value = event.target.value as SortBy
                setLocalStorageItem('documents-sort-by', value)
                setSortBy(value)
              }}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
            >
              <option value="name">{t('documents.filter_sort_name')}</option>
              <option value="date-desc">{t('documents.filter_sort_date_desc')}</option>
              <option value="date-asc">{t('documents.filter_sort_date_asc')}</option>
            </select>
          </label>
        </div>
      ) : null}

      {editingDocument ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col overflow-y-auto rounded-[28px] border border-sky-200/18 bg-[rgba(16,26,44,0.985)] p-5 shadow-[0_32px_100px_rgba(2,6,23,0.62)]"
          >
            <DocumentMetadataPanel
              key={`${dossierId}:${editingDocument.id}:${editingDocument.description ?? ''}:${editingDocument.tags.join('\u0000')}`}
              document={editingDocument}
              disabled={isSavingMetadata}
              onCancel={() => setEditingDocumentId(null)}
              onSave={onSaveMetadata}
            />
          </div>
        </div>
      ) : null}

      {extractDialogPhase !== 'idle' ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex w-full max-w-md flex-col gap-5 rounded-[28px] border border-sky-200/18 bg-[rgba(16,26,44,0.985)] p-6 shadow-[0_32px_100px_rgba(2,6,23,0.62)]"
          >
            <p className="text-sm font-semibold text-slate-100">
              {t('documents.extract_all_dialog_title')}
            </p>

            {extractDialogPhase === 'confirm' ? (
              <>
                <p className="text-sm text-slate-300">
                  {t('documents.extract_all_dialog_confirm_body', {
                    count: pendingExtractableCount
                  })}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setExtractDialogPhase('idle')}
                  >
                    {t('documents.extract_all_dialog_cancel_action')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const pendingDocuments = documents.filter(
                        (document) =>
                          document.textExtraction.isExtractable &&
                          document.textExtraction.state !== 'extracted'
                      )
                      abortRequestedRef.current = false
                      setExtractProgress({
                        current: 0,
                        total: pendingDocuments.length,
                        succeeded: 0,
                        failed: 0,
                        currentFilename: null,
                        wasAborted: false
                      })
                      setExtractDialogPhase('running')

                      let succeeded = 0
                      let failed = 0
                      let aborted = false

                      for (let index = 0; index < pendingDocuments.length; index += 1) {
                        if (abortRequestedRef.current) {
                          aborted = true
                          break
                        }

                        const document = pendingDocuments[index]!
                        setExtractProgress((previous) => ({
                          ...previous,
                          current: index + 1,
                          currentFilename: document.filename
                        }))

                        const ok = await handleExtractContent({
                          dossierId,
                          documentId: document.id
                        })

                        if (ok) {
                          succeeded += 1
                        } else {
                          failed += 1
                        }

                        setExtractProgress((previous) => ({
                          ...previous,
                          succeeded,
                          failed
                        }))
                      }

                      setExtractProgress((previous) => ({
                        ...previous,
                        currentFilename: null,
                        wasAborted: aborted
                      }))
                      setExtractDialogPhase('done')
                    }}
                  >
                    {t('documents.extract_all_dialog_confirm_action')}
                  </Button>
                </div>
              </>
            ) : null}

            {extractDialogPhase === 'running' ? (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {t('documents.extract_all_dialog_progress', {
                        current: extractProgress.current,
                        total: extractProgress.total
                      })}
                    </span>
                    <span>
                      {Math.round(
                        (extractProgress.current / Math.max(extractProgress.total, 1)) * 100
                      )}
                      %
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-aurora transition-all duration-300"
                      style={{
                        width: `${(extractProgress.current / Math.max(extractProgress.total, 1)) * 100}%`
                      }}
                    />
                  </div>
                  {extractProgress.currentFilename ? (
                    <p className="truncate text-xs text-slate-400">
                      {t('documents.extract_all_dialog_current_file', {
                        name: extractProgress.currentFilename
                      })}
                    </p>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      abortRequestedRef.current = true
                    }}
                  >
                    {t('documents.extract_all_dialog_abort_action')}
                  </Button>
                </div>
              </>
            ) : null}

            {extractDialogPhase === 'done' ? (
              <>
                <p className="text-sm text-slate-300">
                  {extractProgress.wasAborted
                    ? t('documents.extract_all_dialog_aborted_body', {
                        succeeded: extractProgress.succeeded,
                        failed: extractProgress.failed,
                        attempted: extractProgress.current
                      })
                    : t('documents.extract_all_dialog_done_body', {
                        succeeded: extractProgress.succeeded,
                        failed: extractProgress.failed,
                        attempted: extractProgress.total
                      })}
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setExtractDialogPhase('idle')}
                  >
                    {t('documents.extract_all_dialog_close_action')}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300/35 bg-rose-300/10 p-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
          {t('documents.loading')}
        </p>
      ) : null}

      {!isLoading && documents.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
          {t('documents.empty')}
        </p>
      ) : null}

      {!isLoading && documents.length > 0 && !hasVisibleDocuments ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
          {t('documents.no_results')}
        </p>
      ) : null}

      {!isLoading && hasVisibleDocuments ? (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.92fr)]">
          <div
            ref={parentRef}
            className="min-h-[26rem] overflow-auto rounded-2xl border border-white/10 bg-slate-950/25 xl:h-full xl:min-h-0"
          >
            <div style={{ height: totalSize, position: 'relative' }}>
              {virtualItems.map((virtualItem) => {
                const node = flatNodes[virtualItem.index]

                if (!node) {
                  return null
                }

                if (node.kind === 'folder') {
                  const isExpanded = expandedPaths.has(node.path)

                  return (
                    <button
                      key={getTreeNodeKey(node)}
                      ref={(element) => rowVirtualizer.measureElement(element)}
                      data-index={virtualItem.index}
                      data-folder-row={node.path}
                      type="button"
                      className="absolute inset-x-0 flex w-full cursor-pointer items-center gap-2 border-b border-white/6 pr-4 text-left last:border-b-0 hover:bg-white/3"
                      style={{
                        minHeight: FOLDER_ROW_HEIGHT,
                        transform: `translateY(${virtualItem.start}px)`,
                        paddingLeft: `${16 + node.depth * INDENT_PX}px`
                      }}
                      onClick={() => toggleFolder(node.path)}
                    >
                      <svg
                        className="shrink-0 text-slate-400 transition-transform duration-150"
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
                        className="shrink-0 text-aurora/60"
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.764c.415 0 .813.165 1.107.46L8.5 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12V3.5z" />
                      </svg>
                      <span className="truncate text-sm font-medium text-slate-200">
                        {node.name}
                      </span>
                      <span className="ml-auto shrink-0 rounded-full bg-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {node.totalDescendants}
                      </span>
                    </button>
                  )
                }

                const hasMetadata = Boolean(
                  node.document.description || node.document.tags.length > 0
                )
                const isPreviewActive = activePreviewDocumentId === node.document.id

                return (
                  <article
                    key={getTreeNodeKey(node)}
                    ref={(element) => rowVirtualizer.measureElement(element)}
                    data-index={virtualItem.index}
                    data-document-row={node.document.id}
                    className={`absolute inset-x-0 border-b border-white/6 py-3 pr-4 last:border-b-0 ${
                      isPreviewActive ? 'bg-aurora/8' : ''
                    }`}
                    style={{
                      minHeight: getFileRowHeight(node.document),
                      transform: `translateY(${virtualItem.start}px)`,
                      paddingLeft: `${16 + node.depth * INDENT_PX}px`
                    }}
                  >
                    {/* Ligne 1 : nom + timestamp + actions */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-medium text-slate-100">
                        {node.document.filename}
                      </p>
                      <div className="flex shrink-0 items-center gap-3">
                        <p className="text-xs text-slate-400">
                          {formatTimestamp(node.document.modifiedAt, locale)}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void onOpenPreview({
                              dossierId,
                              documentId: node.document.id
                            })
                          }
                        >
                          {t('documents.preview_show_action')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isSavingMetadata}
                          onClick={() => setEditingDocumentId(node.document.id)}
                        >
                          {hasMetadata
                            ? t('documents.metadata_edit_action')
                            : t('documents.metadata_add_action')}
                        </Button>
                      </div>
                    </div>

                    {/* Ligne 2 : description */}
                    {node.document.description ? (
                      <p className="mt-1.5 truncate text-xs text-slate-400">
                        {node.document.description}
                      </p>
                    ) : null}

                    {/* Ligne 3 : tags + badge d'extraction */}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[...node.document.tags]
                        .sort((a, b) => a.localeCompare(b))
                        .map((tag) => {
                          return (
                            <span
                              key={tag}
                              className="rounded-full border border-aurora/25 bg-aurora/10 px-2 py-0.5 text-[11px] text-aurora-soft"
                            >
                              {tag}
                            </span>
                          )
                        })}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${getExtractionBadgeTone(
                          node.document.textExtraction.state
                        )}`}
                      >
                        {getExtractionBadgeLabel(node.document.textExtraction.state, t)}
                      </span>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>

          <DocumentPreviewPanel
            activeDocument={activePreviewDocument}
            previewState={previewState}
            contentState={contentState}
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
      ) : null}
    </Card>
  )
}
