import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TemplateDraft, TemplateRecord, TemplateUpdate } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import {
  buildKnownTagIndex,
  getTemplateEditorHtml,
  isBlankTemplateContent,
  lintTemplateHtml,
  replaceTagPathInHtml,
  type TagLintIssue
} from '@shared/templateContent'
import { templateDraftSchema } from '@shared/validation'
import { useEntityStore, useTemplateStore } from '@renderer/stores'
import { AlertBanner, Button, DialogShell } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { copyTextToClipboard } from '@renderer/lib/clipboard'

import { getTagCatalog } from './tagCatalog'
import { TagifyReviewDialog } from './TagifyReviewDialog'
import { TagReferencePanel } from './TagReferencePanel'
import { TemplateEditor } from './TemplateEditor'
import { TemplateLibraryDialog } from './TemplateLibraryDialog'
import { TemplateList } from './TemplateList'

interface TemplatesPanelProps {
  domainPath: string | null
}

interface TemplateFormErrors {
  name?: string
  content?: string
  form?: string
}

type WorkspaceState =
  | { view: 'library' }
  | { view: 'create-choice' }
  | { view: 'create' }
  | { view: 'edit'; templateUuid: string }
  | { view: 'macros' }
  | { view: 'template-library' }

function createEmptyDraft(): TemplateDraft {
  return {
    name: '',
    content: '<p></p>',
    description: '',
    documentKind: 'document',
    category: ''
  }
}

function toDraft(template: TemplateRecord, content: string): TemplateDraft {
  return {
    name: template.name,
    content: getTemplateEditorHtml(content),
    description: template.description ?? '',
    documentKind: template.documentKind,
    category: template.category ?? ''
  }
}

export function TemplatesPanel({ domainPath }: TemplatesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useTemplateStore((state) => state.templates)
  const isLoading = useTemplateStore((state) => state.isLoading)
  const storeError = useTemplateStore((state) => state.error)
  const loadTemplates = useTemplateStore((state) => state.load)
  const getTemplateContent = useTemplateStore((state) => state.getContent)
  const createTemplate = useTemplateStore((state) => state.create)
  const updateTemplate = useTemplateStore((state) => state.update)
  const removeTemplate = useTemplateStore((state) => state.remove)
  const pickDocxFile = useTemplateStore((state) => state.pickDocxFile)
  const importTemplateDocx = useTemplateStore((state) => state.importDocx)
  const openTemplateDocx = useTemplateStore((state) => state.openDocx)
  const removeTemplateDocx = useTemplateStore((state) => state.removeDocx)
  const applyCabinetDefaultDocx = useTemplateStore((state) => state.applyCabinetDefaultDocx)
  const subscribeToDocxSynced = useTemplateStore((state) => state.subscribeToDocxSynced)
  const entityProfile = useEntityStore((state) => state.profile)
  const cabinetHasDefaultDocx = Boolean(entityProfile?.defaultTemplateFileName)
  const tagCatalogEntries = useMemo(
    () => getTagCatalog(entityProfile?.managedFields),
    [entityProfile?.managedFields]
  )
  const knownTagIndex = useMemo(() => buildKnownTagIndex(tagCatalogEntries), [tagCatalogEntries])
  const existingCategories = useMemo(
    () =>
      [
        ...new Set(templates.map((tpl) => tpl.category).filter((c): c is string => Boolean(c)))
      ].sort((a, b) => a.localeCompare(b)),
    [templates]
  )

  const [workspace, setWorkspace] = useState<WorkspaceState>({ view: 'library' })
  const [draft, setDraft] = useState<TemplateDraft>(createEmptyDraft)
  const [createSourceType, setCreateSourceType] = useState<'text' | 'docx'>('text')
  const [errors, setErrors] = useState<TemplateFormErrors>({})
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [lintIssues, setLintIssues] = useState<TagLintIssue[] | null>(null)
  const [tagifyTemplate, setTagifyTemplate] = useState<{ id: string; name: string } | null>(null)
  const [pendingDocxCreate, setPendingDocxCreate] = useState(false)
  const [pendingDocxPick, setPendingDocxPick] = useState<{
    token: string
    fileName: string
  } | null>(null)
  const editLoadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!domainPath) {
      return
    }

    void loadTemplates()
  }, [domainPath, loadTemplates])

  // Refresh editor draft when the watched .docx file is saved externally (e.g. in Word)
  useEffect(() => {
    return subscribeToDocxSynced((event) => {
      if (workspace.view === 'edit' && workspace.templateUuid === event.templateUuid) {
        setDraft((current) => ({ ...current, content: getTemplateEditorHtml(event.html) }))
      }
    })
  }, [workspace, subscribeToDocxSynced])

  const activeTemplate =
    workspace.view === 'edit'
      ? (templates.find((template) => template.uuid === workspace.templateUuid) ?? null)
      : null

  function openCreateChooser(): void {
    setWorkspace({ view: 'create-choice' })
    setDraft(createEmptyDraft())
    setCreateSourceType('text')
    setIsEditorLoading(false)
    setErrors({})
  }

  function openCreateEditor(sourceType: 'text' | 'docx' = 'text'): void {
    setWorkspace({ view: 'create' })
    setDraft(createEmptyDraft())
    setCreateSourceType(sourceType)
    setIsEditorLoading(false)
    setErrors({})
    setPendingDocxCreate(false)
    setPendingDocxPick(null)
  }

  function openEditEditor(template: TemplateRecord): void {
    const requestId = editLoadRequestIdRef.current + 1
    editLoadRequestIdRef.current = requestId
    setWorkspace({ view: 'edit', templateUuid: template.uuid })
    setDraft(createEmptyDraft())
    setIsEditorLoading(true)
    setErrors({})
    setLintIssues(null)

    void getTemplateContent(template.uuid).then((result) => {
      if (editLoadRequestIdRef.current !== requestId) {
        return
      }

      if (!result.success) {
        setErrors({ form: result.error })
        setDraft(toDraft(template, ''))
        setIsEditorLoading(false)
        return
      }

      const nextTemplate =
        useTemplateStore.getState().templates.find((entry) => entry.uuid === template.uuid) ??
        template
      setDraft(toDraft(nextTemplate, result.data))
      setIsEditorLoading(false)
    })
  }

  function openMacrosWorkspace(): void {
    setWorkspace({ view: 'macros' })
    setErrors({})
  }

  function openLibraryDialog(): void {
    setWorkspace({ view: 'template-library' })
    setErrors({})
  }

  async function closeWorkspace(): Promise<void> {
    editLoadRequestIdRef.current += 1
    if (pendingDocxCreate && workspace.view === 'edit') {
      await removeTemplate(workspace.templateUuid)
    }
    setIsEditorLoading(false)
    setPendingDocxCreate(false)
    setPendingDocxPick(null)
    setWorkspace({ view: 'library' })
    setDraft(createEmptyDraft())
    setCreateSourceType('text')
    setErrors({})
    setLintIssues(null)
  }

  const updateDraft = useCallback((field: keyof TemplateDraft, value: string): void => {
    setDraft((current) => ({
      ...current,
      [field]: value
    }))
    setErrors((current) => ({
      ...current,
      [field === 'content' ? 'content' : field]: undefined,
      form: undefined
    }))
    if (field === 'content') {
      setLintIssues(null)
    }
  }, [])

  function applyLintSuggestion(issue: TagLintIssue, suggestion: string): void {
    const fixedContent = replaceTagPathInHtml(draft.content, issue.rawPath, suggestion)
    setDraft((current) => ({ ...current, content: fixedContent }))
    setLintIssues((current) => {
      const remaining = (current ?? []).filter(
        (entry) => entry.normalizedPath !== issue.normalizedPath
      )
      return remaining.length > 0 ? remaining : null
    })
  }

  async function handleSubmit(options: { skipLint?: boolean } = {}): Promise<void> {
    const nextErrors: TemplateFormErrors = {}

    if (!draft.name.trim()) {
      nextErrors.name = t('templates.editor.nameRequired')
    }

    // Docx-create flow: name required + a file must have been picked
    if (workspace.view === 'create' && createSourceType === 'docx') {
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors)
        return
      }

      if (!pendingDocxPick) {
        // No file picked yet — open the picker now
        await handlePickDocxFile()
        return
      }

      // Name + file both present: create template then import from the picked path
      const parsed = templateDraftSchema.safeParse(draft)
      if (!parsed.success) {
        setErrors({ form: parsed.error.issues[0]?.message ?? t('templates.editor.saveFailed') })
        return
      }

      setErrors({})
      setIsSaving(true)

      try {
        await createTemplate(parsed.data)

        const nextState = useTemplateStore.getState()
        if (nextState.error) {
          if (nextState.errorCode === IpcErrorCode.INVALID_INPUT) {
            setErrors({ name: t('templates.editor.duplicateName') })
          } else {
            setErrors({ form: nextState.error })
          }
          return
        }

        const created = nextState.templates.find((tmpl) => tmpl.name === draft.name.trim())
        if (!created) return

        await importTemplateDocx(created.uuid, pendingDocxPick.token)

        const importState = useTemplateStore.getState()
        if (importState.error) {
          setErrors({ form: importState.error })
          return
        }

        showToast(t('templates.toast.created'))
        setPendingDocxCreate(false)
        void closeWorkspace()
        // Offer AI tag detection on the freshly imported letter
        setTagifyTemplate({ id: created.uuid, name: created.name })
      } finally {
        setIsSaving(false)
      }

      return
    }

    if (isBlankTemplateContent(draft.content) && !activeTemplate?.hasDocxSource) {
      nextErrors.content = t('templates.editor.contentRequired')
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const parsed = templateDraftSchema.safeParse(draft)

    if (!parsed.success) {
      setErrors({
        form: parsed.error.issues[0]?.message ?? t('templates.editor.saveFailed')
      })
      return
    }

    // Warn about unknown tags before saving — DOCX sources are authored in Word
    // and synced separately, so only lint editable text templates.
    if (!options.skipLint && !activeTemplate?.hasDocxSource) {
      const issues = lintTemplateHtml(draft.content, knownTagIndex)
      if (issues.length > 0) {
        setLintIssues(issues)
        return
      }
    }
    setLintIssues(null)

    setErrors({})
    setIsSaving(true)

    try {
      if (workspace.view === 'edit' && workspace.templateUuid) {
        const payload: TemplateUpdate = {
          uuid: workspace.templateUuid,
          ...parsed.data
        }
        await updateTemplate(payload)
      } else {
        await createTemplate(parsed.data)
      }

      const nextState = useTemplateStore.getState()

      if (nextState.error) {
        if (nextState.errorCode === IpcErrorCode.INVALID_INPUT) {
          setErrors({
            name: t('templates.editor.duplicateName')
          })
          return
        }

        setErrors({
          form: nextState.error
        })
        return
      }

      showToast(
        workspace.view === 'edit' ? t('templates.toast.updated') : t('templates.toast.created')
      )
      setPendingDocxCreate(false)
      void closeWorkspace()
    } finally {
      setIsSaving(false)
    }
  }

  function handleTagifyApplied(): void {
    void loadTemplates()
    // Refresh the open editor draft if it shows the tagified template
    if (workspace.view === 'edit' && workspace.templateUuid === tagifyTemplate?.id) {
      const template = templates.find((tpl) => tpl.uuid === tagifyTemplate.id)
      if (template) openEditEditor(template)
    }
  }

  async function handleMoveToCategory(
    templateUuid: string,
    category: string | null
  ): Promise<void> {
    const template = templates.find((tpl) => tpl.uuid === templateUuid)
    if (!template) return

    // Lightweight update: omitted content keeps the stored template body.
    await updateTemplate({ uuid: templateUuid, name: template.name, category: category ?? '' })

    const nextError = useTemplateStore.getState().error
    if (nextError) {
      setErrors({ form: nextError })
    }
  }

  async function handleDelete(templateUuid: string): Promise<void> {
    await removeTemplate(templateUuid)

    const nextError = useTemplateStore.getState().error

    if (nextError) {
      setErrors({
        form: nextError
      })
      return
    }

    if (workspace.view === 'edit' && workspace.templateUuid === templateUuid) {
      void closeWorkspace()
    }

    showToast(t('templates.toast.deleted'))
  }

  async function handlePickDocxFile(): Promise<void> {
    // For the edit flow (existing template), use the old full import path
    if (workspace.view === 'edit' && workspace.templateUuid) {
      await importTemplateDocx(workspace.templateUuid)

      const state = useTemplateStore.getState()
      if (state.error) {
        if (state.errorCode === IpcErrorCode.VALIDATION_FAILED) {
          return // user cancelled picker
        }
        setErrors({ form: state.error })
        return
      }

      const updated = state.templates.find(
        (tmpl) => tmpl.uuid === (workspace as { templateUuid: string }).templateUuid
      )
      if (updated) {
        void getTemplateContent(updated.uuid).then((r) => {
          setDraft(toDraft(updated, r.success ? r.data : ''))
          setIsEditorLoading(false)
        })
      }
      showToast(t('templates.toast.docxImported'))
      return
    }

    // For the create flow: just pick the file — no name validation
    const result = await pickDocxFile()
    if (!result.success) {
      setErrors({ form: result.error })
      return
    }

    if (result.data) {
      setPendingDocxPick({ token: result.data.pickToken, fileName: result.data.fileName })
      setDraft((current) => ({ ...current, content: result.data!.html }))
    }
  }

  async function handleOpenDocx(): Promise<void> {
    if (workspace.view !== 'edit' || !workspace.templateUuid) {
      return
    }

    const result = await openTemplateDocx(workspace.templateUuid)
    if (!result.success) {
      setErrors({ form: result.error })
    }
  }

  async function handleApplyCabinetDefaultDocx(): Promise<void> {
    if (workspace.view !== 'edit' || !workspace.templateUuid) {
      return
    }
    await applyCabinetDefaultDocx(workspace.templateUuid)
    const state = useTemplateStore.getState()
    if (state.error) {
      setErrors({ form: state.error })
      return
    }
    showToast(
      t('templates.toast.cabinetDocxApplied', {
        defaultValue: 'Modèle DOCX cabinet appliqué.'
      })
    )
  }

  async function handleRemoveDocx(): Promise<void> {
    if (workspace.view !== 'edit' || !workspace.templateUuid) {
      return
    }

    await removeTemplateDocx(workspace.templateUuid)

    const state = useTemplateStore.getState()
    if (state.error) {
      setErrors({ form: state.error })
      return
    }

    showToast(t('templates.toast.docxRemoved'))
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-6">
      {storeError ? <AlertBanner tone="error">{storeError}</AlertBanner> : null}

      <TemplateList
        isLoading={isLoading}
        templates={templates}
        onCreate={openCreateChooser}
        onDelete={handleDelete}
        onEdit={openEditEditor}
        onMacros={openMacrosWorkspace}
        onOpenLibrary={openLibraryDialog}
        onMoveToCategory={handleMoveToCategory}
      />

      {workspace.view === 'template-library' ? (
        <TemplateLibraryDialog onDismiss={() => void closeWorkspace()} />
      ) : null}

      {tagifyTemplate ? (
        <TagifyReviewDialog
          templateUuid={tagifyTemplate.id}
          templateName={tagifyTemplate.name}
          onClose={() => setTagifyTemplate(null)}
          onApplied={handleTagifyApplied}
        />
      ) : null}

      {workspace.view === 'create-choice' ? (
        <DialogShell
          size="lg"
          aria-label={t('templates.createChoice.title')}
          onDismiss={() => void closeWorkspace()}
        >
          <div className="flex flex-col gap-6">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-ink">
                {t('templates.createChoice.title')}
              </h3>
              <p className="text-sm text-ink">{t('templates.createChoice.description')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => openCreateEditor('text')}
                className="rounded-2xl border border-hairline bg-white p-5 text-left transition hover:border-hairline-strong hover:bg-white"
              >
                <p className="text-sm font-semibold text-ink">
                  {t('templates.createChoice.textTitle')}
                </p>
                <p className="mt-2 text-sm text-ink-muted">
                  {t('templates.createChoice.textDescription')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => openCreateEditor('docx')}
                className="rounded-2xl border border-hairline bg-deep-space p-5 text-left transition hover:border-hairline-strong hover:bg-parchment-dim"
              >
                <p className="text-sm font-semibold text-ink">
                  {t('templates.createChoice.docxTitle')}
                </p>
                <p className="mt-2 text-sm text-ink">
                  {t('templates.createChoice.docxDescription')}
                </p>
              </button>
            </div>

            <div className="flex justify-end border-t border-hairline pt-4">
              <Button type="button" variant="ghost" onClick={() => void closeWorkspace()}>
                {t('templates.editor.cancelButton')}
              </Button>
            </div>
          </div>
        </DialogShell>
      ) : null}

      {workspace.view === 'create' || workspace.view === 'edit' ? (
        <DialogShell
          layout="stretched"
          size="full"
          panelClassName="min-h-0"
          aria-label={
            workspace.view === 'create'
              ? t('templates.editor.createTitle')
              : t('templates.editor.editTitle')
          }
          onDismiss={() => void closeWorkspace()}
        >
          {workspace.view === 'edit' && isEditorLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-hairline bg-white px-6 py-10 text-sm text-ink">
              {t('templates.loading')}
            </div>
          ) : (
            <TemplateEditor
              isSaving={isSaving}
              mode={workspace.view}
              value={draft}
              template={activeTemplate}
              preferredSourceType={workspace.view === 'create' ? createSourceType : 'text'}
              pendingDocxFileName={pendingDocxPick?.fileName ?? null}
              errors={errors}
              onCancel={() => void closeWorkspace()}
              onChange={updateDraft}
              onSubmit={handleSubmit}
              onImportDocx={handlePickDocxFile}
              onOpenDocx={handleOpenDocx}
              onRemoveDocx={handleRemoveDocx}
              onApplyCabinetDefaultDocx={handleApplyCabinetDefaultDocx}
              cabinetHasDefaultDocx={cabinetHasDefaultDocx}
              tagSuggestions={tagCatalogEntries}
              existingCategories={existingCategories}
              onTagify={
                workspace.view === 'edit' && activeTemplate
                  ? () => setTagifyTemplate({ id: activeTemplate.uuid, name: activeTemplate.name })
                  : undefined
              }
              lintIssues={lintIssues}
              onApplyLintSuggestion={applyLintSuggestion}
              onSaveAnyway={() => void handleSubmit({ skipLint: true })}
            />
          )}
        </DialogShell>
      ) : null}

      {workspace.view === 'macros' ? (
        <DialogShell
          size="xl"
          aria-label={t('templates.macros.title')}
          onDismiss={() => void closeWorkspace()}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-ink">{t('templates.macros.title')}</h3>
                <p className="text-sm text-ink-muted">{t('templates.macros.helperText')}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void closeWorkspace()}>
                {t('common.close', { defaultValue: 'Fermer' })}
              </Button>
            </div>
            <TagReferencePanel referenceMode onInsertTag={(tag) => copyTextToClipboard(tag)} />
          </div>
        </DialogShell>
      ) : null}
    </section>
  )
}
