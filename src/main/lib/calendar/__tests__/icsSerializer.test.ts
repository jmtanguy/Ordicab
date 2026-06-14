import { describe, expect, it } from 'vitest'

import {
  buildIcsObject,
  computeEventContentHash,
  type CanonicalCalendarEvent
} from '../icsSerializer'

const DTSTAMP = '20260612T100000Z'

function baseEvent(overrides: Partial<CanonicalCalendarEvent> = {}): CanonicalCalendarEvent {
  return {
    uid: 'abc-123',
    summary: 'Audience de plaidoirie',
    allDay: false,
    date: '2026-06-18',
    time: '14:00',
    durationMinutes: 90,
    cancelled: false,
    ...overrides
  }
}

describe('buildIcsObject', () => {
  it('serializes a timed event with UTC start and computed end', () => {
    const ics = buildIcsObject(baseEvent(), { dtstamp: DTSTAMP })

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('UID:abc-123@ordicab.app')
    expect(ics).toContain(`DTSTAMP:${DTSTAMP}`)
    expect(ics).toContain('SUMMARY:Audience de plaidoirie')
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)

    // 14:00 local rendered in UTC; the end is start + 90 minutes regardless
    // of the host timezone.
    const start = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)?.[1]
    const end = ics.match(/DTEND:(\d{8}T\d{6}Z)/)?.[1]
    expect(start).toBeDefined()
    expect(end).toBeDefined()
    const parse = (value: string): number =>
      Date.parse(
        `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
      )
    expect(parse(end!) - parse(start!)).toBe(90 * 60_000)
    expect(parse(start!)).toBe(new Date(2026, 5, 18, 14, 0, 0).getTime())
  })

  it('serializes an all-day event with an exclusive DTEND on the next day', () => {
    const ics = buildIcsObject(baseEvent({ allDay: true, time: undefined, date: '2026-12-31' }), {
      dtstamp: DTSTAMP
    })

    expect(ics).toContain('DTSTART;VALUE=DATE:20261231')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
    expect(ics).not.toContain('DTSTART:2026')
  })

  it('marks closed events as cancelled', () => {
    const ics = buildIcsObject(baseEvent({ cancelled: true }), { dtstamp: DTSTAMP })
    expect(ics).toContain('STATUS:CANCELLED')
  })

  it('escapes RFC 5545 special characters in text fields', () => {
    const ics = buildIcsObject(
      baseEvent({
        summary: 'Audience; salle 3, bât. B',
        description: 'Ligne 1\nLigne 2 \\ fin'
      }),
      { dtstamp: DTSTAMP }
    )

    expect(ics).toContain('SUMMARY:Audience\\; salle 3\\, bât. B')
    expect(ics).toContain('DESCRIPTION:Ligne 1\\nLigne 2 \\\\ fin')
  })

  it('folds content lines longer than 75 octets without splitting UTF-8 chars', () => {
    const ics = buildIcsObject(baseEvent({ summary: 'é'.repeat(120) }), { dtstamp: DTSTAMP })

    const encoder = new TextEncoder()
    for (const line of ics.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    }
    // Unfolding (strip CRLF + leading space) restores the full summary.
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain(`SUMMARY:${'é'.repeat(120)}`)
  })
})

describe('computeEventContentHash', () => {
  it('is stable across serializations (independent of DTSTAMP)', () => {
    const event = baseEvent()
    expect(computeEventContentHash(event)).toBe(computeEventContentHash({ ...event }))
  })

  it('changes when a meaningful field changes', () => {
    const event = baseEvent()
    expect(computeEventContentHash(event)).not.toBe(
      computeEventContentHash({ ...event, time: '15:00' })
    )
    expect(computeEventContentHash(event)).not.toBe(
      computeEventContentHash({ ...event, cancelled: true })
    )
  })

  it('ignores duration for all-day events', () => {
    const event = baseEvent({ allDay: true, time: undefined })
    expect(computeEventContentHash({ ...event, durationMinutes: 30 })).toBe(
      computeEventContentHash({ ...event, durationMinutes: 60 })
    )
  })
})
