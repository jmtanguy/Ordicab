import { describe, expect, it } from 'vitest'

import { DEFAULT_REMINDER_PREFERENCES, type ReminderPreferences } from '@shared/types'

import {
  countUpcomingWithin,
  daysUntilEvent,
  scanDueReminders,
  type ReminderScanEntry
} from '../reminderScan'

const NOW = new Date('2026-06-06T09:00:00Z')

function entry(
  overrides: Partial<ReminderScanEntry['keyDate']> & { date: string },
  dossier = 'Dossier A',
  dossierId = 'dos-1'
): ReminderScanEntry {
  return {
    dossierId,
    dossierName: dossier,
    keyDate: {
      uuid: `kd-${overrides.date}`,
      label: 'Audience',
      date: overrides.date,
      tags: overrides.tags,
      isClosed: overrides.isClosed,
      time: overrides.time
    }
  }
}

const prefs = (overrides: Partial<ReminderPreferences> = {}): ReminderPreferences => ({
  ...DEFAULT_REMINDER_PREFERENCES,
  ...overrides
})

describe('daysUntilEvent', () => {
  it('returns 0 for today, 1 for tomorrow, 7 for a week out', () => {
    expect(daysUntilEvent('2026-06-06', NOW)).toBe(0)
    expect(daysUntilEvent('2026-06-07', NOW)).toBe(1)
    expect(daysUntilEvent('2026-06-13', NOW)).toBe(7)
  })

  it('returns negative for past dates', () => {
    expect(daysUntilEvent('2026-06-05', NOW)).toBe(-1)
  })

  it('is DST-proof across a spring-forward boundary', () => {
    // Late-evening local "now" must still count the next calendar day as +1.
    const lateNow = new Date('2026-03-28T22:30:00Z')
    expect(daysUntilEvent('2026-03-29', lateNow)).toBe(1)
  })
})

describe('scanDueReminders', () => {
  it('fires on exact lead-day thresholds only', () => {
    const entries = [
      entry({ date: '2026-06-13' }), // J-7
      entry({ date: '2026-06-09' }), // J-3 (not an enabled bucket here)
      entry({ date: '2026-06-07' }), // J-1
      entry({ date: '2026-06-06' }) // day-of
    ]
    const due = scanDueReminders(entries, prefs({ leadDays: [7, 1, 0] }), NOW)
    expect(due.map((d) => d.daysUntil).sort((a, b) => a - b)).toEqual([0, 1, 7])
  })

  it('returns nothing when disabled', () => {
    const due = scanDueReminders([entry({ date: '2026-06-06' })], prefs({ enabled: false }), NOW)
    expect(due).toEqual([])
  })

  it('skips closed, cancelled and postponed key dates', () => {
    const entries = [
      entry({ date: '2026-06-06', isClosed: true }),
      entry({ date: '2026-06-06', tags: ['cancelled'] }),
      entry({ date: '2026-06-06', tags: ['postponed'] })
    ]
    expect(scanDueReminders(entries, prefs(), NOW)).toEqual([])
  })

  it('skips past dates', () => {
    expect(scanDueReminders([entry({ date: '2026-06-01' })], prefs(), NOW)).toEqual([])
  })

  it('honours trigger-tag filtering', () => {
    const entries = [
      entry({ date: '2026-06-06', tags: ['urgent'] }),
      entry({ date: '2026-06-06', tags: ['important'] })
    ]
    const due = scanDueReminders(entries, prefs({ triggerTags: ['urgent'] }), NOW)
    expect(due).toHaveLength(1)
    expect(due[0]!.keyDateUuid).toBe(entries[0]!.keyDate.uuid)
  })

  it('produces a stable per-day dedupe key', () => {
    const due = scanDueReminders([entry({ date: '2026-06-06' })], prefs({ leadDays: [0] }), NOW)
    expect(due[0]!.dedupeKey).toBe('dos-1:kd-2026-06-06:0:2026-06-06')
  })
})

describe('countUpcomingWithin', () => {
  it('counts upcoming dates inside the window and breaks out today/tomorrow', () => {
    const entries = [
      entry({ date: '2026-06-06' }), // today
      entry({ date: '2026-06-07' }), // tomorrow
      entry({ date: '2026-06-12' }), // within 7
      entry({ date: '2026-06-20' }), // outside 7
      entry({ date: '2026-06-01' }) // past
    ]
    const summary = countUpcomingWithin(entries, prefs(), NOW, 7)
    expect(summary).toEqual({ total: 3, today: 1, tomorrow: 1 })
  })
})
