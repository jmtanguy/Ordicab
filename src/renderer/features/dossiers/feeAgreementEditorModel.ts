import type {
  BillingType,
  CabinetServicePreset,
  DossierFeeAgreement,
  DossierFeeAgreementUpsertInput,
  FeeAgreementStatus
} from '@shared/types'
import { dossierFeeAgreementUpsertInputSchema } from '@shared/validation'

import {
  formatMoneyInput,
  formatNumberInput,
  formatPercentInput,
  parseDecimalInput,
  parseEurosToCents,
  parsePercentToBasisPoints
} from '@renderer/lib/billingFormatters'

import {
  createDiscountEditorFields,
  createEmptyDiscountEditorFields,
  parseDiscountEditorFields,
  type DiscountEditorFields
} from './billingDiscountEditor'

export interface FeeAgreementEditorState extends DiscountEditorFields {
  id?: string
  status: FeeAgreementStatus
  matterLabel: string
  scopeDescription: string
  clientContactUuid: string
  signatoryContactUuid: string
  billingType: BillingType
  sourceServicePresetId: string
  flatFeeHt: string
  hourlyRateHt: string
  estimatedHours: string
  retainerHt: string
  successFeePercent: string
  successFeeClause: string
  vatRate: string
  paymentTerms: string
  expenseTerms: string
  terminationTerms: string
  sentAt: string
  signedAt: string
  notes: string
  generatedDocumentUuid?: string
  signedDocumentUuid?: string
}

export function createEmptyFeeAgreementEditor(
  defaultPreset?: CabinetServicePreset
): FeeAgreementEditorState {
  return {
    id: undefined,
    status: 'draft',
    matterLabel: '',
    scopeDescription: '',
    clientContactUuid: '',
    signatoryContactUuid: '',
    billingType: defaultPreset?.billingType ?? 'mixed',
    sourceServicePresetId: defaultPreset?.id ?? '',
    flatFeeHt: formatMoneyInput(defaultPreset?.flatFeeHtCents),
    hourlyRateHt: formatMoneyInput(defaultPreset?.hourlyRateHtCents),
    estimatedHours: formatNumberInput(defaultPreset?.estimatedHours),
    retainerHt: formatMoneyInput(defaultPreset?.retainerHtCents),
    successFeePercent: formatPercentInput(defaultPreset?.successFeePercentBasisPoints),
    successFeeClause: defaultPreset?.successFeeClause ?? '',
    ...createEmptyDiscountEditorFields(),
    vatRate: formatPercentInput(defaultPreset?.vatRateBasisPoints) || '20',
    paymentTerms: defaultPreset?.paymentTerms ?? '',
    expenseTerms: defaultPreset?.expenseTerms ?? '',
    terminationTerms: defaultPreset?.terminationTerms ?? '',
    sentAt: '',
    signedAt: '',
    notes: '',
    generatedDocumentUuid: undefined,
    signedDocumentUuid: undefined
  }
}

export function createFeeAgreementEditorFromAgreement(
  agreement: DossierFeeAgreement
): FeeAgreementEditorState {
  return {
    id: agreement.id,
    status: agreement.status,
    matterLabel: agreement.matterLabel,
    scopeDescription: agreement.scopeDescription,
    clientContactUuid: agreement.clientContactUuid ?? '',
    signatoryContactUuid: agreement.signatoryContactUuid ?? '',
    billingType: agreement.billingType,
    sourceServicePresetId: agreement.sourceServicePresetId ?? '',
    flatFeeHt: formatMoneyInput(agreement.flatFeeHtCents),
    hourlyRateHt: formatMoneyInput(agreement.hourlyRateHtCents),
    estimatedHours: formatNumberInput(agreement.estimatedHours),
    retainerHt: formatMoneyInput(agreement.retainerHtCents),
    successFeePercent: formatPercentInput(agreement.successFeePercentBasisPoints),
    successFeeClause: agreement.successFeeClause ?? '',
    ...createDiscountEditorFields(agreement),
    vatRate: formatPercentInput(agreement.vatRateBasisPoints),
    paymentTerms: agreement.paymentTerms ?? '',
    expenseTerms: agreement.expenseTerms ?? '',
    terminationTerms: agreement.terminationTerms ?? '',
    sentAt: agreement.sentAt ?? '',
    signedAt: agreement.signedAt ?? '',
    notes: agreement.notes ?? '',
    generatedDocumentUuid: agreement.generatedDocumentUuid,
    signedDocumentUuid: agreement.signedDocumentUuid
  }
}

export function applyFeeAgreementPresetToEditor(
  current: FeeAgreementEditorState,
  preset: CabinetServicePreset
): FeeAgreementEditorState {
  return {
    ...current,
    billingType: preset.billingType,
    sourceServicePresetId: preset.id,
    flatFeeHt: formatMoneyInput(preset.flatFeeHtCents),
    hourlyRateHt: formatMoneyInput(preset.hourlyRateHtCents),
    estimatedHours: formatNumberInput(preset.estimatedHours),
    retainerHt: formatMoneyInput(preset.retainerHtCents),
    successFeePercent: formatPercentInput(preset.successFeePercentBasisPoints),
    successFeeClause: preset.successFeeClause ?? '',
    vatRate: formatPercentInput(preset.vatRateBasisPoints),
    paymentTerms: preset.paymentTerms ?? '',
    expenseTerms: preset.expenseTerms ?? '',
    terminationTerms: preset.terminationTerms ?? ''
  }
}

export function createUpsertInputFromFeeAgreement(
  dossierId: string,
  agreement: DossierFeeAgreement,
  overrides: Partial<Omit<DossierFeeAgreementUpsertInput, 'dossierId'>> = {}
): DossierFeeAgreementUpsertInput {
  return {
    dossierId,
    id: agreement.id,
    status: agreement.status,
    matterLabel: agreement.matterLabel,
    scopeDescription: agreement.scopeDescription,
    clientContactUuid: agreement.clientContactUuid,
    signatoryContactUuid: agreement.signatoryContactUuid,
    billingType: agreement.billingType,
    sourceServicePresetId: agreement.sourceServicePresetId,
    flatFeeHtCents: agreement.flatFeeHtCents,
    hourlyRateHtCents: agreement.hourlyRateHtCents,
    estimatedHours: agreement.estimatedHours,
    retainerHtCents: agreement.retainerHtCents,
    successFeePercentBasisPoints: agreement.successFeePercentBasisPoints,
    successFeeClause: agreement.successFeeClause,
    discountKind: agreement.discountKind,
    discountPercentBasisPoints: agreement.discountPercentBasisPoints,
    discountAmountHtCents: agreement.discountAmountHtCents,
    vatRateBasisPoints: agreement.vatRateBasisPoints,
    paymentTerms: agreement.paymentTerms,
    expenseTerms: agreement.expenseTerms,
    terminationTerms: agreement.terminationTerms,
    sentAt: agreement.sentAt,
    signedAt: agreement.signedAt,
    notes: agreement.notes,
    generatedDocumentUuid: agreement.generatedDocumentUuid,
    signedDocumentUuid: agreement.signedDocumentUuid,
    ...overrides
  }
}

export function buildFeeAgreementUpsertInput(
  dossierId: string,
  state: FeeAgreementEditorState,
  setActive?: boolean
): DossierFeeAgreementUpsertInput | null {
  const candidate = {
    dossierId,
    id: state.id,
    setActive,
    generatedDocumentUuid: state.generatedDocumentUuid,
    signedDocumentUuid: state.signedDocumentUuid,
    status: state.status,
    matterLabel: state.matterLabel.trim(),
    scopeDescription: state.scopeDescription.trim(),
    clientContactUuid: state.clientContactUuid || undefined,
    signatoryContactUuid: state.signatoryContactUuid || undefined,
    billingType: state.billingType,
    sourceServicePresetId: state.sourceServicePresetId || undefined,
    flatFeeHtCents: parseEurosToCents(state.flatFeeHt),
    hourlyRateHtCents: parseEurosToCents(state.hourlyRateHt),
    estimatedHours: parseDecimalInput(state.estimatedHours),
    retainerHtCents: parseEurosToCents(state.retainerHt),
    successFeePercentBasisPoints: parsePercentToBasisPoints(state.successFeePercent),
    successFeeClause: state.successFeeClause.trim() || undefined,
    ...parseDiscountEditorFields(state),
    vatRateBasisPoints: parsePercentToBasisPoints(state.vatRate),
    paymentTerms: state.paymentTerms.trim() || undefined,
    expenseTerms: state.expenseTerms.trim() || undefined,
    terminationTerms: state.terminationTerms.trim() || undefined,
    sentAt: state.sentAt || undefined,
    signedAt: state.signedAt || undefined,
    notes: state.notes.trim() || undefined
  }

  const parsed = dossierFeeAgreementUpsertInputSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}
