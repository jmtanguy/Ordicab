import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  KeyDate,
  KeyDateTag
} from '@shared/types'
import { KEY_DATE_TAG_VALUES } from '@shared/types'

import { Button, DialogShell, Field, Input, Textarea } from '@renderer/components/ui'
import { useEntityStore } from '@renderer/stores'

import {
  ColumnHeader,
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  PillSelect,
  ReceiptIcon,
  SearchField,
  SectionHeader,
  TrashIcon
} from './sectionLayout'

interface DossierKeyDatesSectionProps {
  dossierId: string
  dossierName: string
  entries: KeyDate[]
  disabled: boolean
  billedKeyDateIds?: Set<string>
  onSave: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDelete: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onConvertToBillingItem?: (keyDate: KeyDate) => void
}

interface KeyDateEditorState {
  id?: string
  label: string
  date: string
  time?: string
  duration?: string
  tags: KeyDateTag[]
  isClosed: boolean
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

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

function computeAutoState(isoDate: string): 'upcoming' | 'done' {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const eventDay = new Date(isoDate + 'T00:00:00')
  return eventDay >= today ? 'upcoming' : 'done'
}

const AUTO_STATE_STYLES: Record<'upcoming' | 'done', string> = {
  upcoming: 'bg-aurora/10 text-aurora border-aurora/20',
  done: 'bg-slate-100 text-slate-600 border-slate-200'
}

const TAG_STYLES: Record<KeyDateTag, string> = {
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  postponed: 'bg-amber-50 text-amber-700 border-amber-200',
  urgent: 'bg-orange-50 text-orange-700 border-orange-200',
  imperative: 'bg-rose-100 text-rose-800 border-rose-300',
  important: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  to_confirm: 'bg-slate-50 text-slate-700 border-slate-200',
  confidential: 'bg-purple-50 text-purple-700 border-purple-200',
  to_do: 'bg-sky-50 text-sky-700 border-sky-200'
}

function toggleTag(tags: KeyDateTag[], tag: KeyDateTag): KeyDateTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

interface ClosedToggleProps {
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel: string
}

function ClosedToggle({
  value,
  onChange,
  disabled,
  ariaLabel
}: ClosedToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!value)
      }}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        value
          ? 'border-[#c8c4b8] bg-[#f0ede3] text-[#5c5c5a] hover:bg-[#e8e4d8]'
          : 'border-[#d4d2c8] bg-white text-transparent hover:border-aurora/60'
      }`}
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" aria-hidden="true">
        <path
          d="M2.5 6.5L5 9L9.5 3.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

type SortOrder = 'date-desc' | 'date-asc'

type KeyDateFilter = KeyDateTag | 'upcoming' | 'done'

const FILTER_VALUES: KeyDateFilter[] = ['upcoming', 'done', ...KEY_DATE_TAG_VALUES]

export function DossierKeyDatesSection({
  dossierId,
  entries,
  disabled,
  billedKeyDateIds,
  onSave,
  onDelete,
  onConvertToBillingItem
}: DossierKeyDatesSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const [editor, setEditor] = useState<KeyDateEditorState | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [activeFilters, setActiveFilters] = useState<KeyDateFilter[]>([])
  const [dateError, setDateError] = useState<string | null>(null)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const managedFields = normalizeManagedFieldsConfig(profile?.managedFields)
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
    const searchMatched =
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
    const activeStateFilters = activeFilters.filter(
      (f): f is 'upcoming' | 'done' => f === 'upcoming' || f === 'done'
    )
    const activeTagFilters = activeFilters.filter(
      (f): f is KeyDateTag => f !== 'upcoming' && f !== 'done'
    )
    const filterMatched =
      activeFilters.length === 0
        ? searchMatched
        : searchMatched.filter((entry) => {
            const entryTags = entry.tags ?? []
            const autoState = computeAutoState(entry.date)
            const stateMatches =
              activeStateFilters.length === 0 || activeStateFilters.includes(autoState)
            const tagsMatch =
              activeTagFilters.length === 0 ||
              activeTagFilters.every((tag) => entryTags.includes(tag))
            return stateMatches && tagsMatch
          })
    return [...filterMatched].sort((a, b) =>
      sortOrder === 'date-desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
    )
  }, [entries, searchTerms, activeFilters, sortOrder, locale])

  const countLabel =
    entries.length === 0
      ? null
      : filteredEntries.length === entries.length
        ? t('dossiers.key_dates_count_total', {
            count: entries.length,
            defaultValue: '{{count}} événement(s)'
          })
        : t('dossiers.key_dates_count_filtered', {
            count: filteredEntries.length,
            total: entries.length,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('dossiers.key_dates_badge')}
          count={countLabel}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setDateError(null)
                setEditor({ label: '', date: '', tags: [], isClosed: false })
              }}
            >
              {t('dossiers.key_dates_add_action')}
            </Button>
          }
        />

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDateError(null)
              setEditor({ label: '', date: '', tags: [], isClosed: false })
            }}
            className="w-full rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-left text-sm text-[#1a1a1a] transition hover:border-aurora/50 hover:text-[#1a1a1a] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('dossiers.key_dates_empty')}
          </button>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <SearchField
                id="key-dates-search"
                value={searchFilter}
                onChange={setSearchFilter}
                placeholder={t('dossiers.key_dates_filter_search_placeholder')}
                ariaLabel={t('dossiers.key_dates_filter_search_label')}
              />
              <PillSelect<SortOrder>
                id="key-dates-sort"
                value={sortOrder}
                onChange={setSortOrder}
                ariaLabel={t('dossiers.key_dates_filter_sort_label')}
              >
                <option value="date-desc">{t('dossiers.key_dates_filter_sort_date_desc')}</option>
                <option value="date-asc">{t('dossiers.key_dates_filter_sort_date_asc')}</option>
              </PillSelect>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <span className="text-xs uppercase tracking-[0.12em] text-[#8a8a85]">
                {t('dossiers.key_dates_filter_label')}
              </span>
              {FILTER_VALUES.map((filter) => {
                const active = activeFilters.includes(filter)
                const isAutoState = filter === 'upcoming' || filter === 'done'
                const activeStyle = isAutoState ? AUTO_STATE_STYLES[filter] : TAG_STYLES[filter]
                const label = isAutoState
                  ? t(`dossiers.key_dates_state_${filter}`)
                  : t(`dossiers.key_dates_tag_${filter}`)
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() =>
                      setActiveFilters((prev) =>
                        prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
                      )
                    }
                    className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                      active
                        ? activeStyle
                        : 'border-[#e5e3da] bg-white text-[#5c5c5a] hover:border-aurora/40 hover:text-[#1a1a1a]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
              {activeFilters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setActiveFilters([])}
                  className="ml-1 text-xs text-aurora underline-offset-2 hover:underline"
                >
                  {t('dossiers.key_dates_filter_clear')}
                </button>
              ) : null}
            </div>

            {missingConfiguredLabels.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {missingConfiguredLabels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setDateError(null)
                      setEditor({ label, date: '', tags: [], isClosed: false })
                    }}
                    className="rounded-full border border-[#e5e3da] bg-[#fbf9f4] px-3 py-1 text-xs text-[#1a1a1a] transition hover:border-aurora/40 hover:bg-aurora/10 hover:text-aurora disabled:opacity-50"
                  >
                    + {label}
                  </button>
                ))}
              </div>
            ) : null}

            {filteredEntries.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-[#e5e3da] bg-white p-4 text-sm text-[#1a1a1a]">
                {t('dossiers.key_dates_no_results')}
              </p>
            ) : (
              <ListContainer>
                <ColumnHeader>
                  <span className="w-5 shrink-0" aria-hidden="true" />
                  <span className="w-28 shrink-0">
                    {t('dossiers.key_dates_column_date', { defaultValue: 'Date' })}
                  </span>
                  <span className="flex-1">
                    {t('dossiers.key_dates_column_label', { defaultValue: 'Libellé' })}
                  </span>
                  <span className="flex-1">{t('dossiers.key_dates_column_tags')}</span>
                  <span className="flex-2">{t('dossiers.key_dates_information_label')}</span>
                  <span className="w-16 shrink-0" aria-hidden="true" />
                </ColumnHeader>
                <ul className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
                  {filteredEntries.map((entry) => {
                    const isConfirming = confirmingDeleteId === entry.id
                    return (
                      <li
                        key={entry.id}
                        className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-[#fbf9f4]"
                      >
                        <ClosedToggle
                          value={entry.isClosed ?? false}
                          disabled={disabled}
                          ariaLabel={t(
                            entry.isClosed
                              ? 'dossiers.key_dates_toggle_reopen_aria'
                              : 'dossiers.key_dates_toggle_close_aria'
                          )}
                          onChange={async (next) => {
                            await onSave({
                              id: entry.id,
                              dossierId,
                              label: entry.label,
                              date: entry.date,
                              time: entry.time,
                              duration: entry.duration,
                              tags: entry.tags,
                              isClosed: next,
                              note: entry.note
                            })
                          }}
                        />
                        <div
                          className={`flex min-w-0 flex-1 items-center gap-3 transition-opacity ${
                            entry.isClosed ? 'opacity-50' : ''
                          }`}
                        >
                          <div className="w-28 shrink-0">
                            <p className="text-sm tabular-nums text-[#1a1a1a]">
                              {formatDisplayDate(entry.date, locale)}
                            </p>
                            {(entry.time ?? entry.duration) ? (
                              <p className="text-xs tabular-nums text-[#8a8a85]">
                                {[
                                  entry.time,
                                  entry.duration ? formatDuration(entry.duration) : null
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[#1a1a1a]">
                              {entry.label}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            {(() => {
                              const tags = entry.tags ?? []
                              const isCancelledOrPostponed =
                                tags.includes('cancelled') || tags.includes('postponed')
                              const autoState = isCancelledOrPostponed
                                ? null
                                : computeAutoState(entry.date)
                              return autoState || tags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {autoState ? (
                                    <span
                                      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${AUTO_STATE_STYLES[autoState]}`}
                                    >
                                      {t(`dossiers.key_dates_state_${autoState}`)}
                                    </span>
                                  ) : null}
                                  {tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${TAG_STYLES[tag]}`}
                                    >
                                      {t(`dossiers.key_dates_tag_${tag}`)}
                                    </span>
                                  ))}
                                </div>
                              ) : null
                            })()}
                          </div>
                          <div className="min-w-0 flex-2">
                            {entry.note ? (
                              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap pr-1 text-sm text-[#8a8a85]">
                                {entry.note}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="relative flex shrink-0 items-center gap-1">
                          <div
                            className={
                              isConfirming
                                ? 'invisible flex items-center gap-1'
                                : 'flex items-center gap-1'
                            }
                          >
                            {onConvertToBillingItem ? (
                              billedKeyDateIds?.has(entry.id) ? (
                                <span
                                  className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800"
                                  title={t('dossiers.key_dates_billed_badge_tooltip', {
                                    defaultValue: 'Cette échéance est déjà liée à une prestation'
                                  })}
                                >
                                  {t('dossiers.key_dates_billed_badge', {
                                    defaultValue: 'Facturé'
                                  })}
                                </span>
                              ) : (
                                <IconButton
                                  label={t('dossiers.key_dates_convert_to_billing_action', {
                                    defaultValue: 'Convertir en prestation'
                                  })}
                                  disabled={disabled}
                                  onClick={() => onConvertToBillingItem(entry)}
                                >
                                  <ReceiptIcon />
                                </IconButton>
                              )
                            ) : null}
                            <IconButton
                              label={t('dossiers.key_dates_edit_action')}
                              disabled={disabled}
                              onClick={() => {
                                setDateError(null)
                                setEditor({
                                  id: entry.id,
                                  label: entry.label,
                                  date: entry.date,
                                  time: entry.time,
                                  duration: entry.duration ? String(entry.duration) : undefined,
                                  tags: entry.tags ?? [],
                                  isClosed: entry.isClosed ?? false,
                                  note: entry.note
                                })
                              }}
                            >
                              <PencilIcon />
                            </IconButton>
                            <IconButton
                              label={t('dossiers.key_dates_delete_action')}
                              tone="danger"
                              disabled={disabled}
                              onClick={() => setConfirmingDeleteId(entry.id)}
                            >
                              <TrashIcon />
                            </IconButton>
                          </div>
                          {isConfirming ? (
                            <div className="absolute right-0 top-1/2 -translate-y-1/2">
                              <DeleteConfirmTray
                                label={t('dossiers.key_dates_delete_confirm_label')}
                                confirmLabel={t('dossiers.key_dates_delete_confirm_action')}
                                cancelLabel={t('dossiers.key_dates_delete_cancel_action')}
                                disabled={disabled}
                                onConfirm={async () => {
                                  await onDelete({ dossierId, keyDateId: entry.id })
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
          </>
        )}
      </div>

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={t('dossiers.key_dates_form_title')}
          onDismiss={() => setEditor(null)}
        >
          <div>
            <h3 className="text-lg font-semibold text-[#1a1a1a]">
              {t('dossiers.key_dates_form_title')}
            </h3>
            <p className="mt-1 text-sm text-[#1a1a1a]">{t('dossiers.key_dates_form_hint')}</p>
          </div>

          <form
            className="flex flex-col gap-0"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!editor.date) {
                setDateError(t('dossiers.key_dates_form_invalid_date_error'))
                return
              }

              const parsedDuration = editor.duration ? parseInt(editor.duration, 10) : undefined

              const saved = await onSave({
                id: editor.id,
                dossierId,
                label: editor.label,
                date: editor.date,
                time: editor.time || undefined,
                duration: parsedDuration && !isNaN(parsedDuration) ? parsedDuration : undefined,
                tags: editor.tags,
                isClosed: editor.isClosed,
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
                  type="date"
                  value={editor.date}
                  onChange={(event) => {
                    setDateError(null)
                    setEditor((current) =>
                      current ? { ...current, date: event.target.value } : current
                    )
                  }}
                  required
                />
              </Field>

              <Field label={t('dossiers.key_dates_form_time')} htmlFor="key-date-time">
                <Input
                  id="key-date-time"
                  type="time"
                  value={editor.time ?? ''}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, time: event.target.value } : current
                    )
                  }
                />
              </Field>

              <Field label={t('dossiers.key_dates_form_duration')} htmlFor="key-date-duration">
                <div className="flex items-center gap-2">
                  <span className="text-[#5c5c5a]" aria-hidden="true">
                    <svg
                      viewBox="0 0 20 20"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <circle cx="10" cy="10" r="7" />
                      <path d="M10 6v4l2.5 2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <div className="flex-1">
                    <input
                      id="key-date-duration"
                      type="range"
                      list="key-date-duration-marks"
                      min={0}
                      max={480}
                      step={15}
                      value={Math.min(editor.duration ? parseInt(editor.duration, 10) : 0, 480)}
                      onChange={(event) => {
                        const value = event.target.value
                        setEditor((current) =>
                          current
                            ? { ...current, duration: value === '0' ? undefined : value }
                            : current
                        )
                      }}
                      className="w-full accent-aurora"
                    />
                    <datalist id="key-date-duration-marks">
                      <option value="0" />
                      <option value="60" />
                      <option value="120" />
                      <option value="180" />
                      <option value="240" />
                      <option value="300" />
                      <option value="360" />
                      <option value="420" />
                      <option value="480" />
                    </datalist>
                    <div className="mt-0.5 flex justify-between px-0.5 text-[10px] text-[#8a8a85]">
                      <span>{'0h'}</span>
                      <span>{'2h'}</span>
                      <span>{'4h'}</span>
                      <span>{'6h'}</span>
                      <span>{'8h'}</span>
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={editor.duration ?? ''}
                    placeholder="0"
                    aria-label={t('dossiers.key_dates_form_duration')}
                    onChange={(event) => {
                      const value = event.target.value
                      setEditor((current) =>
                        current
                          ? {
                              ...current,
                              duration: value === '' || value === '0' ? undefined : value
                            }
                          : current
                      )
                    }}
                    className="w-20"
                  />
                  <span className="text-xs text-[#5c5c5a]">{'min'}</span>
                </div>
              </Field>

              <Field className="md:col-span-2" label={t('dossiers.key_dates_form_tags')}>
                <div className="flex flex-wrap gap-2">
                  {KEY_DATE_TAG_VALUES.map((tag) => {
                    const active = editor.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setEditor((current) =>
                            current ? { ...current, tags: toggleTag(current.tags, tag) } : current
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          active
                            ? TAG_STYLES[tag]
                            : 'border-[#e5e3da] bg-white text-[#5c5c5a] hover:border-aurora/40 hover:text-[#1a1a1a]'
                        }`}
                      >
                        {t(`dossiers.key_dates_tag_${tag}`)}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field className="md:col-span-2" label={t('dossiers.key_dates_form_closed_label')}>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <ClosedToggle
                    value={editor.isClosed}
                    ariaLabel={t(
                      editor.isClosed
                        ? 'dossiers.key_dates_toggle_reopen_aria'
                        : 'dossiers.key_dates_toggle_close_aria'
                    )}
                    onChange={(next) =>
                      setEditor((current) => (current ? { ...current, isClosed: next } : current))
                    }
                  />
                  <span className="text-sm text-[#1a1a1a]">
                    {t(
                      editor.isClosed
                        ? 'dossiers.key_dates_state_closed'
                        : 'dossiers.key_dates_state_open'
                    )}
                  </span>
                </label>
              </Field>

              <Field
                className="md:col-span-2"
                label={t('dossiers.key_dates_information_label')}
                htmlFor="key-date-information"
              >
                <Textarea
                  id="key-date-information"
                  rows={8}
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
