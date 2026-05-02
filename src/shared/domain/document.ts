export interface DocumentRecord {
  id: string
  uuid?: string
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
  uuid?: string
  relativePath: string
  filename?: string
  byteLength?: number
  modifiedAt?: string
  description: string | undefined
  tags: string[]
}

export interface DocumentMetadataUpdate {
  dossierId: string
  documentId: string
  description?: string
  tags: string[]
}

export interface DocumentMetadataDraft {
  description?: string
  tags: string[]
}

export interface DocumentPreviewInput {
  dossierId: string
  documentId: string
  forceRefresh?: boolean
  readCacheOnly?: boolean
}

export interface DocumentExtractedContent {
  documentId: string
  filename: string
  text: string
  textLength: number
  method: 'direct' | 'docx' | 'embedded' | 'tesseract' | 'cached'
  status: DocumentTextExtractionStatus
}

export interface DocumentRelocationInput {
  dossierId: string
  documentUuid: string
  toDocumentId: string
  fromDocumentId?: string
}
