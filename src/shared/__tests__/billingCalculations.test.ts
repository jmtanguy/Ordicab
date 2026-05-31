import { describe, expect, it } from 'vitest'

import {
  applyVatRate,
  buildBillingItemFromFeeAgreement,
  buildBillingItemFromKeyDate,
  computeFeeAgreementBillingAmounts,
  computeBillingItemTotals
} from '@shared/billingCalculations'
import type { CabinetServicePreset, DossierFeeAgreement, KeyDate } from '@shared/types'

describe('applyVatRate', () => {
  it('returns undefined when the base amount is missing', () => {
    expect(applyVatRate(undefined, 2000)).toBeUndefined()
  })

  it('falls back to no VAT when the rate is missing', () => {
    expect(applyVatRate(10_000, undefined)).toBe(10_000)
  })

  it('applies the basis-point rate and rounds to cents', () => {
    expect(applyVatRate(12_345, 2000)).toBe(14_814)
  })
})

describe('buildBillingItemFromKeyDate', () => {
  const baseKeyDate: KeyDate = {
    id: 'kd-1',
    dossierId: 'dos-1',
    label: 'Audience',
    date: '2026-04-12',
    duration: 90,
    note: 'Audience plaidoirie'
  }

  const preset: CabinetServicePreset = {
    id: 'preset-1',
    name: 'Consultation horaire',
    usage: 'billing',
    billingType: 'hourly',
    hourlyRateHtCents: 18_000,
    vatRateBasisPoints: 2000,
    updatedAt: '2026-03-13T08:30:00.000Z'
  }

  it('converts a key date with duration into hours and prefills from the preset', () => {
    const input = buildBillingItemFromKeyDate(baseKeyDate, preset)
    expect(input.quantity).toBeCloseTo(1.5)
    expect(input.quantityUnit).toBe('hours')
    expect(input.unitPriceHtCents).toBe(18_000)
    expect(input.vatRateBasisPoints).toBe(2000)
    expect(input.sourceKeyDateId).toBe('kd-1')
    expect(input.label).toBe('Audience')
    expect(input.description).toBe('Audience plaidoirie\n1h30')
  })

  it('falls back to time/duration/tags when no note is provided', () => {
    const input = buildBillingItemFromKeyDate({
      id: 'kd-time',
      dossierId: 'dos-1',
      label: 'Audience JLD',
      date: '2026-05-12',
      time: '09:30',
      duration: 45,
      tags: ['urgent', 'imperative']
    })
    expect(input.label).toBe('Audience JLD')
    expect(input.description).toBe('09:30 · 45 min · urgent, imperative')
  })

  it('defaults to one hour and standard VAT when no preset and no duration are provided', () => {
    const input = buildBillingItemFromKeyDate({
      id: 'kd-2',
      dossierId: 'dos-1',
      label: 'Rdv client',
      date: '2026-05-01'
    })
    expect(input.quantity).toBe(1)
    expect(input.unitPriceHtCents).toBe(0)
    expect(input.vatRateBasisPoints).toBe(2000)
    expect(input.sourceKeyDateId).toBe('kd-2')
    expect(input.description).toBeUndefined()
  })
})

describe('computeBillingItemTotals', () => {
  it('returns the gross totals when no discount is configured', () => {
    expect(
      computeBillingItemTotals({
        quantity: 2,
        unitPriceHtCents: 20_000,
        vatRateBasisPoints: 2000
      })
    ).toEqual({
      subtotalHtCents: 40_000,
      discountHtCents: 0,
      totalHtCents: 40_000,
      totalTtcCents: 48_000
    })
  })

  it('applies a percentage discount and rounds the discounted amount', () => {
    expect(
      computeBillingItemTotals({
        quantity: 3,
        unitPriceHtCents: 13_345,
        vatRateBasisPoints: 2000,
        discountKind: 'percent',
        discountPercentBasisPoints: 1500
      })
    ).toEqual({
      subtotalHtCents: 40_035,
      discountHtCents: 6_005,
      totalHtCents: 34_030,
      totalTtcCents: 40_836
    })
  })

  it('applies a fixed amount discount in cents', () => {
    expect(
      computeBillingItemTotals({
        quantity: 1,
        unitPriceHtCents: 80_000,
        vatRateBasisPoints: 2000,
        discountKind: 'amount',
        discountAmountHtCents: 12_500
      })
    ).toEqual({
      subtotalHtCents: 80_000,
      discountHtCents: 12_500,
      totalHtCents: 67_500,
      totalTtcCents: 81_000
    })
  })

  it('caps the discount at the subtotal so totals never go negative', () => {
    expect(
      computeBillingItemTotals({
        quantity: 1,
        unitPriceHtCents: 10_000,
        vatRateBasisPoints: 2000,
        discountKind: 'amount',
        discountAmountHtCents: 25_000
      })
    ).toEqual({
      subtotalHtCents: 10_000,
      discountHtCents: 10_000,
      totalHtCents: 0,
      totalTtcCents: 0
    })
  })
})

describe('buildBillingItemFromFeeAgreement', () => {
  const baseAgreement: DossierFeeAgreement = {
    id: 'fa-1',
    createdAt: '2026-03-12T08:30:00.000Z',
    updatedAt: '2026-03-12T08:30:00.000Z',
    isActive: true,
    status: 'signed',
    matterLabel: 'Convention forfait',
    scopeDescription: 'Phase 1 du dossier',
    billingType: 'flat',
    flatFeeHtCents: 120_000,
    vatRateBasisPoints: 2000
  }

  it('converts a flat-fee convention into a retainer billing item', () => {
    const input = buildBillingItemFromFeeAgreement(
      {
        ...baseAgreement,
        notes: 'Provision encaissée en avril',
        retainerHtCents: 50_000,
        discountKind: 'percent',
        discountPercentBasisPoints: 1000
      },
      { dossierId: 'dos-1', today: '2026-04-01', conversionKind: 'retainer' }
    )
    expect(input.dossierId).toBe('dos-1')
    expect(input.date).toBe('2026-04-01')
    expect(input.quantityUnit).toBe('units')
    expect(input.quantity).toBe(1)
    expect(input.unitPriceHtCents).toBe(50_000)
    expect(input.discountKind).toBeUndefined()
    expect(input.discountPercentBasisPoints).toBeUndefined()
    expect(input.discountAmountHtCents).toBeUndefined()
    expect(input.label).toBe('Provision - Convention forfait')
    expect(input.sourceFeeAgreementId).toBe('fa-1')
    expect(input.sourceFeeAgreementBillingKind).toBe('retainer')
    const description = input.description ?? ''
    expect(description.startsWith('Phase 1 du dossier\nProvision encaissée en avril\n')).toBe(true)
    expect(description).toContain('Convention : forfait')
    expect(description).toContain('Facture de provision')
    expect(description).toContain('500 € HT')
    expect(input.status).toBe('draft')
  })

  it('converts a flat-fee convention into a final balance net of discount and retainer', () => {
    const input = buildBillingItemFromFeeAgreement(
      {
        ...baseAgreement,
        notes: 'Provision encaissée en avril',
        retainerHtCents: 50_000,
        discountKind: 'percent',
        discountPercentBasisPoints: 1000
      },
      { dossierId: 'dos-1', today: '2026-04-01', conversionKind: 'finalBalance' }
    )
    expect(input.quantityUnit).toBe('units')
    expect(input.quantity).toBe(1)
    expect(input.unitPriceHtCents).toBe(58_000)
    expect(input.discountKind).toBeUndefined()
    expect(input.discountPercentBasisPoints).toBeUndefined()
    expect(input.discountAmountHtCents).toBeUndefined()
    expect(input.label).toBe('Solde final - Convention forfait')
    expect(input.sourceFeeAgreementId).toBe('fa-1')
    expect(input.sourceFeeAgreementBillingKind).toBe('finalBalance')
    const description = input.description ?? ''
    expect(description).toContain('Convention : forfait')
    expect(description).toContain('Facture finale')
    expect(description).toContain('total 1 200 € HT')
    expect(description).toContain('remise 120 € HT')
    expect(description).toContain('€ HT')
    expect(description).toContain('provision 500 € HT')
    expect(description).toContain('solde 580 € HT')
    expect(input.status).toBe('draft')
  })

  it('computes the final balance from hourly estimated work when no flat fee is set', () => {
    const input = buildBillingItemFromFeeAgreement(
      {
        ...baseAgreement,
        billingType: 'hourly',
        flatFeeHtCents: undefined,
        hourlyRateHtCents: 15_000,
        estimatedHours: 4,
        discountKind: 'amount',
        discountAmountHtCents: 2_500
      },
      { dossierId: 'dos-2', today: '2026-04-02', conversionKind: 'finalBalance' }
    )
    expect(input.quantityUnit).toBe('units')
    expect(input.quantity).toBe(1)
    expect(input.unitPriceHtCents).toBe(57_500)
    expect(input.discountKind).toBeUndefined()
    expect(input.discountAmountHtCents).toBeUndefined()
    expect(input.discountPercentBasisPoints).toBeUndefined()
    const description = input.description ?? ''
    expect(description.startsWith('Phase 1 du dossier\n')).toBe(true)
    expect(description).toContain('taux horaire 150 € HT')
    expect(description).toContain('(4 h estimées)')
    expect(description).toContain('remise 25 € HT')
    expect(description).toContain('solde 575 € HT')
  })

  it('exposes reusable fee-agreement billing amounts', () => {
    expect(
      computeFeeAgreementBillingAmounts({
        ...baseAgreement,
        retainerHtCents: 50_000,
        discountKind: 'percent',
        discountPercentBasisPoints: 1000
      })
    ).toEqual({
      subtotalHtCents: 120_000,
      discountHtCents: 12_000,
      totalAfterDiscountHtCents: 108_000,
      retainerHtCents: 50_000,
      finalBalanceHtCents: 58_000
    })
  })
})
