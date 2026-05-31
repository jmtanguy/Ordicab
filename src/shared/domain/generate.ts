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
  documentType?: 'invoice' | 'creditNote' | 'correctiveInvoice'
  number: string
  issuedAt: string
  dueAt?: string
  paymentTerms?: string
  correctionReason?: string
  originalInvoiceRefs?: Array<{ id: string; number: string; issuedAt: string }>
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
  templateId: string
  primaryContactId?: string
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
  templateId: string
  billingItemIds: string[]
  issuedAt?: string
  notes?: string
  tagOverrides?: Record<string, string>
  primaryContactId?: string
  contactRoleOverrides?: Record<string, string>
}
