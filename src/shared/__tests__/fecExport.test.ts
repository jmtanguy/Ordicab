import { describe, expect, it } from 'vitest'

import type { InvoiceRecord } from '@shared/domain/invoice'
import { buildFecExport, FEC_COLUMNS } from '@shared/domain/fecExport'

function makeInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    uuid: 'inv-1',
    documentType: 'invoice',
    number: 'FAC-2026-0001',
    sequenceYear: 2026,
    sequenceValue: 1,
    issuedAt: '2026-03-15',
    dossierId: 'dossier-1',
    dossierLabel: 'Dossier A',
    clientContactUuid: 'client-1',
    clientLabel: 'Société Test',
    templateUuid: 'tpl-1',
    totalHtCents: 100000,
    totalVatCents: 20000,
    totalTtcCents: 120000,
    vatBreakdown: [
      { vatRateBasisPoints: 2000, taxableHtCents: 100000, vatCents: 20000, totalTtcCents: 120000 }
    ],
    status: 'issued',
    paymentStatus: 'pending',
    paidAmountCents: 0,
    remainingAmountCents: 120000,
    payments: [],
    originalInvoiceRefs: [],
    lines: [],
    createdAt: '2026-03-15T10:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z',
    ...overrides
  } as InvoiceRecord
}

function parse(fec: string): { header: string[]; rows: string[][] } {
  const [header, ...rows] = fec.split('\r\n').map((line) => line.split('\t'))
  return { header: header!, rows }
}

describe('buildFecExport', () => {
  it('emits the 18 mandatory columns as the header', () => {
    const { header } = parse(buildFecExport([makeInvoice()]))
    expect(header).toEqual([...FEC_COLUMNS])
    expect(header).toHaveLength(18)
  })

  it('produces a balanced écriture (sum of debits equals sum of credits) per invoice', () => {
    const { rows } = parse(buildFecExport([makeInvoice()]))
    const debit = rows.reduce((acc, r) => acc + Number(r[11]!.replace(',', '.')), 0)
    const credit = rows.reduce((acc, r) => acc + Number(r[12]!.replace(',', '.')), 0)
    expect(debit).toBeCloseTo(credit, 2)
    expect(debit).toBeCloseTo(1200, 2) // TTC 1200,00 on the receivable side
  })

  it('debits the client for TTC and credits revenue (HT) + VAT for a normal invoice', () => {
    const { rows } = parse(buildFecExport([makeInvoice()]))
    const client = rows.find((r) => r[4] === '411000')!
    const revenue = rows.find((r) => r[4] === '706000')!
    const vat = rows.find((r) => r[4] === '445710')!
    expect(client[11]).toBe('1200,00') // Debit
    expect(client[12]).toBe('0,00') // Credit
    expect(revenue[12]).toBe('1000,00') // Credit HT
    expect(vat[12]).toBe('200,00') // Credit VAT
  })

  it('swaps debit/credit for a credit note (avoir) without using negative amounts', () => {
    const avoir = makeInvoice({ documentType: 'creditNote', number: 'AV-2026-0001' })
    const { rows } = parse(buildFecExport([avoir]))
    const client = rows.find((r) => r[4] === '411000')!
    const revenue = rows.find((r) => r[4] === '706000')!
    expect(client[12]).toBe('1200,00') // Credit client on an avoir
    expect(revenue[11]).toBe('1000,00') // Debit revenue
    expect(rows.every((r) => !r[11]!.includes('-') && !r[12]!.includes('-'))).toBe(true)
  })

  it('orders entries chronologically and numbers each écriture sequentially', () => {
    const later = makeInvoice({ uuid: 'b', number: 'FAC-2026-0002', issuedAt: '2026-04-01' })
    const earlier = makeInvoice({ uuid: 'a', number: 'FAC-2026-0001', issuedAt: '2026-03-15' })
    const { rows } = parse(buildFecExport([later, earlier]))
    expect(rows[0]![3]).toBe('20260315') // EcritureDate of the first emitted entry
    expect(rows[0]![2]).toBe('1') // EcritureNum
    const secondEntry = rows.find((r) => r[3] === '20260401')!
    expect(secondEntry[2]).toBe('2')
  })

  it('omits the VAT line for a VAT-exempt invoice (e.g. state retribution / AJ)', () => {
    const exempt = makeInvoice({
      totalVatCents: 0,
      totalTtcCents: 100000,
      vatBreakdown: [
        { vatRateBasisPoints: 0, taxableHtCents: 100000, vatCents: 0, totalTtcCents: 100000 }
      ]
    })
    const { rows } = parse(buildFecExport([exempt]))
    expect(rows.some((r) => r[4] === '445710')).toBe(false)
    const debit = rows.reduce((acc, r) => acc + Number(r[11]!.replace(',', '.')), 0)
    const credit = rows.reduce((acc, r) => acc + Number(r[12]!.replace(',', '.')), 0)
    expect(debit).toBeCloseTo(credit, 2)
  })

  it('honours custom account numbers', () => {
    const { rows } = parse(buildFecExport([makeInvoice()], { revenueAccount: '706100' }))
    expect(rows.some((r) => r[4] === '706100')).toBe(true)
  })
})
