import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  KeyDate,
  KeyDateTag
} from '@shared/types'
import { KEY_DATE_TAG_VALUES, computeAutoState } from '@shared/types'

import { Button } from '@renderer/components/ui'
import { useDossierStore, type ChronologyEntry } from '@renderer/stores'

import { ChronologyCalendarPanel } from '../chronology/ChronologyCalendarPanel'
import { EventDialog, type EventDialogInitial } from '../chronology/EventDialog'
import { getStoredSurfaceView, setStoredSurfaceView } from '../chronology/calendarPrefs'
import type { SurfaceView } from '../chronology/calendarTypes'
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
} from './sectionLayout'

const SURFACE_VIEW_STORAGE_KEY = 'ordicab.chronology.dossier.surfaceView'

interface DossierKeyDatesSectionProps {
  dossierId: string
  dossierName: string
  entries: KeyDate[]
  disabled: boolean
  billedKeyDateIds?: Set<string>
  onSave: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDelete: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onConvertToBillingItem?: (keyDate: KeyDate) => void
  /** Conversion d'une échéance d'un autre dossier affichée dans le calendrier. */
  onConvertKeyDateToBilling?: (dossierId: string, keyDate: KeyDate) => void
}

type EventDialogState = { mode: 'create' } | { mode: 'edit'; entry: KeyDate } | null

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
      title={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onChange(!value)
      }}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
        value
          ? 'border-[#c8c4b8] bg-[#f0ede3] text-ink-muted hover:bg-[#e8e4d8]'
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
  dossierName,
  disabled,
  billedKeyDateIds,
  onSave,
  onDelete,
  onConvertToBillingItem,
  onConvertKeyDateToBilling
}: DossierKeyDatesSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const chronologyEntries = useDossierStore((state) => state.chronologyEntries)
  const isChronologyLoading = useDossierStore((state) => state.isChronologyLoading)
  const loadChronology = useDossierStore((state) => state.loadChronology)
  const dossiers = useDossierStore((state) => state.dossiers)
  const saveChronologyEvent = useDossierStore((state) => state.saveChronologyEvent)
  const [eventDialog, setEventDialog] = useState<EventDialogState>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('date-desc')
  const [activeFilters, setActiveFilters] = useState<KeyDateFilter[]>([])
  const [surfaceView, setSurfaceView] = useState<SurfaceView>(
    () => getStoredSurfaceView(SURFACE_VIEW_STORAGE_KEY) ?? 'list'
  )
  const locale = i18n.resolvedLanguage ?? i18n.language

  /** Dossiers proposés au déplacement — même ordre que la sidebar. */
  const dossierOptions = useMemo(
    () =>
      dossiers
        .filter((d) => d.status !== 'completed' && d.status !== 'archived')
        .map((d) => ({ id: d.slug, name: d.name })),
    [dossiers]
  )

  // En mode calendrier, la chronologie complète sert de toile de fond
  // (événements des autres dossiers atténués) — chargement paresseux.
  useEffect(() => {
    if (surfaceView !== 'calendar' || chronologyEntries !== null || isChronologyLoading) {
      return
    }
    void loadChronology()
  }, [surfaceView, chronologyEntries, isChronologyLoading, loadChronology])

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

  /**
   * Entrées du calendrier : les échéances du dossier courant (filtres de la
   * section appliqués, état frais venant du détail) + tous les autres
   * événements de la chronologie comme contexte atténué.
   */
  const calendarEntries = useMemo<ChronologyEntry[]>(() => {
    const others = (chronologyEntries ?? []).filter((entry) => entry.dossierId !== dossierId)
    const own: ChronologyEntry[] = filteredEntries.map((keyDate) => ({
      dossierId,
      dossierName,
      keyDate,
      billingItemUuids: []
    }))
    return [...others, ...own]
  }, [chronologyEntries, dossierId, dossierName, filteredEntries])

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
          badgeTitle={t('dossiers.key_dates_badge_hint', {
            defaultValue:
              'Tous les événements datés du dossier : audiences, expertises, rendez-vous, délais…'
          })}
          count={countLabel}
          actions={
            <>
              {entries.length > 0 ? (
                <SegmentedControl<SurfaceView>
                  value={surfaceView}
                  onChange={(view) => {
                    setSurfaceView(view)
                    setStoredSurfaceView(SURFACE_VIEW_STORAGE_KEY, view)
                  }}
                  ariaLabel={t('dossiers.calendar_view_label', {
                    defaultValue: "Mode d'affichage"
                  })}
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
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  setEventDialog({ mode: 'create' })
                }}
              >
                {t('dossiers.key_dates_add_action')}
              </Button>
            </>
          }
        />

        {entries.length === 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setEventDialog({ mode: 'create' })
            }}
            className="w-full rounded-2xl border border-dashed border-hairline bg-white p-4 text-left text-sm text-ink transition hover:border-aurora/50 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
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
              {surfaceView === 'list' ? (
                <PillSelect<SortOrder>
                  id="key-dates-sort"
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
              <span
                className="cursor-help text-xs uppercase tracking-[0.12em] text-ink-subtle"
                title={t('dossiers.key_dates_filter_hint', {
                  defaultValue:
                    'Affiner la liste : cliquer sur un ou plusieurs états ou tags pour ne voir que les événements correspondants'
                })}
              >
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
                entries={calendarEntries}
                locale={locale}
                focusDossier={{ id: dossierId, name: dossierName }}
                disabled={disabled}
                onEditOwnKeyDate={(keyDate) => {
                  setEventDialog({ mode: 'edit', entry: keyDate })
                }}
                onConvertKeyDateToBilling={onConvertKeyDateToBilling}
              />
            ) : filteredEntries.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
                {t('dossiers.key_dates_no_results')}
              </p>
            ) : (
              <ListContainer>
                <ColumnHeader>
                  <span
                    aria-hidden="true"
                    className="w-5 shrink-0 cursor-help"
                    title={t('dossiers.key_dates_column_closed_hint', {
                      defaultValue:
                        'Cocher pour marquer l’événement comme clos (la ligne passe en grisé)'
                    })}
                  />
                  <span
                    className="w-28 shrink-0 cursor-help"
                    title={t('dossiers.key_dates_column_date_hint', {
                      defaultValue: 'Date de l’événement, avec heure et durée éventuelles'
                    })}
                  >
                    {t('dossiers.key_dates_column_date', { defaultValue: 'Date' })}
                  </span>
                  <span
                    className="flex-1 cursor-help"
                    title={t('dossiers.key_dates_column_label_hint', {
                      defaultValue:
                        'Nature de l’événement : audience, expertise, rendez-vous, échéance…'
                    })}
                  >
                    {t('dossiers.key_dates_column_label', { defaultValue: 'Libellé' })}
                  </span>
                  <span
                    className="flex-1 cursor-help"
                    title={t('dossiers.key_dates_column_tags_hint', {
                      defaultValue:
                        'État automatique (À venir / Passé) et tags posés sur l’événement'
                    })}
                  >
                    {t('dossiers.key_dates_column_tags')}
                  </span>
                  <span
                    className="flex-2 cursor-help"
                    title={t('dossiers.key_dates_column_information_hint', {
                      defaultValue: 'Note libre : contexte, enjeu, action attendue…'
                    })}
                  >
                    {t('dossiers.key_dates_information_label')}
                  </span>
                  <span
                    aria-hidden="true"
                    className="w-16 shrink-0 cursor-help"
                    title={t('dossiers.key_dates_column_actions_hint', {
                      defaultValue:
                        'Au survol d’une ligne : convertir en prestation, modifier, supprimer'
                    })}
                  />
                </ColumnHeader>
                <ul className="h-[calc(100%-2.25rem)] divide-y divide-deep-space overflow-y-auto">
                  {filteredEntries.map((entry) => {
                    const isConfirming = confirmingDeleteId === entry.uuid
                    return (
                      <li
                        key={entry.uuid}
                        className="group relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-parchment-bright"
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
                              uuid: entry.uuid,
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
                            <p className="text-sm tabular-nums text-ink">
                              {formatDisplayDate(entry.date, locale)}
                            </p>
                            {(entry.time ?? entry.duration) ? (
                              <p className="text-xs tabular-nums text-ink-subtle">
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
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => setEventDialog({ mode: 'edit', entry })}
                              className="block w-full truncate text-left text-sm font-medium text-ink underline-offset-2 hover:underline disabled:pointer-events-none"
                            >
                              {entry.label}
                            </button>
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
                                      className={`inline-block cursor-help rounded-full border px-2 py-0.5 text-xs ${AUTO_STATE_STYLES[autoState]}`}
                                      title={t('dossiers.key_dates_state_badge_hint', {
                                        defaultValue:
                                          'État déduit automatiquement de la date de l’événement'
                                      })}
                                    >
                                      {t(`dossiers.key_dates_state_${autoState}`)}
                                    </span>
                                  ) : null}
                                  {tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className={`inline-block cursor-help rounded-full border px-2 py-0.5 text-xs ${TAG_STYLES[tag]}`}
                                      title={t('dossiers.key_dates_tag_badge_hint', {
                                        defaultValue:
                                          'Tag posé sur l’événement — modifiable via le crayon'
                                      })}
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
                              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap pr-1 text-sm text-ink-subtle">
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
                              billedKeyDateIds?.has(entry.uuid) ? (
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
                                setEventDialog({ mode: 'edit', entry })
                              }}
                            >
                              <PencilIcon />
                            </IconButton>
                            <IconButton
                              label={t('dossiers.key_dates_delete_action')}
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
                                label={t('dossiers.key_dates_delete_confirm_label')}
                                confirmLabel={t('dossiers.key_dates_delete_confirm_action')}
                                cancelLabel={t('dossiers.key_dates_delete_cancel_action')}
                                disabled={disabled}
                                onConfirm={async () => {
                                  await onDelete({ dossierId, keyDateUuid: entry.uuid })
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

      {eventDialog ? (
        <EventDialog
          initial={eventDialog.mode === 'edit' ? (eventDialog.entry as EventDialogInitial) : null}
          dossierOptions={dossierOptions}
          dossierId={dossierId}
          dossierName={dossierName}
          currentDossierId={dossierId}
          disabled={disabled}
          onDismiss={() => setEventDialog(null)}
          onSave={(toDossierId, fields) =>
            toDossierId === dossierId
              ? onSave({ ...fields, dossierId })
              : saveChronologyEvent({ fromDossierId: dossierId, toDossierId, fields })
          }
          onDelete={
            eventDialog.mode === 'edit'
              ? () => onDelete({ dossierId, keyDateUuid: eventDialog.entry.uuid })
              : undefined
          }
          onConvertToBillingItem={
            onConvertToBillingItem && eventDialog.mode === 'edit'
              ? () => onConvertToBillingItem(eventDialog.entry)
              : undefined
          }
          isBilled={
            eventDialog.mode === 'edit'
              ? (billedKeyDateIds?.has(eventDialog.entry.uuid) ?? false)
              : false
          }
        />
      ) : null}
    </>
  )
}
