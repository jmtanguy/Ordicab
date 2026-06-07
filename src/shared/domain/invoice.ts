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
  billingItemId: string
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
  id: string
  number: string
  issuedAt: string
}

export interface InvoicePayment {
  id: string
  paidAt: string
  amountCents: number
  method: InvoicePaymentMethod
  reference?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface InvoiceRecord {
  id: string
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
  templateId: string
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

export interface InvoiceRegistry {
  invoices: InvoiceRecord[]
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
  defaultTemplateId?: string
  defaultCreditNoteTemplateId?: string
  defaultCorrectiveInvoiceTemplateId?: string
  /**
   * Legal footer printed on every invoice. Invoice-specific — has no entity equivalent.
   * Issuer identity (name, SIREN, VAT, IBAN, address) lives on the Cabinet entity profile
   * and is resolved via {@link entityToInvoiceIssuer}.
   */
  legalFooter?: string
  defaultPaymentTerms?: string
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
  stateRetributionCurrentSequenceYear: new Date().getFullYear()
}

export interface InvoiceCreateInput {
  dossierId: string
  billingItemIds: string[]
  templateId: string
  issuedAt?: string
  notes?: string
  rememberTemplateAsDefault?: boolean
  /** Tag overrides collected from the invoice dialog tag-filling step. */
  tagOverrides?: Record<string, string>
  /** Primary contact selected by the user in the invoice dialog. */
  primaryContactId?: string
  /** Map a contact role tag-key (e.g. "client") to a contact uuid. */
  contactRoleOverrides?: Record<string, string>
}

export interface InvoiceCancelInput {
  invoiceId: string
}

export interface InvoiceMarkPaidInput {
  invoiceId: string
  paidAt?: string
}

export interface InvoiceCreditLineInput {
  billingItemId: string
  quantity?: number
  totalHtCents?: number
}

export interface InvoiceCreateCreditNoteInput {
  originalInvoiceId: string
  templateId: string
  issuedAt?: string
  dueAt?: string
  reason: string
  notes?: string
  lineCredits?: InvoiceCreditLineInput[]
}

export interface InvoiceCreateCorrectiveInput extends InvoiceCreateInput {
  originalInvoiceId: string
  correctionReason: string
  dueAt?: string
}

export interface InvoicePaymentInput {
  invoiceId: string
  paidAt?: string
  amountCents: number
  method?: InvoicePaymentMethod
  reference?: string
  notes?: string
}

export interface InvoicePaymentUpdateInput extends InvoicePaymentInput {
  paymentId: string
}

export interface InvoicePaymentDeleteInput {
  invoiceId: string
  paymentId: string
}

export interface InvoiceExportCsvInput {
  dateFrom?: string
  dateTo?: string
  includeCancelled?: boolean
}

export interface InvoiceExportCsvResult {
  outputPath: string
  relativePath: string
  invoiceCount: number
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
  defaultTemplateId?: string | null
  defaultCreditNoteTemplateId?: string | null
  defaultCorrectiveInvoiceTemplateId?: string | null
  legalFooter?: string | null
  defaultPaymentTerms?: string | null
}
