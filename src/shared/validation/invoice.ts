import { z } from 'zod'

import {
  DEFAULT_INVOICE_SETTINGS,
  INVOICE_DOCUMENT_TYPE_VALUES,
  INVOICE_PAYMENT_METHOD_VALUES,
  INVOICE_PAYMENT_STATUS_VALUES,
  INVOICE_STATUS_VALUES
} from '@shared/domain/invoice'

import { dossierIdSchema } from './dossierId'

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
function emptyToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const optionalTrimmedStringSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional()
)
const nullableTrimmedStringSchema = z.preprocess(
  emptyToNull,
  z.string().trim().min(1).nullable().optional()
)

const invoiceStatusSchema = z.enum(INVOICE_STATUS_VALUES)
const invoiceDocumentTypeSchema = z.enum(INVOICE_DOCUMENT_TYPE_VALUES)
export const invoicePaymentStatusSchema = z.enum(INVOICE_PAYMENT_STATUS_VALUES)
const invoicePaymentMethodSchema = z.enum(INVOICE_PAYMENT_METHOD_VALUES)

export const invoiceLineSchema = z.object({
  billingItemUuid: z.string().uuid(),
  date: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: optionalTrimmedStringSchema,
  quantity: z.number().nonnegative(),
  quantityUnit: z.enum(['hours', 'units']),
  unitPriceHtCents: z.number().int().nonnegative(),
  discountHtCents: z.number().int().nonnegative(),
  subtotalHtCents: z.number().int().nonnegative(),
  totalHtCents: z.number().int().nonnegative(),
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  totalTtcCents: z.number().int().nonnegative()
})

export const invoiceVatBreakdownLineSchema = z.object({
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  taxableHtCents: z.number().int().nonnegative(),
  vatCents: z.number().int().nonnegative(),
  totalTtcCents: z.number().int().nonnegative()
})

const invoicePartySnapshotSchema = z.object({
  name: optionalTrimmedStringSchema,
  address: optionalTrimmedStringSchema,
  siret: optionalTrimmedStringSchema,
  vatNumber: optionalTrimmedStringSchema,
  iban: optionalTrimmedStringSchema,
  legalFooter: optionalTrimmedStringSchema
})

const invoiceOriginalRefSchema = z.object({
  uuid: z.string().uuid(),
  number: z.string().trim().min(1),
  issuedAt: z.string().trim().min(1)
})

const invoicePaymentSchema = z.object({
  uuid: z.string().uuid(),
  paidAt: z.string().trim().min(1),
  amountCents: z.number().int().positive(),
  method: invoicePaymentMethodSchema,
  reference: optionalTrimmedStringSchema,
  notes: optionalTrimmedStringSchema,
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1)
})

const invoiceRecordRawSchema = z.object({
  uuid: z.string().uuid(),
  documentType: invoiceDocumentTypeSchema,
  number: z.string().trim().min(1),
  sequenceYear: z.number().int(),
  sequenceValue: z.number().int().positive(),
  issuedAt: z.string().trim().min(1),
  dueAt: optionalTrimmedStringSchema,
  dossierId: dossierIdSchema,
  dossierLabel: z.string().trim().min(1),
  clientContactUuid: optionalTrimmedStringSchema,
  clientLabel: optionalTrimmedStringSchema,
  clientSnapshot: invoicePartySnapshotSchema.optional(),
  issuerSnapshot: invoicePartySnapshotSchema.optional(),
  templateUuid: z.string().trim().min(1),
  generatedDocumentUuid: optionalTrimmedStringSchema,
  generatedDocumentName: optionalTrimmedStringSchema,
  generatedDocumentPath: optionalTrimmedStringSchema,
  documentHashes: z
    .object({
      docxSha256: optionalTrimmedStringSchema,
      pdfSha256: optionalTrimmedStringSchema
    })
    .optional(),
  totalHtCents: z.number().int().nonnegative(),
  totalVatCents: z.number().int().nonnegative(),
  totalTtcCents: z.number().int().nonnegative(),
  vatBreakdown: z.array(invoiceVatBreakdownLineSchema).default([]),
  status: invoiceStatusSchema,
  paymentStatus: invoicePaymentStatusSchema,
  paidAmountCents: z.number().int().nonnegative(),
  remainingAmountCents: z.number().int().nonnegative(),
  payments: z.array(invoicePaymentSchema).default([]),
  originalInvoiceRefs: z.array(invoiceOriginalRefSchema).default([]),
  correctionReason: optionalTrimmedStringSchema,
  paymentTerms: optionalTrimmedStringSchema,
  lines: z.array(invoiceLineSchema).min(1),
  notes: optionalTrimmedStringSchema,
  paidAt: optionalTrimmedStringSchema,
  cancelledAt: optionalTrimmedStringSchema,
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1)
})

function deriveVatBreakdown(
  lines: Array<z.infer<typeof invoiceLineSchema>>
): Array<z.infer<typeof invoiceVatBreakdownLineSchema>> {
  const byRate = new Map<number, z.infer<typeof invoiceVatBreakdownLineSchema>>()
  for (const line of lines) {
    const vatCents = Math.max(0, line.totalTtcCents - line.totalHtCents)
    const current = byRate.get(line.vatRateBasisPoints) ?? {
      vatRateBasisPoints: line.vatRateBasisPoints,
      taxableHtCents: 0,
      vatCents: 0,
      totalTtcCents: 0
    }
    current.taxableHtCents += line.totalHtCents
    current.vatCents += vatCents
    current.totalTtcCents += line.totalTtcCents
    byRate.set(line.vatRateBasisPoints, current)
  }
  return [...byRate.values()].sort((a, b) => a.vatRateBasisPoints - b.vatRateBasisPoints)
}

function paymentStatusFromAmounts(
  totalTtcCents: number,
  paidAmountCents: number
): z.infer<typeof invoicePaymentStatusSchema> {
  if (paidAmountCents <= 0) return 'unpaid'
  if (paidAmountCents < totalTtcCents) return 'partiallyPaid'
  if (paidAmountCents === totalTtcCents) return 'paid'
  return 'overpaid'
}

export const invoiceRecordSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null) return value
  const candidate = value as Record<string, unknown>
  const lines = Array.isArray(candidate.lines) ? candidate.lines : []
  const parsedLines = z.array(invoiceLineSchema).safeParse(lines)
  const totalTtcCents = typeof candidate.totalTtcCents === 'number' ? candidate.totalTtcCents : 0
  const paidAmountCents =
    typeof candidate.paidAmountCents === 'number'
      ? candidate.paidAmountCents
      : candidate.status === 'paid'
        ? totalTtcCents
        : 0
  const paymentStatus =
    typeof candidate.paymentStatus === 'string'
      ? candidate.paymentStatus
      : paymentStatusFromAmounts(totalTtcCents, paidAmountCents)
  return {
    ...candidate,
    documentType: candidate.documentType ?? 'invoice',
    vatBreakdown:
      candidate.vatBreakdown ?? (parsedLines.success ? deriveVatBreakdown(parsedLines.data) : []),
    paymentStatus,
    paidAmountCents,
    remainingAmountCents:
      typeof candidate.remainingAmountCents === 'number'
        ? candidate.remainingAmountCents
        : Math.max(0, totalTtcCents - paidAmountCents),
    payments: candidate.payments ?? [],
    originalInvoiceRefs: candidate.originalInvoiceRefs ?? []
  }
}, invoiceRecordRawSchema)

const invoiceSettingsRawSchema = z.object({
  numberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'), {
      message: 'Le motif doit contenir {SEQ}.'
    }),
  sequencePadding: z.number().int().min(0).max(12),
  resetSequenceYearly: z.boolean(),
  nextSequence: z.number().int().positive(),
  currentSequenceYear: z.number().int(),
  creditNoteNumberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'), {
      message: 'Le motif doit contenir {SEQ}.'
    }),
  creditNoteNextSequence: z.number().int().positive(),
  creditNoteCurrentSequenceYear: z.number().int(),
  correctiveInvoiceNumberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'), {
      message: 'Le motif doit contenir {SEQ}.'
    }),
  correctiveInvoiceNextSequence: z.number().int().positive(),
  correctiveInvoiceCurrentSequenceYear: z.number().int(),
  stateRetributionNumberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'), {
      message: 'Le motif doit contenir {SEQ}.'
    }),
  stateRetributionNextSequence: z.number().int().positive(),
  stateRetributionCurrentSequenceYear: z.number().int(),
  defaultTemplateUuid: optionalTrimmedStringSchema,
  defaultCreditNoteTemplateUuid: optionalTrimmedStringSchema,
  defaultCorrectiveInvoiceTemplateUuid: optionalTrimmedStringSchema,
  legalFooter: optionalTrimmedStringSchema,
  defaultPaymentTerms: optionalTrimmedStringSchema,
  defaultDueDays: z.number().int().min(0).max(365)
})

export const invoiceSettingsSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null) return value
  const candidate = value as Record<string, unknown>
  return {
    ...candidate,
    creditNoteNumberPattern:
      candidate.creditNoteNumberPattern ?? DEFAULT_INVOICE_SETTINGS.creditNoteNumberPattern,
    creditNoteNextSequence:
      candidate.creditNoteNextSequence ?? DEFAULT_INVOICE_SETTINGS.creditNoteNextSequence,
    creditNoteCurrentSequenceYear:
      candidate.creditNoteCurrentSequenceYear ??
      candidate.currentSequenceYear ??
      DEFAULT_INVOICE_SETTINGS.creditNoteCurrentSequenceYear,
    correctiveInvoiceNumberPattern:
      candidate.correctiveInvoiceNumberPattern ??
      DEFAULT_INVOICE_SETTINGS.correctiveInvoiceNumberPattern,
    correctiveInvoiceNextSequence:
      candidate.correctiveInvoiceNextSequence ??
      DEFAULT_INVOICE_SETTINGS.correctiveInvoiceNextSequence,
    correctiveInvoiceCurrentSequenceYear:
      candidate.correctiveInvoiceCurrentSequenceYear ??
      candidate.currentSequenceYear ??
      DEFAULT_INVOICE_SETTINGS.correctiveInvoiceCurrentSequenceYear,
    stateRetributionNumberPattern:
      candidate.stateRetributionNumberPattern ??
      DEFAULT_INVOICE_SETTINGS.stateRetributionNumberPattern,
    stateRetributionNextSequence:
      candidate.stateRetributionNextSequence ??
      DEFAULT_INVOICE_SETTINGS.stateRetributionNextSequence,
    stateRetributionCurrentSequenceYear:
      candidate.stateRetributionCurrentSequenceYear ??
      candidate.currentSequenceYear ??
      DEFAULT_INVOICE_SETTINGS.stateRetributionCurrentSequenceYear,
    defaultDueDays: candidate.defaultDueDays ?? DEFAULT_INVOICE_SETTINGS.defaultDueDays
  }
}, invoiceSettingsRawSchema)

export const invoiceCreateInputSchema = z.object({
  dossierId: dossierIdSchema,
  billingItemUuids: z.array(z.string().uuid()).min(1),
  templateUuid: z.string().trim().min(1),
  issuedAt: optionalTrimmedStringSchema,
  dueAt: optionalTrimmedStringSchema,
  notes: optionalTrimmedStringSchema,
  rememberTemplateAsDefault: z.boolean().optional(),
  tagOverrides: z.record(z.string(), z.string()).optional(),
  primaryContactUuid: z.string().trim().min(1).optional(),
  contactRoleOverrides: z.record(z.string(), z.string()).optional()
})

export const invoiceCancelInputSchema = z.object({
  invoiceUuid: z.string().uuid()
})

export const invoiceMarkPaidInputSchema = z.object({
  invoiceUuid: z.string().uuid(),
  paidAt: optionalTrimmedStringSchema
})

const invoiceCreditLineInputSchema = z.object({
  billingItemUuid: z.string().uuid(),
  quantity: z.number().positive().optional(),
  totalHtCents: z.number().int().positive().optional()
})

export const invoiceCreateCreditNoteInputSchema = z.object({
  originalInvoiceUuid: z.string().uuid(),
  templateUuid: z.string().trim().min(1),
  issuedAt: optionalTrimmedStringSchema,
  dueAt: optionalTrimmedStringSchema,
  reason: z.string().trim().min(1),
  notes: optionalTrimmedStringSchema,
  lineCredits: z.array(invoiceCreditLineInputSchema).optional()
})

export const invoiceCreateCorrectiveInputSchema = invoiceCreateInputSchema.extend({
  originalInvoiceUuid: z.string().uuid(),
  correctionReason: z.string().trim().min(1),
  dueAt: optionalTrimmedStringSchema
})

export const invoicePaymentInputSchema = z.object({
  invoiceUuid: z.string().uuid(),
  paidAt: optionalTrimmedStringSchema,
  amountCents: z.number().int().positive(),
  method: invoicePaymentMethodSchema.optional(),
  reference: optionalTrimmedStringSchema,
  notes: optionalTrimmedStringSchema
})

export const invoicePaymentUpdateInputSchema = invoicePaymentInputSchema.extend({
  paymentUuid: z.string().uuid()
})

export const invoicePaymentDeleteInputSchema = z.object({
  invoiceUuid: z.string().uuid(),
  paymentUuid: z.string().uuid()
})

export const invoiceExportCsvInputSchema = z.object({
  dateFrom: optionalTrimmedStringSchema,
  dateTo: optionalTrimmedStringSchema,
  includeCancelled: z.boolean().optional()
})

export const invoiceExportFecInputSchema = z.object({
  dateFrom: optionalTrimmedStringSchema,
  dateTo: optionalTrimmedStringSchema,
  includeCancelled: z.boolean().optional()
})

export const invoiceSettingsUpdateInputSchema = z.object({
  numberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'))
    .optional(),
  sequencePadding: z.number().int().min(0).max(12).optional(),
  resetSequenceYearly: z.boolean().optional(),
  nextSequence: z.number().int().positive().optional(),
  creditNoteNumberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'))
    .optional(),
  creditNoteNextSequence: z.number().int().positive().optional(),
  correctiveInvoiceNumberPattern: z
    .string()
    .trim()
    .min(1)
    .refine((p) => p.includes('{SEQ}'))
    .optional(),
  correctiveInvoiceNextSequence: z.number().int().positive().optional(),
  defaultTemplateUuid: nullableTrimmedStringSchema,
  defaultCreditNoteTemplateUuid: nullableTrimmedStringSchema,
  defaultCorrectiveInvoiceTemplateUuid: nullableTrimmedStringSchema,
  legalFooter: nullableTrimmedStringSchema,
  defaultPaymentTerms: nullableTrimmedStringSchema,
  defaultDueDays: z.number().int().min(0).max(365).optional()
})
