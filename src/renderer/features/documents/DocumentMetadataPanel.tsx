import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DocumentMetadataUpdate, DocumentRecord } from '@shared/types'

import { AlertBanner, Button, Field, Input, Textarea } from '@renderer/components/ui'
import { documentMetadataDraftSchema } from '@shared/validation'
import { useToast } from '@renderer/contexts/ToastContext'

interface DocumentMetadataPanelProps {
  document: DocumentRecord
  disabled: boolean
  onCancel: () => void
  onSave: (input: DocumentMetadataUpdate) => Promise<boolean>
}

export function DocumentMetadataPanel({
  document,
  disabled,
  onCancel,
  onSave
}: DocumentMetadataPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [description, setDescription] = useState(document.description ?? '')
  const [tagsInput, setTagsInput] = useState(document.tags.join(', '))
  const [feedback, setFeedback] = useState<'error' | null>(null)

  const hasSavedMetadata = Boolean(document.description || document.tags.length > 0)

  return (
    <>
      <div>
        <h3 className="text-lg font-semibold text-slate-50">
          {hasSavedMetadata
            ? t('documents.metadata_edit_title')
            : t('documents.metadata_add_title')}
        </h3>
        <p className="mt-1 text-sm text-slate-300">{document.filename}</p>
      </div>

      {feedback === 'error' ? (
        <AlertBanner tone="error" className="mt-4 p-3">
          {t('documents.metadata_save_error')}
        </AlertBanner>
      ) : null}

      <form
        className="flex flex-col gap-0"
        onSubmit={async (event) => {
          event.preventDefault()

          const draft = documentMetadataDraftSchema.parse({
            description,
            tagsInput
          })

          const saved = await onSave({
            dossierId: document.dossierId,
            documentId: document.id,
            description: draft.description,
            tags: draft.tags
          })

          if (saved) {
            showToast(t('documents.metadata_save_success', { name: document.filename }))
            onCancel()
          } else {
            setFeedback('error')
          }
        }}
      >
        <div className="space-y-4 py-5">
          <Field
            label={t('documents.metadata_description_label')}
            htmlFor="document-metadata-description"
          >
            <Textarea
              id="document-metadata-description"
              value={description}
              rows={3}
              onChange={(event) => {
                setDescription(event.target.value)
                setFeedback(null)
              }}
              placeholder={t('documents.metadata_description_placeholder')}
            />
          </Field>

          <Field label={t('documents.metadata_tags_label')} htmlFor="document-metadata-tags">
            <Input
              id="document-metadata-tags"
              type="text"
              value={tagsInput}
              onChange={(event) => {
                setTagsInput(event.target.value)
                setFeedback(null)
              }}
              placeholder={t('documents.metadata_tags_placeholder')}
            />
            <p className="text-xs text-slate-500">{t('documents.metadata_tags_hint')}</p>
          </Field>
        </div>

        <div className="mt-auto flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" disabled={disabled} onClick={onCancel}>
            {t('documents.metadata_cancel_action')}
          </Button>
          <Button type="submit" disabled={disabled}>
            {hasSavedMetadata
              ? t('documents.metadata_save_edit_action')
              : t('documents.metadata_save_create_action')}
          </Button>
        </div>
      </form>
    </>
  )
}
