import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TemplateDraft, TemplateRecord, TemplateUpdate } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { getTemplateEditorHtml, isBlankTemplateContent } from '@shared/templateContent'
import { templateDraftSchema } from '@renderer/schemas'
import { useTemplateStore } from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'
import { AlertBanner, Button, DialogShell } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'

import { GenerateDocumentPanel } from './GenerateDocumentPanel'
import { TagReferencePanel } from './TagReferencePanel'
import { TemplateEditor } from './TemplateEditor'
import { TemplateList } from './TemplateList'

interface TemplatesPanelProps {
  domainPath: string | null
  initialDossierId?: string | null
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
  | { view: 'edit'; templateId: string }
  | { view: 'generate'; templateId: string | null }
  | { view: 'macros' }

function createEmptyDraft(): TemplateDraft {
  return {
    name: '',
    content: '<p></p>',
    description: ''
  }
}

function toDraft(template: TemplateRecord, content: string): TemplateDraft {
  return {
    name: template.name,
    content: getTemplateEditorHtml(content),
    description: template.description ?? ''
  }
}

export function TemplatesPanel({
  domainPath,
  initialDossierId
}: TemplatesPanelProps): React.JSX.Element {
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

  const [workspace, setWorkspace] = useState<WorkspaceState>(() =>
    initialDossierId ? { view: 'generate', templateId: null } : { view: 'library' }
  )
  const [draft, setDraft] = useState<TemplateDraft>(createEmptyDraft)
  const [createSourceType, setCreateSourceType] = useState<'text' | 'docx'>('text')
  const [errors, setErrors] = useState<TemplateFormErrors>({})
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [isEditorLoading, setIsEditorLoading] = useState(false)
  const [pendingDocxCreate, setPendingDocxCreate] = useState(false)
  const [pendingDocxFilePath, setPendingDocxFilePath] = useState<string | null>(null)
  const editLoadRequestIdRef = useRef(0)

  useEffect(() => {
    if (!domainPath) {
      return
    }

    void loadTemplates()
  }, [domainPath, loadTemplates])

  // Refresh editor draft when the watched .docx file is saved externally (e.g. in Word)
  useEffect(() => {
    const api = getOrdicabApi()

    if (!api) {
      return
    }

    return api.template.onDocxSynced((event) => {
      if (workspace.view === 'edit' && workspace.templateId === event.templateId) {
        setDraft((current) => ({ ...current, content: getTemplateEditorHtml(event.html) }))
      }
    })
  }, [workspace])

  const activeTemplate =
    workspace.view === 'edit'
      ? (templates.find((template) => template.id === workspace.templateId) ?? null)
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
    setPendingDocxFilePath(null)
  }

  function openEditEditor(template: TemplateRecord): void {
    const requestId = editLoadRequestIdRef.current + 1
    editLoadRequestIdRef.current = requestId
    setWorkspace({ view: 'edit', templateId: template.id })
    setDraft(createEmptyDraft())
    setIsEditorLoading(true)
    setErrors({})

    void getTemplateContent(template.id).then((result) => {
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
        useTemplateStore.getState().templates.find((entry) => entry.id === template.id) ?? template
      setDraft(toDraft(nextTemplate, result.data))
      setIsEditorLoading(false)
    })
  }

  function openGenerateWorkspace(templateId: string | null = null): void {
    setWorkspace({ view: 'generate', templateId })
    setErrors({})
  }

  function openMacrosWorkspace(): void {
    setWorkspace({ view: 'macros' })
    setErrors({})
  }

  async function closeWorkspace(): Promise<void> {
    editLoadRequestIdRef.current += 1
    if (pendingDocxCreate && workspace.view === 'edit') {
      await removeTemplate(workspace.templateId)
    }
    setIsEditorLoading(false)
    setPendingDocxCreate(false)
    setPendingDocxFilePath(null)
    setWorkspace({ view: 'library' })
    setDraft(createEmptyDraft())
    setCreateSourceType('text')
    setErrors({})
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
  }, [])

  async function handleSubmit(): Promise<void> {
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

      if (!pendingDocxFilePath) {
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

        await importTemplateDocx(created.id, pendingDocxFilePath)

        const importState = useTemplateStore.getState()
        if (importState.error) {
          setErrors({ form: importState.error })
          return
        }

        showToast(t('templates.toast.created'))
        setPendingDocxCreate(false)
        void closeWorkspace()
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

    setErrors({})
    setIsSaving(true)

    try {
      if (workspace.view === 'edit' && workspace.templateId) {
        const payload: TemplateUpdate = {
          id: workspace.templateId,
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

  async function handleDelete(templateId: string): Promise<void> {
    await removeTemplate(templateId)

    const nextError = useTemplateStore.getState().error

    if (nextError) {
      setErrors({
        form: nextError
      })
      return
    }

    if (workspace.view === 'edit' && workspace.templateId === templateId) {
      void closeWorkspace()
    }

    showToast(t('templates.toast.deleted'))
  }

  async function handlePickDocxFile(): Promise<void> {
    // For the edit flow (existing template), use the old full import path
    if (workspace.view === 'edit' && workspace.templateId) {
      await importTemplateDocx(workspace.templateId)

      const state = useTemplateStore.getState()
      if (state.error) {
        if (state.errorCode === IpcErrorCode.VALIDATION_FAILED) {
          return // user cancelled picker
        }
        setErrors({ form: state.error })
        return
      }

      const updated = state.templates.find(
        (tmpl) => tmpl.id === (workspace as { templateId: string }).templateId
      )
      if (updated) {
        void getTemplateContent(updated.id).then((r) => {
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
      setPendingDocxFilePath(result.data.filePath)
      setDraft((current) => ({ ...current, content: result.data!.html }))
    }
  }

  async function handleOpenDocx(): Promise<void> {
    if (workspace.view !== 'edit' || !workspace.templateId) {
      return
    }

    const result = await openTemplateDocx(workspace.templateId)
    if (!result.success) {
      setErrors({ form: result.error })
    }
  }

  async function handleRemoveDocx(): Promise<void> {
    if (workspace.view !== 'edit' || !workspace.templateId) {
      return
    }

    await removeTemplateDocx(workspace.templateId)

    const state = useTemplateStore.getState()
    if (state.error) {
      setErrors({ form: state.error })
      return
    }

    showToast(t('templates.toast.docxRemoved'))
  }

  return (
    <section className="flex h-[calc(100vh-8.5rem)] max-h-[calc(100vh-8.5rem)] min-h-0 flex-col gap-6 p-5 xl:p-6 2xl:p-7">
      {storeError ? <AlertBanner tone="error">{storeError}</AlertBanner> : null}

      {workspace.view === 'generate' ? (
        <GenerateDocumentPanel
          initialTemplateId={workspace.templateId}
          initialDossierId={initialDossierId}
          onBack={closeWorkspace}
        />
      ) : (
        <TemplateList
          isLoading={isLoading}
          templates={templates}
          onCreate={openCreateChooser}
          onDelete={handleDelete}
          onEdit={openEditEditor}
          onGenerate={(template) => openGenerateWorkspace(template.id)}
          onMacros={openMacrosWorkspace}
        />
      )}

      {workspace.view === 'create-choice' ? (
        <DialogShell size="lg" aria-label={t('templates.createChoice.title')}>
          <div className="flex flex-col gap-6">
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-slate-50">
                {t('templates.createChoice.title')}
              </h3>
              <p className="text-sm text-slate-300">{t('templates.createChoice.description')}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                type="button"
                onClick={() => openCreateEditor('text')}
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-5 text-left transition hover:border-white/20 hover:bg-slate-950/60"
              >
                <p className="text-sm font-semibold text-slate-50">
                  {t('templates.createChoice.textTitle')}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {t('templates.createChoice.textDescription')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => openCreateEditor('docx')}
                className="rounded-2xl border border-sky-300/20 bg-sky-300/5 p-5 text-left transition hover:border-sky-300/35 hover:bg-sky-300/10"
              >
                <p className="text-sm font-semibold text-slate-50">
                  {t('templates.createChoice.docxTitle')}
                </p>
                <p className="mt-2 text-sm text-slate-300">
                  {t('templates.createChoice.docxDescription')}
                </p>
              </button>
            </div>

            <div className="flex justify-end border-t border-white/10 pt-4">
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
        >
          {workspace.view === 'edit' && isEditorLoading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-slate-950/40 px-6 py-10 text-sm text-slate-300">
              {t('templates.loading')}
            </div>
          ) : (
            <TemplateEditor
              isSaving={isSaving}
              mode={workspace.view}
              value={draft}
              template={activeTemplate}
              preferredSourceType={workspace.view === 'create' ? createSourceType : 'text'}
              pendingDocxFilePath={pendingDocxFilePath}
              errors={errors}
              onCancel={() => void closeWorkspace()}
              onChange={updateDraft}
              onSubmit={handleSubmit}
              onImportDocx={handlePickDocxFile}
              onOpenDocx={handleOpenDocx}
              onRemoveDocx={handleRemoveDocx}
            />
          )}
        </DialogShell>
      ) : null}

      {workspace.view === 'macros' ? (
        <DialogShell
          layout="stretched"
          size="full"
          panelClassName="min-h-0"
          aria-label={t('templates.macros.title')}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void closeWorkspace()}
                className="text-sm text-slate-400 hover:text-slate-100"
              >
                ← {t('templates.workspace.backToLibrary')}
              </button>
            </div>
            <TagReferencePanel
              referenceMode
              onInsertTag={(tag) => void navigator.clipboard.writeText(tag)}
            />
          </div>
        </DialogShell>
      ) : null}
    </section>
  )
}
