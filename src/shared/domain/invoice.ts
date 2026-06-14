export const INVOICE_DOCUMENT_TYPE_VALUES = [
  'invoice',
  'creditNote',
  'correctiveInvoice',
  'stateRetribution'
] as const
export type InvoiceDocumentType = (typeof INVOICE_DOCUMENT_TYPE_VALUES)[number]

export const INVOICE_STATUS_VALUES = [
  'issued',
  'paid',
  'partiallyPaid',
  'overpaid',
  'cancelled',
  'corrected'
] as const
export type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number]

export const INVOICE_PAYMENT_STATUS_VALUES = [
  'unpaid',
  'partiallyPaid',
  'paid',
  'overpaid'
] as const
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUS_VALUES)[number]

export const INVOICE_PAYMENT_METHOD_VALUES = ['transfer', 'card', 'cash', 'check', 'other'] as const
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHOD_VALUES)[number]

export interface InvoiceLine {
  billingItemUuid: string
  date: string
  label: string
  description?: string
  quantity: number
  quantityUnit: 'hours' | 'units'
  unitPriceHtCents: number
  discountHtCents: number
  subtotalHtCents: number
  totalHtCents: number
  vatRateBasisPoints: number
  totalTtcCents: number
}

export interface InvoiceVatBreakdownLine {
  vatRateBasisPoints: number
  taxableHtCents: number
  vatCents: number
  totalTtcCents: number
}

export interface InvoicePartySnapshot {
  name?: string
  address?: string
  siret?: string
  vatNumber?: string
  iban?: string
  legalFooter?: string
}

export interface InvoiceOriginalRef {
  uuid: string
  number: string
  issuedAt: string
}

export interface InvoicePayment {
  uuid: string
  paidAt: string
  amountCents: number
  method: InvoicePaymentMethod
  reference?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceRecord {
  uuid: string
  documentType: InvoiceDocumentType
  number: string
  sequenceYear: number
  sequenceValue: number
  issuedAt: string
  dueAt?: string
  dossierId: string
  dossierLabel: string
  clientContactUuid?: string
  clientLabel?: string
  clientSnapshot?: InvoicePartySnapshot
  issuerSnapshot?: InvoicePartySnapshot
  templateUuid: string
  generatedDocumentUuid?: string
  generatedDocumentName?: string
  /** Path of the generated invoice document, relative to the domain root. */
  generatedDocumentPath?: string
  /**
   * SHA-256 hashes of the contractual artifacts captured at issuance.
   * Used to detect tampering: an issued invoice is legally immutable, but the
   * underlying files on disk are not. On open, the resolvers re-hash and
   * compare; a mismatch surfaces a warning. Absent on legacy records emitted
   * before this field was introduced.
   */
  documentHashes?: {
    docxSha256?: string
    pdfSha256?: string
  }
  totalHtCents: number
  totalVatCents: number
  totalTtcCents: number
  vatBreakdown: InvoiceVatBreakdownLine[]
  status: InvoiceStatus
  paymentStatus: InvoicePaymentStatus
  paidAmountCents: number
  remainingAmountCents: number
  payments: InvoicePayment[]
  originalInvoiceRefs: InvoiceOriginalRef[]
  correctionReason?: string
  paymentTerms?: string
  lines: InvoiceLine[]
  notes?: string
  paidAt?: string
  cancelledAt?: string
  createdAt: string
  updatedAt: string
}

/**
 * Integrity verdict for an issued invoice artifact (DOCX or PDF) when opened.
 *
 *  - `ok`           : file exists and its SHA-256 matches the hash captured at
 *                     issuance — original, untampered artifact.
 *  - `modified`     : file exists but its SHA-256 differs from the stored hash.
 *                     The user (or another process) edited the file after the
 *                     invoice was issued. The InvoiceRecord remains the legal
 *                     source of truth; the file is no longer the original
 *                     contractual artifact.
 *  - `regenerated`  : the original file was missing on disk, so the system
 *                     re-rendered a replacement from the immutable record.
 *                     Content is contractually correct but layout/template
 *                     fidelity may have drifted from the original.
 *  - `unknown`      : no hash was captured at issuance (legacy invoice emitted
 *                     before this guarantee existed). Integrity cannot be
 *                     verified.
 */
export type InvoiceArtifactIntegrity = 'ok' | 'modified' | 'regenerated' | 'unknown'

export interface InvoiceArtifactResult {
  absolutePath: string
  integrity: InvoiceArtifactIntegrity
}

export interface InvoiceSettings {
  numberPattern: string
  sequencePadding: number
  resetSequenceYearly: boolean
  nextSequence: number
  currentSequenceYear: number
  creditNoteNumberPattern: string
  creditNoteNextSequence: number
  creditNoteCurrentSequenceYear: number
  correctiveInvoiceNumberPattern: string
  correctiveInvoiceNextSequence: number
  correctiveInvoiceCurrentSequenceYear: number
  /**
   * Numérotation dédiée des pièces de rétribution AJ (aide juridictionnelle versée
   * par l'État via la CARPA). Distincte des factures clients (`FAC-…`) : ce n'est pas
   * un produit commercial mais une dotation de l'État, exonérée de TVA.
   */
  stateRetributionNumberPattern: string
  stateRetributionNextSequence: number
  stateRetributionCurrentSequenceYear: number
  defaultTemplateUuid?: string
  defaultCreditNoteTemplateUuid?: string
  defaultCorrectiveInvoiceTemplateUuid?: string
  /**
   * Legal footer printed on every invoice. Invoice-specific — has no entity equivalent.
   * Issuer identity (name, SIREN, VAT, IBAN, address) lives on the Cabinet entity profile
   * and is resolved via {@link entityToInvoiceIssuer}.
   */
  legalFooter?: string
  defaultPaymentTerms?: string
  /** Délai de paiement standard en jours — l'échéance est calculée à émission + N jours. */
  defaultDueDays: number
}

/** Computes the due date (ISO YYYY-MM-DD) from an issue date and a payment delay in days. */
export function computeDueDateIso(issuedAtIso: string, dueDays: number): string {
  const date = new Date(`${issuedAtIso.slice(0, 10)}T12:00:00`)
  date.setDate(date.getDate() + dueDays)
  return date.toISOString().slice(0, 10)
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  numberPattern: 'FAC-{YYYY}-{SEQ}',
  sequencePadding: 4,
  resetSequenceYearly: true,
  nextSequence: 1,
  currentSequenceYear: new Date().getFullYear(),
  creditNoteNumberPattern: 'AV-{YYYY}-{SEQ}',
  creditNoteNextSequence: 1,
  creditNoteCurrentSequenceYear: new Date().getFullYear(),
  correctiveInvoiceNumberPattern: 'FCR-{YYYY}-{SEQ}',
  correctiveInvoiceNextSequence: 1,
  correctiveInvoiceCurrentSequenceYear: new Date().getFullYear(),
  stateRetributionNumberPattern: 'RET-{YYYY}-{SEQ}',
  stateRetributionNextSequence: 1,
  stateRetributionCurrentSequenceYear: new Date().getFullYear(),
  defaultDueDays: 30
}

export interface InvoiceCreateInput {
  dossierId: string
  billingItemUuids: string[]
  templateUuid: string
  issuedAt?: string
  /** Échéance choisie dans le dialogue ; à défaut, émission + defaultDueDays. */
  dueAt?: string
  notes?: string
  rememberTemplateAsDefault?: boolean
  /** Tag overrides collected from the invoice dialog tag-filling step. */
  tagOverrides?: Record<string, string>
  /** Primary contact selected by the user in the invoice dialog. */
  primaryContactUuid?: string
  /** Map a contact role tag-key (e.g. "client") to a contact uuid. */
  contactRoleOverrides?: Record<string, string>
}

export interface InvoiceCancelInput {
  invoiceUuid: string
}

export interface InvoiceMarkPaidInput {
  invoiceUuid: string
  paidAt?: string
}

export interface InvoiceCreditLineInput {
  billingItemUuid: string
  quantity?: number
  totalHtCents?: number
}

export interface InvoiceCreateCreditNoteInput {
  originalInvoiceUuid: string
  templateUuid: string
  issuedAt?: string
  dueAt?: string
  reason: string
  notes?: string
  lineCredits?: InvoiceCreditLineInput[]
}

export interface InvoiceCreateCorrectiveInput extends InvoiceCreateInput {
  originalInvoiceUuid: string
  correctionReason: string
  dueAt?: string
}

export interface InvoicePaymentInput {
  invoiceUuid: string
  paidAt?: string
  amountCents: number
  method?: InvoicePaymentMethod
  reference?: string
  notes?: string
}

export interface InvoicePaymentUpdateInput extends InvoicePaymentInput {
  paymentUuid: string
}

export interface InvoicePaymentDeleteInput {
  invoiceUuid: string
  paymentUuid: string
}

export interface InvoiceExportCsvInput {
  dateFrom?: string
  dateTo?: string
  includeCancelled?: boolean
}

export interface InvoiceExportCsvResult {
  /** True when the user dismissed the destination picker — no file was written. */
  canceled: boolean
  /** Absolute path of the written file (the user-chosen location). */
  outputPath?: string
  invoiceCount?: number
}

export interface InvoiceExportFecInput {
  dateFrom?: string
  dateTo?: string
  includeCancelled?: boolean
}

export interface InvoiceExportFecResult {
  /** True when the user dismissed the destination picker — no file was written. */
  canceled: boolean
  /** Absolute path of the written file (the user-chosen location). */
  outputPath?: string
  invoiceCount?: number
}

export interface InvoiceSettingsUpdateInput {
  numberPattern?: string
  sequencePadding?: number
  resetSequenceYearly?: boolean
  nextSequence?: number
  creditNoteNumberPattern?: string
  creditNoteNextSequence?: number
  correctiveInvoiceNumberPattern?: string
  correctiveInvoiceNextSequence?: number
  defaultTemplateUuid?: string | null
  defaultCreditNoteTemplateUuid?: string | null
  defaultCorrectiveInvoiceTemplateUuid?: string | null
  legalFooter?: string | null
  defaultPaymentTerms?: string | null
  defaultDueDays?: number
}
