export interface GeneratedDocumentResult {
  outputPath: string
  /**
   * Stable UUID of the persisted document record, when metadata was saved
   * during generation (i.e. when description or tags were provided). Callers
   * that need to reference the generated document immediately should prefer
   * this UUID over resolving the path against a possibly stale documents list.
   */
  documentUuid?: string
}

export interface GeneratedDraftResult {
  draftHtml: string
  suggestedFilename: string
  unresolvedTags: string[]
  resolvedTags: Record<string, string>
  /**
   * Manual values memorized from the last generation of this template for this
   * dossier. Only returned on the initial preview (no tagOverrides) so the
   * wizard can pre-fill fields the context cannot resolve.
   */
  memorizedOverrides?: Record<string, string>
}

export interface DocxPreviewResult {
  tagPaths: string[]
  resolvedTags: Record<string, string>
  suggestedFilename: string
  htmlPreview: string
  /** See GeneratedDraftResult.memorizedOverrides. */
  memorizedOverrides?: Record<string, string>
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
  type: 'contacts' | 'dossier' | 'general-key-dates' | 'entity' | 'cabinet-billing' | 'templates'
  changedAt: string
}

export interface TemplateDocxSyncedEvent {
  templateUuid: string
  html: string
}

export interface DocumentWatchStatus {
  dossierId: string
  status: 'available' | 'unavailable'
  changedAt: string
  message: string | null
}

export interface DocumentContentStatus {
  documentPath: string
  status: import('../domain/document').DocumentTextExtractionStatus
}

export type DocumentAvailabilityEvent = DocumentWatchStatus

export interface DocumentExtractProgressEvent {
  dossierId: string
  documentPath: string
  phase: 'embedded' | 'ocr'
  page: number
  totalPages: number
}

/**
 * Maps a 1-based source page to the character offset where its content starts
 * in the flat extracted text. The table is sparse: pages that produced no text
 * (blank/skipped during OCR) are omitted, so a gap between two entries means the
 * page in between contributed nothing. Use `pageForOffset` to resolve any
 * character offset back to its page.
 */
export interface DocumentPageOffset {
  /** 1-based page number in the source file. */
  page: number
  /** Character offset into the extracted text where this page's content begins. */
  charStart: number
}

export interface SemanticSearchQuery {
  dossierId: string
  query: string
  /** Maximum hits to return. Defaults to 10 on the service side. */
  topK?: number
}

export interface SemanticSearchHit {
  /** Document relativePath — matches DocumentRecord.id and DocumentRecord.relativePath. */
  documentPath: string
  /** Document filename for display. */
  filename: string
  /** Inclusive character offset into the extracted text. */
  charStart: number
  /** Exclusive character offset into the extracted text. */
  charEnd: number
  /**
   * 1-based source page the matched passage starts on, when the document's
   * extraction tracked page boundaries (PDF embedded text / OCR). Undefined for
   * formats without pages (DOCX, plain text) or caches predating page tracking.
   */
  page?: number
  /** Cosine similarity in [-1, 1]. Higher = more relevant. */
  score: number
  /** Matched passage text framed by surrounding sentences for context. */
  snippet: string
  /** Offset within `snippet` where the best-matching sentence starts. */
  snippetMatchStart?: number
  /** Offset within `snippet` where the best-matching sentence ends. */
  snippetMatchEnd?: number
  /**
   * How this hit was found. 'keyword' = the document literally contains a query
   * word (exact result); 'semantic' = vector similarity only (approximate). The
   * renderer groups results by this. Undefined is treated as 'semantic'.
   */
  matchKind?: 'keyword' | 'semantic'
}

export interface SemanticSearchResult {
  dossierId: string
  query: string
  hits: SemanticSearchHit[]
}

export interface GlobalSearchQuery {
  query: string
  /** Maximum hits to return per dossier before the global merge. Defaults to 10 on the service side. */
  topK?: number
}

/** A {@link SemanticSearchHit} carrying the dossier it was found in, for cross-dossier search. */
export interface GlobalSearchHit extends SemanticSearchHit {
  /** Slug of the source dossier — usable as a dossierId for follow-up document calls. */
  dossierId: string
  /** Display name of the source dossier. */
  dossierName: string
}

export interface GlobalSearchResult {
  query: string
  hits: GlobalSearchHit[]
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
  documentPath: string
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

export interface EmailAttachmentSummary {
  /** Position in the parsed attachment list — duplicate filenames are common, so addressing is index-based. */
  index: number
  filename: string
  byteLength: number | null
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
  attachments: EmailAttachmentSummary[]
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
