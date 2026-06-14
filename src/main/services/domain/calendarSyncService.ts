import { join } from 'node:path'

import { z } from 'zod'

import type {
  CalendarSyncOptionsInput,
  CalendarSyncRunResult,
  CalendarSyncSettingsSaveInput,
  CalendarSyncStatus,
  DossierSummary
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { generalKeyDateSchema, keyDateSchema } from '@shared/validation/keyDate'

import {
  createCalDavClient,
  isCalDavAuthError,
  type CalDavClientLike
} from '../../lib/calendar/caldavClient'
import {
  buildIcsObject,
  computeEventContentHash,
  type CanonicalCalendarEvent
} from '../../lib/calendar/icsSerializer'
import {
  getDomainCalendarSyncStatePath,
  getDomainGeneralKeyDatesDirectoryPath,
  getDossierKeyDatesDirectoryPath
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadAllRecords, loadRecord } from '../../lib/system/perFileStore'
import type { AppStateStore } from '../../lib/system/appStateStore'
import type { CredentialStore } from '../../lib/system/credentialStore'

const PASSWORD_SECRET_KEY = 'calendarSync.password'
const REMOTE_CALENDAR_NAME = 'Ordicab'
const PUSH_CONCURRENCY = 4
const DEFAULT_DEBOUNCE_MS = 5_000
const DEFAULT_INTERVAL_MS = 15 * 60_000

export class CalendarSyncError extends Error {
  constructor(
    message: string,
    readonly code: IpcErrorCode = IpcErrorCode.REMOTE_API_ERROR
  ) {
    super(message)
    this.name = 'CalendarSyncError'
  }
}

interface CalendarSyncSettings {
  serverUrl: string | null
  username: string | null
  /** Collection URL resolved at save time (find-or-create "Ordicab"). */
  calendarUrl: string | null
  enabled: boolean
  /** Push only upcoming events; the past is limited to the current week. */
  futureOnly: boolean
}

/**
 * ISO date (YYYY-MM-DD) of the Monday of the week containing `reference`,
 * in local time. Events strictly before this date are out of the
 * "future + current week" window.
 */
export function currentWeekCutoffIso(reference: Date): string {
  const monday = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  // getDay(): 0 = Sunday … 6 = Saturday; the French week starts on Monday.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

const syncStateFileSchema = z.object({
  version: z.literal(1),
  calendarUrl: z.string(),
  entries: z.record(
    z.string(),
    z.object({
      href: z.string(),
      contentHash: z.string()
    })
  ),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable()
})

type CalendarSyncStateFile = z.infer<typeof syncStateFileSchema>

interface DomainStatusLike {
  registeredDomainPath: string | null
  isAvailable: boolean
}

export type CalendarSyncTrigger = 'startup' | 'change' | 'interval' | 'manual'

export interface CalendarSyncServiceOptions {
  appState: AppStateStore
  credentialStore: CredentialStore
  domainService: { getStatus(): Promise<DomainStatusLike> }
  listRegisteredDossiers: () => Promise<DossierSummary[]>
  onStatusChanged?: (status: CalendarSyncStatus) => void
  /** Test seam — defaults to the real tsdav-backed factory. */
  davClientFactory?: typeof createCalDavClient
  now?: () => Date
  debounceMs?: number
  intervalMs?: number
}

export interface CalendarSyncService {
  getStatus(): Promise<CalendarSyncStatus>
  /**
   * Persist server/credentials, verify them by connecting, find-or-create the
   * remote "Ordicab" calendar, enable the sync and trigger an initial push.
   */
  saveSettings(input: CalendarSyncSettingsSaveInput): Promise<CalendarSyncStatus>
  deleteCredentials(): Promise<CalendarSyncStatus>
  setOptions(input: CalendarSyncOptionsInput): Promise<CalendarSyncStatus>
  /** Manual sync; throws CalendarSyncError so the UI can show the failure. */
  syncNow(): Promise<CalendarSyncRunResult>
  /** Debounced, single-flight, never throws — for automatic triggers. */
  requestSync(trigger: CalendarSyncTrigger): void
  /** Arm the periodic sync timer. */
  start(): void
  dispose(): Promise<void>
}

/** Run tasks with a bounded number in flight, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext))
  return results
}

function summaryWithDossier(label: string, dossierName: string | null): string {
  return dossierName ? `${label} — ${dossierName}` : label
}

export function createCalendarSyncService(
  options: CalendarSyncServiceOptions
): CalendarSyncService {
  const {
    appState,
    credentialStore,
    domainService,
    listRegisteredDossiers,
    onStatusChanged,
    davClientFactory = createCalDavClient,
    now = () => new Date(),
    debounceMs = DEFAULT_DEBOUNCE_MS,
    intervalMs = DEFAULT_INTERVAL_MS
  } = options

  let inProgress = false
  let pendingRerun = false
  let inFlight: Promise<void> | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  let intervalTimer: NodeJS.Timeout | null = null
  let disposed = false
  // Mirrors the state file's lastSyncAt/lastError for status reads when no
  // domain is active (the state file lives in the domain folder).
  let lastSyncAt: string | null = null
  let lastError: string | null = null

  async function readSettings(): Promise<CalendarSyncSettings> {
    const state = await appState.read()
    const raw =
      state.calendarSync && typeof state.calendarSync === 'object'
        ? (state.calendarSync as Record<string, unknown>)
        : {}
    return {
      serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : null,
      username: typeof raw.username === 'string' ? raw.username : null,
      calendarUrl: typeof raw.calendarUrl === 'string' ? raw.calendarUrl : null,
      enabled: raw.enabled === true,
      // Default ON: a phone calendar carrying years of past hearings is noise;
      // the dialog exposes the toggle for users who want the full history.
      futureOnly: raw.futureOnly !== false
    }
  }

  async function writeSettings(settings: CalendarSyncSettings): Promise<void> {
    await appState.update((current) => ({
      ...current,
      calendarSync: { ...settings }
    }))
  }

  async function buildStatus(): Promise<CalendarSyncStatus> {
    const settings = await readSettings()
    const hasPassword = await credentialStore.hasSecret(PASSWORD_SECRET_KEY)
    return {
      configured: Boolean(settings.serverUrl && settings.username && hasPassword),
      enabled: settings.enabled,
      futureOnly: settings.futureOnly,
      serverUrl: settings.serverUrl,
      username: settings.username,
      lastSyncAt,
      lastError,
      inProgress
    }
  }

  function emitStatus(): void {
    if (!onStatusChanged) return
    void buildStatus()
      .then(onStatusChanged)
      .catch(() => undefined)
  }

  async function connect(settings: CalendarSyncSettings): Promise<CalDavClientLike> {
    const password = await credentialStore.getSecret(PASSWORD_SECRET_KEY)
    if (!settings.serverUrl || !settings.username || !password) {
      throw new CalendarSyncError(
        'CalDAV credentials are not configured.',
        IpcErrorCode.INVALID_INPUT
      )
    }
    return davClientFactory({
      serverUrl: settings.serverUrl,
      username: settings.username,
      password
    })
  }

  async function buildSnapshot(domainPath: string): Promise<CanonicalCalendarEvent[]> {
    const dossiers = await listRegisteredDossiers()
    const perDossier = await Promise.all(
      dossiers.map(async (dossier) => {
        const keyDates = await loadAllRecords(
          getDossierKeyDatesDirectoryPath(join(domainPath, dossier.slug)),
          keyDateSchema
        )
        return keyDates.map((keyDate) => toCanonicalEvent(keyDate, dossier))
      })
    )
    const generalKeyDates = await loadAllRecords(
      getDomainGeneralKeyDatesDirectoryPath(domainPath),
      generalKeyDateSchema
    )
    return [...perDossier.flat(), ...generalKeyDates.map((keyDate) => toCanonicalEvent(keyDate))]
  }

  function toCanonicalEvent(
    keyDate: {
      uuid: string
      label: string
      date: string
      time?: string
      duration?: number
      tags?: string[]
      isClosed?: boolean
      note?: string
    },
    dossier?: DossierSummary
  ): CanonicalCalendarEvent {
    return {
      uid: keyDate.uuid,
      summary: summaryWithDossier(keyDate.label, dossier?.name ?? null),
      allDay: !keyDate.time,
      date: keyDate.date,
      time: keyDate.time,
      durationMinutes: keyDate.duration ?? 30,
      description: keyDate.note,
      cancelled: keyDate.isClosed === true || (keyDate.tags ?? []).includes('cancelled')
    }
  }

  async function readStateFile(domainPath: string): Promise<CalendarSyncStateFile | null> {
    return loadRecord(getDomainCalendarSyncStatePath(domainPath), syncStateFileSchema)
  }

  async function writeStateFile(domainPath: string, state: CalendarSyncStateFile): Promise<void> {
    await atomicWrite(
      getDomainCalendarSyncStatePath(domainPath),
      `${JSON.stringify(state, null, 2)}\n`
    )
  }

  /**
   * The actual sync pass: snapshot → diff against the state file → push.
   * The state file is rewritten with only the per-item successes applied, so
   * failed items are retried on the next run.
   */
  async function runSync(): Promise<CalendarSyncRunResult> {
    const settings = await readSettings()
    if (!settings.enabled || !settings.calendarUrl) {
      throw new CalendarSyncError('Calendar sync is not configured.', IpcErrorCode.INVALID_INPUT)
    }
    const domainStatus = await domainService.getStatus()
    if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
      throw new CalendarSyncError('No active domain.', IpcErrorCode.INVALID_INPUT)
    }
    const domainPath = domainStatus.registeredDomainPath
    const calendarUrl = settings.calendarUrl

    const client = await connect(settings)
    let events = await buildSnapshot(domainPath)
    if (settings.futureOnly) {
      // Keep upcoming events plus the current week. Older events simply drop
      // out of the snapshot, so the diff below DELETEs them remotely — the
      // weekly window slides forward on its own at each periodic sync.
      const cutoff = currentWeekCutoffIso(now())
      events = events.filter((event) => event.date >= cutoff)
    }
    const eventsByUid = new Map(events.map((event) => [event.uid, event]))

    let state = await readStateFile(domainPath)
    if (!state || state.calendarUrl !== calendarUrl) {
      // Missing or retargeted state: reconcile against the remote collection.
      // The "Ordicab" calendar is dedicated to this sync, so any remote object
      // we don't know about is an orphan from a previous state and goes away
      // (deleted locally = deleted remotely).
      const remoteObjects = await client.listObjects(calendarUrl)
      const entries: CalendarSyncStateFile['entries'] = {}
      for (const remote of remoteObjects) {
        const rawUid = remote.uid ?? ''
        // Only objects we created carry the `@ordicab.app` UID suffix. Anything
        // without it is a foreign event (the user may have pointed the sync at a
        // shared/personal calendar) and must NEVER be deleted, even when our
        // local state is missing or retargeted.
        const isOrdicabOwned = /@ordicab\.app$/.test(rawUid)
        const uid = rawUid.replace(/@ordicab\.app$/, '')
        if (isOrdicabOwned && uid && eventsByUid.has(uid)) {
          // Force a re-push: the remote content is of unknown freshness.
          entries[uid] = { href: remote.url, contentHash: '' }
        } else if (isOrdicabOwned) {
          // An orphan we created in a previous session and no longer track.
          await client.deleteObject({ url: remote.url })
        }
      }
      state = { version: 1, calendarUrl, entries, lastSyncAt: null, lastError: null }
    }

    const entries = state.entries
    const toPush: CanonicalCalendarEvent[] = []
    for (const event of events) {
      const entry = entries[event.uid]
      if (!entry || entry.contentHash !== computeEventContentHash(event)) {
        toPush.push(event)
      }
    }
    const toDelete = Object.keys(entries).filter((uid) => !eventsByUid.has(uid))

    const dtstamp = now()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
    const result: CalendarSyncRunResult = { created: 0, updated: 0, deleted: 0, failed: 0 }
    const errors: string[] = []

    await mapWithConcurrency(toPush, PUSH_CONCURRENCY, async (event) => {
      const isUpdate = Boolean(entries[event.uid])
      try {
        const filename = `${event.uid}.ics`
        await client.putObject({
          calendarUrl,
          filename,
          ics: buildIcsObject(event, { dtstamp })
        })
        entries[event.uid] = {
          href: new URL(filename, calendarUrl).href,
          contentHash: computeEventContentHash(event)
        }
        if (isUpdate) result.updated += 1
        else result.created += 1
      } catch (error) {
        result.failed += 1
        errors.push(error instanceof Error ? error.message : String(error))
      }
    })

    await mapWithConcurrency(toDelete, PUSH_CONCURRENCY, async (uid) => {
      try {
        await client.deleteObject({ url: entries[uid]!.href })
        delete entries[uid]
        result.deleted += 1
      } catch (error) {
        result.failed += 1
        errors.push(error instanceof Error ? error.message : String(error))
      }
    })

    const finishedAt = now().toISOString()
    const runError = errors.length > 0 ? errors[0]! : null
    lastSyncAt = finishedAt
    lastError = runError
    await writeStateFile(domainPath, {
      ...state,
      entries,
      lastSyncAt: finishedAt,
      lastError: runError
    })

    if (result.failed > 0) {
      throw new CalendarSyncError(
        `Calendar sync completed with ${result.failed} failure(s): ${runError}`
      )
    }
    return result
  }

  /** Single-flight wrapper: one run at a time, a queued re-run when needed. */
  function executeSync(): Promise<void> {
    if (inProgress) {
      pendingRerun = true
      return inFlight ?? Promise.resolve()
    }
    inProgress = true
    emitStatus()
    inFlight = (async () => {
      try {
        await runSync()
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (isCalDavAuthError(error)) {
          lastError = `Authentication failed — check the CalDAV credentials. (${lastError})`
        }
      } finally {
        inProgress = false
        emitStatus()
      }
      if (pendingRerun && !disposed) {
        pendingRerun = false
        await executeSync()
      }
    })()
    return inFlight
  }

  return {
    getStatus: buildStatus,

    async saveSettings(input) {
      const serverUrl = input.serverUrl.trim().replace(/\/+$/, '')
      const username = input.username.trim()
      if (input.password) {
        await credentialStore.saveSecret(PASSWORD_SECRET_KEY, input.password)
      }
      const password = await credentialStore.getSecret(PASSWORD_SECRET_KEY)
      if (!password) {
        throw new CalendarSyncError('A password is required.', IpcErrorCode.INVALID_INPUT)
      }

      // Verify the credentials and resolve the dedicated calendar right away,
      // so the user gets immediate feedback and no later run has to guess.
      const client = await davClientFactory({ serverUrl, username, password })
      const calendar = await client.findOrCreateCalendar(REMOTE_CALENDAR_NAME)

      const { futureOnly } = await readSettings()
      await writeSettings({
        serverUrl,
        username,
        calendarUrl: calendar.url,
        enabled: true,
        futureOnly
      })
      lastError = null
      emitStatus()
      this.requestSync('change')
      return buildStatus()
    },

    async deleteCredentials() {
      await credentialStore.deleteSecret(PASSWORD_SECRET_KEY)
      await writeSettings({
        serverUrl: null,
        username: null,
        calendarUrl: null,
        enabled: false,
        futureOnly: true
      })
      lastSyncAt = null
      lastError = null
      emitStatus()
      return buildStatus()
    },

    async setOptions(input) {
      const settings = await readSettings()
      const next = {
        ...settings,
        enabled: input.enabled ?? settings.enabled,
        futureOnly: input.futureOnly ?? settings.futureOnly
      }
      await writeSettings(next)
      // Re-sync on any effective change: enabling pushes the backlog, and
      // toggling the window adds (or prunes) the past events remotely.
      if (
        next.enabled &&
        (next.enabled !== settings.enabled || next.futureOnly !== settings.futureOnly)
      ) {
        this.requestSync('change')
      }
      emitStatus()
      return buildStatus()
    },

    async syncNow() {
      if (inProgress) {
        throw new CalendarSyncError('A sync is already running.', IpcErrorCode.INVALID_INPUT)
      }
      inProgress = true
      emitStatus()
      try {
        const result = await runSync()
        return result
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        throw error instanceof CalendarSyncError ? error : new CalendarSyncError(lastError)
      } finally {
        inProgress = false
        emitStatus()
      }
    },

    requestSync(trigger) {
      if (disposed) return
      void readSettings().then((settings) => {
        if (disposed || !settings.enabled || !settings.calendarUrl) return
        // Interval/startup ticks run immediately; change events are debounced
        // so a burst of file writes coalesces into one push.
        if (trigger === 'change') {
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            debounceTimer = null
            void executeSync()
          }, debounceMs)
          debounceTimer.unref?.()
          return
        }
        void executeSync()
      })
    },

    start() {
      if (intervalTimer || disposed) return
      intervalTimer = setInterval(() => {
        this.requestSync('interval')
      }, intervalMs)
      intervalTimer.unref?.()
    },

    async dispose() {
      disposed = true
      pendingRerun = false
      if (debounceTimer) clearTimeout(debounceTimer)
      if (intervalTimer) clearInterval(intervalTimer)
      debounceTimer = null
      intervalTimer = null
      await inFlight?.catch(() => undefined)
    }
  }
}
