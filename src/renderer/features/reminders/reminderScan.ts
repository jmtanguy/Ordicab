import type { KeyDate, KeyDateTag, ReminderPreferences } from '@shared/types'

/**
 * Minimal shape the scan needs from a chronology entry. Kept structural (rather
 * than importing the store's `ChronologyEntry`) so the logic stays pure and
 * trivially unit-testable.
 */
export interface ReminderScanEntry {
  dossierId: string
  dossierName: string
  keyDate: Pick<KeyDate, 'uuid' | 'label' | 'date' | 'time' | 'tags' | 'isClosed'>
}

export interface DueReminder {
  dossierId: string
  dossierName: string
  keyDateUuid: string
  label: string
  date: string
  /** Lead-time bucket (days before the event) that triggered this reminder. */
  leadDays: number
  /** Whole days from the reference date to the event (0 = today). */
  daysUntil: number
  /** Stable per-day dedupe key: dossier + key date + bucket + ISO day. */
  dedupeKey: string
}

/** Tags that mark a key date as no longer actionable — never remind on these. */
const SUPPRESSING_TAGS: readonly KeyDateTag[] = ['cancelled', 'postponed']

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toLocalIsoDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalNoon(isoDate: string): number {
  // Key dates are stored as YYYY-MM-DD. Anchor at local noon so day-count
  // arithmetic follows the user's calendar day and stays stable across DST.
  const parsed = new Date(`${isoDate}T12:00:00`)
  return parsed.getTime()
}

/**
 * Whole days between `now` and the event date. Positive = future, 0 = today,
 * negative = past. Uses the local day of `now`, matching the rest of the app's
 * YYYY-MM-DD calendar-date convention.
 */
export function daysUntilEvent(eventIsoDate: string, now: Date): number {
  const today = toLocalNoon(toLocalIsoDay(now))
  const event = toLocalNoon(eventIsoDate)
  if (Number.isNaN(event)) return Number.NaN
  return Math.round((event - today) / MS_PER_DAY)
}

/**
 * Pure scan: returns the reminders that are *due today* given the current
 * preferences. A key date fires once per enabled lead bucket on the exact day
 * it reaches that threshold (J-7, J-3, J-1, day-of). The caller is responsible
 * for de-duplicating against `dedupeKey` so each reminder surfaces only once.
 */
export function scanDueReminders(
  entries: ReminderScanEntry[],
  preferences: ReminderPreferences,
  now: Date
): DueReminder[] {
  if (!preferences.enabled || preferences.leadDays.length === 0) return []

  const today = toLocalIsoDay(now)
  const buckets = [...new Set(preferences.leadDays)].sort((a, b) => b - a)
  const due: DueReminder[] = []

  for (const entry of entries) {
    const { keyDate } = entry
    if (keyDate.isClosed) continue

    const tags = keyDate.tags ?? []
    if (tags.some((tag) => SUPPRESSING_TAGS.includes(tag))) continue

    if (
      preferences.triggerTags.length > 0 &&
      !tags.some((tag) => preferences.triggerTags.includes(tag))
    ) {
      continue
    }

    const daysUntil = daysUntilEvent(keyDate.date, now)
    if (Number.isNaN(daysUntil) || daysUntil < 0) continue

    const bucket = buckets.find((b) => b === daysUntil)
    if (bucket === undefined) continue

    due.push({
      dossierId: entry.dossierId,
      dossierName: entry.dossierName,
      keyDateUuid: keyDate.uuid,
      label: keyDate.label,
      date: keyDate.date,
      leadDays: bucket,
      daysUntil,
      dedupeKey: `${entry.dossierId}:${keyDate.uuid}:${bucket}:${today}`
    })
  }

  return due
}

/**
 * Upcoming key dates within `windowDays` (used by the home widget summary).
 * Applies the same suppression/trigger-tag rules as {@link scanDueReminders}.
 */
export function countUpcomingWithin(
  entries: ReminderScanEntry[],
  preferences: ReminderPreferences,
  now: Date,
  windowDays: number
): { total: number; today: number; tomorrow: number } {
  let total = 0
  let onToday = 0
  let onTomorrow = 0

  for (const entry of entries) {
    const { keyDate } = entry
    if (keyDate.isClosed) continue
    const tags = keyDate.tags ?? []
    if (tags.some((tag) => SUPPRESSING_TAGS.includes(tag))) continue
    if (
      preferences.triggerTags.length > 0 &&
      !tags.some((tag) => preferences.triggerTags.includes(tag))
    ) {
      continue
    }

    const daysUntil = daysUntilEvent(keyDate.date, now)
    if (Number.isNaN(daysUntil) || daysUntil < 0 || daysUntil > windowDays) continue

    total += 1
    if (daysUntil === 0) onToday += 1
    if (daysUntil === 1) onTomorrow += 1
  }

  return { total, today: onToday, tomorrow: onTomorrow }
}
