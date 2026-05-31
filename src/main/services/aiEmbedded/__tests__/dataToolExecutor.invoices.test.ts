import { describe, expect, it, vi } from 'vitest'

import { DataToolExecutor } from '../dataToolExecutor'

// Minimal stubs — only the surfaces the invoice data tools touch are populated.
// The executor never reaches the other services for invoice_list / invoice_get.
function makeExecutor(invoices: unknown[]): {
  executor: DataToolExecutor
  invoiceService: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }
} {
  const invoiceService = {
    list: vi.fn().mockResolvedValue(invoices),
    get: vi
      .fn()
      .mockImplementation(async (id: string) =>
        invoices.find((inv) => (inv as { id: string }).id === id)
      )
  }
  const noop = vi.fn()
  const executor = new DataToolExecutor({
    dossierId: null,
    dossiers: [],
    contactService: { list: noop, upsert: noop, delete: noop } as never,
    templateService: {
      list: noop,
      getContent: noop,
      create: noop,
      update: noop,
      delete: noop
    } as never,
    documentService: {} as never,
    dossierService: {} as never,
    invoiceService: invoiceService as never,
    entityProfile: null
  })
  return { executor, invoiceService }
}

const INVOICE_A = {
  id: 'inv-a',
  number: 'FAC-2026-001',
  documentType: 'invoice',
  dossierId: 'dos1',
  dossierLabel: 'Dupont',
  clientLabel: 'Jean Dupont',
  issuedAt: '2026-05-12',
  totalTtcCents: 36000,
  remainingAmountCents: 0,
  status: 'issued',
  paymentStatus: 'paid'
}
const INVOICE_B = { ...INVOICE_A, id: 'inv-b', number: 'FAC-2026-002', dossierId: 'dos2' }

describe('DataToolExecutor invoice tools', () => {
  it('invoice_list returns a light summary of all invoices', async () => {
    const { executor } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('invoice_list', {})
    const parsed = JSON.parse(raw)
    expect(parsed.invoices).toHaveLength(2)
    expect(parsed.invoices[0]).toEqual(
      expect.objectContaining({ invoiceId: 'inv-a', number: 'FAC-2026-001', status: 'issued' })
    )
  })

  it('invoice_list filters by dossierId when provided', async () => {
    const { executor } = makeExecutor([INVOICE_A, INVOICE_B])
    const raw = await executor.execute('invoice_list', { dossierId: 'dos2' })
    const parsed = JSON.parse(raw)
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].invoiceId).toBe('inv-b')
  })

  it('invoice_get returns the full invoice', async () => {
    const { executor, invoiceService } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', { invoiceId: 'inv-a' })
    const parsed = JSON.parse(raw)
    expect(invoiceService.get).toHaveBeenCalledWith('inv-a')
    expect(parsed.invoice.id).toBe('inv-a')
  })

  it('invoice_get reports an error for an unknown invoice', async () => {
    const { executor } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', { invoiceId: 'missing' })
    const parsed = JSON.parse(raw)
    expect(parsed.error).toContain('missing')
  })

  it('invoice_get requires an invoiceId', async () => {
    const { executor } = makeExecutor([INVOICE_A])
    const raw = await executor.execute('invoice_get', {})
    const parsed = JSON.parse(raw)
    expect(parsed.error).toBe('invoiceId is required.')
  })
})
