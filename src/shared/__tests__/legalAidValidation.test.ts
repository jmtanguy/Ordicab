import { describe, expect, it } from 'vitest'

import { dossierLegalAidSchema } from '@shared/validation/dossier'
import { dossierFeeAgreementUpsertInputSchema } from '@shared/validation/billing'

describe('dossierLegalAidSchema', () => {
  it('requires a type when the status is granted', () => {
    const result = dossierLegalAidSchema.safeParse({ status: 'granted' })
    expect(result.success).toBe(false)
  })

  it('requires a share for partial legal aid', () => {
    const result = dossierLegalAidSchema.safeParse({ status: 'granted', type: 'partial' })
    expect(result.success).toBe(false)
  })

  it('accepts a complete partial legal aid record', () => {
    const result = dossierLegalAidSchema.safeParse({
      status: 'granted',
      type: 'partial',
      shareBasisPoints: 5500,
      stateRetributionHtCents: 108_000,
      bajDecisionNumber: '2026/0042'
    })
    expect(result.success).toBe(true)
  })

  it('accepts a requested status without a type', () => {
    const result = dossierLegalAidSchema.safeParse({ status: 'requested' })
    expect(result.success).toBe(true)
  })
})

describe('fee agreement legal aid consistency', () => {
  const base = {
    dossierId: 'dossier-1',
    status: 'draft' as const,
    matterLabel: 'Prud’hommes AJ',
    scopeDescription: 'Assistance prud’homale',
    billingType: 'flat' as const,
    vatRateBasisPoints: 2000
  }

  it('rejects a partial legal aid agreement without a share', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...base,
      legalAidMode: true,
      legalAidType: 'partial',
      stateRetributionHtCents: 108_000
    })
    expect(result.success).toBe(false)
  })

  it('rejects a complement on a full legal aid agreement', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...base,
      legalAidMode: true,
      legalAidType: 'total',
      stateRetributionHtCents: 108_000,
      complementHtCents: 50_000
    })
    expect(result.success).toBe(false)
  })

  it('rejects legal aid fields when the mode is disabled', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...base,
      legalAidType: 'total',
      stateRetributionHtCents: 108_000
    })
    expect(result.success).toBe(false)
  })

  it('accepts a valid partial legal aid agreement with a complement', () => {
    const result = dossierFeeAgreementUpsertInputSchema.safeParse({
      ...base,
      legalAidMode: true,
      legalAidType: 'partial',
      legalAidShareBasisPoints: 5500,
      stateRetributionHtCents: 108_000,
      complementHtCents: 50_000,
      legalAidVatExempt: true
    })
    expect(result.success).toBe(true)
  })
})
