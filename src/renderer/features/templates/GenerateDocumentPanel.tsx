import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import { normalizeTagPath } from '@shared/templateContent'
import { buildTagPathLocalizer, templateRoutineCatalog } from '@shared/templateRoutines'

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
import {
  computeTagProvenance,
  hydrateAutoSelectedContactTags,
  mergeMemorizedOverrides,
  type TagProvenance
} from './generateDocument/tagFillingHelpers'
import { buildKeyDateOptions, getFilenameFromPath } from './generateDocument/tagValueHelpers'

// ── Panel ─────────────────────────────────────────────────────────────────────

interface ReviewDraftState {
  html: string
  filename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
}

type TemplateSortOrder = 'name-asc' | 'name-desc'

type WizardStep = 'setup' | 'tags' | 'save'

const WIZARD_STEPS: WizardStep[] = ['setup', 'tags', 'save']

function WizardStepper({
  current,
  onNavigate
}: {
  current: WizardStep
  onNavigate: (step: WizardStep) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const currentIndex = WIZARD_STEPS.indexOf(current)
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {WIZARD_STEPS.map((step, index) => {
        const isCurrent = index === currentIndex
        const isPast = index < currentIndex
        const label = `${index + 1}. ${t(`generate.steps.${step}`)}`
        return (
          <li key={step} className="flex items-center gap-1">
            {index > 0 ? <span className="text-ink-subtle">→</span> : null}
            {isPast ? (
              <button
                type="button"
                onClick={() => onNavigate(step)}
                className="rounded-full px-2.5 py-1 text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
              >
                {label}
              </button>
            ) : (
              <span
                className={cn(
                  'rounded-full px-2.5 py-1',
                  isCurrent ? 'bg-aurora/10 font-semibold text-aurora' : 'text-ink-subtle'
                )}
              >
                {label}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function TemplateSourceBadge({ hasDocxSource }: { hasDocxSource: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return hasDocxSource ? (
    <span className="shrink-0 rounded-full border border-success-border bg-success-tint px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-success-deep">
      {t('templates.list.docxBadge')}
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-[#d8d3c4] bg-[#f4f1e8] px-2 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-[#6b5d3a]">
      {t('templates.list.textBadge')}
    </span>
  )
}

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

  const [step, setStep] = useState<WizardStep>('setup')
  const [focusTagPath, setFocusTagPath] = useState<string | null>(null)
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
  const [tagProvenance, setTagProvenance] = useState<Record<string, TagProvenance>>({})
  const [primaryContactUuid, setPrimaryContactId] = useState('')
  const [roleContactUuids, setRoleContactIds] = useState<Record<string, string>>({})
  const [keyDateOptions, setKeyDateOptions] = useState<ComboOption[]>([])
  const managedFieldsConfig = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields),
    [profile?.managedFields]
  )
  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
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

        if (detail?.slug !== selectedDossierId) {
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
  const selectedTemplate = templates.find((tmpl) => tmpl.uuid === selectedTemplateId)
  const selectedTemplateUsesDocxSource = selectedTemplate?.hasDocxSource === true

  const canSubmitSetup =
    selectedDossierId.trim().length > 0 &&
    selectedTemplateId.trim().length > 0 &&
    templates.some((tmpl) => tmpl.uuid === selectedTemplateId) &&
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
        return detail?.slug === selectedDossierId ? detail : null
      })()

      setKeyDateOptions(buildKeyDateOptions(loadedDossier, i18n.resolvedLanguage ?? 'fr'))

      // Docx-sourced templates: preview tags first for reconciliation
      if (selectedTemplateUsesDocxSource) {
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateUuid: selectedTemplateId
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
              .map((p) => normalizeTagPath(p).split('.'))
              .filter((s) => s[0] === 'contact' && s.length === 3)
              .map((s) => s[1] as string)
          )
        ]
        for (const roleKey of roleKeys) {
          const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
          if (matched) initRoleIds[roleKey] = matched.uuid
        }
        setRoleContactIds(initRoleIds)

        const hydrated = hydrateAutoSelectedContactTags(
          initial,
          initPrimaryId,
          initRoleIds,
          loadedContacts,
          managedFieldsConfig
        )
        const memorized = result.data.memorizedOverrides
        setTagValues(mergeMemorizedOverrides(hydrated, memorized))
        setTagProvenance(computeTagProvenance(paths, result.data.resolvedTags, hydrated, memorized))
        setStep('tags')
        return
      }

      // Dry-run preview to get pre-filled tag values from dossier data
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateUuid: selectedTemplateId
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
            .map((p) => normalizeTagPath(p).split('.'))
            .filter((s) => s[0] === 'contact' && s.length === 3)
            .map((s) => s[1] as string)
        )
      ]
      for (const roleKey of roleKeys) {
        const matched = loadedContacts.find((c) => c.role && roleToTagKey(c.role) === roleKey)
        if (matched) initRoleIds[roleKey] = matched.uuid
      }
      setRoleContactIds(initRoleIds)

      const hydrated = hydrateAutoSelectedContactTags(
        initial,
        initPrimaryId,
        initRoleIds,
        loadedContacts,
        managedFieldsConfig
      )
      const memorized = result.data.memorizedOverrides
      setTagValues(mergeMemorizedOverrides(hydrated, memorized))
      setTagProvenance(computeTagProvenance(paths, result.data.resolvedTags, hydrated, memorized))
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
          Object.entries(roleContactUuids).filter(([, id]) => id)
        )
        const result = await previewDocxDocument({
          dossierId: selectedDossierId,
          templateUuid: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactUuid: primaryContactUuid || undefined,
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
        Object.entries(roleContactUuids).filter(([, id]) => id)
      )
      const result = await previewDocument({
        dossierId: selectedDossierId,
        templateUuid: selectedTemplateId,
        tagOverrides: tagValues,
        primaryContactUuid: primaryContactUuid || undefined,
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
          Object.entries(roleContactUuids).filter(([, id]) => id)
        )
        const result = await generateDocument({
          dossierId: selectedDossierId,
          templateUuid: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactUuid: primaryContactUuid || undefined,
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
        // HTML → DOCX conversion path — generation context included so manual
        // values are memorized for the next run of this template.
        const contactRoleOverrides = Object.fromEntries(
          Object.entries(roleContactUuids).filter(([, id]) => id)
        )
        const result = await saveGeneratedDocument({
          dossierId: selectedDossierId,
          filename: reviewDraft.filename,
          format: 'docx',
          html: reviewDraft.html,
          outputPath: docxCustomOutputPath ?? undefined,
          templateUuid: selectedTemplateId,
          tagOverrides: tagValues,
          primaryContactUuid: primaryContactUuid || undefined,
          contactRoleOverrides: Object.keys(contactRoleOverrides).length
            ? contactRoleOverrides
            : undefined
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

  // Mirror the library grouping: named categories first (alphabetical), rest last.
  const groupedTemplates = useMemo(() => {
    const map = new Map<string, typeof filteredSortedTemplates>()
    for (const tmpl of filteredSortedTemplates) {
      const key = tmpl.category ?? ''
      const list = map.get(key) ?? []
      list.push(tmpl)
      map.set(key, list)
    }
    const categories = [...map.keys()]
      .filter((key) => key !== '')
      .sort((a, b) => a.localeCompare(b))
    return [
      ...categories.map((category) => ({ key: category, items: map.get(category) ?? [] })),
      ...(map.has('') ? [{ key: '', items: map.get('') ?? [] }] : [])
    ]
  }, [filteredSortedTemplates])

  const pickerHasCategories = groupedTemplates.some((section) => section.key !== '')

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
            onBack ? (
              <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                {t('templates.workspace.backToLibrary')}
              </Button>
            ) : undefined
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <WizardStepper current={step} onNavigate={setStep} />
          {step !== 'setup' && selectedTemplate ? (
            <div className="flex min-w-0 items-center gap-2">
              <TemplateSourceBadge hasDocxSource={selectedTemplate.hasDocxSource} />
              <span className="min-w-0 truncate text-sm font-semibold text-ink">
                {selectedTemplate.name}
              </span>
            </div>
          ) : null}
        </div>
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
          <p className="text-sm text-ink-muted">{t('generate.tagsDescription')}</p>
        ) : null}
        {step === 'save' ? (
          <p className="text-sm text-ink-muted">{t('generate.reviewDescription')}</p>
        ) : null}
      </div>

      {/* Success */}
      {success ? (
        <div
          role="status"
          className="flex shrink-0 items-start justify-between gap-4 rounded-xl border border-success-border bg-success-tint px-4 py-3 text-sm text-success-deep mb-5"
        >
          <div>
            <p>{t('generate.toast.success', { filename: success.filename })}</p>
            <p className="mt-1 break-all font-mono text-xs text-success-deep">
              {success.outputPath}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 border border-success-border text-success-deep hover:bg-success-tint"
            onClick={() => void openGeneratedFile(success.outputPath)}
          >
            {t('generate.openFile')}
          </Button>
        </div>
      ) : null}

      {/* Error */}
      {error ? (
        <div className="shrink-0 rounded-xl border border-destructive-border bg-destructive-tint px-4 py-3 text-sm text-destructive">
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
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-hairline bg-white py-8 text-sm text-ink-muted">
                  {t('templates.emptyState')}
                </div>
              ) : (
                <ListContainer className="min-h-0 h-full">
                  <ul className="h-full divide-y divide-deep-space overflow-y-auto">
                    {groupedTemplates.map((section) => (
                      <Fragment key={section.key || '__uncategorized__'}>
                        {pickerHasCategories ? (
                          <li className="bg-parchment px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                            {section.key || t('templates.list.uncategorized')}
                          </li>
                        ) : null}
                        {section.items.map((template) => {
                          const isSelected = template.uuid === selectedTemplateId
                          return (
                            <li key={template.uuid}>
                              <button
                                type="button"
                                onClick={() => setSelectedTemplateId(template.uuid)}
                                className={cn(
                                  'w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-parchment-bright',
                                  isSelected
                                    ? 'bg-aurora/5 shadow-[inset_0_0_0_1px_rgba(15,122,138,0.25)]'
                                    : 'bg-white'
                                )}
                              >
                                <div className="flex min-w-0 items-baseline gap-2">
                                  <TemplateSourceBadge hasDocxSource={template.hasDocxSource} />
                                  <span className="truncate text-sm font-semibold text-ink">
                                    {template.name}
                                  </span>
                                  {template.description ? (
                                    <span className="min-w-0 truncate text-xs text-ink-muted">
                                      {template.description}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            </li>
                          )
                        })}
                      </Fragment>
                    ))}
                  </ul>
                </ListContainer>
              )}
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-hairline pt-3">
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack}>
                {t('templates.editor.cancelButton')}
              </Button>
            ) : null}
            <Button onClick={() => void handleSetupNext()} disabled={!canSubmitSetup}>
              {isSubmitting ? t('generate.buttonLoading') : t('generate.continueButton')}
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
            primaryContactUuid={primaryContactUuid}
            onPrimaryContactChange={setPrimaryContactId}
            roleContactUuids={roleContactUuids}
            onRoleContactIdsChange={setRoleContactIds}
            dossierContacts={dossierContacts}
            keyDateOptions={keyDateOptions}
            managedFieldsConfig={managedFieldsConfig}
            tagProvenance={tagProvenance}
            focusPath={focusTagPath}
            onFocusHandled={() => setFocusTagPath(null)}
          />
          <div className="flex shrink-0 justify-end gap-2 border-t border-hairline pt-4">
            <Button type="button" variant="ghost" onClick={() => setStep('setup')}>
              {t('generate.backButton')}
            </Button>
            <Button onClick={() => void handleTagsNext()} disabled={isSubmitting}>
              {isSubmitting ? t('generate.buttonLoading') : t('generate.continueButton')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Save step — unified for both rich-text and Word templates */}
      {step === 'save' && reviewDraft ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Top controls: filename + output path — both template types save into the dossier */}
          <div className="shrink-0 space-y-4">
            <label className="flex flex-col gap-2 text-sm text-ink" htmlFor="save-filename">
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
                className="w-full rounded-2xl border border-hairline bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
              />
            </label>

            {/* Output path */}
            <section className="rounded-2xl border border-hairline bg-white p-4 space-y-3">
              <p className="text-sm font-medium text-ink">
                {t('generate.docxSave.outputPathTitle')}
              </p>

              <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
                <input
                  type="radio"
                  name="save-output-path"
                  checked={docxCustomOutputPath === null}
                  onChange={() => setDocxCustomOutputPath(null)}
                  className="accent-aurora"
                />
                {t('generate.docxSave.saveToDossier')}
              </label>

              <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
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
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
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

            {/* Unresolved tags warning — click a tag to jump back to its field */}
            {reviewDraft.unresolvedTags.length > 0 ? (
              <div className="rounded-2xl border border-warning-border bg-warning-tint px-4 py-3">
                <p className="text-sm font-medium text-warning-deep">
                  {t('generate.unresolvedTitle')}
                </p>
                <p className="mt-1 text-sm text-warning-deep">{t('generate.unresolvedTagHint')}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {reviewDraft.unresolvedTags.map((tagPath) => (
                    <li key={tagPath}>
                      <button
                        type="button"
                        onClick={() => {
                          setFocusTagPath(tagPath)
                          setStep('tags')
                        }}
                        title={tagPath}
                        className="rounded-full border border-warning-border bg-warning-tint px-3 py-1 text-xs text-warning-deep underline-offset-2 transition hover:bg-warning-tint/70 hover:underline"
                      >
                        {localizeTagPath(tagPath)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {/* Read-only preview */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-hairline">
            <RichTextEditor
              ariaLabel={t('generate.reviewEditorLabel')}
              value={reviewDraft.html}
              onChange={() => {}}
              documentPreview
            />
          </div>

          {/* Actions — save into the dossier for both template types, copy as secondary */}
          <div className="flex shrink-0 items-center justify-between border-t border-hairline pt-4">
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
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('tags')}>
                {t('generate.backButton')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={!canSave}>
                {isSubmitting ? t('generate.saveLoading') : t('generate.saveButton')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
