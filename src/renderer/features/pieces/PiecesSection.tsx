import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PieceRecord } from '@shared/types'

import { Button, ConfirmDialog, Field, Input, Textarea } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { SectionHeader } from '@renderer/features/dossiers/sectionLayout'
import { useDocumentStore } from '@renderer/stores/documentStore'
import { usePieceStore } from '@renderer/stores/pieceStore'

import { PieceAddDialog, type PieceDraftItem } from './PieceAddDialog'
import { PieceGenerateDialog } from './PieceGenerateDialog'

interface PiecesSectionProps {
  dossier: { slug: string; name: string; juridiction?: string; tribunal?: string }
}

function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
      new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
    )
  } catch {
    return iso
  }
}

interface PieceEditState {
  pieceUuid: string
  title: string
  pieceDate: string
  summary: string
}

const EMPTY_PIECES: PieceRecord[] = []
const EMPTY_DOCUMENTS: never[] = []

export function PiecesSection({ dossier }: PiecesSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()

  const pieces = usePieceStore((state) => state.piecesByDossierId[dossier.slug]) ?? EMPTY_PIECES
  const isLoading = usePieceStore((state) => state.isLoading)
  const isMutating = usePieceStore((state) => state.isMutating)
  const error = usePieceStore((state) => state.error)
  const loadPieces = usePieceStore((state) => state.load)
  const updatePiece = usePieceStore((state) => state.update)
  const removePiece = usePieceStore((state) => state.remove)
  const clearError = usePieceStore((state) => state.clearError)

  const documents =
    useDocumentStore((state) => state.documentsByDossierId[dossier.slug]) ?? EMPTY_DOCUMENTS
  const loadDocuments = useDocumentStore((state) => state.load)

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isGenerateOpen, setIsGenerateOpen] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<PieceRecord | null>(null)
  const [editState, setEditState] = useState<PieceEditState | null>(null)
  // Selection draft of the add dialog, kept here so closing the dialog
  // (Escape, ✕, click outside) does not lose the picked documents.
  const [addDraft, setAddDraft] = useState<PieceDraftItem[]>([])

  useEffect(() => {
    void loadPieces({ dossierId: dossier.slug })
    void loadDocuments({ dossierId: dossier.slug })
  }, [dossier.slug, loadPieces, loadDocuments])

  useEffect(() => {
    if (error) {
      showToast(error, 'error')
      clearError()
    }
  }, [error, showToast, clearError])

  const documentUuids = useMemo(
    () => new Set(documents.flatMap((record) => (record.uuid ? [record.uuid] : []))),
    [documents]
  )

  const handleSaveEdit = async (): Promise<void> => {
    if (!editState || !editState.title.trim()) return
    const success = await updatePiece({
      dossierId: dossier.slug,
      pieceUuid: editState.pieceUuid,
      title: editState.title.trim(),
      pieceDate: editState.pieceDate || undefined,
      summary: editState.summary.trim() || undefined
    })
    if (success) {
      setEditState(null)
    }
  }

  const handleRemove = async (): Promise<void> => {
    if (!pendingRemoval) return
    const success = await removePiece({ dossierId: dossier.slug, pieceUuid: pendingRemoval.uuid })
    setPendingRemoval(null)
    if (success) {
      showToast(
        t('pieces.removed_toast', {
          defaultValue:
            'Pièce n°{{number}} retirée du bordereau. Son numéro ne sera pas réutilisé.',
          number: pendingRemoval.pieceNumber
        }),
        'success'
      )
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <SectionHeader
        badge={t('pieces.section_title', { defaultValue: 'Pièces cotées' })}
        badgeTitle={t('pieces.section_subtitle', {
          defaultValue:
            'Numérotation continue du dossier — les numéros attribués ne changent jamais.'
        })}
        count={pieces.length || null}
        actions={
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddOpen(true)}>
              {t('pieces.add_action', { defaultValue: 'Ajouter des pièces' })}
              {addDraft.length > 0 ? ` (${addDraft.length})` : ''}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pieces.length === 0}
              onClick={() => setIsGenerateOpen(true)}
            >
              {t('pieces.generate_action', { defaultValue: 'Générer…' })}
            </Button>
          </>
        }
      />

      {isLoading && pieces.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {t('pieces.loading', { defaultValue: 'Chargement des pièces…' })}
        </p>
      ) : pieces.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline-strong bg-white/60 p-8 text-center">
          <p className="text-sm text-ink-muted">
            {t('pieces.empty_state', {
              defaultValue:
                'Aucune pièce cotée. Ajoutez des documents du dossier pour constituer le bordereau de communication de pièces.'
            })}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pieces.map((piece) => {
            const isSourceMissing = !documentUuids.has(piece.documentUuid)
            const isEditing = editState?.pieceUuid === piece.uuid
            return (
              <li
                key={piece.uuid}
                className="rounded-2xl border border-hairline bg-white/80 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-aurora/10 text-sm font-bold text-aurora">
                    {piece.pieceNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Field
                          density="compact"
                          label={t('pieces.edit_title_label', { defaultValue: 'Intitulé' })}
                        >
                          <Input
                            density="compact"
                            value={editState.title}
                            onChange={(event) =>
                              setEditState({ ...editState, title: event.target.value })
                            }
                          />
                        </Field>
                        <div className="flex gap-3">
                          <Field
                            density="compact"
                            className="w-44"
                            label={t('pieces.edit_date_label', {
                              defaultValue: 'Date de la pièce'
                            })}
                          >
                            <Input
                              density="compact"
                              type="date"
                              value={editState.pieceDate}
                              onChange={(event) =>
                                setEditState({ ...editState, pieceDate: event.target.value })
                              }
                            />
                          </Field>
                          <Field
                            density="compact"
                            className="flex-1"
                            label={t('pieces.edit_summary_label', {
                              defaultValue: 'Résumé (optionnel)'
                            })}
                          >
                            <Textarea
                              density="compact"
                              rows={2}
                              value={editState.summary}
                              onChange={(event) =>
                                setEditState({ ...editState, summary: event.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditState(null)}
                          >
                            {t('common.cancel', { defaultValue: 'Annuler' })}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={isMutating || !editState.title.trim()}
                            onClick={() => void handleSaveEdit()}
                          >
                            {t('common.save', { defaultValue: 'Enregistrer' })}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="truncate font-medium text-ink">{piece.title}</p>
                        <p className="text-xs text-ink-subtle">
                          {piece.sourceFilename}
                          {piece.pieceDate
                            ? ` — ${t('pieces.dated', { defaultValue: 'datée du' })} ${formatDate(piece.pieceDate)}`
                            : ''}
                        </p>
                        {piece.summary ? (
                          <p className="mt-1 text-xs text-ink-muted">{piece.summary}</p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap gap-2">
                          {isSourceMissing ? (
                            <span className="inline-flex items-center rounded-full bg-[#b23a3a]/10 px-2 py-0.5 text-[11px] font-medium text-[#b23a3a]">
                              {t('pieces.source_missing', {
                                defaultValue: 'Source manquante'
                              })}
                            </span>
                          ) : null}
                          {piece.communicatedAt ? (
                            <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                              {t('pieces.communicated_on', {
                                defaultValue: 'Communiquée le {{date}}',
                                date: formatDate(piece.communicatedAt)
                              })}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                              {t('pieces.not_communicated', {
                                defaultValue: 'Non communiquée'
                              })}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {!isEditing ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditState({
                            pieceUuid: piece.uuid,
                            title: piece.title,
                            pieceDate: piece.pieceDate ?? '',
                            summary: piece.summary ?? ''
                          })
                        }
                      >
                        {t('common.edit', { defaultValue: 'Modifier' })}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-[#b23a3a] hover:bg-[#b23a3a]/10"
                        onClick={() => setPendingRemoval(piece)}
                      >
                        {t('common.remove', { defaultValue: 'Retirer' })}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {isAddOpen ? (
        <PieceAddDialog
          dossierId={dossier.slug}
          documents={documents}
          pieces={pieces}
          draft={addDraft}
          onDraftChange={setAddDraft}
          onClose={() => setIsAddOpen(false)}
        />
      ) : null}

      {isGenerateOpen ? (
        <PieceGenerateDialog
          dossierId={dossier.slug}
          defaultJuridiction={dossier.juridiction ?? dossier.tribunal ?? ''}
          onClose={() => setIsGenerateOpen(false)}
        />
      ) : null}

      {pendingRemoval ? (
        <ConfirmDialog
          title={t('pieces.remove_confirm_title', {
            defaultValue: 'Retirer la pièce n°{{number}} ?',
            number: pendingRemoval.pieceNumber
          })}
          description={t('pieces.remove_confirm_description', {
            defaultValue:
              'La pièce « {{title}} » sera retirée du bordereau. Son numéro n°{{number}} ne sera jamais réattribué (la numérotation reste continue) ; le document lui-même n’est pas supprimé.',
            title: pendingRemoval.title,
            number: pendingRemoval.pieceNumber
          })}
          confirmLabel={t('common.remove', { defaultValue: 'Retirer' })}
          cancelLabel={t('common.cancel', { defaultValue: 'Annuler' })}
          tone="danger"
          isBusy={isMutating}
          onConfirm={() => void handleRemove()}
          onCancel={() => setPendingRemoval(null)}
        />
      ) : null}
    </div>
  )
}
