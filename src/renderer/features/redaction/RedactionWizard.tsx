/**
 * Entry wizard of the drafting page: resume an active draft, or start a new
 * document from one of the five sources — blank / cabinet letterhead /
 * template ("modèles") / copy of an existing document / edit an existing
 * document in place.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RedactionDocKind, RedactionSourceType } from '@shared/domain/redaction'
import { SectionHeader } from '../dossiers/sectionLayout'
import { useDocumentStore } from '../../stores/documentStore'
import { useTemplateStore } from '../../stores/templateStore'
import { useEntityStore } from '../../stores/entityStore'
import { useRedactionStore } from '../../stores/redactionStore'

const DOC_KINDS: Array<{ value: RedactionDocKind; label: string }> = [
  { value: 'conclusions', label: 'Conclusions' },
  { value: 'courrier', label: 'Courrier' },
  { value: 'relance', label: 'Relance' },
  { value: 'information', label: 'Information' },
  { value: 'autre', label: 'Autre document' }
]

interface SourceCard {
  type: RedactionSourceType
  title: string
  description: string
  disabled?: boolean
  disabledHint?: string
}

export function RedactionWizard({ dossierId }: { dossierId: string }): React.JSX.Element {
  const { t } = useTranslation()
  const sessions = useRedactionStore((state) => state.sessions)
  const sessionsLoading = useRedactionStore((state) => state.sessionsLoading)
  const loading = useRedactionStore((state) => state.loading)
  const error = useRedactionStore((state) => state.error)
  const createSession = useRedactionStore((state) => state.createSession)
  const openSession = useRedactionStore((state) => state.openSession)

  const documentsByDossierId = useDocumentStore((state) => state.documentsByDossierId)
  const loadDocuments = useDocumentStore((state) => state.load)
  const templates = useTemplateStore((state) => state.templates)
  const loadTemplates = useTemplateStore((state) => state.load)
  const entityProfile = useEntityStore((state) => state.profile)
  const loadEntity = useEntityStore((state) => state.load)

  const [sourceType, setSourceType] = useState<RedactionSourceType | null>(null)
  const [templateUuid, setTemplateUuid] = useState<string | null>(null)
  const [sourceDocumentUuid, setSourceDocumentUuid] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [docKind, setDocKind] = useState<RedactionDocKind>('conclusions')

  useEffect(() => {
    void loadDocuments({ dossierId })
    void loadTemplates()
    void loadEntity()
  }, [dossierId, loadDocuments, loadTemplates, loadEntity])

  const activeDrafts = sessions.filter((session) => session.status === 'active')
  const docxDocuments = useMemo(
    () => (documentsByDossierId[dossierId] ?? []).filter((doc) => /\.docx$/i.test(doc.filename)),
    [documentsByDossierId, dossierId]
  )
  const documentTemplates = useMemo(
    () =>
      templates.filter(
        (template) => !template.documentKind || template.documentKind === 'document'
      ),
    [templates]
  )
  const hasCabinetTemplate = Boolean(entityProfile?.defaultTemplateFileName)

  const sourceCards: SourceCard[] = [
    {
      type: 'blank',
      title: t('redaction.source_blank', { defaultValue: 'Document vierge' }),
      description: t('redaction.source_blank_desc', {
        defaultValue: 'Partir d’une page blanche, co-rédigée avec l’assistant.'
      })
    },
    {
      type: 'entity_default',
      title: t('redaction.source_entity', { defaultValue: 'Papier en-tête du cabinet' }),
      description: t('redaction.source_entity_desc', {
        defaultValue: 'Partir du modèle Word par défaut de l’entité (en-tête, pied de page).'
      }),
      disabled: !hasCabinetTemplate,
      disabledHint: t('redaction.source_entity_missing', {
        defaultValue: 'Aucun modèle par défaut importé dans Paramètres → Entité.'
      })
    },
    {
      type: 'template',
      title: t('redaction.source_template', { defaultValue: 'Depuis un modèle' }),
      description: t('redaction.source_template_desc', {
        defaultValue:
          'Générer le point de départ depuis un de vos modèles (champs remplis avec le dossier).'
      }),
      disabled: documentTemplates.length === 0,
      disabledHint: t('redaction.source_template_missing', {
        defaultValue: 'Aucun modèle de document disponible.'
      })
    },
    {
      type: 'copy',
      title: t('redaction.source_copy', { defaultValue: 'Copier un document' }),
      description: t('redaction.source_copy_desc', {
        defaultValue: 'Dupliquer un document Word du dossier pour en faire une nouvelle version.'
      }),
      disabled: docxDocuments.length === 0,
      disabledHint: t('redaction.source_docx_missing', {
        defaultValue: 'Aucun document Word (.docx) dans ce dossier.'
      })
    },
    {
      type: 'edit_existing',
      title: t('redaction.source_edit', { defaultValue: 'Modifier un document existant' }),
      description: t('redaction.source_edit_desc', {
        defaultValue: 'Réviser un document du dossier ; l’enregistrement remplacera l’original.'
      }),
      disabled: docxDocuments.length === 0,
      disabledHint: t('redaction.source_docx_missing', {
        defaultValue: 'Aucun document Word (.docx) dans ce dossier.'
      })
    }
  ]

  const needsTemplate = sourceType === 'template'
  const needsDocument = sourceType === 'copy' || sourceType === 'edit_existing'
  const selectionComplete =
    sourceType !== null &&
    (!needsTemplate || templateUuid !== null) &&
    (!needsDocument || sourceDocumentUuid !== null)

  const selectedDocument = docxDocuments.find((doc) => doc.uuid === sourceDocumentUuid)
  const selectedTemplate = documentTemplates.find((tpl) => tpl.uuid === templateUuid)
  const effectiveTitle =
    title.trim() ||
    selectedDocument?.filename.replace(/\.docx$/i, '') ||
    selectedTemplate?.name ||
    ''

  const start = (): void => {
    if (!sourceType || !selectionComplete || !effectiveTitle) return
    void createSession({
      dossierId,
      title: effectiveTitle,
      docKind,
      source: {
        type: sourceType,
        templateUuid: templateUuid ?? undefined,
        sourceDocumentUuid: sourceDocumentUuid ?? undefined
      }
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <SectionHeader
        badge={t('redaction.title', { defaultValue: 'Rédaction assistée' })}
        count={
          activeDrafts.length > 0
            ? t('redaction.active_drafts_count', {
                defaultValue: '{{count}} brouillon(s) en cours',
                count: activeDrafts.length
              })
            : undefined
        }
      />

      {error && (
        <p className="rounded-2xl border border-destructive-border bg-destructive-tint px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {activeDrafts.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {t('redaction.resume_heading', { defaultValue: 'Reprendre un travail en cours' })}
          </h3>
          <ul className="space-y-2">
            {activeDrafts.map((draft) => (
              <li key={draft.sessionId}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void openSession(dossierId, draft.sessionId)}
                  className="flex w-full items-center justify-between rounded-2xl border border-aurora/40 bg-aurora/5 px-4 py-3 text-left transition-colors hover:bg-aurora/10"
                >
                  <span>
                    <span className="block text-sm font-medium text-ink">{draft.title}</span>
                    <span className="block text-xs text-ink-subtle">
                      {t('redaction.resume_updated', {
                        defaultValue: 'Modifié le {{date}}',
                        date: new Date(draft.updatedAt).toLocaleString('fr-FR')
                      })}
                    </span>
                  </span>
                  <span className="rounded-full bg-aurora px-3 py-1 text-xs font-medium text-white">
                    {t('redaction.resume_button', { defaultValue: 'Reprendre' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
          {t('redaction.new_heading', { defaultValue: 'Nouveau document' })}
        </h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {sourceCards.map((card) => {
            const active = sourceType === card.type
            return (
              <button
                key={card.type}
                type="button"
                disabled={card.disabled}
                title={card.disabled ? card.disabledHint : undefined}
                onClick={() => {
                  setSourceType(card.type)
                  setTemplateUuid(null)
                  setSourceDocumentUuid(null)
                }}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  active
                    ? 'border-aurora bg-aurora/10'
                    : 'border-hairline bg-white hover:border-aurora/50'
                } ${card.disabled ? 'opacity-45' : ''}`}
              >
                <span className="block text-sm font-medium text-ink">{card.title}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{card.description}</span>
              </button>
            )
          })}
        </div>
      </section>

      {needsTemplate && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {t('redaction.pick_template', { defaultValue: 'Choisir un modèle' })}
          </h3>
          <ul className="max-h-96 space-y-1 overflow-y-auto rounded-2xl border border-hairline bg-white p-2">
            {documentTemplates.map((template) => (
              <li key={template.uuid}>
                <button
                  type="button"
                  onClick={() => setTemplateUuid(template.uuid)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    templateUuid === template.uuid
                      ? 'bg-aurora/10 text-aurora'
                      : 'text-ink hover:bg-parchment'
                  }`}
                >
                  {template.name}
                  {template.description && (
                    <span className="block text-xs text-ink-subtle">{template.description}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-subtle">
            {t('redaction.pick_template_hint', {
              defaultValue:
                'Les champs du modèle sont remplis avec les données du dossier ; ceux qui restent sans valeur apparaîtront dans le document sous la forme {{placeholder}}, à compléter pendant la rédaction (demandez à l’IA ou éditez le paragraphe).',
              placeholder: '{{champ}}'
            })}
          </p>
        </section>
      )}

      {needsDocument && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {sourceType === 'copy'
              ? t('redaction.pick_document_copy', { defaultValue: 'Document à copier' })
              : t('redaction.pick_document_edit', { defaultValue: 'Document à modifier' })}
          </h3>
          <ul className="max-h-96 space-y-1 overflow-y-auto rounded-2xl border border-hairline bg-white p-2">
            {docxDocuments.map((doc) => (
              <li key={doc.uuid}>
                <button
                  type="button"
                  onClick={() => setSourceDocumentUuid(doc.uuid)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                    sourceDocumentUuid === doc.uuid
                      ? 'bg-aurora/10 text-aurora'
                      : 'text-ink hover:bg-parchment'
                  }`}
                >
                  <span className="truncate">{doc.filename}</span>
                  <span className="ml-2 shrink-0 text-xs text-ink-subtle">
                    {new Date(doc.modifiedAt).toLocaleDateString('fr-FR')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {sourceType === 'edit_existing' && (
            <p className="mt-1 text-xs text-warning">
              {t('redaction.edit_existing_warning', {
                defaultValue: '⚠ À l’enregistrement, le document original sera remplacé.'
              })}
            </p>
          )}
        </section>
      )}

      {sourceType && selectionComplete && (
        <section className="rounded-2xl border border-hairline bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs font-medium text-ink-subtle">
              {t('redaction.title_label', { defaultValue: 'Titre du document' })}
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={
                  effectiveTitle ||
                  t('redaction.title_placeholder', { defaultValue: 'Conclusions récapitulatives…' })
                }
                className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-aurora focus:outline-none focus:ring-2 focus:ring-aurora/35"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-subtle">
              {t('redaction.kind_label', { defaultValue: 'Type' })}
              <select
                value={docKind}
                onChange={(event) => setDocKind(event.target.value as RedactionDocKind)}
                className="h-9.5 rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus:border-aurora focus:outline-none focus:ring-2 focus:ring-aurora/35"
              >
                {DOC_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={loading || sessionsLoading || !effectiveTitle}
              onClick={start}
              className="rounded-full bg-aurora px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-aurora/90 disabled:opacity-50"
            >
              {loading
                ? t('redaction.creating', { defaultValue: 'Préparation…' })
                : t('redaction.start', { defaultValue: 'Commencer la rédaction' })}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
