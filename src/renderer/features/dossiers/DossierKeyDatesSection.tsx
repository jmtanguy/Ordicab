import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import type { DossierKeyDateDeleteInput, DossierKeyDateUpsertInput, KeyDate } from '@shared/types'

import { Button, Card, DialogShell, Field, Input, Textarea } from '@renderer/components/ui'
import { useEntityStore } from '@renderer/stores'

import { formatIsoDateForLocaleInput, parseLocaleDateToIso } from './localDate'

interface DossierKeyDatesSectionProps {
  dossierId: string
  dossierName: string
  entries: KeyDate[]
  disabled: boolean
  onSave: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDelete: (input: DossierKeyDateDeleteInput) => Promise<boolean>
}

interface KeyDateEditorState {
  id?: string
  label: string
  date: string
  note?: string
}

function formatDisplayDate(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(value + 'T12:00:00')
    )
  } catch {
    return value
  }
}

type SortOrder = 'date-desc' | 'date-asc'

export function DossierKeyDatesSection({
  dossierId,
  entries,
  disabled,
  onSave,
  onDelete
}: DossierKeyDatesSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const [editor, setEditor] = useState<KeyDateEditorState | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [dateError, setDateError] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields, profile?.profession)
  const configuredLabels = managedFields.keyDates.map((definition) => definition.label)
  const missingConfiguredLabels = configuredLabels.filter(
    (label) => !entries.some((entry) => entry.label.toLowerCase() === label.toLowerCase())
  )

  const searchTerms = searchFilter
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  const filteredEntries = useMemo(() => {
    const filtered =
      searchTerms.length === 0
        ? entries
        : entries.filter((entry) =>
            searchTerms.every(
              (term) =>
                entry.label.toLowerCase().includes(term) ||
                (entry.note ?? '').toLowerCase().includes(term) ||
                formatDisplayDate(entry.date, locale).toLowerCase().includes(term)
            )
          )
    return [...filtered].sort((a, b) =>
      sortOrder === 'date-desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
    )
  }, [entries, searchTerms, sortOrder, locale])

  return (
    <>
      <Card className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {t('dossiers.key_dates_badge')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setDateError(null)
              setEditor({ label: '', date: '' })
            }}
          >
            {t('dossiers.key_dates_add_action')}
          </Button>
        </div>

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDateError(null)
              setEditor({ label: '', date: '' })
            }}
            className="w-full rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-left text-sm text-slate-300 transition hover:border-aurora/50 hover:text-slate-100 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dossiers.key_dates_empty')}
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
                    onClick={() => {
                      setDateError(null)
                      setEditor({ label, date: '' })
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 transition hover:border-aurora/35 hover:text-slate-50 disabled:opacity-50"
                  >
                    + {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid shrink-0 gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
              <label
                htmlFor="key-dates-search"
                className="flex flex-col gap-2 text-sm text-slate-100"
              >
                <span>{t('dossiers.key_dates_filter_search_label')}</span>
                <input
                  id="key-dates-search"
                  type="search"
                  value={searchFilter}
                  onChange={(event) => setSearchFilter(event.target.value)}
                  placeholder={t('dossiers.key_dates_filter_search_placeholder')}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                />
              </label>
              <label
                htmlFor="key-dates-sort"
                className="flex flex-col gap-2 text-sm text-slate-100"
              >
                <span>{t('dossiers.key_dates_filter_sort_label')}</span>
                <select
                  id="key-dates-sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35"
                >
                  <option value="date-desc">{t('dossiers.key_dates_filter_sort_date_desc')}</option>
                  <option value="date-asc">{t('dossiers.key_dates_filter_sort_date_asc')}</option>
                </select>
              </label>
            </div>

            {filteredEntries.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-white/10 bg-slate-950/25 p-4 text-sm text-slate-300">
                {t('dossiers.key_dates_no_results')}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ul className="space-y-3">
                  {filteredEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-white/10 bg-slate-950/35 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <p className="w-36 shrink-0 text-sm font-medium text-slate-300">
                          {formatDisplayDate(entry.date, locale)}
                        </p>
                        <p className="font-medium text-slate-100">{entry.label}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {confirmingDeleteId === entry.id ? (
                          <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/8 px-3 py-1.5">
                            <span className="text-xs font-semibold text-rose-300">
                              {t('dossiers.key_dates_delete_confirm_label')}
                            </span>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={async () => {
                                await onDelete({ dossierId, keyDateId: entry.id })
                                setConfirmingDeleteId(null)
                              }}
                              className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                            >
                              {t('dossiers.key_dates_delete_confirm_action')}
                            </button>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => setConfirmingDeleteId(null)}
                              className="rounded-lg px-2 py-0.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                            >
                              {t('dossiers.key_dates_delete_cancel_action')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              onClick={() => {
                                setDateError(null)
                                setEditor({
                                  id: entry.id,
                                  label: entry.label,
                                  date: formatIsoDateForLocaleInput(entry.date, locale),
                                  note: entry.note
                                })
                              }}
                            >
                              {t('dossiers.key_dates_edit_action')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={disabled}
                              onClick={() => setConfirmingDeleteId(entry.id)}
                            >
                              {t('dossiers.key_dates_delete_action')}
                            </Button>
                          </>
                        )}
                      </div>

                      {entry.note ? (
                        <p className="w-full whitespace-pre-wrap text-sm text-slate-400">
                          {entry.note}
                        </p>
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
        <DialogShell
          size="xl"
          aria-label={
            editor.id ? t('dossiers.key_dates_edit_action') : t('dossiers.key_dates_add_action')
          }
        >
          <div>
            <h3 className="text-lg font-semibold text-slate-50">
              {editor.id ? t('dossiers.key_dates_edit_action') : t('dossiers.key_dates_add_action')}
            </h3>
            <p className="mt-1 text-sm text-slate-300">{t('dossiers.key_dates_form_hint')}</p>
          </div>

          <form
            className="flex flex-col gap-0"
            onSubmit={async (event) => {
              event.preventDefault()
              const parsedDate = parseLocaleDateToIso(editor.date, locale)

              if (parsedDate === null) {
                setDateError(t('dossiers.key_dates_form_invalid_date_error'))
                return
              }

              const saved = await onSave({
                id: editor.id,
                dossierId,
                label: editor.label,
                date: parsedDate,
                note: editor.note
              })
              if (saved) {
                setDateError(null)
                setEditor(null)
              }
            }}
          >
            <div className="grid gap-4 py-5 md:grid-cols-2">
              <Field label={t('dossiers.key_dates_form_label')} htmlFor="key-date-label">
                <Input
                  id="key-date-label"
                  type="text"
                  list="key-date-label-options"
                  value={editor.label}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, label: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.key_dates_form_label_placeholder')}
                  required
                />
                <datalist id="key-date-label-options">
                  {configuredLabels.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </Field>

              <Field
                label={t('dossiers.key_dates_form_date')}
                htmlFor="key-date-date"
                error={dateError}
              >
                <Input
                  id="key-date-date"
                  type="text"
                  value={editor.date}
                  placeholder={t('dossiers.key_dates_form_date_placeholder')}
                  inputMode="numeric"
                  onChange={(event) => {
                    setDateError(null)
                    setEditor((current) =>
                      current ? { ...current, date: event.target.value } : current
                    )
                  }}
                  required
                />
              </Field>

              <Field
                className="md:col-span-2"
                label={t('dossiers.key_dates_information_label')}
                htmlFor="key-date-information"
              >
                <Textarea
                  id="key-date-information"
                  rows={5}
                  value={editor.note ?? ''}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, note: event.target.value } : current
                    )
                  }
                  placeholder={t('dossiers.key_dates_information_placeholder')}
                />
              </Field>
            </div>

            <div className="mt-auto flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDateError(null)
                  setEditor(null)
                }}
                disabled={disabled}
              >
                {t('dossiers.key_dates_cancel_action')}
              </Button>
              <Button type="submit" disabled={disabled}>
                {editor.id
                  ? t('dossiers.key_dates_save_edit_action')
                  : t('dossiers.key_dates_save_create_action')}
              </Button>
            </div>
          </form>
        </DialogShell>
      ) : null}
    </>
  )
}
