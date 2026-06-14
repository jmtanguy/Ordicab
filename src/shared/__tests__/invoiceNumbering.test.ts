import { describe, expect, it } from 'vitest'

import { DEFAULT_INVOICE_SETTINGS } from '@shared/domain/invoice'
import {
  consumeNextInvoiceNumber,
  formatInvoiceNumber,
  InvoicePatternError,
  previewInvoiceNumber
} from '@shared/domain/invoiceNumbering'

describe('invoiceNumbering.formatInvoiceNumber', () => {
  it('replaces tokens YYYY, YY, MM, DD and SEQ with padding', () => {
    expect(
      formatInvoiceNumber('FAC-{YYYY}-{MM}-{DD}-{SEQ}', {
        sequence: 7,
        sequencePadding: 4,
        date: new Date(2026, 4, 9)
      })
    ).toBe('FAC-2026-05-09-0007')
  })

  it('supports YY token', () => {
    expect(
      formatInvoiceNumber('{YY}/{SEQ}', {
        sequence: 12,
        sequencePadding: 3,
        date: new Date(2026, 0, 1)
      })
    ).toBe('26/012')
  })

  it('throws when {SEQ} is missing', () => {
    expect(() =>
      formatInvoiceNumber('FAC-{YYYY}', {
        sequence: 1,
        sequencePadding: 4,
        date: new Date(2026, 0, 1)
      })
    ).toThrow(InvoicePatternError)
  })

  it('clamps padding to a reasonable range', () => {
    expect(
      formatInvoiceNumber('{SEQ}', {
        sequence: 1,
        sequencePadding: 0,
        date: new Date(2026, 0, 1)
      })
    ).toBe('1')
  })
})

describe('invoiceNumbering.consumeNextInvoiceNumber', () => {
  it('increments the sequence and keeps the same year', () => {
    const settings = {
      ...DEFAULT_INVOICE_SETTINGS,
      nextSequence: 5,
      currentSequenceYear: 2026
    }
    const result = consumeNextInvoiceNumber(settings, new Date(2026, 5, 1))
    expect(result.number).toBe('FAC-2026-0005')
    expect(result.sequenceValue).toBe(5)
    expect(result.sequenceYear).toBe(2026)
    expect(result.nextSettings.nextSequence).toBe(6)
    expect(result.nextSettings.currentSequenceYear).toBe(2026)
  })

  it('resets the sequence when year changes and reset is enabled', () => {
    const settings = {
      ...DEFAULT_INVOICE_SETTINGS,
      nextSequence: 42,
      currentSequenceYear: 2025,
      resetSequenceYearly: true
    }
    const result = consumeNextInvoiceNumber(settings, new Date(2026, 0, 2))
    expect(result.sequenceValue).toBe(1)
    expect(result.number).toBe('FAC-2026-0001')
    expect(result.nextSettings.nextSequence).toBe(2)
    expect(result.nextSettings.currentSequenceYear).toBe(2026)
  })

  it('keeps incrementing across years when reset is disabled', () => {
    const settings = {
      ...DEFAULT_INVOICE_SETTINGS,
      nextSequence: 42,
      currentSequenceYear: 2025,
      resetSequenceYearly: false
    }
    const result = consumeNextInvoiceNumber(settings, new Date(2026, 0, 2))
    expect(result.sequenceValue).toBe(42)
    expect(result.nextSettings.nextSequence).toBe(43)
  })

  it('never reuses an issued number when the counter is stale (floor wins)', () => {
    // Counter says 5 but number 9 was already issued (e.g. crash before the
    // counter advanced, or a manually lowered nextSequence). The floor forces
    // the next number past the highest issued one.
    const settings = { ...DEFAULT_INVOICE_SETTINGS, nextSequence: 5, currentSequenceYear: 2026 }
    const result = consumeNextInvoiceNumber(settings, new Date(2026, 5, 1), 10)
    expect(result.sequenceValue).toBe(10)
    expect(result.nextSettings.nextSequence).toBe(11)
  })

  it('ignores the floor when the counter is already ahead of it', () => {
    const settings = { ...DEFAULT_INVOICE_SETTINGS, nextSequence: 20, currentSequenceYear: 2026 }
    const result = consumeNextInvoiceNumber(settings, new Date(2026, 5, 1), 10)
    expect(result.sequenceValue).toBe(20)
  })
})

describe('invoiceNumbering.previewInvoiceNumber', () => {
  it('returns the next number without mutating settings', () => {
    const settings = { ...DEFAULT_INVOICE_SETTINGS, nextSequence: 3, currentSequenceYear: 2026 }
    expect(previewInvoiceNumber(settings, new Date(2026, 1, 1))).toBe('FAC-2026-0003')
    expect(settings.nextSequence).toBe(3)
  })
})
