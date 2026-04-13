import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAddressFields } from '@shared/addressFormatting'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  getContactManagedFieldValues,
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type ContactDeleteInput,
  type ContactRecord,
  type ContactUpsertInput
} from '@shared/types'

import { DelegatedPrompt } from '@renderer/components/shell/DelegatedPrompt'
import { Button, Card } from '@renderer/components/ui'
import { buildPrompt } from '@renderer/features/delegated/promptTemplates'
import { useEntityStore } from '@renderer/stores'

import { ContactForm } from './ContactForm'

interface DossierContactsSectionProps {
  dossierId: string
  dossierName: string
  entries: ContactRecord[]
  error: string | null
  isLoading: boolean
  disabled: boolean
  onSave: (input: ContactUpsertInput) => Promise<boolean>
  onDelete: (input: ContactDeleteInput) => Promise<boolean>
}

type ContactEditorState = Partial<ContactRecord> | null
type SortOrder = 'name-asc' | 'name-desc'

function getContactDisplayName(contact: Partial<ContactRecord>): string {
  return computeContactDisplayName(contact)
}

const EMPTY_CONTACT = {
  role: '',
  institution: '',
  addressLine: '',
  addressLine2: '',
  zipCode: '',
  city: '',
  phone: '',
  email: '',
  information: ''
}

function buildManagedFieldSummary(contact: ContactRecord): Array<{ key: string; value: string }> {
  return Object.entries(getContactManagedFieldValues(contact))
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => ({ key, value }))
}

export function DossierContactsSection({
  dossierId,
  dossierName,
  entries,
  error,
  isLoading,
  disabled,
  onSave,
  onDelete
}: DossierContactsSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const [editor, setEditor] = useState<ContactEditorState>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')

  const searchTerms = searchFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  const filteredEntries = useMemo(() => {
    const managedFieldDefinitions = normalizeManagedFieldsConfig(
      profile?.managedFields,
      profile?.profession
    ).contacts
    const managedFieldLabels = new Map(
      managedFieldDefinitions.map((definition) => [
        getManagedFieldKey(definition),
        definition.label
      ])
    )

    const filtered =
      searchTerms.length === 0
        ? entries
        : entries.filter((entry) => {
            const managedValues = buildManagedFieldSummary(entry)
            const displayName = getContactDisplayName(entry)
            return searchTerms.every(
              (term) =>
                displayName.toLowerCase().includes(term) ||
                (entry.role ?? '').toLowerCase().includes(term) ||
                (entry.institution ?? '').toLowerCase().includes(term) ||
                (entry.city ?? '').toLowerCase().includes(term) ||
                (entry.phone ?? '').toLowerCase().includes(term) ||
                (entry.email ?? '').toLowerCase().includes(term) ||
                (entry.information ?? '').toLowerCase().includes(term) ||
                managedValues.some(
                  (field) =>
                    field.value.toLowerCase().includes(term) ||
                    (managedFieldLabels.get(field.key) ?? field.key).toLowerCase().includes(term)
                )
            )
          })
    return [...filtered].sort((a, b) => {
      const aName = getContactDisplayName(a)
      const bName = getContactDisplayName(b)
      const cmp = aName.localeCompare(bName, undefined, { sensitivity: 'base' })
      return sortOrder === 'name-asc' ? cmp : -cmp
    })
  }, [entries, profile?.managedFields, profile?.profession, searchTerms, sortOrder])

  const managedFieldLabels = new Map(
    normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession).contacts.map(
      (definition) => [getManagedFieldKey(definition), definition.label]
    )
  )

  return (
    <>
      <Card className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {t('contacts.sectionBadge')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setEditor(EMPTY_CONTACT)}
          >
            {t('contacts.addButton')}
          </Button>
        </div>

        {error ? (
          <div className="shrink-0 rounded-2xl border border-rose-300/35 bg-rose-300/10 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <DelegatedPrompt prompt={buildPrompt('contacts', { dossierName })} className="shrink-0" />

        {isLoading ? (
          <p className="shrink-0 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
            {t('contacts.loadingState')}
          </p>
        ) : entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditor(EMPTY_CONTACT)}
            className="w-full shrink-0 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-left text-sm text-slate-300 transition hover:border-aurora/50 hover:text-slate-100 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('contacts.emptyState')}
          </button>
        ) : (
          <>
            <div className="grid shrink-0 gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
              <label
                htmlFor="contacts-search"
                className="flex flex-col gap-2 text-sm text-slate-100"
              >
                <span>{t('contacts.filter.searchLabel')}</span>
                <input
                  id="contacts-search"
                  type="search"
                  value={searchFilter}
                  onChange={(event) => setSearchFilter(event.target.value)}
                  placeholder={t('contacts.filter.searchPlaceholder')}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                />
              </label>
              <label htmlFor="contacts-sort" className="flex flex-col gap-2 text-sm text-slate-100">
                <span>{t('contacts.filter.sortLabel')}</span>
                <select
                  id="contacts-sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                >
                  <option value="name-asc">{t('contacts.filter.sortNameAsc')}</option>
                  <option value="name-desc">{t('contacts.filter.sortNameDesc')}</option>
                </select>
              </label>
            </div>

            {filteredEntries.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
                {t('contacts.noResults')}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ul className="space-y-3">
                  {filteredEntries.map((entry) => (
                    <li
                      key={entry.uuid}
                      className="rounded-2xl border border-white/10 bg-slate-950/35 p-4"
                    >
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-x-4 gap-y-3">
                        {/* Colonne gauche : nom + badge */}
                        <div className="space-y-1.5">
                          <p className="font-medium text-slate-100">
                            {getContactDisplayName(entry)}
                          </p>
                          {entry.role ? (
                            <span className="inline-block rounded-full border border-aurora/25 bg-aurora/10 px-2 py-1 text-xs text-aurora-soft">
                              {entry.role}
                            </span>
                          ) : null}
                        </div>

                        {/* Colonne du milieu : détails */}
                        <div className="space-y-0.5">
                          {entry.institution ? (
                            <p className="text-sm text-slate-300">{entry.institution}</p>
                          ) : null}
                          {entry.addressLine || entry.city ? (
                            <p className="whitespace-pre-wrap text-sm text-slate-400">
                              {buildAddressFields(entry).addressFormatted}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                            {entry.phone ? <span>{entry.phone}</span> : null}
                            {entry.email ? <span>{entry.email}</span> : null}
                          </div>
                        </div>

                        {/* Colonne droite : actions */}
                        <div className="flex flex-wrap items-start justify-end gap-2">
                          {confirmingDeleteId === entry.uuid ? (
                            <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/8 px-3 py-1.5">
                              <span className="text-xs font-semibold text-rose-300">
                                {t('contacts.deleteConfirmLabel')}
                              </span>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={async () => {
                                  await onDelete({ dossierId, contactUuid: entry.uuid })
                                  setConfirmingDeleteId(null)
                                }}
                                className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                              >
                                {t('contacts.deleteConfirmAction')}
                              </button>
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => setConfirmingDeleteId(null)}
                                className="rounded-lg px-2 py-0.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                              >
                                {t('contacts.deleteCancelAction')}
                              </button>
                            </div>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={disabled}
                                onClick={() => setEditor(entry)}
                              >
                                {t('contacts.editButton')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={disabled}
                                onClick={() => setConfirmingDeleteId(entry.uuid)}
                              >
                                {t('contacts.deleteButton')}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {buildManagedFieldSummary(entry).length > 0 ? (
                        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 md:grid-cols-2 xl:grid-cols-3">
                          {buildManagedFieldSummary(entry).map((field) => (
                            <div
                              key={`${entry.uuid}-${field.key}`}
                              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                            >
                              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                {managedFieldLabels.get(field.key) ?? field.key}
                              </p>
                              <p className="text-sm text-slate-200">{field.value}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      {editor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-y-auto rounded-[28px] border border-sky-200/18 bg-[rgba(16,26,44,0.985)] p-6 shadow-[0_32px_100px_rgba(2,6,23,0.62)]"
          >
            <ContactForm
              key={editor.uuid ?? 'new-contact'}
              dossierId={dossierId}
              initialValue={editor}
              existingContacts={entries}
              disabled={disabled}
              onCancel={() => setEditor(null)}
              onSubmit={onSave}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
