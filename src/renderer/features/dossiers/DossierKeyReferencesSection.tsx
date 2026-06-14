import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import type {
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  KeyReference
} from '@shared/types'
import {
  DOSSIER_REQUIRED_REFERENCE_LABELS,
  isDossierNameReferenceLabel,
  isDossierRequiredReferenceLabel
} from '@shared/types'

import { Button, DialogShell, Field, Input } from '@renderer/components/ui'
import { useEntityStore } from '@renderer/stores'

import {
  ColumnHeader,
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  SearchField,
  SectionHeader,
  TrashIcon
} from './sectionLayout'

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
  const [searchFilter, setSearchFilter] = useState('')
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields)
  const configuredLabels = managedFields.keyReferences
    .map((definition) => definition.label)
    .filter((label) => !isDossierNameReferenceLabel(label))
  const missingConfiguredLabels = configuredLabels.filter(
    (label) => !entries.some((entry) => entry.label.toLowerCase() === label.toLowerCase())
  )

  // Pin required dossier parameters at the top so the user sees that these
  // values are part of the dossier references, not separate hidden settings.
  const orderedEntries = useMemo(() => {
    const required = DOSSIER_REQUIRED_REFERENCE_LABELS.flatMap((label) => {
      const entry = entries.find(
        (candidate) =>
          candidate.label.trim().toLocaleLowerCase('fr-FR') === label.toLocaleLowerCase('fr-FR')
      )
      return entry ? [entry] : []
    })
    const requiredIds = new Set(required.map((entry) => entry.uuid))
    return [...required, ...entries.filter((entry) => !requiredIds.has(entry.uuid))]
  }, [entries])
  const searchTerms = searchFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  const filteredEntries = useMemo(() => {
    if (searchTerms.length === 0) {
      return orderedEntries
    }

    return orderedEntries.filter((entry) =>
      searchTerms.every(
        (term) =>
          entry.label.toLowerCase().includes(term) ||
          entry.value.toLowerCase().includes(term) ||
          (entry.note ?? '').toLowerCase().includes(term)
      )
    )
  }, [orderedEntries, searchTerms])

  const countLabel =
    entries.length === 0
      ? null
      : filteredEntries.length === entries.length
        ? t('dossiers.key_references_count_total', {
            count: entries.length,
            defaultValue: '{{count}} référence(s)'
          })
        : t('dossiers.key_references_count_filtered', {
            count: filteredEntries.length,
            total: entries.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('dossiers.key_references_badge')}
          count={countLabel}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setEditor({ label: '', value: '' })}
            >
              {t('dossiers.key_references_add_action')}
            </Button>
          }
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SearchField
            id="key-references-search"
            value={searchFilter}
            onChange={setSearchFilter}
            placeholder={t('dossiers.key_references_filter_search_placeholder')}
            ariaLabel={t('dossiers.key_references_filter_search_label')}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {missingConfiguredLabels.length > 0 ? (
            <>
              {missingConfiguredLabels.map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={() => setEditor({ label, value: '' })}
                  className="rounded-full border border-hairline bg-parchment-bright px-3 py-1 text-xs text-ink transition hover:border-aurora/40 hover:bg-aurora/10 hover:text-aurora disabled:opacity-50"
                >
                  + {label}
                </button>
              ))}
            </>
          ) : null}
        </div>

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditor({ label: '', value: '' })}
            className="w-full shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-left text-sm text-ink transition hover:border-aurora/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dossiers.key_references_empty')}
          </button>
        ) : filteredEntries.length === 0 ? (
          <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
            {t('dossiers.key_references_no_results')}
          </p>
        ) : (
          <ListContainer>
            <ColumnHeader>
              <span className="w-48 shrink-0">
                {t('dossiers.key_references_column_label', { defaultValue: 'Libellé' })}
              </span>
              <span className="flex-1">
                {t('dossiers.key_references_column_value', { defaultValue: 'Valeur' })}
              </span>
              <span className="w-16 shrink-0" aria-hidden="true" />
            </ColumnHeader>
            <ul className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
              {filteredEntries.map((entry) => {
                const isConfirming = confirmingDeleteId === entry.uuid
                const isRequiredEntry = isDossierRequiredReferenceLabel(entry.label)
                return (
                  <li
                    key={entry.uuid}
                    className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-parchment-bright"
                  >
                    <span className="w-48 shrink-0 truncate text-sm font-medium text-ink">
                      {entry.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.value}</span>
                    <div className="relative flex shrink-0 items-center gap-1">
                      <div
                        className={
                          isConfirming
                            ? 'invisible flex items-center gap-1'
                            : 'flex items-center gap-1'
                        }
                      >
                        <IconButton
                          label={t('dossiers.key_references_edit_action')}
                          disabled={disabled}
                          onClick={() =>
                            setEditor({
                              id: entry.uuid,
                              label: entry.label,
                              value: entry.value,
                              note: entry.note
                            })
                          }
                        >
                          <PencilIcon />
                        </IconButton>
                        {isRequiredEntry ? null : (
                          <IconButton
                            label={t('dossiers.key_references_delete_action')}
                            tone="danger"
                            disabled={disabled}
                            onClick={() => setConfirmingDeleteId(entry.uuid)}
                          >
                            <TrashIcon />
                          </IconButton>
                        )}
                      </div>
                      {isConfirming ? (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2">
                          <DeleteConfirmTray
                            label={t('dossiers.key_references_delete_confirm_label')}
                            confirmLabel={t('dossiers.key_references_delete_confirm_action')}
                            cancelLabel={t('dossiers.key_references_delete_cancel_action')}
                            disabled={disabled}
                            onConfirm={async () => {
                              await onDelete({ dossierId, keyReferenceUuid: entry.uuid })
                              setConfirmingDeleteId(null)
                            }}
                            onCancel={() => setConfirmingDeleteId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </ListContainer>
        )}
      </div>

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={
            editor.id
              ? t('dossiers.key_references_edit_action')
              : t('dossiers.key_references_add_action')
          }
          onDismiss={() => setEditor(null)}
        >
          <div>
            <h3 className="text-lg font-semibold text-ink">
              {editor.id
                ? t('dossiers.key_references_edit_action')
                : t('dossiers.key_references_add_action')}
            </h3>
            <p className="mt-1 text-sm text-ink">{t('dossiers.key_references_form_hint')}</p>
          </div>

          <form
            className="flex flex-col gap-0"
            onSubmit={async (event) => {
              event.preventDefault()
              const saved = await onSave({
                uuid: editor.id,
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
                  disabled={isDossierRequiredReferenceLabel(editor.label)}
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
                  placeholder={
                    isDossierNameReferenceLabel(editor.label)
                      ? t('dossiers.key_references_name_reset_placeholder', {
                          defaultValue: 'Laisser vide pour reprendre le nom du dossier sur disque'
                        })
                      : t('dossiers.key_references_form_value_placeholder')
                  }
                  required={!isDossierRequiredReferenceLabel(editor.label)}
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
