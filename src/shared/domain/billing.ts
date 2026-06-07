export const BILLING_TYPE_VALUES = ['flat', 'hourly', 'mixed'] as const
export type BillingType = (typeof BILLING_TYPE_VALUES)[number]

export const CABINET_SERVICE_USAGE_VALUES = ['feeAgreement', 'billing', 'both'] as const
export type CabinetServiceUsage = (typeof CABINET_SERVICE_USAGE_VALUES)[number]

export const FEE_AGREEMENT_STATUS_VALUES = ['draft', 'sent', 'signed'] as const
export type FeeAgreementStatus = (typeof FEE_AGREEMENT_STATUS_VALUES)[number]

export const DEFAULT_CABINET_SERVICE_GROUP = 'Standard'

export interface CabinetServicePreset {
  id: string
  name: string
  description?: string
  group?: string
  usage: CabinetServiceUsage
  billingType: BillingType
  flatFeeHtCents?: number
  hourlyRateHtCents?: number
  estimatedHours?: number
  retainerHtCents?: number
  successFeePercentBasisPoints?: number
  successFeeClause?: string
  vatRateBasisPoints: number
  paymentTerms?: string
  expenseTerms?: string
  terminationTerms?: string
  updatedAt: string
}

export function isCabinetServicePresetEligibleForFeeAgreement(
  preset: Pick<CabinetServicePreset, 'usage'>
): boolean {
  return preset.usage === 'feeAgreement' || preset.usage === 'both'
}

export function isCabinetServicePresetEligibleForBilling(
  preset: Pick<CabinetServicePreset, 'usage'>
): boolean {
  return preset.usage === 'billing' || preset.usage === 'both'
}

import type { InvoiceSettings } from './invoice'
import type { LegalAidType } from './dossier'

export interface CabinetBillingCatalog {
  services: CabinetServicePreset[]
  defaultServiceId?: string
  invoiceSettings?: InvoiceSettings
  updatedAt: string
}

export interface CabinetServicePresetUpsertInput {
  id?: string
  name: string
  description?: string
  group?: string
  usage: CabinetServiceUsage
  billingType: BillingType
  flatFeeHtCents?: number
  hourlyRateHtCents?: number
  estimatedHours?: number
  retainerHtCents?: number
  successFeePercentBasisPoints?: number
  successFeeClause?: string
  vatRateBasisPoints: number
  paymentTerms?: string
  expenseTerms?: string
  terminationTerms?: string
}

export interface CabinetServicePresetDeleteInput {
  id: string
}

export interface CabinetBillingDefaultInput {
  serviceId?: string
}

export interface DossierFeeAgreement {
  id: string
  createdAt: string
  updatedAt: string
  isActive: boolean
  archivedAt?: string
  generatedDocumentUuid?: string
  signedDocumentUuid?: string
  status: FeeAgreementStatus
  matterLabel: string
  scopeDescription: string
  clientContactUuid?: string
  signatoryContactUuid?: string
  billingType: BillingType
  sourceServicePresetId?: string
  flatFeeHtCents?: number
  hourlyRateHtCents?: number
  estimatedHours?: number
  retainerHtCents?: number
  successFeePercentBasisPoints?: number
  successFeeClause?: string
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
  vatRateBasisPoints: number
  paymentTerms?: string
  expenseTerms?: string
  terminationTerms?: string
  sentAt?: string
  signedAt?: string
  notes?: string
  /** Active la gestion d'aide juridictionnelle sur cette convention. */
  legalAidMode?: boolean
  /** Type d'AJ (totale/partielle) — orthogonal au `billingType`. */
  legalAidType?: LegalAidType
  /** Taux d'AJ partielle en points de base (ex. 5500 = 55 %). */
  legalAidShareBasisPoints?: number
  /** Rétribution versée par l'État, en centimes HT (calculée par défaut, modifiable). */
  stateRetributionHtCents?: number
  /** Complément d'honoraires négocié facturé au client (AJ partielle), en centimes HT. */
  complementHtCents?: number
  /** Plafond calculé du complément (informatif / contrôle), en centimes HT. */
  complementCapHtCents?: number
  /** Si true, la rétribution État est traitée comme exonérée de TVA (défaut métier). */
  legalAidVatExempt?: boolean
}

export interface DossierFeeAgreementUpsertInput {
  dossierId: string
  id?: string
  setActive?: boolean
  generatedDocumentUuid?: string
  signedDocumentUuid?: string
  status: FeeAgreementStatus
  matterLabel: string
  scopeDescription: string
  clientContactUuid?: string
  signatoryContactUuid?: string
  billingType: BillingType
  sourceServicePresetId?: string
  flatFeeHtCents?: number
  hourlyRateHtCents?: number
  estimatedHours?: number
  retainerHtCents?: number
  successFeePercentBasisPoints?: number
  successFeeClause?: string
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
  vatRateBasisPoints: number
  paymentTerms?: string
  expenseTerms?: string
  terminationTerms?: string
  sentAt?: string
  signedAt?: string
  notes?: string
  legalAidMode?: boolean
  legalAidType?: LegalAidType
  legalAidShareBasisPoints?: number
  stateRetributionHtCents?: number
  complementHtCents?: number
  complementCapHtCents?: number
  legalAidVatExempt?: boolean
}

export interface DossierFeeAgreementDeleteInput {
  dossierId: string
  feeAgreementId: string
}

export interface DossierFeeAgreementArchiveInput {
  dossierId: string
  feeAgreementId: string
}

export interface DossierFeeAgreementSetActiveInput {
  dossierId: string
  feeAgreementId: string
}

export const BILLING_ITEM_STATUS_VALUES = ['draft', 'billed', 'cancelled'] as const
export type BillingItemStatus = (typeof BILLING_ITEM_STATUS_VALUES)[number]

export const BILLING_ITEM_QUANTITY_UNIT_VALUES = ['hours', 'units'] as const
export type BillingItemQuantityUnit = (typeof BILLING_ITEM_QUANTITY_UNIT_VALUES)[number]

export const BILLING_ITEM_DISCOUNT_KIND_VALUES = ['percent', 'amount'] as const
export type BillingItemDiscountKind = (typeof BILLING_ITEM_DISCOUNT_KIND_VALUES)[number]

export const SOURCE_FEE_AGREEMENT_BILLING_KIND_VALUES = [
  'retainer',
  'finalBalance',
  'stateRetribution',
  'legalAidComplement'
] as const
export type SourceFeeAgreementBillingKind =
  (typeof SOURCE_FEE_AGREEMENT_BILLING_KIND_VALUES)[number]

export interface DossierBillingItem {
  id: string
  dossierId: string
  date: string
  label: string
  description?: string
  sourceServicePresetId?: string
  quantity: number
  quantityUnit: BillingItemQuantityUnit
  unitPriceHtCents: number
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
  subtotalHtCents: number
  discountHtCents: number
  totalHtCents: number
  vatRateBasisPoints: number
  totalTtcCents: number
  status: BillingItemStatus
  sourceKeyDateId?: string
  sourceFeeAgreementId?: string
  sourceFeeAgreementBillingKind?: SourceFeeAgreementBillingKind
  invoiceId?: string
  invoiceNumber?: string
  createdAt: string
  updatedAt: string
}

export interface DossierBillingItemUpsertInput {
  id?: string
  dossierId: string
  date: string
  label: string
  description?: string
  sourceServicePresetId?: string
  quantity: number
  quantityUnit: BillingItemQuantityUnit
  unitPriceHtCents: number
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
  vatRateBasisPoints: number
  status: BillingItemStatus
  sourceKeyDateId?: string
  sourceFeeAgreementId?: string
  sourceFeeAgreementBillingKind?: SourceFeeAgreementBillingKind
}

export interface DossierBillingItemDeleteInput {
  dossierId: string
  billingItemId: string
}
