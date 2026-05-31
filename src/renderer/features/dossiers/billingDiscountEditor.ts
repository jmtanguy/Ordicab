import { computeBillingItemTotals } from '@shared/billingCalculations'
import type { BillingItemDiscountKind } from '@shared/types'

import {
  formatMoneyInput,
  formatPercentInput,
  parseDecimalInput,
  parseEurosToCents,
  parsePercentToBasisPoints
} from '@renderer/lib/billingFormatters'

export type DiscountMode = 'none' | BillingItemDiscountKind

export interface DiscountEditorFields {
  discountMode: DiscountMode
  discountPercent: string
  discountAmount: string
}

export interface DiscountSource {
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
}

export function createEmptyDiscountEditorFields(): DiscountEditorFields {
  return {
    discountMode: 'none',
    discountPercent: '',
    discountAmount: ''
  }
}

export function createDiscountEditorFields(source: DiscountSource): DiscountEditorFields {
  return {
    discountMode: source.discountKind ?? 'none',
    discountPercent:
      source.discountKind === 'percent'
        ? formatPercentInput(source.discountPercentBasisPoints)
        : '',
    discountAmount:
      source.discountKind === 'amount' ? formatMoneyInput(source.discountAmountHtCents) : ''
  }
}

export function parseDiscountEditorFields(fields: DiscountEditorFields): DiscountSource {
  const discountKind = fields.discountMode === 'none' ? undefined : fields.discountMode

  return {
    discountKind,
    discountPercentBasisPoints:
      discountKind === 'percent'
        ? (parsePercentToBasisPoints(fields.discountPercent) ?? 0)
        : undefined,
    discountAmountHtCents:
      discountKind === 'amount' ? (parseEurosToCents(fields.discountAmount) ?? 0) : undefined
  }
}

export function computeBillingTotalsFromEditor(input: {
  quantity: string | number
  unitPriceHt: string
  vatRate: string
  discount: DiscountEditorFields
}): ReturnType<typeof computeBillingItemTotals> {
  const quantity =
    typeof input.quantity === 'number' ? input.quantity : (parseDecimalInput(input.quantity) ?? 0)
  const discount = parseDiscountEditorFields(input.discount)

  return computeBillingItemTotals({
    quantity,
    unitPriceHtCents: parseEurosToCents(input.unitPriceHt) ?? 0,
    vatRateBasisPoints: parsePercentToBasisPoints(input.vatRate) ?? 0,
    discountKind: discount.discountKind,
    discountPercentBasisPoints: discount.discountPercentBasisPoints,
    discountAmountHtCents: discount.discountAmountHtCents
  })
}
