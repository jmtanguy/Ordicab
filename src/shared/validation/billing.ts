import { z } from 'zod'

import type {
  BillingItemDiscountKind,
  BillingItemQuantityUnit,
  BillingItemStatus,
  BillingType,
  CabinetServiceUsage,
  CabinetBillingCatalog,
  CabinetBillingDefaultInput,
  CabinetServicePreset,
  CabinetServicePresetDeleteInput,
  CabinetServicePresetUpsertInput,
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreement,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  FeeAgreementStatus,
  SourceFeeAgreementBillingKind
} from '@shared/domain/billing'
import {
  BILLING_ITEM_DISCOUNT_KIND_VALUES,
  BILLING_ITEM_QUANTITY_UNIT_VALUES,
  BILLING_ITEM_STATUS_VALUES,
  BILLING_TYPE_VALUES,
  CABINET_SERVICE_USAGE_VALUES,
  FEE_AGREEMENT_STATUS_VALUES,
  SOURCE_FEE_AGREEMENT_BILLING_KIND_VALUES
} from '@shared/domain/billing'

import { invoiceSettingsSchema } from './invoice'
import { dossierIdSchema } from './dossierId'

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const optionalTrimmedStringSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
)

const optionalIsoDateSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().date().optional()
)

const optionalNonNegativeIntegerSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.number().int().nonnegative().optional()
)

const optionalNonNegativeNumberSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.number().nonnegative().optional()
)

// Schemas derive their value sets from the domain layer (single source of truth)
// rather than re-declaring the literals here.
export const billingTypeSchema = z.enum(BILLING_TYPE_VALUES)
export const cabinetServiceUsageSchema = z.enum(CABINET_SERVICE_USAGE_VALUES)
export const feeAgreementStatusSchema = z.enum(FEE_AGREEMENT_STATUS_VALUES)
export const billingItemStatusSchema = z.enum(BILLING_ITEM_STATUS_VALUES)
export const billingItemQuantityUnitSchema = z.enum(BILLING_ITEM_QUANTITY_UNIT_VALUES)
export const billingItemDiscountKindSchema = z.enum(BILLING_ITEM_DISCOUNT_KIND_VALUES)
export const sourceFeeAgreementBillingKindSchema = z.enum(SOURCE_FEE_AGREEMENT_BILLING_KIND_VALUES)

export const cabinetServicePresetSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalTrimmedStringSchema,
  group: optionalTrimmedStringSchema,
  usage: cabinetServiceUsageSchema.default('feeAgreement'),
  billingType: billingTypeSchema,
  flatFeeHtCents: optionalNonNegativeIntegerSchema,
  hourlyRateHtCents: optionalNonNegativeIntegerSchema,
  estimatedHours: optionalNonNegativeNumberSchema,
  retainerHtCents: optionalNonNegativeIntegerSchema,
  successFeePercentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  successFeeClause: optionalTrimmedStringSchema,
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  paymentTerms: optionalTrimmedStringSchema,
  expenseTerms: optionalTrimmedStringSchema,
  terminationTerms: optionalTrimmedStringSchema,
  updatedAt: z.string().trim().min(1)
})

export const cabinetBillingCatalogSchema = z.object({
  services: z.array(cabinetServicePresetSchema).default([]),
  defaultServiceId: optionalTrimmedStringSchema,
  invoiceSettings: invoiceSettingsSchema.optional(),
  updatedAt: z.string().trim().min(1)
})

export const cabinetServicePresetUpsertInputSchema = cabinetServicePresetSchema
  .omit({
    id: true,
    updatedAt: true
  })
  .extend({
    id: z.string().trim().min(1).optional()
  })

export const cabinetServicePresetDeleteInputSchema = z.object({
  id: z.string().trim().min(1)
})

export const cabinetBillingDefaultInputSchema = z.object({
  serviceId: optionalTrimmedStringSchema
})

type DiscountShape = {
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
}

function isDiscountShapeConsistent(data: DiscountShape): boolean {
  if (data.discountKind === 'percent') {
    return data.discountAmountHtCents === undefined
  }
  if (data.discountKind === 'amount') {
    return data.discountPercentBasisPoints === undefined
  }
  return data.discountPercentBasisPoints === undefined && data.discountAmountHtCents === undefined
}

const discountConsistencyMessage =
  'Discount fields must match discountKind: percent requires discountPercentBasisPoints only, amount requires discountAmountHtCents only, and no discountKind forbids both.'

const feeAgreementBaseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  isActive: z.boolean(),
  archivedAt: optionalTrimmedStringSchema,
  generatedDocumentUuid: optionalTrimmedStringSchema,
  signedDocumentUuid: optionalTrimmedStringSchema,
  status: feeAgreementStatusSchema,
  matterLabel: z.string().trim().min(1),
  scopeDescription: z.string().trim().min(1),
  clientContactUuid: optionalTrimmedStringSchema,
  signatoryContactUuid: optionalTrimmedStringSchema,
  billingType: billingTypeSchema,
  sourceServicePresetId: optionalTrimmedStringSchema,
  flatFeeHtCents: optionalNonNegativeIntegerSchema,
  hourlyRateHtCents: optionalNonNegativeIntegerSchema,
  estimatedHours: optionalNonNegativeNumberSchema,
  retainerHtCents: optionalNonNegativeIntegerSchema,
  successFeePercentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  successFeeClause: optionalTrimmedStringSchema,
  discountKind: billingItemDiscountKindSchema.optional(),
  discountPercentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  discountAmountHtCents: z.number().int().nonnegative().optional(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  paymentTerms: optionalTrimmedStringSchema,
  expenseTerms: optionalTrimmedStringSchema,
  terminationTerms: optionalTrimmedStringSchema,
  sentAt: optionalIsoDateSchema,
  signedAt: optionalIsoDateSchema,
  notes: optionalTrimmedStringSchema
})

export const feeAgreementSchema = feeAgreementBaseSchema.refine(isDiscountShapeConsistent, {
  message: discountConsistencyMessage,
  path: ['discountKind']
})

export const dossierFeeAgreementUpsertInputSchema = feeAgreementBaseSchema
  .omit({ id: true, createdAt: true, updatedAt: true, isActive: true })
  .extend({
    dossierId: dossierIdSchema,
    id: z.string().uuid().optional(),
    setActive: z.boolean().optional()
  })
  .refine(isDiscountShapeConsistent, {
    message: discountConsistencyMessage,
    path: ['discountKind']
  })

export const dossierFeeAgreementDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  feeAgreementId: z.string().uuid()
})

export const dossierFeeAgreementArchiveInputSchema = z.object({
  dossierId: dossierIdSchema,
  feeAgreementId: z.string().uuid()
})

export const dossierFeeAgreementSetActiveInputSchema = z.object({
  dossierId: dossierIdSchema,
  feeAgreementId: z.string().uuid()
})

const dossierBillingItemRawSchema = z.object({
  id: z.string().uuid(),
  dossierId: dossierIdSchema,
  date: z.string().trim().date(),
  label: z.string().trim().min(1),
  description: optionalTrimmedStringSchema,
  sourceServicePresetId: optionalTrimmedStringSchema,
  quantity: z.number().nonnegative(),
  quantityUnit: billingItemQuantityUnitSchema,
  unitPriceHtCents: z.number().int().nonnegative(),
  discountKind: billingItemDiscountKindSchema.optional(),
  discountPercentBasisPoints: z.number().int().min(0).max(10_000).optional(),
  discountAmountHtCents: z.number().int().nonnegative().optional(),
  subtotalHtCents: z.number().int().nonnegative(),
  discountHtCents: z.number().int().nonnegative(),
  totalHtCents: z.number().int().nonnegative(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  totalTtcCents: z.number().int().nonnegative(),
  status: billingItemStatusSchema,
  sourceKeyDateId: optionalTrimmedStringSchema,
  sourceFeeAgreementId: optionalTrimmedStringSchema,
  sourceFeeAgreementBillingKind: sourceFeeAgreementBillingKindSchema.optional(),
  invoiceId: optionalTrimmedStringSchema,
  invoiceNumber: optionalTrimmedStringSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})

type BillingItemSourceShape = {
  sourceKeyDateId?: string
  sourceFeeAgreementId?: string
  sourceFeeAgreementBillingKind?: SourceFeeAgreementBillingKind
}

function isBillingItemSourceConsistent(data: BillingItemSourceShape): boolean {
  if (data.sourceKeyDateId && data.sourceFeeAgreementId) {
    return false
  }
  if (data.sourceFeeAgreementBillingKind && !data.sourceFeeAgreementId) {
    return false
  }
  return true
}

const billingItemSourceConsistencyMessage =
  'A billing item cannot reference both a key date and a fee agreement, and sourceFeeAgreementBillingKind requires sourceFeeAgreementId.'

const dossierBillingItemNormalizedSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const candidate = value as Record<string, unknown>
  const hasSubtotal = typeof candidate.subtotalHtCents === 'number'
  const hasDiscount = typeof candidate.discountHtCents === 'number'
  if (hasSubtotal && hasDiscount) {
    return candidate
  }
  const totalHtCents = typeof candidate.totalHtCents === 'number' ? candidate.totalHtCents : 0
  return {
    ...candidate,
    subtotalHtCents: hasSubtotal ? candidate.subtotalHtCents : totalHtCents,
    discountHtCents: hasDiscount ? candidate.discountHtCents : 0
  }
}, dossierBillingItemRawSchema)

export const dossierBillingItemSchema = dossierBillingItemNormalizedSchema
  .refine(isDiscountShapeConsistent, {
    message: discountConsistencyMessage,
    path: ['discountKind']
  })
  .refine(isBillingItemSourceConsistent, {
    message: billingItemSourceConsistencyMessage,
    path: ['sourceFeeAgreementId']
  })

export const dossierBillingItemUpsertInputSchema = dossierBillingItemRawSchema
  .omit({
    id: true,
    subtotalHtCents: true,
    discountHtCents: true,
    totalHtCents: true,
    totalTtcCents: true,
    invoiceId: true,
    invoiceNumber: true,
    createdAt: true,
    updatedAt: true
  })
  .extend({
    id: z.string().uuid().optional()
  })
  .refine(isDiscountShapeConsistent, {
    message: discountConsistencyMessage,
    path: ['discountKind']
  })
  .refine(isBillingItemSourceConsistent, {
    message: billingItemSourceConsistencyMessage,
    path: ['sourceFeeAgreementId']
  })

export const dossierBillingItemDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  billingItemId: z.string().uuid()
})

export const billingItemIndexEntrySchema = z.object({
  id: z.string().uuid(),
  dossierId: dossierIdSchema,
  label: z.string().trim().min(1),
  status: billingItemStatusSchema,
  date: z.string().trim().min(1),
  totalTtcCents: z.number().int().nonnegative(),
  invoiceId: z.string().optional(),
  updatedAt: z.string().min(1)
})

export const billingItemIndexSchema = z.object({
  items: z.array(billingItemIndexEntrySchema).default([]),
  updatedAt: z.string().min(1),
  migrated: z.boolean().optional()
})

export type BillingItemIndexEntry = z.infer<typeof billingItemIndexEntrySchema>
export type BillingItemIndex = z.infer<typeof billingItemIndexSchema>

export type {
  BillingItemDiscountKind,
  BillingItemQuantityUnit,
  BillingItemStatus,
  BillingType,
  CabinetServiceUsage,
  CabinetBillingCatalog,
  CabinetBillingDefaultInput,
  CabinetServicePreset,
  CabinetServicePresetDeleteInput,
  CabinetServicePresetUpsertInput,
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreement,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  FeeAgreementStatus,
  SourceFeeAgreementBillingKind
}
