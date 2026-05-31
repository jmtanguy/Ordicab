import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'

import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import {
  useContactStore,
  useDossierStore,
  useEntityStore,
  useTemplateStore
} from '@renderer/stores'

import { roleToTagKey } from '../dossiers/rolePresets'
import { ListContainer, PillSelect, SearchField, SectionHeader } from '../dossiers/sectionLayout'
import { RichTextEditor } from './RichTextEditor'
import { type ComboOption } from './generateDocument/ComboField'
import { TagFillingStep } from './generateDocument/TagFillingStep'
import { hydrateAutoSelectedContactTags } from './generateDocument/tagFillingHelpers'
import { buildKeyDateOptions, getFilenameFromPath } from './generateDocument/tagValueHelpers'

// ── Panel ─────────────────────────────────────────────────────────────────────

interface ReviewDraftState {
  html: string
  filename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
}

type TemplateSortOrder = 'name-asc' | 'name-desc'

interface GenerateDocumentPanelProps {
  /**
   * Active dossier the document is generated for. The panel is always scoped
   * to a single dossier (mounted inside DossierDetail's sidebar) — there is no
   * in-panel dossier override.
   */
  dossierId: string
  onBack?: () => void
}

export function GenerateDocumentPanel({
  dossierId,
  onBack
}: GenerateDocumentPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const templates = useTemplateStore((state) => state.templates)
  const loadTemplates = useTemplateStore((state) => state.load)
  const generateDocument = useTemplateStore((state) => state.generate)
  const previewDocument = useTemplateStore((state) => state.preview)
  const previewDocxDocument = useTemplateStore((state) => state.previewDocx)
  const selectOutputPath = useTemplateStore((state) => state.selectOutputPath)
  const saveGeneratedDocument = useTemplateStore((state) => state.saveGeneratedDocument)
  const openGeneratedFile = useTemplateStore((state) => state.openGeneratedFile)
  const copyToClipboard = useTemplateStore((state) => state.copyToClipboard)
  const loadDetail = useDossierStore((state) => state.loadDetail)
  const profile = useEntityStore((state) => state.profile)
  const loadContacts = useContactStore((state) => state.load)
  const contactsByDossierId = useContactStore((state) => state.contactsByDossierId)

  const selectedDossierId = dossierId

  const [step, setStep] = useState<'setup' | 'tags' | 'save'>('setup')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ filename: string; outputPath: string } | null>(null)
  const [reviewDraft, setReviewDraft] = useState<ReviewDraftState | null>(null)
  const [copied, setCopied] = useState(false)
  const [templateFilter, setTemplateFilter] = useState('')
  const [templateSort, setTemplateSort] = useState<TemplateSortOrder>('name-asc')
  // Docx-save step state
  const [docxFilename, setDocxFilename] = useState('')
  const [docxCustomOutputPath, setDocxCustomOutputPath] = useState<string | null>(null)

  // Tags step state
  const [tagPaths, setTagPaths] = useState<string[]>([])
  const [tagValues, setTagValues] = useState<Record<string, string>>({})
  const [primaryContactId, setPrimaryContactId] = useState('')
  const [roleContactIds, setRoleContactIds] = useState<Record<string, string>>({})
  const [keyDateOptions, setKeyDateOptions] = useState<ComboOption[]>([])
  const managedFieldsConfig = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields),
    [profile?.managedFields]
  )

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  // Dismiss success banner when leaving setup (not when arriving at it after a save)
  useEffect(() => {
    if (step !== 'setup') {
      setSuccess(null)
    }
  }, [step])

  useEffect(() => {
    let isCancelled = false

    if (selectedDossierId) {
      void loadContacts({ dossierId: selectedDossierId })
      void loadDetail(selectedDossierId).then(() => {
        if (isCancelled) {
          return
        }

        const detail = useDossierStore.getState().activeDossier

        if (detail?.id !== selectedDossierId) {
          return
        }

        setKeyDateOptions(buildKeyDateOptions(detail, i18n.resolvedLanguage ?? 'fr'))
      })
      return () => {
        isCancelled = true
      }
    }

    setKeyDateOptions([])

    return () => {
      isCancelled = true
    }
  }, [selectedDossierId, loadContacts, loadDetail, i18n.resolvedLanguage])

  const dossierContacts = selectedDossierId ? (contactsByDossierId[selectedDossierId] ?? []) : []
  const selectedTemplate = templates.find((tmpl) => tmpl.id === selectedTemplateId)
  const selectedTemplateUsesDocxSource = selectedTemplate?.hasDocxSource === true

  const canSubmitSetup =
    selectedDossierId.trim().length > 0 &&
    selectedTemplateId.trim().length > 0 &&
    templates.some((tmpl) => tmpl.id === selectedTemplateId) &&
    !isSubmitting

  const canSave = reviewDraft !== null && reviewDraft.filename.trim().length > 0 && !isSubmitting

  async function handleSetupNext(): Promise<void> {
    if (!canSubmitSetup || !selectedTemplate) return

    setError(null)
    setIsSubmitting(true)

    try {
      await Promise.all([
        loadContacts({ dossierId: selectedDossierId }),
        loadDetail(selectedDossierId)
      ])

      const loadedContacts = useContactStore.getState().contactsByDossierId[selectedDossierId] ?? []
      const loadedDossier = (() => {
        const detail = useDossierStore.getState().activeDossier
        return detail?.id === selectedDossierId ? detail : null
      })()

      setKeyDateOptions(buildKeyDateOptions(loadedDossier, i18n.resolvedLanguage ?? 'fr'))

      // Docx-sourced templates: preview tags first for reconciliation
      if (selectedTemplateUsesDocxSource) {
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId
        })

        if (!result.success) {
          setError(result.error || t('generate.previewError'))
          return
        }

        const paths = result.data.tagPaths
        setTagPaths(paths)
        setDocxFilename(result.data.suggestedFilename)
        setDocxCustomOutputPath(null)

        // Init tagValues from resolved values; empty string for unresolved
        const initial: Record<string, string> = {}
        for (const path of paths) {
          initial[path] = result.data.resolvedTags[path] ?? ''
        }

        // Auto-select primary contact
        const firstContact = loadedContacts[0]
        const initPrimaryId = firstContact?.uuid ?? ''
        setPrimaryContactId(initPrimaryId)

        // Auto-select role contacts
        const initRoleIds: Record<string, string> = {}
        const roleKeys = [
          ...new Set(
            paths
              .filter((p) => {
                const s = p.split('.')
                return s[0] === 'contact' && s.length === 3
              })
              .map((p) => p.split('.')[1] as string)
          )
        ]
        for (const roleKey of roleKeys) {
          const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
          if (matched) initRoleIds[roleKey] = matched.uuid
        }
        setRoleContactIds(initRoleIds)

        setTagValues(
          hydrateAutoSelectedContactTags(
            initial,
            initPrimaryId,
            initRoleIds,
            loadedContacts,
            managedFieldsConfig
          )
        )
        setStep('tags')
        return
      }

      // Dry-run preview to get pre-filled tag values from dossier data
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateId: selectedTemplateId
      })

      if (!result.success) {
        setError(result.error || t('generate.previewError'))
        return
      }

      const paths = [
        ...new Set([...result.data.unresolvedTags, ...Object.keys(result.data.resolvedTags)])
      ]
      setTagPaths(paths)

      // Init tagValues from resolved values; empty string for unresolved
      const initial: Record<string, string> = {}
      for (const path of paths) {
        initial[path] = result.data.resolvedTags[path] ?? ''
      }

      // Auto-select primary contact: first contact, or one matching a contact.* tag
      const firstContact = loadedContacts[0]
      const initPrimaryId = firstContact?.uuid ?? ''
      setPrimaryContactId(initPrimaryId)

      // Auto-select role contacts based on contact role
      const initRoleIds: Record<string, string> = {}
      const roleKeys = [
        ...new Set(
          paths
            .filter((p) => {
              const s = p.split('.')
              return s[0] === 'contact' && s.length === 3
            })
            .map((p) => p.split('.')[1] as string)
        )
      ]
      for (const roleKey of roleKeys) {
        const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
        if (matched) initRoleIds[roleKey] = matched.uuid
      }
      setRoleContactIds(initRoleIds)

      setTagValues(
        hydrateAutoSelectedContactTags(
          initial,
          initPrimaryId,
          initRoleIds,
          loadedContacts,
          managedFieldsConfig
        )
      )
      setStep('tags')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleTagsNext(): Promise<void> {
    setError(null)
    setIsSubmitting(true)

    try {
      if (selectedTemplateUsesDocxSource) {
        // For docx templates, reload tag resolution from the .docx source directly —
        // the HTML snapshot may be stale and is not the source of truth.
        const contactRoleOverrides = Object.fromEntries(
          Object.entries(roleContactIds).filter(([, id]) => id)
        )
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactId: primaryContactId || undefined,
          contactRoleOverrides: Object.keys(contactRoleOverrides).length
            ? contactRoleOverrides
            : undefined
        })

        if (!result.success) {
          setError(result.error || t('generate.previewError'))
          return
        }

        const unresolvedTags = result.data.tagPaths.filter((p) => !(p in result.data.resolvedTags))

        setReviewDraft({
          html: result.data.htmlPreview,
          filename: result.data.suggestedFilename,
          unresolvedTags,
          resolvedTags: result.data.resolvedTags
        })
        setDocxCustomOutputPath(null)
        setStep('save')
        return
      }

      const contactRoleOverrides = Object.fromEntries(
        Object.entries(roleContactIds).filter(([, id]) => id)
      )
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateId: selectedTemplateId,
        tagOverrides: tagValues,
        primaryContactId: primaryContactId || undefined,
        contactRoleOverrides: Object.keys(contactRoleOverrides).length
          ? contactRoleOverrides
          : undefined
      })

      if (!result.success) {
        setError(result.error || t('generate.previewError'))
        return
      }

      setReviewDraft({
        html: result.data.draftHtml,
        filename: result.data.suggestedFilename,
        unresolvedTags: result.data.unresolvedTags,
        resolvedTags: result.data.resolvedTags
      })
      setDocxCustomOutputPath(null)
      setStep('save')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveSelectOutputPath(): Promise<void> {
    const filename = reviewDraft?.filename ?? docxFilename
    const result = await selectOutputPath({ defaultFilename: filename })
    if (result.success && result.data) {
      setDocxCustomOutputPath(result.data)
    }
  }

  async function handleSave(): Promise<void> {
    if (!reviewDraft) return

    setError(null)
    setIsSubmitting(true)

    try {
      if (selectedTemplateUsesDocxSource) {
        // Use docxtemplater path — preserves Word formatting
        const contactRoleOverrides = Object.fromEntries(
          Object.entries(roleContactIds).filter(([, id]) => id)
        )
        const result = await generateDocument({
          dossierId: selectedDossierId,
          templateId: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactId: primaryContactId || undefined,
          contactRoleOverrides: Object.keys(contactRoleOverrides).length
            ? contactRoleOverrides
            : undefined,
          outputPath: docxCustomOutputPath ?? undefined,
          filename: docxCustomOutputPath ? undefined : reviewDraft.filename
        })

        if (!result.success) {
          setError(result.error || t('generate.saveError'))
          return
        }

        setSuccess({
          filename: getFilenameFromPath(result.data.outputPath),
          outputPath: result.data.outputPath
        })
      } else {
        // HTML → DOCX conversion path
        const result = await saveGeneratedDocument({
          dossierId: selectedDossierId,
          filename: reviewDraft.filename,
          format: 'docx',
          html: reviewDraft.html,
          outputPath: docxCustomOutputPath ?? undefined
        })

        if (!result.success) {
          setError(result.error || t('generate.saveError'))
          return
        }

        setSuccess({
          filename: getFilenameFromPath(result.data.outputPath),
          outputPath: result.data.outputPath
        })
      }

      setStep('setup')
      setReviewDraft(null)
      setDocxFilename('')
      setDocxCustomOutputPath(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredSortedTemplates = useMemo(() => {
    const needle = templateFilter.trim().toLowerCase()
    const filtered = needle
      ? templates.filter(
          (tmpl) =>
            tmpl.name.toLowerCase().includes(needle) ||
            (tmpl.description ?? '').toLowerCase().includes(needle)
        )
      : templates
    return [...filtered].sort((a, b) =>
      templateSort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
    )
  }, [templates, templateFilter, templateSort])

  const templateCountLabel =
    templates.length === 0
      ? null
      : filteredSortedTemplates.length === templates.length
        ? t('templates.list.countTotal', {
            count: templates.length,
            defaultValue: '{{count}} modèle(s)'
          })
        : t('templates.list.countFiltered', {
            count: filteredSortedTemplates.length,
            total: templates.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 pb-4">
        <SectionHeader
          badge={t('generate.title')}
          count={step === 'setup' ? templateCountLabel : undefined}
          actions={
            <div className="flex flex-wrap gap-2">
              {step === 'tags' ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep('setup')}>
                  {t('generate.backToSetup')}
                </Button>
              ) : null}
              {step === 'save' ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep('tags')}>
                  {t('generate.backToTags')}
                </Button>
              ) : null}
              {onBack ? (
                <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                  {t('templates.workspace.backToLibrary')}
                </Button>
              ) : null}
            </div>
          }
        />
        {step === 'setup' && templates.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SearchField
              id="generate-template-search"
              value={templateFilter}
              onChange={setTemplateFilter}
              placeholder={t('templates.list.searchPlaceholder')}
              ariaLabel={t('templates.list.searchLabel')}
            />
            <PillSelect<TemplateSortOrder>
              id="generate-template-sort"
              value={templateSort}
              onChange={setTemplateSort}
              ariaLabel={t('templates.list.sortLabel')}
            >
              <option value="name-asc">{t('templates.list.sortNameAsc')}</option>
              <option value="name-desc">{t('templates.list.sortNameDesc')}</option>
            </PillSelect>
          </div>
        ) : null}
        {step === 'tags' ? (
          <p className="text-sm text-[#5c5c5a]">{t('generate.tagsDescription')}</p>
        ) : null}
        {step === 'save' && selectedTemplateUsesDocxSource ? (
          <p className="text-sm text-[#5c5c5a]">{t('generate.reviewDescription')}</p>
        ) : null}
      </div>

      {/* Success */}
      {success ? (
        <div
          role="status"
          className="flex shrink-0 items-start justify-between gap-4 rounded-xl border border-[#cfe0c5] bg-[#f1f7ec] px-4 py-3 text-sm text-[#3c6132] mb-5"
        >
          <div>
            <p>{t('generate.toast.success', { filename: success.filename })}</p>
            <p className="mt-1 break-all font-mono text-xs text-[#3c6132]">{success.outputPath}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 border border-[#cfe0c5] text-[#3c6132] hover:bg-[#f1f7ec]"
            onClick={() => void openGeneratedFile(success.outputPath)}
          >
            {t('generate.openFile')}
          </Button>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="shrink-0 rounded-xl border border-[#e8c7c7] bg-[#fbf0f0] px-4 py-3 text-sm text-[#9c2f2f]">
          {error}
        </div>
      ) : null}

      {/* Setup step */}
      {step === 'setup' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* Single-column template picker — dossier is fixed by the parent. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="min-h-0 flex-1">
              {filteredSortedTemplates.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#e5e3da] bg-white py-8 text-sm text-[#5c5c5a]">
                  {t('templates.emptyState')}
                </div>
              ) : (
                <ListContainer className="min-h-0 h-full">
                  <ul className="h-full divide-y divide-deep-space overflow-y-auto">
                    {filteredSortedTemplates.map((template) => {
                      const isSelected = template.id === selectedTemplateId
                      return (
                        <li key={template.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedTemplateId(template.id)}
                            className={cn(
                              'w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-[#fbf9f4]',
                              isSelected
                                ? 'bg-aurora/5 shadow-[inset_0_0_0_1px_rgba(15,122,138,0.25)]'
                                : 'bg-white'
                            )}
                          >
                            <div className="flex min-w-0 items-baseline gap-2">
                              {template.hasDocxSource ? (
                                <span className="shrink-0 rounded-full border border-[#cfe0c5] bg-[#f1f7ec] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#3c6132]">
                                  {t('templates.list.docxBadge')}
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full border border-[#d8d3c4] bg-[#f4f1e8] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#6b5d3a]">
                                  {t('templates.list.textBadge')}
                                </span>
                              )}
                              <span className="truncate text-sm font-semibold text-[#1a1a1a]">
                                {template.name}
                              </span>
                              {template.description ? (
                                <span className="min-w-0 truncate text-xs text-[#5c5c5a]">
                                  {template.description}
                                </span>
                              ) : null}
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </ListContainer>
              )}
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-[#e5e3da] pt-3">
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack}>
                {t('templates.editor.cancelButton')}
              </Button>
            ) : null}
            <Button onClick={() => void handleSetupNext()} disabled={!canSubmitSetup}>
              {isSubmitting ? t('generate.buttonLoading') : t('generate.nextButton')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Tags step */}
      {step === 'tags' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <TagFillingStep
            tagPaths={tagPaths}
            tagValues={tagValues}
            onTagValuesChange={setTagValues}
            primaryContactId={primaryContactId}
            onPrimaryContactChange={setPrimaryContactId}
            roleContactIds={roleContactIds}
            onRoleContactIdsChange={setRoleContactIds}
            dossierContacts={dossierContacts}
            keyDateOptions={keyDateOptions}
            managedFieldsConfig={managedFieldsConfig}
          />
          <div className="flex shrink-0 justify-end gap-2 border-t border-[#e5e3da] pt-4">
            <Button type="button" variant="ghost" onClick={() => setStep('setup')}>
              {t('templates.editor.cancelButton')}
            </Button>
            <Button onClick={() => void handleTagsNext()} disabled={isSubmitting}>
              {isSubmitting
                ? t('generate.buttonLoading')
                : selectedTemplateUsesDocxSource
                  ? t('generate.reviewButton')
                  : t('generate.generateTextButton')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Save step — unified for both rich-text and Word templates */}
      {step === 'save' && reviewDraft ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Top controls: filename + path (DOCX templates only) */}
          <div className="shrink-0 space-y-4">
            {selectedTemplateUsesDocxSource ? (
              <>
                <label
                  className="flex flex-col gap-2 text-sm text-[#1a1a1a]"
                  htmlFor="save-filename"
                >
                  <span>{t('generate.filenameLabel')}</span>
                  <input
                    id="save-filename"
                    type="text"
                    value={reviewDraft.filename}
                    onChange={(event) =>
                      setReviewDraft((current) =>
                        current ? { ...current, filename: event.target.value } : current
                      )
                    }
                    className="w-full rounded-2xl border border-[#e5e3da] bg-white px-4 py-3 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                  />
                </label>

                {/* Output path */}
                <section className="rounded-2xl border border-[#e5e3da] bg-white p-4 space-y-3">
                  <p className="text-sm font-medium text-[#1a1a1a]">
                    {t('generate.docxSave.outputPathTitle')}
                  </p>

                  <label className="flex cursor-pointer items-center gap-3 text-sm text-[#1a1a1a]">
                    <input
                      type="radio"
                      name="save-output-path"
                      checked={docxCustomOutputPath === null}
                      onChange={() => setDocxCustomOutputPath(null)}
                      className="accent-aurora"
                    />
                    {t('generate.docxSave.saveToDossier')}
                  </label>

                  <label className="flex cursor-pointer items-center gap-3 text-sm text-[#1a1a1a]">
                    <input
                      type="radio"
                      name="save-output-path"
                      checked={docxCustomOutputPath !== null}
                      onChange={() => void handleSaveSelectOutputPath()}
                      className="accent-aurora"
                    />
                    {t('generate.docxSave.saveToCustomPath')}
                  </label>

                  {docxCustomOutputPath !== null ? (
                    <div className="flex items-center gap-3 pl-6">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#1a1a1a]">
                        {docxCustomOutputPath}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleSaveSelectOutputPath()}
                      >
                        {t('generate.docxSave.browsePath')}
                      </Button>
                    </div>
                  ) : null}
                </section>
              </>
            ) : null}

            {/* Unresolved tags warning */}
            {reviewDraft.unresolvedTags.length > 0 ? (
              <div className="rounded-2xl border border-[#e8d5a3] bg-[#fbf5e3] px-4 py-3">
                <p className="text-sm font-medium text-[#7a5a00]">
                  {t('generate.unresolvedTitle')}
                </p>
                <p className="mt-1 text-sm text-[#7a5a00]">{t('generate.unresolvedTagHint')}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {reviewDraft.unresolvedTags.map((tagPath) => (
                    <li
                      key={tagPath}
                      className="rounded-full border border-[#e8d5a3] bg-[#fbf5e3] px-3 py-1 text-xs text-[#7a5a00]"
                    >
                      {tagPath}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Read-only preview */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e5e3da]">
            <RichTextEditor
              ariaLabel={t('generate.reviewEditorLabel')}
              value={reviewDraft.html}
              onChange={() => {}}
              documentPreview
            />
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center justify-between border-t border-[#e5e3da] pt-4">
            {selectedTemplateUsesDocxSource ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  const html = reviewDraft.html
                  const plain = (() => {
                    const div = document.createElement('div')
                    div.innerHTML = html
                    return div.innerText
                  })()
                  const showTick = (): void => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }
                  void copyToClipboard({ text: plain, html }).then(showTick).catch(showTick)
                }}
              >
                {copied ? t('generate.copiedButton') : t('generate.copyButton')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (selectedTemplateUsesDocxSource) {
                    setStep('tags')
                  } else {
                    setReviewDraft(null)
                    setDocxFilename('')
                    setDocxCustomOutputPath(null)
                    setStep('setup')
                  }
                }}
              >
                {selectedTemplateUsesDocxSource
                  ? t('templates.editor.cancelButton')
                  : t('generate.closeButton')}
              </Button>
              {selectedTemplateUsesDocxSource ? (
                <Button onClick={() => void handleSave()} disabled={!canSave}>
                  {isSubmitting ? t('generate.saveLoading') : t('generate.saveButton')}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    const html = reviewDraft.html
                    const plain = (() => {
                      const div = document.createElement('div')
                      div.innerHTML = html
                      return div.innerText
                    })()
                    const showTick = (): void => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }
                    void copyToClipboard({ text: plain, html }).then(showTick).catch(showTick)
                  }}
                >
                  <span className="relative inline-flex items-center justify-center">
                    <span className={copied ? 'invisible' : ''}>{t('generate.copyButton')}</span>
                    {copied ? (
                      <span className="absolute inset-0 flex items-center justify-center">✓</span>
                    ) : null}
                  </span>
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
