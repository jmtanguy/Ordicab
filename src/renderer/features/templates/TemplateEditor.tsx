import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { TemplateDraft, TemplateRecord } from '@shared/types'

import { AlertBanner, Button, Field, Input } from '@renderer/components/ui'

import { RichTextEditor } from './RichTextEditor'
import { TagReferencePanel } from './TagReferencePanel'

interface TemplateFormErrors {
  name?: string
  content?: string
  form?: string
}

interface TemplateEditorProps {
  isSaving: boolean
  mode: 'create' | 'edit'
  value: TemplateDraft
  template?: TemplateRecord | null
  preferredSourceType?: 'text' | 'docx'
  /** Basename of the Word file picked for creation but not yet saved. */
  pendingDocxFileName?: string | null
  errors: TemplateFormErrors
  onCancel: () => void
  onChange: (field: keyof TemplateDraft, value: string) => void
  onSubmit: () => Promise<void>
  onImportDocx?: () => Promise<void>
  onOpenDocx?: () => Promise<void>
  onRemoveDocx?: () => Promise<void>
}

export function TemplateEditor({
  isSaving,
  mode,
  value,
  template,
  preferredSourceType = 'text',
  pendingDocxFileName = null,
  errors,
  onCancel,
  onChange,
  onSubmit,
  onImportDocx,
  onOpenDocx,
  onRemoveDocx
}: TemplateEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const tagInsertRef = useRef<((tagPath: string) => void) | null>(null)
  const hasDocxSource = template?.hasDocxSource === true
  const isDocxCreationFlow = mode === 'create' && preferredSourceType === 'docx' && !hasDocxSource
  const hasPickedFile = isDocxCreationFlow && pendingDocxFileName !== null
  const pickedFileName = pendingDocxFileName ?? null
  const contentLabel =
    hasDocxSource || hasPickedFile
      ? t('templates.editor.contentLabelDocx')
      : t('templates.editor.content')
  const submitLabel =
    isDocxCreationFlow && !hasPickedFile
      ? t('templates.editor.selectWordDoc')
      : t('templates.editor.saveButton')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-slate-50">
            {mode === 'create'
              ? isDocxCreationFlow
                ? t('templates.editor.createDocxTitle')
                : t('templates.editor.createTitle')
              : t('templates.editor.editTitle')}
          </h3>
          <p className="text-sm text-slate-300">
            {isDocxCreationFlow
              ? t('templates.editor.createDocxDescription')
              : t('templates.editor.description')}
          </p>
        </div>

        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('templates.workspace.backToLibrary')}
        </Button>
      </div>

      {errors.form ? <AlertBanner tone="error">{errors.form}</AlertBanner> : null}

      <form
        className="flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        {/* Name + description row */}
        <div className="grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label={t('templates.editor.name')} htmlFor="template-name" error={errors.name}>
            <Input
              id="template-name"
              type="text"
              value={value.name}
              onChange={(event) => onChange('name', event.target.value)}
            />
          </Field>

          <Field label={t('templates.editor.descriptionField')} htmlFor="template-description">
            <Input
              id="template-description"
              type="text"
              value={value.description ?? ''}
              onChange={(event) => onChange('description', event.target.value)}
              placeholder={t('templates.editor.descriptionPlaceholder')}
            />
          </Field>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-100">
          {hasDocxSource ? (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-emerald-200">
                  {t('templates.list.docxBadge')}
                </span>
                <span className="text-sm text-slate-300">{t('templates.editor.docxAttached')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void onOpenDocx?.()}>
                  {t('templates.editor.openInWord')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="border border-rose-400/20 text-rose-300 hover:bg-rose-400/10"
                  onClick={() => {
                    if (window.confirm(t('templates.editor.removeDocxConfirm'))) {
                      void onRemoveDocx?.()
                    }
                  }}
                >
                  {t('templates.editor.removeDocx')}
                </Button>
              </div>
            </>
          ) : isDocxCreationFlow ? (
            <div className="flex w-full items-center justify-between gap-3">
              {hasPickedFile ? (
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-sky-200">
                    {t('templates.list.docxBadge')}
                  </span>
                  <span className="truncate text-xs text-slate-300">{pickedFileName}</span>
                </div>
              ) : (
                <span className="text-xs text-slate-400">
                  {t('templates.editor.docxImportHint')}
                </span>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => void onImportDocx?.()}>
                {hasPickedFile
                  ? t('templates.editor.changeWordDoc')
                  : t('templates.editor.importDocx')}
              </Button>
            </div>
          ) : mode === 'create' && !template?.id ? (
            <span className="text-xs text-slate-400">{t('templates.editor.richTextHint')}</span>
          ) : (
            <div className="flex w-full items-center justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => void onImportDocx?.()}>
                {t('templates.editor.importDocx')}
              </Button>
            </div>
          )}
        </div>

        {/* Content — two-column: editor left, tag panel right */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm text-slate-100">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <label htmlFor="template-content">{contentLabel}</label>
            <p className="text-xs text-slate-400">
              {isDocxCreationFlow && !hasPickedFile
                ? t('templates.editor.createDocxHint')
                : hasDocxSource || hasPickedFile
                  ? t('templates.editor.docxEditHint')
                  : t('templates.editor.richTextHint')}
            </p>
          </div>

          <div
            className={`grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 ${isDocxCreationFlow && !hasPickedFile ? '' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]'}`}
          >
            <div className="flex min-h-0 flex-col gap-3">
              {isDocxCreationFlow && !hasPickedFile ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-sky-300/20 bg-sky-300/5 p-8 text-center">
                  <p className="max-w-xl text-sm text-slate-200">
                    {t('templates.editor.createDocxBody')}
                  </p>
                  <Button type="button" size="sm" onClick={() => void onImportDocx?.()}>
                    {t('templates.editor.importDocx')}
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <RichTextEditor
                    ariaLabel={contentLabel}
                    value={value.content}
                    onChange={(nextValue) => onChange('content', nextValue)}
                    tagInsertRef={tagInsertRef}
                    readOnly={hasPickedFile || (mode === 'edit' && hasDocxSource)}
                  />
                  {errors.content ? (
                    <span className="mt-1 block text-xs text-rose-300">{errors.content}</span>
                  ) : null}
                </div>
              )}
            </div>

            {!(isDocxCreationFlow && !hasPickedFile) ? (
              <TagReferencePanel
                onInsertTag={
                  mode === 'edit' && hasDocxSource
                    ? (tag) => void navigator.clipboard.writeText(tag)
                    : (tag) => tagInsertRef.current?.(tag)
                }
                referenceMode={mode === 'edit' && hasDocxSource}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('templates.editor.cancelButton')}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
