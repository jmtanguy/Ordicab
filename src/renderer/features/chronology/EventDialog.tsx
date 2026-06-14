import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DEADLINE_RULES,
  computeDeadline,
  findDeadlineRule,
  type DeadlineComputation,
  type DeadlineRule
} from '@shared/domain/proceduralDeadlines'
import { normalizeManagedFieldsConfig } from '@shared/managedFields'
import type { GeneralKeyDateUpsertInput, KeyDateTag } from '@shared/types'
import { toIsoDay } from '@shared/types'

import {
  Button,
  DialogShell,
  Field,
  FieldMessage,
  Input,
  Select,
  Textarea
} from '@renderer/components/ui'
import { useEntityStore } from '@renderer/stores'

import { DeleteConfirmTray } from '../dossiers/sectionLayout'
import type { CalendarCreateSlot } from './calendarTypes'

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

const KEY_DATE_TAG_DISPLAY_ORDER: KeyDateTag[] = [
  'imperative',
  'urgent',
  'to_confirm',
  'to_do',
  'important',
  'postponed',
  'cancelled',
  'confidential'
]

function formatDisplayDate(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(value + 'T12:00:00')
    )
  } catch {
    return value
  }
}

/** Valeurs initiales d'un événement existant (échéance de dossier ou générale). */
export interface EventDialogInitial {
  uuid: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

interface EventDialogProps {
  /** Édition : valeurs existantes ; création : null. */
  initial: EventDialogInitial | null
  /** Pré-remplissage (date/heure/durée) pour une création depuis le calendrier. */
  createDefaults?: CalendarCreateSlot
  /** Dossiers sélectionnables (ordre de la sidebar). */
  dossierOptions: { id: string; name: string }[]
  /** Rattachement actuel de l'événement ; `null` = « hors dossier ». */
  dossierId: string | null
  /** Nom du rattachement actuel (repli si le dossier est hors de `dossierOptions`). */
  dossierName?: string
  /**
   * Dossier dont la page est ouverte, le cas échéant. Masque « Ouvrir le
   * dossier » quand l'événement est déjà rattaché à ce dossier (point de vue
   * d'une section dossier).
   */
  currentDossierId?: string | null
  disabled?: boolean
  onDismiss: () => void
  /**
   * Enregistre l'événement. `toDossierId` `null` = « hors dossier ». L'appelant
   * compare avec le rattachement d'origine pour décider d'un déplacement.
   */
  onSave: (toDossierId: string | null, fields: GeneralKeyDateUpsertInput) => Promise<boolean>
  /** Présent en édition : suppression (avec confirmation dans le dialogue). */
  onDelete?: () => Promise<boolean>
  /** Ouvre un dossier rattaché (édition d'une échéance depuis l'accueil). */
  onOpenDossier?: (dossierId: string) => void
  /**
   * Convertit l'événement (échéance enregistrée et rattachée à un dossier) en
   * prestation — même action que l'icône reçu de la liste des échéances.
   */
  onConvertToBillingItem?: () => void
  /** L'échéance est déjà liée à une prestation : affiche un badge au lieu de l'action. */
  isBilled?: boolean
}

interface EditorState {
  uuid?: string
  label: string
  date: string
  time?: string
  duration?: string
  tags: KeyDateTag[]
  isClosed: boolean
  note?: string
}

function toEditorState(
  initial: EventDialogInitial | null,
  defaults?: CalendarCreateSlot
): EditorState {
  if (!initial) {
    return {
      label: '',
      date: defaults?.date ?? '',
      time: defaults?.time,
      // Création par geste calendrier : seule la durée du geste compte
      // (un créneau « jour seul » reste sans durée). Sinon, 60 min par défaut.
      duration: defaults ? (defaults.duration ? String(defaults.duration) : undefined) : '60',
      tags: [],
      isClosed: false
    }
  }
  return {
    uuid: initial.uuid,
    label: initial.label,
    date: initial.date,
    time: initial.time,
    duration: initial.duration ? String(initial.duration) : undefined,
    tags: initial.tags ?? [],
    isClosed: initial.isClosed ?? false,
    note: initial.note
  }
}

function toggleTag(tags: KeyDateTag[], tag: KeyDateTag): KeyDateTag[] {
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
}

interface DossierComboboxProps {
  options: { id: string; name: string }[]
  value: string | null
  onChange: (dossierId: string | null) => void
  noneLabel: string
  searchPlaceholder: string
}

/** Sélecteur de dossier avec recherche — l'ordre des options suit la sidebar. */
function DossierCombobox({
  options,
  value,
  onChange,
  noneLabel,
  searchPlaceholder
}: DossierComboboxProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const selectedLabel =
    value === null ? noneLabel : (options.find((o) => o.id === value)?.name ?? '')
  const normalized = search.trim().toLocaleLowerCase()
  const filtered =
    normalized.length === 0
      ? options
      : options.filter((o) => o.name.toLocaleLowerCase().includes(normalized))

  return (
    <div className="relative">
      <Input
        type="text"
        role="combobox"
        aria-expanded={open}
        value={open ? search : selectedLabel}
        placeholder={open ? searchPlaceholder : undefined}
        onFocus={() => {
          setOpen(true)
          setSearch('')
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => setSearch(event.target.value)}
      />
      {open ? (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-xl border border-hairline bg-white py-1 shadow-panel"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onMouseDown={(event) => {
                event.preventDefault()
                onChange(null)
                setOpen(false)
              }}
              className={`w-full px-3 py-1.5 text-left text-sm transition hover:bg-aurora/10 ${
                value === null ? 'font-medium text-aurora' : 'text-ink-muted'
              }`}
            >
              {noneLabel}
            </button>
          </li>
          {filtered.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === option.id}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onChange(option.id)
                  setOpen(false)
                }}
                className={`w-full truncate px-3 py-1.5 text-left text-sm transition hover:bg-aurora/10 ${
                  value === option.id ? 'font-medium text-aurora' : 'text-ink'
                }`}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Dialogue d'événement unique, partagé entre l'accueil et les dossiers.
 * Toujours riche : calcul des délais de procédure et autocomplétion des
 * libellés configurés. Le rattachement au dossier est affiché en lecture seule
 * puis déplaçable via « Changer de dossier ».
 */
export function EventDialog({
  initial,
  createDefaults,
  dossierOptions,
  dossierId,
  dossierName,
  currentDossierId,
  disabled,
  onDismiss,
  onSave,
  onDelete,
  onOpenDossier,
  onConvertToBillingItem,
  isBilled
}: EventDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const profile = useEntityStore((state) => state.profile)

  const [editor, setEditor] = useState<EditorState>(() => toEditorState(initial, createDefaults))
  const [selectedDossierId, setSelectedDossierId] = useState<string | null>(dossierId)
  const [editingDossier, setEditingDossier] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deadlineRuleId, setDeadlineRuleId] = useState('')
  const [deadlineBaseDate, setDeadlineBaseDate] = useState(() => toIsoDay(new Date()))
  const [deadlineComputed, setDeadlineComputed] = useState<{
    rule: DeadlineRule
    computation: DeadlineComputation
  } | null>(null)
  const lastSuggestedLabelRef = useRef<string | null>(null)

  const configuredLabels = useMemo(
    () => normalizeManagedFieldsConfig(profile?.managedFields).keyDates.map((d) => d.label),
    [profile?.managedFields]
  )

  const noneLabel = t('home.general_event_dossier_label', { defaultValue: 'Hors dossier' })

  // Le rattachement courant peut être hors de la liste (dossier clôturé/archivé) :
  // on l'ajoute pour qu'il reste affichable et sélectionnable.
  const options = useMemo(() => {
    if (dossierId === null || dossierOptions.some((o) => o.id === dossierId)) {
      return dossierOptions
    }
    return [...dossierOptions, { id: dossierId, name: dossierName ?? dossierId }]
  }, [dossierOptions, dossierId, dossierName])

  const selectedName =
    selectedDossierId === null
      ? noneLabel
      : (options.find((o) => o.id === selectedDossierId)?.name ?? dossierName ?? '')

  const showOpenDossier =
    selectedDossierId !== null && Boolean(onOpenDossier) && selectedDossierId !== currentDossierId

  // « Convertir en prestation » : seulement pour une échéance enregistrée encore
  // rattachée à son dossier d'origine (un déplacement non sauvegardé l'exclut).
  const showConvertToBilling =
    initial !== null &&
    selectedDossierId !== null &&
    selectedDossierId === dossierId &&
    Boolean(onConvertToBillingItem)
  const showRelatedActions = !editingDossier
  const requiredText = t('common.required', { defaultValue: 'Obligatoire' })

  const requiredLabel = (label: string): React.JSX.Element => (
    <span className="inline-flex items-baseline gap-1.5">
      <span>{label}</span>
      <span className="text-xs font-normal text-ink-subtle">{`(${requiredText})`}</span>
    </span>
  )

  /** Calcule l'échéance, remplit la date et suggère le libellé (modifiables ensuite). */
  const applyDeadlineRule = (ruleId: string, baseDateIso: string): void => {
    setDeadlineRuleId(ruleId)
    setDeadlineBaseDate(baseDateIso)
    const rule = findDeadlineRule(ruleId)
    if (!rule || !baseDateIso) {
      setDeadlineComputed(null)
      return
    }
    const computation = computeDeadline(rule, baseDateIso)
    setDeadlineComputed({ rule, computation })
    const suggestedLabel = t('proceduralDeadlines.suggested_label', {
      label: rule.labelFr,
      basis: rule.basis,
      defaultValue: 'Expiration délai — {{label}} ({{basis}})'
    })
    setDateError(null)
    setEditor((current) => {
      // Ne pas écraser un libellé saisi à la main (seul vide ou suggestion précédente).
      const keepLabel = current.label !== '' && current.label !== lastSuggestedLabelRef.current
      lastSuggestedLabelRef.current = suggestedLabel
      return {
        ...current,
        date: computation.dateIso,
        label: keepLabel ? current.label : suggestedLabel
      }
    })
  }

  return (
    <DialogShell
      size="xl"
      aria-label={t('dossiers.key_dates_form_title', { defaultValue: 'Événement' })}
      onDismiss={onDismiss}
    >
      <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">
          {t('dossiers.key_dates_form_title', { defaultValue: 'Événement' })}
        </h3>
        {showRelatedActions ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingDossier(true)}>
              {t('dossiers.calendar_event_change_dossier', {
                defaultValue: 'Changer de dossier'
              })}
            </Button>
            {showOpenDossier ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenDossier?.(selectedDossierId as string)
                  onDismiss()
                }}
              >
                {t('dossiers.calendar_event_open_dossier', {
                  defaultValue: 'Ouvrir le dossier'
                })}
              </Button>
            ) : null}
            {showConvertToBilling ? (
              isBilled ? (
                <span
                  className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                  title={t('dossiers.key_dates_billed_badge_tooltip', {
                    defaultValue: 'Cette échéance est déjà liée à une prestation'
                  })}
                >
                  {t('dossiers.key_dates_billed_badge', { defaultValue: 'Facturé' })}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onConvertToBillingItem?.()
                    onDismiss()
                  }}
                >
                  {t('dossiers.key_dates_convert_to_billing_action', {
                    defaultValue: 'Convertir en prestation'
                  })}
                </Button>
              )
            ) : null}
          </div>
        ) : null}
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
          const saved = await onSave(selectedDossierId, {
            uuid: editor.uuid,
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
            onDismiss()
          }
        }}
      >
        <div className="py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)]">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2 text-sm text-ink md:col-span-2">
                <span className="font-medium">
                  {t('dossiers.calendar_event_dossier_label', { defaultValue: 'Dossier' })}
                </span>
                {editingDossier ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-56 flex-1">
                      <DossierCombobox
                        options={options}
                        value={selectedDossierId}
                        onChange={(next) => {
                          setSelectedDossierId(next)
                          setEditingDossier(false)
                        }}
                        noneLabel={noneLabel}
                        searchPlaceholder={t('dossiers.calendar_event_dossier_search_placeholder', {
                          defaultValue: 'Rechercher un dossier…'
                        })}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDossierId(dossierId)
                        setEditingDossier(false)
                      }}
                      className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                    >
                      {t('dossiers.key_dates_cancel_action', { defaultValue: 'Annuler' })}
                    </button>
                  </div>
                ) : (
                  <span className="inline-block max-w-full truncate rounded-full border border-hairline bg-[#f5f3ec] px-3 py-1 text-sm text-ink">
                    {selectedName}
                  </span>
                )}
              </div>

              <Field
                label={requiredLabel(t('dossiers.key_dates_form_label'))}
                htmlFor="chronology-event-label"
              >
                <Input
                  id="chronology-event-label"
                  type="text"
                  list="chronology-event-label-options"
                  value={editor.label}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, label: event.target.value }))
                  }
                  placeholder={t('dossiers.key_dates_form_label_placeholder')}
                  required
                />
                <datalist id="chronology-event-label-options">
                  {configuredLabels.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </Field>

              <Field
                label={requiredLabel(t('dossiers.key_dates_form_date'))}
                htmlFor="chronology-event-date"
                error={dateError}
              >
                <Input
                  id="chronology-event-date"
                  type="date"
                  value={editor.date}
                  onChange={(event) => {
                    setDateError(null)
                    // Édition manuelle : le calcul affiché ne correspond plus.
                    setDeadlineRuleId('')
                    setDeadlineComputed(null)
                    setEditor((current) => ({ ...current, date: event.target.value }))
                  }}
                  required
                />
              </Field>

              <Field label={t('dossiers.key_dates_form_time')} htmlFor="chronology-event-time">
                <Input
                  id="chronology-event-time"
                  type="time"
                  value={editor.time ?? ''}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, time: event.target.value }))
                  }
                />
              </Field>

              <Field
                label={t('dossiers.key_dates_form_duration')}
                htmlFor="chronology-event-duration"
              >
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted" aria-hidden="true">
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
                      id="chronology-event-duration"
                      type="range"
                      list="chronology-event-duration-marks"
                      min={0}
                      max={480}
                      step={15}
                      value={Math.min(editor.duration ? parseInt(editor.duration, 10) : 0, 480)}
                      onChange={(event) => {
                        const value = event.target.value
                        setEditor((current) => ({
                          ...current,
                          duration: value === '0' ? undefined : value
                        }))
                      }}
                      className="w-full accent-aurora"
                    />
                    <datalist id="chronology-event-duration-marks">
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
                    <div className="mt-0.5 flex justify-between px-0.5 text-[10px] text-ink-subtle">
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
                      setEditor((current) => ({
                        ...current,
                        duration: value === '' || value === '0' ? undefined : value
                      }))
                    }}
                    className="w-20"
                  />
                  <span className="text-xs text-ink-muted">{'min'}</span>
                </div>
              </Field>

              <Field
                className="md:col-span-2"
                label={t('dossiers.key_dates_information_label')}
                htmlFor="chronology-event-information"
              >
                <Textarea
                  id="chronology-event-information"
                  rows={7}
                  value={editor.note ?? ''}
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder={t('dossiers.key_dates_information_placeholder')}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-dashed border-hairline bg-parchment-bright p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-ink">
                    {t('proceduralDeadlines.rule_label', {
                      defaultValue: 'Délai de procédure'
                    })}
                  </span>
                  {deadlineComputed ? (
                    <span className="rounded-full bg-aurora/10 px-2 py-0.5 text-xs font-medium text-aurora">
                      {formatDisplayDate(deadlineComputed.computation.dateIso, locale)}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3">
                  <Select
                    id="chronology-event-deadline-rule"
                    aria-label={t('proceduralDeadlines.rule_label', {
                      defaultValue: 'Délai de procédure'
                    })}
                    value={deadlineRuleId}
                    onChange={(event) => applyDeadlineRule(event.target.value, deadlineBaseDate)}
                  >
                    <option value="">
                      {t('proceduralDeadlines.rule_placeholder', {
                        defaultValue: '— Aucun (saisie manuelle) —'
                      })}
                    </option>
                    {DEADLINE_RULES.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {`${rule.labelFr} · ${rule.basis}`}
                      </option>
                    ))}
                  </Select>

                  <div
                    className={`grid gap-3 transition-opacity ${
                      deadlineRuleId ? 'opacity-100' : 'pointer-events-none opacity-45'
                    }`}
                  >
                    <Field
                      label={t('proceduralDeadlines.base_date_label', {
                        defaultValue: 'Point de départ'
                      })}
                      htmlFor="chronology-event-deadline-base"
                    >
                      <Input
                        id="chronology-event-deadline-base"
                        type="date"
                        value={deadlineBaseDate}
                        disabled={!deadlineRuleId}
                        onChange={(event) => applyDeadlineRule(deadlineRuleId, event.target.value)}
                      />
                    </Field>

                    <FieldMessage>
                      {deadlineComputed
                        ? t('proceduralDeadlines.computed_note', {
                            date: formatDisplayDate(deadlineComputed.computation.dateIso, locale),
                            basis: deadlineComputed.rule.basis,
                            defaultValue: 'Échéance calculée : {{date}} ({{basis}})'
                          })
                        : t('proceduralDeadlines.rule_placeholder', {
                            defaultValue: '— Aucun (saisie manuelle) —'
                          })}
                      {deadlineComputed?.computation.adjusted
                        ? ` — ${t(
                            deadlineComputed.computation.adjustedReason === 'holiday'
                              ? 'proceduralDeadlines.adjusted_holiday'
                              : 'proceduralDeadlines.adjusted_weekend',
                            {
                              defaultValue:
                                deadlineComputed.computation.adjustedReason === 'holiday'
                                  ? 'ajustée au premier jour ouvrable (jour férié, art. 642 CPC)'
                                  : 'ajustée au premier jour ouvrable (week-end, art. 642 CPC)'
                            }
                          )}`
                        : null}
                    </FieldMessage>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 text-sm text-ink">
                <span className="font-medium">{t('dossiers.key_dates_form_tags')}</span>
                <div className="flex flex-wrap gap-2">
                  {KEY_DATE_TAG_DISPLAY_ORDER.map((tag) => {
                    const active = editor.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setEditor((current) => ({
                            ...current,
                            tags: toggleTag(current.tags, tag)
                          }))
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 ${
                          active
                            ? TAG_STYLES[tag]
                            : 'border-hairline bg-white text-ink-muted hover:border-aurora/40 hover:text-ink'
                        }`}
                      >
                        {t(`dossiers.key_dates_tag_${tag}`)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2 text-sm text-ink">
                <span className="font-medium">{t('dossiers.key_dates_form_status_label')}</span>
                <div
                  role="radiogroup"
                  aria-label={t('dossiers.key_dates_form_status_label')}
                  className="inline-flex w-fit rounded-full border border-hairline bg-white p-0.5"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!editor.isClosed}
                    onClick={() => setEditor((current) => ({ ...current, isClosed: false }))}
                    className={`rounded-full px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 ${
                      !editor.isClosed
                        ? 'bg-aurora/10 font-medium text-aurora'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {t('dossiers.key_dates_state_open')}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={editor.isClosed}
                    onClick={() => setEditor((current) => ({ ...current, isClosed: true }))}
                    className={`rounded-full px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 ${
                      editor.isClosed
                        ? 'bg-aurora/10 font-medium text-aurora'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {t('dossiers.key_dates_state_closed')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-end gap-2">
          {editor.uuid && onDelete ? (
            confirmingDelete ? (
              <div className="mr-auto">
                <DeleteConfirmTray
                  label={t('dossiers.key_dates_delete_confirm_label')}
                  confirmLabel={t('dossiers.key_dates_delete_confirm_action')}
                  cancelLabel={t('dossiers.key_dates_delete_cancel_action')}
                  disabled={disabled}
                  onConfirm={async () => {
                    const deleted = await onDelete()
                    if (deleted) onDismiss()
                  }}
                  onCancel={() => setConfirmingDelete(false)}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-red-700"
                disabled={disabled}
                onClick={() => setConfirmingDelete(true)}
              >
                {t('dossiers.key_dates_delete_action')}
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDateError(null)
              onDismiss()
            }}
            disabled={disabled}
          >
            {t('dossiers.key_dates_cancel_action')}
          </Button>
          <Button type="submit" disabled={disabled}>
            {editor.uuid
              ? t('dossiers.key_dates_save_edit_action')
              : t('dossiers.key_dates_save_create_action')}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
