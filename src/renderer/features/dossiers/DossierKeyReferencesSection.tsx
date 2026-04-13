import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import type {
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  KeyReference
} from '@shared/types'

import { Button, Card, DialogShell, Field, Input } from '@renderer/components/ui'
import { useEntityStore } from '@renderer/stores'

interface DossierKeyReferencesSectionProps {
  dossierId: string
  dossierName: string
  entries: KeyReference[]
  disabled: boolean
  onSave: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDelete: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
}

interface KeyReferenceEditorState {
  id?: string
  label: string
  value: string
  note?: string
}

export function DossierKeyReferencesSection({
  dossierId,
  entries,
  disabled,
  onSave,
  onDelete
}: DossierKeyReferencesSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const [editor, setEditor] = useState<KeyReferenceEditorState | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession)
  const configuredLabels = managedFields.keyReferences.map((definition) => definition.label)
  const missingConfiguredLabels = configuredLabels.filter(
    (label) => !entries.some((entry) => entry.label.toLowerCase() === label.toLowerCase())
  )

  return (
    <>
      <Card className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {t('dossiers.key_references_badge')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEditor({ label: '', value: '' })}
          >
            {t('dossiers.key_references_add_action')}
          </Button>
        </div>

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditor({ label: '', value: '' })}
            className="w-full shrink-0 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-left text-sm text-slate-300 transition hover:border-aurora/50 hover:text-slate-100 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dossiers.key_references_empty')}
          </button>
        ) : (
          <>
            {missingConfiguredLabels.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {missingConfiguredLabels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => setEditor({ label, value: '' })}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:border-aurora/35 hover:text-slate-50 disabled:opacity-50"
                  >
                    + {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ul className="space-y-3">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-slate-100">{entry.label}</p>
                      <p className="text-sm text-slate-300">{entry.value}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {confirmingDeleteId === entry.id ? (
                        <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/8 px-3 py-1.5">
                          <span className="text-xs font-semibold text-rose-300">
                            {t('dossiers.key_references_delete_confirm_label')}
                          </span>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={async () => {
                              await onDelete({ dossierId, keyReferenceId: entry.id })
                              setConfirmingDeleteId(null)
                            }}
                            className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                          >
                            {t('dossiers.key_references_delete_confirm_action')}
                          </button>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => setConfirmingDeleteId(null)}
                            className="rounded-lg px-2 py-0.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                          >
                            {t('dossiers.key_references_delete_cancel_action')}
                          </button>
                        </div>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() =>
                              setEditor({
                                id: entry.id,
                                label: entry.label,
                                value: entry.value,
                                note: entry.note
                              })
                            }
                          >
                            {t('dossiers.key_references_edit_action')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => setConfirmingDeleteId(entry.id)}
                          >
                            {t('dossiers.key_references_delete_action')}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </Card>

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={
            editor.id
              ? t('dossiers.key_references_edit_action')
              : t('dossiers.key_references_add_action')
          }
        >
          <div>
            <h3 className="text-lg font-semibold text-slate-50">
              {editor.id
                ? t('dossiers.key_references_edit_action')
                : t('dossiers.key_references_add_action')}
            </h3>
            <p className="mt-1 text-sm text-slate-300">{t('dossiers.key_references_form_hint')}</p>
          </div>

          <form
            className="flex flex-col gap-0"
            onSubmit={async (event) => {
              event.preventDefault()
              const saved = await onSave({
                id: editor.id,
                dossierId,
                label: editor.label,
                value: editor.value,
                note: editor.note
              })
              if (saved) setEditor(null)
            }}
          >
            <div className="grid gap-4 py-5 md:grid-cols-2">
              <Field label={t('dossiers.key_references_form_label')} htmlFor="key-reference-label">
                <Input
                  id="key-reference-label"
                  type="text"
                  list="key-reference-label-options"
                  value={editor.label}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, label: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.key_references_form_label_placeholder')}
                  required
                />
                <datalist id="key-reference-label-options">
                  {configuredLabels.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </Field>

              <Field label={t('dossiers.key_references_form_value')} htmlFor="key-reference-value">
                <Input
                  id="key-reference-value"
                  type="text"
                  value={editor.value}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, value: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.key_references_form_value_placeholder')}
                  required
                />
              </Field>
            </div>

            <div className="mt-auto flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditor(null)}
                disabled={disabled}
              >
                {t('dossiers.key_references_cancel_action')}
              </Button>
              <Button type="submit" disabled={disabled}>
                {editor.id
                  ? t('dossiers.key_references_save_edit_action')
                  : t('dossiers.key_references_save_create_action')}
              </Button>
            </div>
          </form>
        </DialogShell>
      ) : null}
    </>
  )
}
