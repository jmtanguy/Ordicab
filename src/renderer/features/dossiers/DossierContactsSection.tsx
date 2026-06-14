import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAddressFields } from '@shared/addressFormatting'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  getContactManagedFieldValues,
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type ConflictMatch,
  type ContactDeleteInput,
  type ContactRecord,
  type ContactUpsertInput,
  type ManagedFieldDefinition
} from '@shared/types'

import { AlertBanner, Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { useEntityStore } from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'

import { ContactForm } from './ContactForm'
import {
  CheckIcon,
  CopyIcon,
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  PillSelect,
  SearchField,
  SectionHeader,
  TrashIcon
} from './sectionLayout'

interface DossierContactsSectionProps {
  dossierId: string
  entries: ContactRecord[]
  error: string | null
  isLoading: boolean
  disabled: boolean
  onSave: (input: ContactUpsertInput) => Promise<boolean>
  onDelete: (input: ContactDeleteInput) => Promise<boolean>
}

type ContactEditorState = Partial<ContactRecord> | null
type SortOrder = 'name-asc' | 'name-desc'

interface ConflictCheckState {
  status: 'checking' | 'done' | 'error'
  /** Display name of the contact the check ran for. */
  name: string
  matches: ConflictMatch[]
}
type ManagedFieldSummaryEntry = {
  key: string
  label: string
  value: string
}

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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function buildManagedFieldSummary(
  contact: ContactRecord,
  definitions: ManagedFieldDefinition[] = []
): ManagedFieldSummaryEntry[] {
  const definitionMeta = new Map(
    definitions.map((definition, index) => [
      getManagedFieldKey(definition),
      { label: definition.label, index }
    ])
  )

  return Object.entries(getContactManagedFieldValues(contact))
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value], originalIndex) => {
      const meta = definitionMeta.get(key)
      return {
        key,
        label: meta?.label ?? key,
        value,
        order: meta?.index ?? Number.MAX_SAFE_INTEGER,
        originalIndex
      }
    })
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order
      }
      return left.originalIndex - right.originalIndex
    })
    .map(({ key, label, value }) => ({ key, label, value }))
}

export function DossierContactsSection({
  dossierId,
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
  const [copiedField, setCopiedField] = useState<{ uuid: string; field: string } | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')
  const [conflictCheck, setConflictCheck] = useState<ConflictCheckState | null>(null)

  const openEditor = (value: Partial<ContactRecord>): void => {
    setConflictCheck(null)
    setEditor(value)
  }

  const runConflictCheck = (name: { firstName?: string; lastName?: string }): void => {
    const api = getOrdicabApi()
    if (!api || !name.lastName?.trim()) {
      return
    }

    const checkedName = [name.firstName, name.lastName]
      .map((part) => part?.trim() ?? '')
      .filter(Boolean)
      .join(' ')

    setConflictCheck({ status: 'checking', name: checkedName, matches: [] })
    void api.contact
      .checkConflicts({ dossierId, firstName: name.firstName, lastName: name.lastName })
      .then((result) => {
        if (!result.success) {
          setConflictCheck({ status: 'error', name: checkedName, matches: [] })
          return
        }
        setConflictCheck({ status: 'done', name: checkedName, matches: result.data })
      })
  }

  const handleSave = async (input: ContactUpsertInput): Promise<boolean> => {
    const saved = await onSave(input)
    if (saved && input.lastName) {
      // Advisory only — the save already went through, the check just warns.
      runConflictCheck({ firstName: input.firstName, lastName: input.lastName })
    }
    return saved
  }

  const isCopied = (uuid: string, field: string): boolean =>
    copiedField?.uuid === uuid && copiedField?.field === field

  const handleCopy = (uuid: string, field: string, text: string): void => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return
      setCopiedField({ uuid, field })
      setTimeout(() => setCopiedField(null), 1500)
    })
  }

  const searchTerms = searchFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  const managedFieldDefinitions = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields).contacts,
    [profile?.managedFields]
  )

  const filteredEntries = useMemo(() => {
    const filtered =
      searchTerms.length === 0
        ? entries
        : entries.filter((entry) => {
            const managedValues = buildManagedFieldSummary(entry, managedFieldDefinitions)
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
                    field.label.toLowerCase().includes(term)
                )
            )
          })
    return [...filtered].sort((a, b) => {
      const aName = getContactDisplayName(a)
      const bName = getContactDisplayName(b)
      const cmp = aName.localeCompare(bName, undefined, { sensitivity: 'base' })
      return sortOrder === 'name-asc' ? cmp : -cmp
    })
  }, [entries, managedFieldDefinitions, searchTerms, sortOrder])

  const conflictPanel = conflictCheck ? (
    <AlertBanner
      tone={
        conflictCheck.status === 'done' && conflictCheck.matches.length === 0
          ? 'success'
          : 'warning'
      }
      role="status"
      className="flex shrink-0 items-start justify-between gap-3"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {conflictCheck.status === 'checking' ? (
          <p>
            {t('conflictCheck.checking', {
              defaultValue: 'Vérification des conflits d’intérêts en cours…'
            })}
          </p>
        ) : conflictCheck.status === 'error' ? (
          <p>
            {t('conflictCheck.error', {
              defaultValue: 'La vérification des conflits d’intérêts a échoué.'
            })}
          </p>
        ) : conflictCheck.matches.length === 0 ? (
          <p>
            {t('conflictCheck.noMatches', {
              name: conflictCheck.name,
              defaultValue: 'Aucun conflit d’intérêts détecté pour {{name}}.'
            })}
          </p>
        ) : (
          <>
            <p className="font-semibold">
              {t('conflictCheck.title', { defaultValue: 'Conflit d’intérêts potentiel' })}
            </p>
            <ul className="list-disc pl-5">
              {conflictCheck.matches.map((match) => (
                <li key={`${match.dossierId}-${match.contactUuid}`}>
                  {t('conflictCheck.matchLine', {
                    name: match.contactDisplayName,
                    dossier: match.dossierName,
                    role:
                      match.contactRole ??
                      t('conflictCheck.roleUnknown', { defaultValue: 'rôle non précisé' }),
                    defaultValue:
                      '{{name}} apparaît dans le dossier {{dossier}} en tant que {{role}}'
                  })}
                  {match.matchKind === 'partial'
                    ? ` (${t('conflictCheck.partialMatch', {
                        defaultValue: 'correspondance partielle sur le nom'
                      })})`
                    : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => setConflictCheck(null)}
        className="shrink-0 text-xs font-medium underline-offset-2 transition hover:underline"
      >
        {t('conflictCheck.dismiss', { defaultValue: 'Ignorer' })}
      </button>
    </AlertBanner>
  ) : null

  const countLabel =
    entries.length === 0
      ? null
      : filteredEntries.length === entries.length
        ? t('contacts.count_total', {
            count: entries.length,
            defaultValue: '{{count}} contact(s)'
          })
        : t('contacts.count_filtered', {
            count: filteredEntries.length,
            total: entries.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('contacts.sectionBadge')}
          count={countLabel}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => openEditor(EMPTY_CONTACT)}
            >
              {t('contacts.addButton')}
            </Button>
          }
        />

        {error ? (
          <div className="shrink-0 rounded-2xl border border-destructive-border bg-destructive-tint p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {editor ? null : conflictPanel}

        {isLoading ? (
          <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
            {t('contacts.loadingState')}
          </p>
        ) : entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => openEditor(EMPTY_CONTACT)}
            className="w-full shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-left text-sm text-ink transition hover:border-aurora/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            {t('contacts.emptyState')}
          </button>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <SearchField
                id="contacts-search"
                value={searchFilter}
                onChange={setSearchFilter}
                placeholder={t('contacts.filter.searchPlaceholder')}
                ariaLabel={t('contacts.filter.searchLabel')}
              />
              <PillSelect<SortOrder>
                id="contacts-sort"
                value={sortOrder}
                onChange={setSortOrder}
                ariaLabel={t('contacts.filter.sortLabel')}
              >
                <option value="name-asc">{t('contacts.filter.sortNameAsc')}</option>
                <option value="name-desc">{t('contacts.filter.sortNameDesc')}</option>
              </PillSelect>
            </div>

            {filteredEntries.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
                {t('contacts.noResults')}
              </p>
            ) : (
              <ListContainer>
                <ul className="h-full divide-y divide-deep-space overflow-y-auto">
                  {filteredEntries.map((entry) => {
                    const isConfirming = confirmingDeleteId === entry.uuid
                    const managedFieldSummary = buildManagedFieldSummary(
                      entry,
                      managedFieldDefinitions
                    )
                    const addressFormatted = buildAddressFields(entry).addressFormatted
                    return (
                      <li
                        key={entry.uuid}
                        className="group relative px-5 py-4 transition-colors duration-150 hover:bg-parchment-bright"
                      >
                        <div className="flex items-start justify-between gap-x-4">
                          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(10rem,0.8fr)_minmax(12rem,1fr)]">
                            <div className="group/nameaddr flex min-w-0 items-center gap-1.5 overflow-hidden lg:col-start-1 lg:row-start-1">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                                <p className="text-sm font-semibold text-ink">
                                  {getContactDisplayName(entry)}
                                </p>
                                {entry.institution &&
                                (entry.firstName || entry.lastName || entry.title) ? (
                                  <span className="text-xs text-ink-muted">
                                    {entry.institution}
                                  </span>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                title={
                                  isCopied(entry.uuid, 'name-address')
                                    ? 'Copié !'
                                    : 'Copier nom + adresse'
                                }
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleCopy(
                                    entry.uuid,
                                    'name-address',
                                    [getContactDisplayName(entry), addressFormatted]
                                      .filter(Boolean)
                                      .join('\n')
                                  )
                                }}
                                className={cn(
                                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-all',
                                  isCopied(entry.uuid, 'name-address')
                                    ? 'text-aurora opacity-100'
                                    : 'text-[#b0afa9] opacity-0 group-hover/nameaddr:opacity-100 hover:text-aurora'
                                )}
                              >
                                {isCopied(entry.uuid, 'name-address') ? (
                                  <CheckIcon />
                                ) : (
                                  <CopyIcon />
                                )}
                              </button>
                            </div>
                            <div className="flex min-w-0 items-baseline lg:col-start-2 lg:row-start-1">
                              {entry.role ? (
                                <span className="rounded-full border border-aurora/40 bg-aurora/15 px-2 py-0.5 text-xs text-aurora">
                                  {entry.role}
                                </span>
                              ) : null}
                            </div>

                            {addressFormatted || entry.phone || entry.email || entry.information ? (
                              <>
                                <p className="min-w-0 overflow-hidden whitespace-pre-wrap text-sm text-ink-muted lg:col-start-1 lg:row-start-2">
                                  {addressFormatted}
                                </p>
                                <div className="flex flex-col gap-0.5 text-sm text-ink-muted lg:col-start-2 lg:row-start-2">
                                  {entry.phone ? (
                                    <span className="group/phone inline-flex items-center gap-1">
                                      <span className="tabular-nums">{entry.phone}</span>
                                      <button
                                        type="button"
                                        title={
                                          isCopied(entry.uuid, 'phone')
                                            ? 'Copié !'
                                            : 'Copier le téléphone'
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleCopy(entry.uuid, 'phone', entry.phone!)
                                        }}
                                        className={cn(
                                          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all',
                                          isCopied(entry.uuid, 'phone')
                                            ? 'text-aurora opacity-100'
                                            : 'text-[#b0afa9] opacity-0 group-hover/phone:opacity-100 hover:text-aurora'
                                        )}
                                      >
                                        {isCopied(entry.uuid, 'phone') ? (
                                          <CheckIcon />
                                        ) : (
                                          <CopyIcon />
                                        )}
                                      </button>
                                    </span>
                                  ) : null}
                                  {entry.email ? (
                                    <span className="group/email inline-flex min-w-0 items-center gap-1">
                                      <span className="truncate">{entry.email}</span>
                                      <button
                                        type="button"
                                        title={
                                          isCopied(entry.uuid, 'email')
                                            ? 'Copié !'
                                            : "Copier l'e-mail"
                                        }
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleCopy(entry.uuid, 'email', entry.email!)
                                        }}
                                        className={cn(
                                          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all',
                                          isCopied(entry.uuid, 'email')
                                            ? 'text-aurora opacity-100'
                                            : 'text-[#b0afa9] opacity-0 group-hover/email:opacity-100 hover:text-aurora'
                                        )}
                                      >
                                        {isCopied(entry.uuid, 'email') ? (
                                          <CheckIcon />
                                        ) : (
                                          <CopyIcon />
                                        )}
                                      </button>
                                    </span>
                                  ) : null}
                                </div>
                                {entry.information ? (
                                  <p className="whitespace-pre-wrap text-xs text-ink-subtle lg:col-span-2 lg:col-start-1 lg:row-start-3">
                                    {entry.information}
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                            {managedFieldSummary.length > 0 ? (
                              <dl className="mt-2 grid min-w-0 gap-1.5 rounded-lg border border-hairline bg-parchment-bright p-2.5 lg:col-start-3 lg:row-span-3 lg:row-start-1 lg:mt-0">
                                {managedFieldSummary.map((field) => (
                                  <div
                                    key={`${entry.uuid}-${field.key}`}
                                    className="grid min-w-0 grid-cols-[minmax(5.5rem,0.42fr)_minmax(0,1fr)] items-start gap-x-2"
                                  >
                                    <dt
                                      title={field.label}
                                      className="min-w-0 truncate text-[11px] font-medium text-ink-subtle"
                                    >
                                      {field.label}
                                    </dt>
                                    <dd className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-ink">
                                      {field.value}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}
                          </div>
                          <div className="relative flex shrink-0 items-center gap-1">
                            <div
                              className={
                                isConfirming
                                  ? 'invisible flex items-center gap-1'
                                  : 'flex items-center gap-1'
                              }
                            >
                              <IconButton
                                label={t('contacts.editButton')}
                                disabled={disabled}
                                onClick={() => openEditor(entry)}
                              >
                                <PencilIcon />
                              </IconButton>
                              <IconButton
                                label={t('contacts.deleteButton')}
                                tone="danger"
                                disabled={disabled}
                                onClick={() => setConfirmingDeleteId(entry.uuid)}
                              >
                                <TrashIcon />
                              </IconButton>
                            </div>
                            {isConfirming ? (
                              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                                <DeleteConfirmTray
                                  label={t('contacts.deleteConfirmLabel')}
                                  confirmLabel={t('contacts.deleteConfirmAction')}
                                  cancelLabel={t('contacts.deleteCancelAction')}
                                  disabled={disabled}
                                  onConfirm={async () => {
                                    await onDelete({ dossierId, contactUuid: entry.uuid })
                                    setConfirmingDeleteId(null)
                                  }}
                                  onCancel={() => setConfirmingDeleteId(null)}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </ListContainer>
            )}
          </>
        )}
      </div>

      {editor ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(15,122,138,0.18)] p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-y-auto rounded-[28px] border border-hairline-strong bg-parchment p-6 shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15"
          >
            {conflictPanel ? <div className="mb-4 shrink-0">{conflictPanel}</div> : null}
            <ContactForm
              key={editor.uuid ?? 'new-contact'}
              dossierId={dossierId}
              initialValue={editor}
              existingContacts={entries}
              disabled={disabled}
              onCancel={() => setEditor(null)}
              onSubmit={handleSave}
              onCheckConflicts={runConflictCheck}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
