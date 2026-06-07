import type { KeyDateTag } from './dossier'

/**
 * Lead-time buckets (in days before the event) the user can be reminded at.
 * `0` means the day of the event itself.
 */
export const REMINDER_LEAD_DAYS_VALUES = [7, 3, 1, 0] as const
export type ReminderLeadDays = (typeof REMINDER_LEAD_DAYS_VALUES)[number]

/**
 * User preferences for proactive deadline reminders (native OS notifications
 * for upcoming key dates across all active dossiers).
 *
 * Persisted renderer-side in localStorage like the other UI preferences — the
 * data they act on (key dates) already lives on disk in each dossier.
 */
export interface ReminderPreferences {
  /** Master switch. When false, no notifications are ever surfaced. */
  enabled: boolean
  /**
   * Lead times to alert at, in days before the event. A key date fires once per
   * matching bucket as it crosses each threshold (e.g. J-7, J-3, J-1, day-of).
   */
  leadDays: ReminderLeadDays[]
  /**
   * Restrict reminders to key dates carrying at least one of these tags. When
   * empty, every upcoming key date is eligible.
   */
  triggerTags: KeyDateTag[]
}

export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  enabled: true,
  leadDays: [7, 1, 0],
  triggerTags: []
}
