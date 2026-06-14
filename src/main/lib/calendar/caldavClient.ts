import { DAVClient, type DAVCalendar } from 'tsdav'

/**
 * Thin wrapper around tsdav exposing exactly what the one-way push sync
 * needs. tsdav earns its place by handling RFC 6764 discovery (well-known →
 * principal → calendar-home-set), which varies across iCloud, Nextcloud and
 * Fastmail; the actual object operations are plain PUT/DELETE/REPORT.
 */

class CalDavRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'CalDavRequestError'
  }
}

export function isCalDavAuthError(error: unknown): boolean {
  return error instanceof CalDavRequestError && (error.status === 401 || error.status === 403)
}

export interface RemoteCalendarObjectRef {
  url: string
  /** UID parsed from the object's iCalendar payload, null when unreadable. */
  uid: string | null
}

export interface CalDavClientLike {
  /**
   * Find the calendar collection named `displayName` in the account, creating
   * it (MKCALENDAR) when absent. Returns the collection URL (trailing slash).
   */
  findOrCreateCalendar(displayName: string): Promise<{ url: string }>
  /** Unconditional PUT — the remote calendar is a mirror, phone edits lose. */
  putObject(input: { calendarUrl: string; filename: string; ics: string }): Promise<void>
  /** DELETE; a 404 (already gone) counts as success. */
  deleteObject(input: { url: string }): Promise<void>
  /** List every event object in the collection (used by the reconcile pass). */
  listObjects(calendarUrl: string): Promise<RemoteCalendarObjectRef[]>
}

function displayNameOf(calendar: DAVCalendar): string {
  return typeof calendar.displayName === 'string' ? calendar.displayName : ''
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

async function assertResponseOk(response: Response, action: string): Promise<void> {
  if (response.ok) return
  throw new CalDavRequestError(`${action} failed: HTTP ${response.status}`, response.status)
}

function parseUid(icsData: unknown): string | null {
  if (typeof icsData !== 'string') return null
  const match = icsData.match(/^UID:(.+)$/m)
  return match ? match[1]!.trim() : null
}

export async function createCalDavClient(options: {
  serverUrl: string
  username: string
  password: string
}): Promise<CalDavClientLike> {
  const client = new DAVClient({
    serverUrl: options.serverUrl,
    credentials: { username: options.username, password: options.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  })

  try {
    await client.login()
  } catch (error) {
    // tsdav surfaces auth failures as generic errors; normalise the common
    // "Invalid credentials" shape so the service can tell auth from network.
    const message = error instanceof Error ? error.message : String(error)
    throw new CalDavRequestError(
      /invalid credentials|401|403/i.test(message)
        ? `CalDAV authentication failed: ${message}`
        : `CalDAV connection failed: ${message}`,
      /invalid credentials|401|403/i.test(message) ? 401 : undefined
    )
  }

  return {
    async findOrCreateCalendar(displayName) {
      const calendars = await client.fetchCalendars()
      const existing = calendars.find(
        (calendar) => displayNameOf(calendar).toLowerCase() === displayName.toLowerCase()
      )
      if (existing) {
        return { url: ensureTrailingSlash(existing.url) }
      }

      const homeUrl = client.account?.homeUrl
      if (!homeUrl) {
        throw new CalDavRequestError('CalDAV account has no calendar home.')
      }
      const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const url = `${ensureTrailingSlash(homeUrl)}${slug}/`
      await client.makeCalendar({
        url,
        props: { displayname: displayName }
      })
      // Re-fetch instead of trusting the MKCALENDAR response: some servers
      // (iCloud) normalise the collection URL they actually created.
      const refreshed = await client.fetchCalendars()
      const created = refreshed.find(
        (calendar) => displayNameOf(calendar).toLowerCase() === displayName.toLowerCase()
      )
      if (!created) {
        throw new CalDavRequestError(`Unable to create the "${displayName}" calendar.`)
      }
      return { url: ensureTrailingSlash(created.url) }
    },

    async putObject({ calendarUrl, filename, ics }) {
      // Unconditional PUT (create-or-replace). tsdav's createCalendarObject
      // sends `If-None-Match: *` and would 412 on updates; updateObject
      // without an etag sends no precondition at all — the mirror semantics
      // we want (phone edits are overwritten by design).
      const response = await client.updateObject({
        url: new URL(filename, ensureTrailingSlash(calendarUrl)).href,
        data: ics,
        headers: { 'content-type': 'text/calendar; charset=utf-8' }
      })
      await assertResponseOk(response, `PUT ${filename}`)
    },

    async deleteObject({ url }) {
      const response = await client.deleteObject({ url })
      if (response.status === 404) return
      await assertResponseOk(response, `DELETE ${url}`)
    },

    async listObjects(calendarUrl) {
      const objects = await client.fetchCalendarObjects({
        calendar: { url: calendarUrl } as DAVCalendar
      })
      return objects.map((object) => ({
        url: object.url,
        uid: parseUid(object.data)
      }))
    }
  }
}
