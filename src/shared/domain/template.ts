export const TEMPLATE_DOCUMENT_KIND_VALUES = [
  'document',
  'invoice',
  'creditNote',
  'correctiveInvoice'
] as const
export type TemplateDocumentKind = (typeof TEMPLATE_DOCUMENT_KIND_VALUES)[number]

export interface TemplateRecord {
  id: string
  name: string
  description?: string
  content?: string
  tags?: string[]
  macros: string[]
  hasDocxSource: boolean
  /** Document family this template is intended for. Defaults to 'document' (correspondence). */
  documentKind?: TemplateDocumentKind
  updatedAt: string
}

export interface TemplateDraft {
  name: string
  content: string
  description?: string
  tags?: string[]
  documentKind?: TemplateDocumentKind
}

export interface TemplateUpdate extends TemplateDraft {
  id: string
}

export interface TemplateDeleteInput {
  id: string
}

export interface TemplateDocxInput {
  id: string
  pickToken?: string
}
