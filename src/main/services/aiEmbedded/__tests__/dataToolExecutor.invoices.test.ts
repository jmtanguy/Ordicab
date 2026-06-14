import { describe, expect, it, vi } from 'vitest'

import { DataToolExecutor } from '../dataToolExecutor'

// Minimal stubs — only the surfaces the invoice and dossier data tools touch are populated.
function makeExecutor(invoices: unknown[]): {
  executor: DataToolExecutor
  invoiceService: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }
  dossierService: { getDossier: ReturnType<typeof vi.fn> }
} {
  const invoiceService = {
    list: vi.fn().mockResolvedValue(invoices),
    get: vi
      .fn()
      .mockImplementation(async (uuid: string) =>
        invoices.find((inv) => (inv as { uuid: string }).uuid === uuid)
      )
  }
  const dossierService = {
    getDossier: vi.fn().mockResolvedValue({
      id: 'dos1',
      name: 'Dupont',
      billingItems: [
        {
          id: 'billing-a',
          unitPriceHtCents: 25000,
          totalHtCents: 25000,
          totalTtcCents: 30000,
          status: 'billed'
        },
        {
          id: 'billing-b',
          unitPriceHtCents: 15000,
          totalHtCents: 15000,
          totalTtcCents: 18000,
          status: 'draft'
        }
      ]
    })
  }
  const noop = vi.fn()
  const executor = new DataToolExecutor({
    dossierId: 'dos1',
    dossiers: [
      {
        slug: 'dos1',
        uuid: 'uuid-dos1',
        name: 'Dupont',
        status: 'active',
        type: 'contentieux',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      }
    ],
    contactService: { list: noop, upsert: noop, delete: noop } as never,
    templateService: {
      list: noop,
      getContent: noop,
      create: noop,
      update: noop,
      delete: noop
    } as never,
    documentService: {} as never,
    dossierService: dossierService as never,
    invoiceService: invoiceService as never,
    entityProfile: null
  })
  return { executor, invoiceService, dossierService }
}

const INVOICE_A = {
  uuid: 'inv-a',
  number: 'FAC-2026-001',
  documentType: 'invoice',
  dossierId: 'dos1',
  dossierLabel: 'Dupont',
  clientLabel: 'Jean Dupont',
  issuedAt: '2026-05-12',
  totalTtcCents: 36000,
  totalHtCents: 30000,
  totalVatCents: 6000,
  paidAmountCents: 36000,
  remainingAmountCents: 0,
  status: 'issued',
  paymentStatus: 'paid'
}
const INVOICE_B = { ...INVOICE_A, uuid: 'inv-b', number: 'FAC-2026-002', dossierId: 'dos2' }

describe('DataToolExecutor invoice tools', () => {
  it('invoice_list returns a light summary of all invoices', async () => {
    const { executor } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('invoice_list', {})
    const parsed = JSON.parse(raw)
    expect(parsed.invoices).toHaveLength(2)
    expect(parsed.invoices[0]).toEqual(
      expect.objectContaining({ invoiceUuid: 'inv-a', number: 'FAC-2026-001', status: 'issued' })
    )
  })

  it('invoice_list exposes formatted euro amounts alongside cent fields', async () => {
    const { executor } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_list', { dossierId: 'dos1' })
    const parsed = JSON.parse(raw)

    expect(parsed.invoices[0].totalTtcCents).toBe(36000)
    expect(parsed.invoices[0].totalTtcEuros).toMatch(/^360,00\s€$/)
    expect(parsed.invoices[0].remainingAmountEuros).toMatch(/^0,00\s€$/)
  })

  it('invoice_list filters by dossierId when provided', async () => {
    const { executor } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('invoice_list', { dossierId: 'dos2' })
    const parsed = JSON.parse(raw)
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].invoiceUuid).toBe('inv-b')
  })

  it('invoice_list resolves dossier UUID filters to stored dossier slugs', async () => {
    const { executor } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('invoice_list', { dossierId: 'uuid-dos1' })
    const parsed = JSON.parse(raw)
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].invoiceUuid).toBe('inv-a')
  })

  it('invoice_get returns the full invoice', async () => {
    const { executor, invoiceService } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', { invoiceUuid: 'inv-a' })
    const parsed = JSON.parse(raw)
    expect(invoiceService.get).toHaveBeenCalledWith('inv-a')
    expect(parsed.invoice.uuid).toBe('inv-a')
  })

  it('invoice_get exposes formatted euro amounts for nested invoice data', async () => {
    const invoice = {
      ...INVOICE_A,
      lines: [{ totalHtCents: 30000, totalTtcCents: 36000, unitPriceHtCents: 15000 }],
      payments: [{ amountCents: 36000 }]
    }
    const { executor } = makeExecutor([invoice])
    const raw = await executor.execute('invoice_get', { invoiceUuid: 'inv-a' })
    const parsed = JSON.parse(raw)

    expect(parsed.invoice.totalTtcEuros).toMatch(/^360,00\s€$/)
    expect(parsed.invoice.lines[0].unitPriceHtEuros).toMatch(/^150,00\s€$/)
    expect(parsed.invoice.payments[0].amountEuros).toMatch(/^360,00\s€$/)
  })

  it('dossier_get exposes billing items and dossier invoices with formatted euro amounts', async () => {
    const { executor, dossierService } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('dossier_get', { dossierId: 'dos1' })
    const parsed = JSON.parse(raw)

    expect(dossierService.getDossier).toHaveBeenCalledWith({ dossierId: 'dos1' })
    expect(parsed.dossier.billingItems[0].unitPriceHtCents).toBe(25000)
    expect(parsed.dossier.billingItems[0].unitPriceHtEuros).toMatch(/^250,00\s€$/)
    expect(parsed.dossier.billingItems[0].unitPriceHtDisplay).toMatch(/^250,00\s€$/)
    expect(parsed.dossier.billingItems[0].totalTtcEuros).toMatch(/^300,00\s€$/)
    expect(parsed.dossier.billingItems[0].totalVatDisplay).toMatch(/^50,00\s€$/)
    expect(parsed.dossier.invoices).toHaveLength(1)
    expect(parsed.dossier.invoices[0].uuid).toBe('inv-a')
    expect(parsed.dossier.invoices[0].totalTtcEuros).toMatch(/^360,00\s€$/)
    expect(parsed.dossier.financialSummary.billingItems.byStatus.draft.totalHtCents).toBe(15000)
    expect(parsed.dossier.financialSummary.billingItems.byStatus.billed.totalTtcCents).toBe(30000)
    expect(parsed.dossier.financialSummary.invoices.totals.totalHtCents).toBe(30000)
    expect(parsed.dossier.financialSummary.invoices.totals.totalVatDisplay).toMatch(/^60,00\s€$/)
    expect(parsed.dossier.financialSummary.totals.invoicedHtCents).toBe(30000)
    expect(parsed.dossier.financialSummary.totals.remainingAmountDisplay).toMatch(/^0,00\s€$/)
  })

  it('invoice_get reports an error for an unknown invoice', async () => {
    const { executor } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', { invoiceUuid: 'missing' })
    const parsed = JSON.parse(raw)
    expect(parsed.error).toContain('missing')
  })

  it('invoice_get requires an invoiceUuid', async () => {
    const { executor } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', {})
    const parsed = JSON.parse(raw)
    expect(parsed.error).toBe('invoiceUuid is required.')
  })
})
