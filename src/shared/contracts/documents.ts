export interface GeneratedDocumentResult {
  outputPath: string
}

export interface GeneratedDraftResult {
  draftHtml: string
  suggestedFilename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
}

export interface DocxPreviewResult {
  tagPaths: string[]
  resolvedTags: Record<string, string>
  suggestedFilename: string
  htmlPreview: string
}

export interface ClaudeMdRegenerateInput {
  dossierId?: string
}

export interface ClaudeMdStatus {
  status: 'idle' | 'running' | 'error'
  updatedAt: string | null
}

export interface DocumentChangeEvent {
  dossierId: string
  kind: 'documents-changed'
  changedAt: string
}

export interface OrdicabDataChangedEvent {
  dossierId: string | null
  type: 'contacts' | 'dossier' | 'entity' | 'templates'
  changedAt: string
}

export interface TemplateDocxSyncedEvent {
  templateId: string
  html: string
}

export interface DocumentWatchStatus {
  dossierId: string
  status: 'available' | 'unavailable'
  changedAt: string
  message: string | null
}

export interface DocumentContentStatus {
  documentId: string
  status: import('../domain/document').DocumentTextExtractionStatus
}

export type DocumentAvailabilityEvent = DocumentWatchStatus

export interface DocumentExtractProgressEvent {
  dossierId: string
  documentId: string
  phase: 'embedded' | 'ocr'
  page: number
  totalPages: number
}

export interface SemanticSearchQuery {
  dossierId: string
  query: string
  /** Maximum hits to return. Defaults to 10 on the service side. */
  topK?: number
}

export interface SemanticSearchHit {
  /** Document relativePath — matches DocumentRecord.id and DocumentRecord.relativePath. */
  documentId: string
  /** Document filename for display. */
  filename: string
  /** Inclusive character offset into the extracted text. */
  charStart: number
  /** Exclusive character offset into the extracted text. */
  charEnd: number
  /** Cosine similarity in [-1, 1]. Higher = more relevant. */
  score: number
  /** Matched passage text, capped to ~280 chars. */
  snippet: string
}

export interface SemanticSearchResult {
  dossierId: string
  query: string
  hits: SemanticSearchHit[]
}

export type DocumentPreviewSourceType =
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'txt'
  | 'eml'
  | 'msg'
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'tif'
  | 'tiff'
  | 'unknown'

interface DocumentPreviewBase {
  documentId: string
  filename: string
  mimeType: string | null
  byteLength: number
  sourceType: DocumentPreviewSourceType
}

export interface PdfDocumentPreview extends DocumentPreviewBase {
  kind: 'pdf'
  sourceType: 'pdf'
  mimeType: 'application/pdf'
  data: ArrayBuffer
}

export interface DocxDocumentPreview extends DocumentPreviewBase {
  kind: 'docx'
  sourceType: 'docx'
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  data: ArrayBuffer
}

export interface TextDocumentPreview extends DocumentPreviewBase {
  kind: 'text'
  sourceType: 'doc' | 'txt'
  mimeType: 'text/plain'
  text: string
}

export interface EmailDocumentPreview extends DocumentPreviewBase {
  kind: 'email'
  sourceType: 'eml' | 'msg'
  mimeType: 'message/rfc822' | 'application/vnd.ms-outlook'
  subject: string | null
  from: string | null
  to: string | null
  cc: string | null
  date: string | null
  attachments: string[]
  text: string
}

export interface ImageDocumentPreview extends DocumentPreviewBase {
  kind: 'image'
  sourceType: 'png' | 'jpg' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tif' | 'tiff'
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp' | 'image/tiff'
  data: ArrayBuffer
}

export interface UnsupportedDocumentPreview extends DocumentPreviewBase {
  kind: 'unsupported'
  reason: 'unsupported-type' | 'file-too-large'
  message: string
}

export type DocumentPreview =
  | PdfDocumentPreview
  | DocxDocumentPreview
  | TextDocumentPreview
  | EmailDocumentPreview
  | ImageDocumentPreview
  | UnsupportedDocumentPreview
