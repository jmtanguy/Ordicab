/**
 * Drafting workspace: header (title, autosave state, undo/redo, save) +
 * AI assistant panel (left) + document preview (right).
 */

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useToast } from '../../contexts/ToastContext'
import { useRedactionStore } from '../../stores/redactionStore'
import { RedactionAssistantPanel } from './RedactionAssistantPanel'
import { RedactionPreviewPane } from './RedactionPreviewPane'

function UndoIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M4.5 3.5 2 6l2.5 2.5M2 6h7a4 4 0 0 1 0 8H6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RedoIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M10.5 3.5 13 6l-2.5 2.5M13 6H6a4 4 0 0 0 0 8h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const DOC_KIND_LABELS: Record<string, string> = {
  conclusions: 'Conclusions',
  courrier: 'Courrier',
  relance: 'Relance',
  information: 'Information',
  autre: 'Document'
}

export function RedactionWorkspace(): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const snapshot = useRedactionStore((state) => state.snapshot)
  const loading = useRedactionStore((state) => state.loading)
  const saving = useRedactionStore((state) => state.saving)
  const chatBusy = useRedactionStore((state) => state.chatBusy)
  const replaceConflict = useRedactionStore((state) => state.replaceConflict)
  const error = useRedactionStore((state) => state.error)
  const clearError = useRedactionStore((state) => state.clearError)
  const undo = useRedactionStore((state) => state.undo)
  const redo = useRedactionStore((state) => state.redo)
  const updateMeta = useRedactionStore((state) => state.updateMeta)
  const commitSession = useRedactionStore((state) => state.commitSession)
  const dismissReplaceConflict = useRedactionStore((state) => state.dismissReplaceConflict)
  const discardSession = useRedactionStore((state) => state.discardSession)
  const closeWorkspace = useRedactionStore((state) => state.closeWorkspace)
  const subscribeStreaming = useRedactionStore((state) => state.subscribeStreaming)

  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [scrollToParagraph, setScrollToParagraph] = useState<number | null>(null)

  useEffect(() => subscribeStreaming(), [subscribeStreaming])

  useEffect(() => {
    if (error) {
      showToast(error, 'error')
      clearError()
    }
  }, [error, showToast, clearError])

  if (!snapshot) return <></>

  const session = snapshot.session
  const commitTitle = (): void => {
    const next = titleDraft?.trim()
    setTitleDraft(null)
    if (next && next !== session.title) {
      void updateMeta({ title: next, targetFilename: next })
    }
  }

  const onSave = async (forceReplace = false): Promise<void> => {
    const result = await commitSession(forceReplace)
    if (result) {
      showToast(
        t('redaction.saved_toast', {
          defaultValue: 'Document enregistré : {{filename}}',
          filename: result.filename
        }),
        'success'
      )
      closeWorkspace()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-center gap-3">
        <input
          value={titleDraft ?? session.title}
          disabled={chatBusy}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
          aria-label={t('redaction.title_label', { defaultValue: 'Titre du document' })}
          className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-ink outline-none transition focus:border-hairline focus:bg-white"
        />
        <span className="rounded-full bg-aurora/10 px-2.5 py-0.5 text-xs font-medium text-aurora">
          {DOC_KIND_LABELS[session.docKind] ?? session.docKind}
        </span>
        <span className="text-xs text-ink-subtle">
          {t('redaction.autosaved', { defaultValue: 'Enregistré ✓' })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!snapshot.canUndo || loading || chatBusy}
            onClick={() => void undo()}
            title={t('redaction.undo', { defaultValue: 'Annuler' })}
            className="rounded-full border border-hairline p-2 text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            disabled={!snapshot.canRedo || loading || chatBusy}
            onClick={() => void redo()}
            title={t('redaction.redo', { defaultValue: 'Rétablir' })}
            className="rounded-full border border-hairline p-2 text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
          >
            <RedoIcon />
          </button>
        </div>
        <button
          type="button"
          disabled={saving || chatBusy || loading}
          onClick={() => void onSave()}
          className="rounded-full bg-aurora px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-aurora/90 disabled:opacity-50"
        >
          {saving
            ? t('redaction.saving', { defaultValue: 'Enregistrement…' })
            : session.saveMode === 'replace_original'
              ? t('redaction.save_replace', { defaultValue: 'Enregistrer (remplace l’original)' })
              : t('redaction.save_new', { defaultValue: 'Enregistrer dans le dossier' })}
        </button>
        <button
          type="button"
          onClick={() => closeWorkspace()}
          className="rounded-full border border-hairline px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-parchment-dim"
        >
          {t('redaction.back_to_list', { defaultValue: 'Fermer' })}
        </button>
        <button
          type="button"
          disabled={chatBusy}
          onClick={() => setConfirmDiscard(true)}
          className="rounded-full border border-destructive-border px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive-tint"
        >
          {t('redaction.discard', { defaultValue: 'Abandonner' })}
        </button>
      </header>

      {confirmDiscard && (
        <div className="flex items-center justify-between rounded-2xl border border-destructive-border bg-destructive-tint px-4 py-2">
          <span className="text-sm text-destructive">
            {t('redaction.discard_confirm', {
              defaultValue:
                'Abandonner ce brouillon ? Le travail en cours sera définitivement supprimé.'
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="rounded-full border border-hairline bg-white px-3 py-1 text-sm text-ink-muted"
            >
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDiscard(false)
                void discardSession()
              }}
              className="rounded-full bg-destructive px-3 py-1 text-sm font-medium text-white"
            >
              {t('redaction.discard_confirm_button', { defaultValue: 'Supprimer le brouillon' })}
            </button>
          </div>
        </div>
      )}

      {replaceConflict && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-warning-border bg-warning-tint px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-warning-deep">
              {t('redaction.replace_conflict_title', {
                defaultValue: 'Le document original a été modifié.'
              })}
            </p>
            <p className="mt-0.5 text-sm text-warning-deep">
              {t('redaction.replace_conflict_body', {
                defaultValue:
                  'Une version plus récente existe hors d’Ordicab. Voulez-vous la remplacer par ce brouillon ?'
              })}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={dismissReplaceConflict}
              className="rounded-full border border-warning-border bg-white px-3 py-1.5 text-sm text-ink-muted"
            >
              {t('redaction.replace_conflict_cancel', { defaultValue: 'Non, annuler' })}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave(true)}
              className="rounded-full bg-warning px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('redaction.replace_conflict_confirm', { defaultValue: 'Oui, remplacer' })}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <RedactionAssistantPanel
          onRevealParagraph={(index) => {
            useRedactionStore.getState().selectParagraph(index)
            // Re-trigger even for the same index
            setScrollToParagraph(null)
            requestAnimationFrame(() => setScrollToParagraph(index))
          }}
        />
        <RedactionPreviewPane scrollToParagraph={scrollToParagraph} />
      </div>
    </div>
  )
}
