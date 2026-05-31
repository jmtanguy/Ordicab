import { describe, expect, it } from 'vitest'

import { isCabinetServicePresetEligibleForFeeAgreement } from '@shared/domain/billing'

describe('billing domain helpers', () => {
  it('marks only fee agreement and mixed-use services as eligible for fee agreements', () => {
    expect(isCabinetServicePresetEligibleForFeeAgreement({ usage: 'feeAgreement' })).toBe(true)
    expect(isCabinetServicePresetEligibleForFeeAgreement({ usage: 'both' })).toBe(true)
    expect(isCabinetServicePresetEligibleForFeeAgreement({ usage: 'billing' })).toBe(false)
  })
})
