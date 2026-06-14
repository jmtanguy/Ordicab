import { createHash } from 'node:crypto'

/**
 * Minimal RFC 5545 (iCalendar) serializer for the one-way CalDAV push.
 *
 * Ordicab events are simple — single occurrence, all-day or timed with a
 * duration, no recurrence, no attendees — so a hand-rolled serializer keeps
 * the output deterministic (required for the content-hash diff) and fully
 * unit-testable, instead of pulling in an ical library with its timezone
 * plugin story.
 */

export interface CanonicalCalendarEvent {
  /** keyDate uuid — becomes the stable iCalendar UID. */
  uid: string
  summary: string
  allDay: boolean
  /** ISO date YYYY-MM-DD (wall-clock local date for timed events). */
  date: string
  /** HH:MM, present only when allDay is false. */
  time?: string
  /** Minutes; ignored for all-day events. */
  durationMinutes: number
  description?: string
  /** Closed or cancelled events stay visible but struck through on phones. */
  cancelled: boolean
}

const PROD_ID = '-//Ordicab//Calendar Sync//FR'
const MAX_LINE_OCTETS = 75

/** RFC 5545 §3.3.11 TEXT escaping. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * RFC 5545 §3.1 line folding: content lines longer than 75 octets are split,
 * each continuation line starting with a single space. Splits happen on
 * character boundaries so multi-byte UTF-8 sequences are never cut.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line

  const parts: string[] = []
  let current = ''
  // Continuation lines carry a leading space that counts toward the limit.
  let budget = MAX_LINE_OCTETS
  for (const char of line) {
    const charOctets = encoder.encode(char).length
    if (encoder.encode(current).length + charOctets > budget) {
      parts.push(current)
      current = ''
      budget = MAX_LINE_OCTETS - 1
    }
    current += char
  }
  if (current) parts.push(current)
  return parts.join('\r\n ')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** YYYY-MM-DD → YYYYMMDD. */
function toIcsDate(date: string): string {
  return date.replace(/-/g, '')
}

/** Day after a YYYY-MM-DD date, as YYYYMMDD (all-day DTEND is exclusive). */
function nextDayIcsDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1))
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`
}

/** A local wall-clock date+time rendered as a UTC iCalendar DATE-TIME (…Z). */
function toIcsUtcDateTime(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

/**
 * Interpret the event's date+time in the system timezone. Emitting UTC keeps
 * the output RFC-valid without any VTIMEZONE component, and stays DST-correct
 * because the conversion happens per event date.
 */
function timedEventStart(event: CanonicalCalendarEvent): Date {
  const [year, month, day] = event.date.split('-').map(Number)
  const [hours, minutes] = (event.time ?? '00:00').split(':').map(Number)
  return new Date(year!, month! - 1, day!, hours!, minutes!, 0, 0)
}

export function buildIcsObject(event: CanonicalCalendarEvent, opts: { dtstamp: string }): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PROD_ID}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid}@ordicab.app`,
    `DTSTAMP:${opts.dtstamp}`
  ]

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(event.date)}`)
    lines.push(`DTEND;VALUE=DATE:${nextDayIcsDate(event.date)}`)
  } else {
    const start = timedEventStart(event)
    const end = new Date(start.getTime() + event.durationMinutes * 60_000)
    lines.push(`DTSTART:${toIcsUtcDateTime(start)}`)
    lines.push(`DTEND:${toIcsUtcDateTime(end)}`)
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`)
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  }
  lines.push(`STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/**
 * Change-detection hash for the sync diff. Hashes the canonical event fields,
 * NOT the serialized ICS — DTSTAMP changes on every serialization and would
 * make every event look modified on every run.
 */
export function computeEventContentHash(event: CanonicalCalendarEvent): string {
  const canonical = JSON.stringify([
    event.uid,
    event.summary,
    event.allDay,
    event.date,
    event.time ?? null,
    event.allDay ? null : event.durationMinutes,
    event.description ?? null,
    event.cancelled
  ])
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}
