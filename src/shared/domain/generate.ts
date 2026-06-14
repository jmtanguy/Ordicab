import type { InvoiceDocumentType } from './invoice'

export interface InvoiceLineTemplateInput {
  date: string
  label: string
  description?: string
  quantity: number
  quantityUnit: 'hours' | 'units'
  unitPriceHtCents: number
  subtotalHtCents: number
  discountHtCents: number
  totalHtCents: number
  totalTtcCents: number
  vatRateBasisPoints: number
}

export interface InvoiceTemplateInput {
  documentType?: InvoiceDocumentType
  number: string
  issuedAt: string
  dueAt?: string
  paymentTerms?: string
  correctionReason?: string
  originalInvoiceRefs?: Array<{ uuid: string; number: string; issuedAt: string }>
  notes?: string
  totalHtCents: number
  totalVatCents: number
  totalTtcCents: number
  lines: InvoiceLineTemplateInput[]
  client?: {
    displayName?: string
    address?: string
  }
  issuer?: {
    name?: string
    address?: string
    siret?: string
    vatNumber?: string
    iban?: string
    legalFooter?: string
  }
}

export interface GenerateDocumentInput {
  dossierId: string
  templateUuid: string
  primaryContactUuid?: string
  contactRoleOverrides?: Record<string, string>
  tagOverrides?: Record<string, string>
  outputPath?: string
  filename?: string
  description?: string
  tags?: string[]
  /** When provided, exposes {{invoice.*}} and {{invoice.issuer.*}} in the template context. */
  invoiceContext?: InvoiceTemplateInput
}

export interface GeneratePreviewInput extends GenerateDocumentInput {}

export interface SaveGeneratedDocumentInput {
  dossierId: string
  filename: string
  format: 'txt' | 'docx'
  html: string
  outputPath?: string
  /**
   * Generation context of the saved draft. When provided, manual tag values
   * are memorized per (template, dossier) for the next generation.
   */
  templateUuid?: string
  tagOverrides?: Record<string, string>
  primaryContactUuid?: string
  contactRoleOverrides?: Record<string, string>
}

export interface SelectOutputPathInput {
  defaultFilename?: string
}

/**
 * Preview a Word invoice template before the invoice number is consumed. Returns the same
 * `DocxPreviewResult` shape as `previewDocxDocument` so the renderer can reuse the
 * existing tag-filling flow.
 */
export interface GeneratePreviewInvoiceDocxInput {
  dossierId: string
  templateUuid: string
  billingItemUuids: string[]
  issuedAt?: string
  /** Échéance choisie dans le dialogue ; à défaut, émission + defaultDueDays. */
  dueAt?: string
  notes?: string
  tagOverrides?: Record<string, string>
  primaryContactUuid?: string
  contactRoleOverrides?: Record<string, string>
}
