export const TEMPLATE_DOCUMENT_KIND_VALUES = [
  'document',
  'invoice',
  'creditNote',
  'correctiveInvoice'
] as const
export type TemplateDocumentKind = (typeof TEMPLATE_DOCUMENT_KIND_VALUES)[number]

export interface TemplateRecord {
  uuid: string
  name: string
  description?: string
  content?: string
  tags?: string[]
  macros: string[]
  hasDocxSource: boolean
  /** Document family this template is intended for. Defaults to 'document' (correspondence). */
  documentKind?: TemplateDocumentKind
  /** Free-form folder name used to group templates in the library. */
  category?: string
  updatedAt: string
}

export interface TemplateDraft {
  name: string
  content: string
  description?: string
  tags?: string[]
  documentKind?: TemplateDocumentKind
  category?: string
}

export interface TemplateUpdate extends Omit<TemplateDraft, 'content'> {
  uuid: string
  /** Omitted = keep the stored content (lightweight updates such as a category move). */
  content?: string
}

export interface TemplateDeleteInput {
  uuid: string
}

export interface TemplateDocxInput {
  uuid: string
  pickToken?: string
}

// ── AI tagification (convert literal values of an imported letter into tags) ──

export interface TemplateTagifyAnalyzeInput {
  templateUuid: string
}

export interface TemplateTagifyProposal {
  /** Exact substring of the template text to replace. */
  originalText: string
  /** Canonical tag path (no braces), validated against the catalog. */
  suggestedTag: string
  confidence: 'high' | 'medium' | 'low'
  /** Number of occurrences found in the template text. */
  occurrences: number
}

export interface TemplateTagifyAnalyzeResult {
  proposals: TemplateTagifyProposal[]
}

export interface TemplateTagifyApplyInput {
  templateUuid: string
  replacements: Array<{ originalText: string; tagPath: string }>
}

export interface TemplateTagifyApplyResult {
  /** Total replaced occurrences. */
  applied: number
  failed: Array<{ originalText: string; reason: string }>
}
