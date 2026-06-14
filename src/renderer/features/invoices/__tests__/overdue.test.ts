import { describe, expect, it } from 'vitest'

import { computeOverdueInfo } from '../overdue'

const TODAY = new Date('2026-06-11T10:30:00')

describe('computeOverdueInfo', () => {
  it('reports the number of days overdue for an issued invoice past its due date', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: '2026-06-01' }, TODAY)).toEqual({
      daysOverdue: 10
    })
  })

  it('reports one day overdue the day after the due date', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: '2026-06-10' }, TODAY)).toEqual({
      daysOverdue: 1
    })
  })

  it('handles partially paid invoices', () => {
    expect(computeOverdueInfo({ status: 'partiallyPaid', dueAt: '2026-05-12' }, TODAY)).toEqual({
      daysOverdue: 30
    })
  })

  it('accepts full ISO timestamps for the due date', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: '2026-06-08T09:00:00' }, TODAY)).toEqual({
      daysOverdue: 3
    })
  })

  it('returns null when the invoice is due today', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: '2026-06-11' }, TODAY)).toBeNull()
  })

  it('returns null when the due date is in the future', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: '2026-06-20' }, TODAY)).toBeNull()
  })

  it('returns null when there is no due date', () => {
    expect(computeOverdueInfo({ status: 'issued' }, TODAY)).toBeNull()
  })

  it('returns null for settled or inactive statuses', () => {
    for (const status of ['paid', 'overpaid', 'cancelled', 'corrected'] as const) {
      expect(computeOverdueInfo({ status, dueAt: '2026-06-01' }, TODAY)).toBeNull()
    }
  })

  it('returns null for an unparseable due date', () => {
    expect(computeOverdueInfo({ status: 'issued', dueAt: 'not-a-date' }, TODAY)).toBeNull()
  })
})
