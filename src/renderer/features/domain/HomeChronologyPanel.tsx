import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KeyDate, KeyDateTag } from '@shared/types'
import { KEY_DATE_TAG_VALUES, computeAutoState, mondayIndex } from '@shared/types'
import { useDossierStore, useReminderStore, type ChronologyEntry } from '@renderer/stores'
import { countUpcomingWithin } from '@renderer/features/reminders/reminderScan'
import { Button } from '@renderer/components/ui'

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
  SegmentedControl,
  TrashIcon
} from '../dossiers/sectionLayout'
import { ChronologyCalendarPanel } from '../chronology/ChronologyCalendarPanel'
import { EventDialog, type EventDialogInitial } from '../chronology/EventDialog'
import { getStoredSurfaceView, setStoredSurfaceView } from '../chronology/calendarPrefs'
import type { SurfaceView } from '../chronology/calendarTypes'

const SURFACE_VIEW_STORAGE_KEY = 'ordicab.chronology.home.surfaceView'

function nextLocalDayDelayMs(now: Date): number {
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  return Math.max(1000, nextDay.getTime() - now.getTime())
}

function daysUntilEndOfWeek(date: Date): number {
  return 6 - mondayIndex(date)
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

type SortOrder = 'date-desc' | 'date-asc'
type KeyDateFilter = KeyDateTag | 'upcoming' | 'done'

const FILTER_VALUES: KeyDateFilter[] = ['upcoming', 'done', ...KEY_DATE_TAG_VALUES]

type EventDialogState = { mode: 'create' } | { mode: 'edit'; entry: ChronologyEntry } | null

/** Clé de ligne stable (un événement hors dossier partage le slug `__general__`). */
function entryKey(entry: ChronologyEntry): string {
  return `${entry.dossierId}-${entry.keyDate.uuid}`
}

interface HomeChronologyPanelProps {
  onOpenDossier: (id: string) => void
  onConvertKeyDateToBilling: (dossierId: string, keyDate: KeyDate) => void
}

export function HomeChronologyPanel({
  onOpenDossier,
  onConvertKeyDateToBilling
}: HomeChronologyPanelProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language

  const dossiers = useDossierStore((state) => state.dossiers)
  const chronologyEntries = useDossierStore((state) => state.chronologyEntries)
  const isChronologyLoading = useDossierStore((state) => state.isChronologyLoading)
  const isDossierLoading = useDossierStore((state) => state.isLoading)
  const loadChronology = useDossierStore((state) => state.loadChronology)
  const deleteGeneralKeyDate = useDossierStore((state) => state.deleteGeneralKeyDate)
  const deleteChronologyKeyDate = useDossierStore((state) => state.deleteChronologyKeyDate)
  const saveChronologyEvent = useDossierStore((state) => state.saveChronologyEvent)
  const reminderPreferences = useReminderStore((state) => state.preferences)

  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [activeFilters, setActiveFilters] = useState<KeyDateFilter[]>([])
  const [eventDialog, setEventDialog] = useState<EventDialogState>(null)
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null)
  const [surfaceView, setSurfaceView] = useState<SurfaceView>(
    () => getStoredSurfaceView(SURFACE_VIEW_STORAGE_KEY) ?? 'list'
  )
  const [currentDate, setCurrentDate] = useState(() => new Date())

  useEffect(() => {
    if (chronologyEntries !== null || isDossierLoading || isChronologyLoading) {
      return
    }
    void loadChronology()
  }, [chronologyEntries, isChronologyLoading, isDossierLoading, loadChronology])

  useEffect(() => {
    const refreshCurrentDate = (): void => setCurrentDate(new Date())
    const timer = window.setTimeout(refreshCurrentDate, nextLocalDayDelayMs(new Date()))
    document.addEventListener('visibilitychange', refreshCurrentDate)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshCurrentDate)
    }
  }, [currentDate])

  const searchTerms = useMemo(
    () =>
      searchFilter
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((term) => term.length > 0),
    [searchFilter]
  )

  const filteredEntries = useMemo(() => {
    if (!chronologyEntries) return []

    const searchMatched =
      searchTerms.length === 0
        ? chronologyEntries
        : chronologyEntries.filter((entry) =>
            searchTerms.every(
              (term) =>
                entry.keyDate.label.toLowerCase().includes(term) ||
                entry.dossierName.toLowerCase().includes(term) ||
                (entry.keyDate.note ?? '').toLowerCase().includes(term) ||
                formatDisplayDate(entry.keyDate.date, locale).toLowerCase().includes(term)
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
            const entryTags = entry.keyDate.tags ?? []
            const autoState = computeAutoState(entry.keyDate.date, currentDate)
            const stateMatches =
              activeStateFilters.length === 0 || activeStateFilters.includes(autoState)
            const tagsMatch =
              activeTagFilters.length === 0 ||
              activeTagFilters.every((tag) => entryTags.includes(tag))
            return stateMatches && tagsMatch
          })

    return [...filterMatched].sort((a, b) =>
      sortOrder === 'date-desc'
        ? b.keyDate.date.localeCompare(a.keyDate.date)
        : a.keyDate.date.localeCompare(b.keyDate.date)
    )
  }, [chronologyEntries, searchTerms, activeFilters, sortOrder, locale, currentDate])

  /** Dossiers proposés à la création — même ordre que la sidebar. */
  const dossierOptions = useMemo(
    () =>
      dossiers
        .filter((d) => d.status !== 'completed' && d.status !== 'archived')
        .map((d) => ({ id: d.slug, name: d.name })),
    [dossiers]
  )

  /** Supprime une entrée de la chronologie (échéance de dossier ou hors dossier). */
  const deleteEntry = (entry: ChronologyEntry): Promise<boolean> =>
    entry.isGeneral
      ? deleteGeneralKeyDate({ keyDateUuid: entry.keyDate.uuid })
      : deleteChronologyKeyDate({ dossierId: entry.dossierId, keyDateUuid: entry.keyDate.uuid })

  const upcomingSummary = useMemo(() => {
    if (!chronologyEntries) return null
    const scanEntries = chronologyEntries.map((entry) => ({
      dossierId: entry.dossierId,
      dossierName: entry.dossierName,
      keyDate: entry.keyDate
    }))
    return countUpcomingWithin(
      scanEntries,
      reminderPreferences,
      currentDate,
      daysUntilEndOfWeek(currentDate)
    )
  }, [chronologyEntries, reminderPreferences, currentDate])

  const isReady = chronologyEntries !== null
  const totalCount = chronologyEntries?.length ?? 0
  const isEmpty = isReady && totalCount === 0
  const shouldShowLoading = chronologyEntries === null

  const countLabel =
    !isReady || isEmpty
      ? null
      : filteredEntries.length === totalCount
        ? t('dossiers.key_dates_count_total', {
            count: totalCount,
            defaultValue: '{{count}} événement(s)'
          })
        : t('dossiers.key_dates_count_filtered', {
            count: filteredEntries.length,
            total: totalCount,
            defaultValue: '{{count}} sur {{total}}'
          })

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <SectionHeader
        badge={t('home.chronology_badge', { defaultValue: 'Chronologie' })}
        count={countLabel}
        actions={
          <>
            <SegmentedControl<SurfaceView>
              value={surfaceView}
              onChange={(view) => {
                setSurfaceView(view)
                setStoredSurfaceView(SURFACE_VIEW_STORAGE_KEY, view)
              }}
              ariaLabel={t('dossiers.calendar_view_label', { defaultValue: "Mode d'affichage" })}
              options={[
                {
                  value: 'list',
                  label: t('dossiers.calendar_view_list', { defaultValue: 'Liste' })
                },
                {
                  value: 'calendar',
                  label: t('dossiers.calendar_view_calendar', { defaultValue: 'Calendrier' })
                }
              ]}
            />
            <Button size="sm" onClick={() => setEventDialog({ mode: 'create' })}>
              {t('home.add_event_action', { defaultValue: 'Ajouter un événement' })}
            </Button>
          </>
        }
      />

      {upcomingSummary && upcomingSummary.total > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-aurora/20 bg-aurora/5 px-4 py-2.5">
          <span className="text-sm font-medium text-aurora">
            {t('reminders.widget_upcoming', {
              count: upcomingSummary.total,
              defaultValue: '{{count}} échéance(s) cette semaine'
            })}
          </span>
          {upcomingSummary.today > 0 ? (
            <span className="inline-block rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
              {t('reminders.widget_today', {
                count: upcomingSummary.today,
                defaultValue: "{{count}} aujourd'hui"
              })}
            </span>
          ) : null}
          {upcomingSummary.tomorrow > 0 ? (
            <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              {t('reminders.widget_tomorrow', {
                count: upcomingSummary.tomorrow,
                defaultValue: '{{count}} demain'
              })}
            </span>
          ) : null}
          {!reminderPreferences.enabled ? (
            <span className="text-xs text-ink-subtle">{t('reminders.widget_muted_hint')}</span>
          ) : null}
        </div>
      ) : null}

      {shouldShowLoading ? (
        <div className="flex h-full items-center justify-center">
          <span className="text-sm text-ink-subtle">
            {t('common.loading', { defaultValue: 'Chargement…' })}
          </span>
        </div>
      ) : isEmpty ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink-muted">
          {t('home.chronology_empty', {
            defaultValue: 'Aucun événement pour le moment.'
          })}
        </p>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <SearchField
              id="chronology-search"
              value={searchFilter}
              onChange={setSearchFilter}
              placeholder={t('dossiers.key_dates_filter_search_placeholder')}
              ariaLabel={t('dossiers.key_dates_filter_search_label')}
            />
            {surfaceView === 'list' ? (
              <PillSelect<SortOrder>
                id="chronology-sort"
                value={sortOrder}
                onChange={setSortOrder}
                ariaLabel={t('dossiers.key_dates_filter_sort_label')}
              >
                <option value="date-desc">{t('dossiers.key_dates_filter_sort_date_desc')}</option>
                <option value="date-asc">{t('dossiers.key_dates_filter_sort_date_asc')}</option>
              </PillSelect>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="text-xs uppercase tracking-[0.12em] text-ink-subtle">
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
                      : 'border-hairline bg-white text-ink-muted hover:border-aurora/40 hover:text-ink'
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

          {surfaceView === 'calendar' ? (
            <ChronologyCalendarPanel
              entries={filteredEntries}
              locale={locale}
              onOpenDossier={onOpenDossier}
              onConvertKeyDateToBilling={onConvertKeyDateToBilling}
            />
          ) : filteredEntries.length === 0 ? (
            <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
              {t('dossiers.key_dates_no_results')}
            </p>
          ) : (
            <ListContainer>
              <ColumnHeader>
                <span className="w-28 shrink-0">
                  {t('dossiers.key_dates_column_date', { defaultValue: 'Date' })}
                </span>
                <span className="w-44 shrink-0">
                  {t('home.chronology_column_dossier', { defaultValue: 'Dossier' })}
                </span>
                <span className="flex-1">
                  {t('dossiers.key_dates_column_label', { defaultValue: 'Libellé' })}
                </span>
                <span className="flex-1">{t('dossiers.key_dates_column_tags')}</span>
                <span aria-hidden="true" className="w-24 shrink-0" />
              </ColumnHeader>
              <ul className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
                {filteredEntries.map((entry) => {
                  const tags = entry.keyDate.tags ?? []
                  const isCancelledOrPostponed =
                    tags.includes('cancelled') || tags.includes('postponed')
                  const autoState = isCancelledOrPostponed
                    ? null
                    : computeAutoState(entry.keyDate.date, currentDate)

                  const rowKey = entryKey(entry)
                  const isConfirming = confirmingDeleteKey === rowKey

                  return (
                    <li
                      key={rowKey}
                      className={`group relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-parchment-bright ${
                        entry.keyDate.isClosed ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="w-28 shrink-0">
                        <p className="text-sm tabular-nums text-ink">
                          {formatDisplayDate(entry.keyDate.date, locale)}
                        </p>
                        {entry.keyDate.time ? (
                          <p className="text-xs tabular-nums text-ink-subtle">
                            {entry.keyDate.time}
                          </p>
                        ) : null}
                      </div>
                      <div className="w-44 min-w-0 shrink-0">
                        {entry.isGeneral ? (
                          <span className="inline-block rounded-full border border-hairline bg-[#f5f3ec] px-2 py-0.5 text-xs text-ink-subtle">
                            {t('home.general_event_dossier_label', {
                              defaultValue: 'Hors dossier'
                            })}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenDossier(entry.dossierId)}
                            className="w-full truncate text-left text-sm font-medium text-aurora underline-offset-2 hover:underline"
                          >
                            {entry.dossierName}
                          </button>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => setEventDialog({ mode: 'edit', entry })}
                          className="block w-full truncate text-left text-sm text-ink underline-offset-2 hover:underline"
                        >
                          {entry.keyDate.label}
                        </button>
                        {entry.keyDate.note ? (
                          <p className="truncate text-xs text-ink-subtle">{entry.keyDate.note}</p>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
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
                          {entry.billingItemUuids.length > 0 ? (
                            <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                              {t('dossiers.key_dates_billed_badge', {
                                defaultValue: 'Facturé'
                              })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="relative flex w-24 shrink-0 items-center justify-end gap-1">
                        <div
                          className={
                            isConfirming
                              ? 'invisible flex items-center gap-1'
                              : 'flex items-center gap-1'
                          }
                        >
                          {!entry.isGeneral && entry.billingItemUuids.length === 0 ? (
                            <IconButton
                              label={t('dossiers.key_dates_convert_to_billing_action', {
                                defaultValue: 'Convertir en prestation'
                              })}
                              onClick={() =>
                                onConvertKeyDateToBilling(entry.dossierId, entry.keyDate as KeyDate)
                              }
                            >
                              <ReceiptIcon />
                            </IconButton>
                          ) : null}
                          <IconButton
                            label={t('dossiers.key_dates_edit_action')}
                            onClick={() => setEventDialog({ mode: 'edit', entry })}
                          >
                            <PencilIcon />
                          </IconButton>
                          <IconButton
                            label={t('dossiers.key_dates_delete_action')}
                            tone="danger"
                            onClick={() => setConfirmingDeleteKey(rowKey)}
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
                              onConfirm={async () => {
                                await deleteEntry(entry)
                                setConfirmingDeleteKey(null)
                              }}
                              onCancel={() => setConfirmingDeleteKey(null)}
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

      {eventDialog
        ? (() => {
            const entry = eventDialog.mode === 'edit' ? eventDialog.entry : null
            const isGeneral = entry?.isGeneral ?? false
            // Édition d'une échéance de dossier : rattachement d'origine pour
            // décider d'un éventuel déplacement à la sauvegarde.
            const fromDossierId = entry && !isGeneral ? entry.dossierId : null
            return (
              <EventDialog
                initial={entry ? (entry.keyDate as EventDialogInitial) : null}
                dossierOptions={dossierOptions}
                dossierId={fromDossierId}
                dossierName={entry && !isGeneral ? entry.dossierName : undefined}
                currentDossierId={null}
                onDismiss={() => setEventDialog(null)}
                onSave={(toDossierId, fields) =>
                  saveChronologyEvent({ fromDossierId, toDossierId, fields })
                }
                onDelete={entry ? () => deleteEntry(entry) : undefined}
                onOpenDossier={onOpenDossier}
                onConvertToBillingItem={
                  entry && !isGeneral
                    ? () => onConvertKeyDateToBilling(entry.dossierId, entry.keyDate as KeyDate)
                    : undefined
                }
                isBilled={Boolean(entry && !isGeneral && entry.billingItemUuids.length > 0)}
              />
            )
          })()
        : null}
    </div>
  )
}
