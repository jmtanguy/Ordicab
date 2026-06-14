export interface DocumentRecord {
  path: string
  uuid: string
  dossierId: string
  filename: string
  byteLength: number
  relativePath: string
  modifiedAt: string
  description?: string
  tags: string[]
  textExtraction: DocumentTextExtractionStatus
}

export type DocumentTextExtractionState = 'not-extractable' | 'extractable' | 'extracted'

export interface DocumentTextExtractionStatus {
  state: DocumentTextExtractionState
  isExtractable: boolean
}

export interface StoredDocumentMetadata {
  uuid: string
  relativePath: string
  filename?: string
  byteLength?: number
  modifiedAt?: string
  description: string | undefined
  tags: string[]
}

export interface DocumentMetadataUpdate {
  dossierId: string
  documentPath: string
  description?: string
  tags: string[]
}

export interface DocumentMetadataDraft {
  description?: string
  tags: string[]
}

export interface DocumentPreviewInput {
  dossierId: string
  documentPath: string
  forceRefresh?: boolean
  readCacheOnly?: boolean
}

export interface DocumentExtractedContent {
  documentPath: string
  filename: string
  text: string
  textLength: number
  method: 'direct' | 'docx' | 'embedded' | 'tesseract' | 'cached'
  status: DocumentTextExtractionStatus
}

export interface DocumentRelocationInput {
  dossierId: string
  documentUuid: string
  toDocumentPath: string
  fromDocumentPath?: string
}

export interface DocumentFolderCreateInput {
  dossierId: string
  parentPath?: string
  name: string
}

export interface DocumentFolderRenameInput {
  dossierId: string
  fromPath: string
  newName: string
}

export interface DocumentFolderDeleteInput {
  dossierId: string
  path: string
}

export interface DocumentFileRenameInput {
  dossierId: string
  documentPath: string
  newFilename: string
}

export interface DocumentFileMoveInput {
  dossierId: string
  documentPaths: string[]
  /** Destination folder, relative to the dossier root. Empty string targets the root. */
  targetFolderPath: string
}

export interface DocumentFolderMoveInput {
  dossierId: string
  fromPath: string
  /** Destination folder, relative to the dossier root. Empty string targets the root. */
  targetFolderPath: string
}

export interface DocumentMoveResult {
  moved: Array<{ fromPath: string; record: DocumentRecord }>
  failed: Array<{ documentPath: string; error: string }>
}

export interface DocumentImportInput {
  dossierId: string
  /** Destination folder, relative to the dossier root. Empty string targets the root. */
  targetFolderPath: string
  /** Absolute paths of external files or folders to copy into the dossier. */
  sourcePaths: string[]
}

export interface DocumentImportResult {
  imported: Array<{ sourcePath: string; relativePath: string }>
  failed: Array<{ sourcePath: string; error: string }>
}

export interface DocumentTrashInput {
  dossierId: string
  documentPaths: string[]
}

export interface DocumentTrashResult {
  /** null when no file could be moved to the trash. */
  deletionId: string | null
  trashedCount: number
  failed: Array<{ documentPath: string; error: string }>
}

export interface DocumentTrashRestoreInput {
  dossierId: string
  deletionId: string
}

export interface DocumentTrashRestoreResult {
  restoredCount: number
}

export interface DocumentTrashEntry {
  deletionId: string
  deletedAt: string
  kind: 'files' | 'folder'
  folderPath?: string
  items: Array<{ relativePath: string }>
}

export interface DocumentFolderDeleteResult {
  deletionId: string
}

export interface EmailAttachmentSaveInput {
  dossierId: string
  documentPath: string
  /** Indexes into the parsed attachment list; undefined saves all attachments. */
  attachmentIndexes?: number[]
  /** Destination folder relative to the dossier root; defaults to the email's own folder. */
  targetFolderPath?: string
}

export interface EmailAttachmentSaveResult {
  saved: Array<{ index: number; relativePath: string }>
  failed: Array<{ index: number; filename: string; error: string }>
}

export interface PdfPageRange {
  /** 1-based, inclusive. */
  from: number
  to: number
}

export interface PdfExtractPagesInput {
  dossierId: string
  documentPath: string
  ranges: PdfPageRange[]
  outputFilename?: string
}

export interface PdfMergeInput {
  dossierId: string
  /** Merge order follows the array order. */
  documentPaths: string[]
  outputFilename: string
  /** Destination folder relative to the dossier root; defaults to the first source's folder. */
  targetFolderPath?: string
}

export interface PdfSplitInput {
  dossierId: string
  documentPath: string
  mode: 'each-page' | { ranges: PdfPageRange[] }
}

export interface PdfOperationResult {
  relativePaths: string[]
}
