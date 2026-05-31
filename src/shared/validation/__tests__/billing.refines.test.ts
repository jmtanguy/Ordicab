import { describe, expect, it } from 'vitest'

import {
  dossierBillingItemUpsertInputSchema,
  dossierFeeAgreementUpsertInputSchema
} from '../billing'

const dossierId = '00000000-0000-4000-8000-000000000001'

function feeAgreementBase(): Record<string, unknown> {
  return {
    dossierId,
    status: 'draft',
    matterLabel: 'Conseil juridique',
    scopeDescription: 'Analyse contractuelle',
    billingType: 'flat',
    flatFeeHtCents: 100_000,
    vatRateBasisPoints: 2000
  }
}

function billingItemBase(): Record<string, unknown> {
  return {
    dossierId,
    date: '2026-05-01',
    label: 'Consultation',
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: 12_000,
    vatRateBasisPoints: 2000,
    status: 'draft'
  }
}

describe('dossierFeeAgreementUpsertInputSchema — discount XOR refine', () => {
  it('accepts no discount when all discount fields are undefined', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse(feeAgreementBase())
    expect(result.success).toBe(true)
  })

  it('accepts a percent discount with only discountPercentBasisPoints set', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...feeAgreementBase(),
      discountKind: 'percent',
      discountPercentBasisPoints: 1000
    })
    expect(result.success).toBe(true)
  })

  it('accepts an amount discount with only discountAmountHtCents set', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...feeAgreementBase(),
      discountKind: 'amount',
      discountAmountHtCents: 5000
    })
    expect(result.success).toBe(true)
  })

  it('rejects percent kind with a discountAmountHtCents leak', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...feeAgreementBase(),
      discountKind: 'percent',
      discountPercentBasisPoints: 1000,
      discountAmountHtCents: 5000
    })
    expect(result.success).toBe(false)
  })

  it('rejects amount kind with a discountPercentBasisPoints leak', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...feeAgreementBase(),
      discountKind: 'amount',
      discountAmountHtCents: 5000,
      discountPercentBasisPoints: 1000
    })
    expect(result.success).toBe(false)
  })

  it('rejects undefined kind with a residual discount value', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...feeAgreementBase(),
      discountPercentBasisPoints: 1000
    })
    expect(result.success).toBe(false)
  })
})

describe('dossierBillingItemUpsertInputSchema — source XOR refine', () => {
  it('accepts a manual billing item with no source', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse(billingItemBase())
    expect(result.success).toBe(true)
  })

  it('accepts a billing item sourced from a key date only', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse({
      ...billingItemBase(),
      sourceKeyDateId: 'kd-123'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a billing item sourced from a fee agreement with billing kind', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse({
      ...billingItemBase(),
      sourceFeeAgreementId: 'fa-123',
      sourceFeeAgreementBillingKind: 'retainer'
    })
    expect(result.success).toBe(true)
  })

  it('rejects a billing item referencing both a key date and a fee agreement', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse({
      ...billingItemBase(),
      sourceKeyDateId: 'kd-123',
      sourceFeeAgreementId: 'fa-123'
    })
    expect(result.success).toBe(false)
  })

  it('rejects sourceFeeAgreementBillingKind without a sourceFeeAgreementId', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse({
      ...billingItemBase(),
      sourceFeeAgreementBillingKind: 'finalBalance'
    })
    expect(result.success).toBe(false)
  })

  it('rejects an inconsistent discount on a billing item upsert', () => {
    const result = dossierBillingItemUpsertInputSchema.safeParse({
      ...billingItemBase(),
      discountKind: 'percent',
      discountAmountHtCents: 5000
    })
    expect(result.success).toBe(false)
  })
})
