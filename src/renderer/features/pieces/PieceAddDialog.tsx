import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DocumentRecord, PieceRecord } from '@shared/types'

import { Button, DialogShell, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { usePieceStore } from '@renderer/stores/pieceStore'
import { useToast } from '@renderer/contexts/ToastContext'

import { filenameWithoutExtension, isDocxFilename, isPieceSourceSupported } from './pieceFormats'

/** Draft selection item — owned by PiecesSection so closing the dialog keeps it. */
export interface PieceDraftItem {
  documentUuid: string
  filename: string
  relativePath: string
  title: string
  pieceDate: string
}

interface PieceAddDialogProps {
  dossierId: string
  documents: DocumentRecord[]
  pieces: PieceRecord[]
  /** Selection draft lifted to the parent: survives dialog close/reopen. */
  draft: PieceDraftItem[]
  onDraftChange: (items: PieceDraftItem[]) => void
  onClose: () => void
}

const DRAG_MIME = 'application/x-ordicab-piece-index'

export function PieceAddDialog({
  dossierId,
  documents,
  pieces,
  draft,
  onDraftChange,
  onClose
}: PieceAddDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const addPieces = usePieceStore((state) => state.add)
  const isMutating = usePieceStore((state) => state.isMutating)

  const selected = draft
  const setSelected = (update: (items: PieceDraftItem[]) => PieceDraftItem[]): void => {
    onDraftChange(update(draft))
  }
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const cotedUuids = useMemo(() => new Set(pieces.map((piece) => piece.documentUuid)), [pieces])

  const eligibleDocuments = useMemo(
    () =>
      documents.filter(
        (record) =>
          Boolean(record.uuid) &&
          !cotedUuids.has(record.uuid!) &&
          isPieceSourceSupported(record.filename)
      ),
    [documents, cotedUuids]
  )

  const filteredDocuments = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return eligibleDocuments
    return eligibleDocuments.filter((record) => record.relativePath.toLowerCase().includes(needle))
  }, [eligibleDocuments, filter])

  const selectedUuids = useMemo(
    () => new Set(selected.map((item) => item.documentUuid)),
    [selected]
  )

  const nextNumber = pieces.reduce((max, piece) => Math.max(max, piece.pieceNumber), 0) + 1
  const hasDocx = selected.some((item) => isDocxFilename(item.filename))

  const toggleDocument = (record: DocumentRecord): void => {
    const uuid = record.uuid!
    if (selectedUuids.has(uuid)) {
      setSelected((items) => items.filter((item) => item.documentUuid !== uuid))
      return
    }
    setSelected((items) => [
      ...items,
      {
        documentUuid: uuid,
        filename: record.filename,
        relativePath: record.relativePath,
        title: filenameWithoutExtension(record.filename),
        pieceDate: ''
      }
    ])
  }

  const moveItem = (from: number, to: number): void => {
    setSelected((items) => {
      const next = [...items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved!)
      return next
    })
  }

  const handleSubmit = async (): Promise<void> => {
    if (selected.length === 0 || selected.some((item) => !item.title.trim())) return
    const success = await addPieces({
      dossierId,
      items: selected.map((item) => ({
        documentUuid: item.documentUuid,
        title: item.title.trim(),
        pieceDate: item.pieceDate || undefined
      }))
    })
    if (success) {
      showToast(
        t('pieces.added_toast', {
          defaultValue: 'Numéros n°{{first}} à n°{{last}} attribués.',
          first: nextNumber,
          last: nextNumber + selected.length - 1
        }),
        'success'
      )
      onDraftChange([])
      onClose()
    }
  }

  return (
    <DialogShell
      size="xl"
      panelClassName="flex h-[85vh] flex-col overflow-hidden"
      onDismiss={onClose}
      aria-label={t('pieces.add_dialog_title', { defaultValue: 'Ajouter des pièces' })}
    >
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {t('pieces.add_dialog_title', { defaultValue: 'Ajouter des pièces' })}
          </h2>
          <p className="text-sm text-ink-muted">
            {t('pieces.add_dialog_subtitle', {
              defaultValue:
                'Sélectionnez les documents, puis ordonnez-les : les numéros seront attribués dans cet ordre, définitivement.'
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-aurora/10 hover:text-aurora"
        >
          ✕
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden">
        {/* Left: dossier documents picker */}
        <div className="flex min-h-0 flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
            {t('pieces.add_documents_column', { defaultValue: 'Documents du dossier' })}
          </p>
          <Input
            density="compact"
            placeholder={t('pieces.add_filter_placeholder', {
              defaultValue: 'Filtrer…'
            })}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline bg-white/70">
            {filteredDocuments.length === 0 ? (
              <p className="p-4 text-sm text-ink-muted">
                {t('pieces.add_no_eligible_documents', {
                  defaultValue:
                    'Aucun document éligible (formats acceptés : PDF, image, Word — documents non encore cotés).'
                })}
              </p>
            ) : (
              <ul>
                {filteredDocuments.map((record) => {
                  const isSelected = selectedUuids.has(record.uuid!)
                  return (
                    <li key={record.uuid}>
                      <button
                        type="button"
                        onClick={() => toggleDocument(record)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-aurora/5',
                          isSelected && 'bg-aurora/10'
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                            isSelected
                              ? 'border-aurora bg-aurora text-white'
                              : 'border-hairline-strong bg-white'
                          )}
                        >
                          {isSelected ? '✓' : ''}
                        </span>
                        <span className="truncate text-ink">{record.relativePath}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right: ordered selection (drag & drop) */}
        <div className="flex min-h-0 flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
            {t('pieces.add_order_column', {
              defaultValue: 'Ordre de cotation ({{count}})',
              count: selected.length
            })}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-hairline bg-white/70 p-2">
            {selected.length === 0 ? (
              <p className="p-3 text-sm text-ink-muted">
                {t('pieces.add_order_empty', {
                  defaultValue: 'Cochez des documents à gauche pour les ajouter ici.'
                })}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {selected.map((item, index) => (
                  <li
                    key={item.documentUuid}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_MIME, String(index))
                      event.dataTransfer.effectAllowed = 'move'
                      setDragIndex(index)
                    }}
                    onDragEnd={() => {
                      setDragIndex(null)
                      setDropIndex(null)
                    }}
                    onDragOver={(event) => {
                      if (dragIndex === null) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDropIndex(index)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragIndex !== null && dragIndex !== index) {
                        moveItem(dragIndex, index)
                      }
                      setDragIndex(null)
                      setDropIndex(null)
                    }}
                    className={cn(
                      'cursor-grab rounded-xl border border-hairline bg-white px-3 py-2 active:cursor-grabbing',
                      dropIndex === index && dragIndex !== index && 'border-aurora bg-aurora/5'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aurora/10 text-xs font-bold text-aurora">
                        {nextNumber + index}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-subtle">
                        {item.filename}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected((items) =>
                            items.filter((entry) => entry.documentUuid !== item.documentUuid)
                          )
                        }
                        aria-label={t('common.remove', { defaultValue: 'Retirer' })}
                        className="rounded p-1 text-ink-subtle transition hover:bg-[#b23a3a]/10 hover:text-[#b23a3a]"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      <Input
                        density="compact"
                        className="flex-1"
                        value={item.title}
                        placeholder={t('pieces.add_title_placeholder', {
                          defaultValue: 'Intitulé pour le bordereau'
                        })}
                        onChange={(event) =>
                          setSelected((items) =>
                            items.map((entry) =>
                              entry.documentUuid === item.documentUuid
                                ? { ...entry, title: event.target.value }
                                : entry
                            )
                          )
                        }
                      />
                      <Input
                        density="compact"
                        type="date"
                        className="w-40"
                        value={item.pieceDate}
                        onChange={(event) =>
                          setSelected((items) =>
                            items.map((entry) =>
                              entry.documentUuid === item.documentUuid
                                ? { ...entry, pieceDate: event.target.value }
                                : entry
                            )
                          )
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <div className="min-w-0 text-xs text-ink-muted">
          {selected.length > 0 ? (
            <p>
              {selected.length === 1
                ? t('pieces.add_numbers_preview_single', {
                    defaultValue: 'Le numéro n°{{first}} sera attribué.',
                    first: nextNumber
                  })
                : t('pieces.add_numbers_preview', {
                    defaultValue: 'Les numéros n°{{first}} à n°{{last}} seront attribués.',
                    first: nextNumber,
                    last: nextNumber + selected.length - 1
                  })}
            </p>
          ) : null}
          {hasDocx ? (
            <p className="text-warning">
              {t('pieces.add_docx_warning', {
                defaultValue:
                  'Les documents Word sont convertis en PDF avec un rendu approximatif — vérifiez le résultat.'
              })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel', { defaultValue: 'Annuler' })}
          </Button>
          <Button
            type="button"
            disabled={
              isMutating || selected.length === 0 || selected.some((item) => !item.title.trim())
            }
            onClick={() => void handleSubmit()}
          >
            {t('pieces.add_confirm', {
              defaultValue: 'Coter {{count}} pièce(s)',
              count: selected.length
            })}
          </Button>
        </div>
      </footer>
    </DialogShell>
  )
}
