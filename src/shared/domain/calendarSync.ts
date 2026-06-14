/**
 * One-way CalDAV calendar sync (Ordicab → remote calendar server).
 *
 * Ordicab is the source of truth: key dates are pushed as iCalendar events to
 * a dedicated remote calendar ("Ordicab") on a CalDAV server (iCloud,
 * Nextcloud, Fastmail…). Phones subscribed to the same account receive the
 * events natively; edits made on the phone are overwritten on the next sync.
 */

export interface CalendarSyncSettingsSaveInput {
  /** CalDAV server base URL, e.g. https://caldav.icloud.com */
  serverUrl: string
  /** Account identifier (e-mail for iCloud). */
  username: string
  /**
   * Account password (app-specific password for iCloud). Omitted = keep the
   * stored one (when re-saving with unchanged credentials).
   */
  password?: string
}

export interface CalendarSyncOptionsInput {
  enabled?: boolean
  /** Push only upcoming events; the past is limited to the current week. */
  futureOnly?: boolean
}

export interface CalendarSyncStatus {
  /** Server URL + username + stored password are all present. */
  configured: boolean
  enabled: boolean
  /** Only upcoming events (past limited to the current week) are pushed. */
  futureOnly: boolean
  serverUrl: string | null
  username: string | null
  /** ISO timestamp of the last successful sync run, null before the first one. */
  lastSyncAt: string | null
  /** Human-readable message of the last failure, null when the last run succeeded. */
  lastError: string | null
  inProgress: boolean
}

export interface CalendarSyncRunResult {
  created: number
  updated: number
  deleted: number
  failed: number
}
