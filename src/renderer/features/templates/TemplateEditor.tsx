import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  TEMPLATE_DOCUMENT_KIND_VALUES,
  type TemplateDocumentKind,
  type TemplateDraft,
  type TemplateRecord
} from '@shared/types'
import type { TagLintIssue } from '@shared/templateContent'
import {
  buildTagPathLocalizer,
  templateRoutineCatalog,
  type TemplateRoutineEntry
} from '@shared/templateRoutines'

import { AlertBanner, Button, Field, Input, Select } from '@renderer/components/ui'

const DOCUMENT_KIND_LABEL: Record<TemplateDocumentKind, string> = {
  document: 'Document',
  invoice: 'Facture',
  creditNote: 'Avoir',
  correctiveInvoice: 'Facture rectificative'
}
import { copyTextToClipboard } from '@renderer/lib/clipboard'

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
  onApplyCabinetDefaultDocx?: () => Promise<void>
  /** Whether the cabinet has a default DOCX template — controls availability of the convert action. */
  cabinetHasDefaultDocx?: boolean
  /** Tag catalog forwarded to the editor for chip validation and autocomplete. */
  tagSuggestions?: TemplateRoutineEntry[]
  /** Known category names, offered as datalist suggestions for the category field. */
  existingCategories?: string[]
  /** Opens the AI tag-detection dialog. In create mode the draft is saved first. */
  onTagify?: () => void
  /** Unknown tags found at save time — shown as a warning with suggestions. */
  lintIssues?: TagLintIssue[] | null
  onApplyLintSuggestion?: (issue: TagLintIssue, suggestion: string) => void
  onSaveAnyway?: () => void
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
  onRemoveDocx,
  onApplyCabinetDefaultDocx,
  cabinetHasDefaultDocx,
  tagSuggestions,
  existingCategories,
  onTagify,
  lintIssues,
  onApplyLintSuggestion,
  onSaveAnyway
}: TemplateEditorProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const tagInsertRef = useRef<((tagPath: string) => void) | null>(null)
  const localizeTagPath = useMemo(
    () => buildTagPathLocalizer(templateRoutineCatalog, i18n.language),
    [i18n.language]
  )
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
  const tagifyActionLabel =
    mode === 'create'
      ? t('templates.tagify.saveThenAnalyzeButton')
      : t('templates.tagify.openButton')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-ink">
            {mode === 'create'
              ? isDocxCreationFlow
                ? t('templates.editor.createDocxTitle')
                : t('templates.editor.createTitle')
              : t('templates.editor.editTitle')}
          </h3>
          <p className="text-sm text-ink">
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

      {lintIssues && lintIssues.length > 0 ? (
        <div className="shrink-0 rounded-2xl border border-warning-border bg-warning-tint px-4 py-3">
          <p className="text-sm font-medium text-warning-deep">{t('templates.lint.title')}</p>
          <p className="mt-1 text-sm text-warning-deep">{t('templates.lint.description')}</p>
          <ul className="mt-3 space-y-2">
            {lintIssues.map((issue) => (
              <li key={issue.normalizedPath} className="flex flex-wrap items-center gap-2 text-xs">
                <code className="rounded-full border border-warning-border px-2.5 py-0.5 font-mono text-warning-deep">
                  {`{{${issue.rawPath}}}`}
                </code>
                {issue.suggestions.length > 0 ? (
                  <>
                    <span className="text-warning-deep">{t('templates.lint.didYouMean')}</span>
                    {issue.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        title={`{{${suggestion}}}`}
                        onClick={() => onApplyLintSuggestion?.(issue, suggestion)}
                        className="rounded-full border border-success-border bg-success-tint px-2.5 py-0.5 font-mono text-success-deep transition hover:bg-success-tint/60"
                      >
                        {`{{${localizeTagPath(suggestion)}}}`}
                      </button>
                    ))}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => onSaveAnyway?.()}>
              {t('templates.lint.saveAnyway')}
            </Button>
          </div>
        </div>
      ) : null}

      {onTagify ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-aurora/35 bg-aurora/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{t('templates.tagify.assistantTitle')}</p>
            <p className="mt-0.5 max-w-3xl text-sm text-ink-muted">
              {t('templates.tagify.assistantBody')}
            </p>
          </div>
          <Button type="button" size="sm" onClick={onTagify}>
            {tagifyActionLabel}
          </Button>
        </div>
      ) : null}

      <form
        className="flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void onSubmit()
        }}
      >
        {/* Name + description row */}
        <div className="grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)]">
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

          <Field
            label={t('templates.editor.documentKind', { defaultValue: 'Type de document' })}
            htmlFor="template-document-kind"
          >
            <Select
              id="template-document-kind"
              value={value.documentKind ?? 'document'}
              onChange={(event) => onChange('documentKind', event.target.value)}
            >
              {TEMPLATE_DOCUMENT_KIND_VALUES.map((kind) => (
                <option key={kind} value={kind}>
                  {DOCUMENT_KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('templates.editor.categoryField')} htmlFor="template-category">
            <Input
              id="template-category"
              type="text"
              list="template-category-options"
              value={value.category ?? ''}
              onChange={(event) => onChange('category', event.target.value)}
              placeholder={t('templates.editor.categoryPlaceholder')}
            />
            <datalist id="template-category-options">
              {(existingCategories ?? []).map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-hairline bg-white px-4 py-3 text-sm text-ink">
          {hasDocxSource ? (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-success-border bg-success-tint px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-success-deep">
                  {t('templates.list.docxBadge')}
                </span>
                <span className="text-sm text-ink">{t('templates.editor.docxAttached')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={() => void onOpenDocx?.()}>
                  {t('templates.editor.openInWord')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="border border-destructive-border text-destructive hover:bg-destructive-tint"
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
                  <span className="rounded-full border border-aurora/30 bg-aurora/10 px-2 py-0.5 text-xs font-semibold tracking-[0.12em] text-aurora">
                    {t('templates.list.docxBadge')}
                  </span>
                  <span className="truncate text-xs text-ink">{pickedFileName}</span>
                </div>
              ) : (
                <span className="text-xs text-ink-muted">
                  {t('templates.editor.docxImportHint')}
                </span>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => void onImportDocx?.()}>
                {hasPickedFile
                  ? t('templates.editor.changeWordDoc')
                  : t('templates.editor.importDocx')}
              </Button>
            </div>
          ) : mode === 'create' && !template?.uuid ? (
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-xs text-ink-muted">{t('templates.editor.richTextHint')}</span>
            </div>
          ) : (
            <div className="flex w-full items-center justify-end gap-2">
              {mode === 'edit' && onApplyCabinetDefaultDocx ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!cabinetHasDefaultDocx}
                  title={
                    cabinetHasDefaultDocx
                      ? undefined
                      : t('templates.editor.applyCabinetDocxMissing', {
                          defaultValue:
                            "Aucun modèle DOCX cabinet par défaut n'est défini dans la page Cabinet."
                        })
                  }
                  onClick={() => void onApplyCabinetDefaultDocx()}
                >
                  {t('templates.editor.applyCabinetDocx', {
                    defaultValue: 'Convertir en DOCX cabinet'
                  })}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => void onImportDocx?.()}>
                {t('templates.editor.importDocx')}
              </Button>
            </div>
          )}
        </div>

        {/* Content — two-column: editor left, tag panel right */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 text-sm text-ink">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <label htmlFor="template-content">{contentLabel}</label>
            <p className="text-xs text-ink-muted">
              {isDocxCreationFlow && !hasPickedFile
                ? t('templates.editor.createDocxHint')
                : hasDocxSource || hasPickedFile
                  ? t('templates.editor.docxEditHint')
                  : t('templates.editor.richTextHint')}
            </p>
          </div>

          <div
            className={`grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 ${isDocxCreationFlow && !hasPickedFile ? '' : 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_30rem]'}`}
          >
            <div className="flex min-h-0 flex-col gap-3">
              {isDocxCreationFlow && !hasPickedFile ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-hairline bg-[#eeece3] p-8 text-center">
                  <p className="max-w-xl text-sm text-ink">
                    {t('templates.editor.createDocxBody')}
                  </p>
                  <p className="max-w-xl text-xs text-ink-muted">
                    {t('templates.tagify.docxNextStep')}
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
                    tagSuggestions={tagSuggestions}
                  />
                  {errors.content ? (
                    <span className="mt-1 block text-xs text-destructive">{errors.content}</span>
                  ) : null}
                </div>
              )}
            </div>

            {!(isDocxCreationFlow && !hasPickedFile) ? (
              <TagReferencePanel
                onInsertTag={
                  mode === 'edit' && hasDocxSource
                    ? (tag) => copyTextToClipboard(tag)
                    : (tag) => tagInsertRef.current?.(tag)
                }
                referenceMode={mode === 'edit' && hasDocxSource}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline pt-4">
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
