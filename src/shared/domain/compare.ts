/**
 * Comparaison de conclusions — diff between two versions of a document
 * (typically opposing counsel's briefs, possibly DOCX vs PDF), with
 * verification of the legal citations found in the ADDED text and
 * detection of newly cited « pièce n°X » references.
 */
import type { LegalReferenceCheckItem } from './legal'

export type DiffSegmentKind = 'same' | 'added' | 'removed'

export interface DiffSegment {
  kind: DiffSegmentKind
  text: string
}

export type DiffBlockType = 'unchanged' | 'added' | 'removed' | 'modified'

export interface DiffBlock {
  type: DiffBlockType
  /** Word-level segments for 'modified'; a single segment otherwise. */
  segments: DiffSegment[]
  /**
   * 'unchanged' collapse marker: number of paragraphs elided from the
   * payload (one context paragraph is kept on each side of the run).
   */
  collapsedCount?: number
}

export interface ComparisonDocumentInfo {
  /** Document relativePath — matches DocumentRecord.relativePath. */
  documentPath: string
  filename: string
  /** Extraction method — 'tesseract' means OCR (noisy diff warning). */
  method: 'direct' | 'docx' | 'embedded' | 'tesseract' | 'cached'
}

export interface ComparisonStats {
  addedWords: number
  removedWords: number
  addedBlocks: number
  removedBlocks: number
  modifiedBlocks: number
}

export interface DetectedPieceReference {
  /** Expanded numbers, e.g. « pièces nos 4 à 7 » → [4, 5, 6, 7]. */
  numbers: number[]
  /** Raw matched text, e.g. "pièce adverse n°3". */
  raw: string
  /** Surrounding excerpt (~160 chars) for context. */
  excerpt: string
  /** Index of the diff block the reference was found in. */
  blockIndex: number
}

export interface ComparisonCitations {
  references: Array<LegalReferenceCheckItem & { blockIndex?: number }>
  /** True when a verification chunk hit the 20-reference extraction cap. */
  truncated: boolean
  /** Legal service not configured or failed — diff still succeeds. */
  unavailable: boolean
  error?: string
}

export interface CompareRunInput {
  dossierId: string
  /** relativePath of the older version within the dossier. */
  oldDocumentPath: string
  /** relativePath of the newer version within the dossier. */
  newDocumentPath: string
  verifyCitations: boolean
}

export interface ComparisonResult {
  dossierId: string
  oldDocument: ComparisonDocumentInfo
  newDocument: ComparisonDocumentInfo
  blocks: DiffBlock[]
  stats: ComparisonStats
  pieceReferences: DetectedPieceReference[]
  /** Undefined when verifyCitations=false or no added text. */
  citations?: ComparisonCitations
}

export type CompareStage = 'extract-old' | 'extract-new' | 'diff' | 'citations'

export interface CompareProgressEvent {
  dossierId: string
  stage: CompareStage
  documentPath?: string
  /** Forwarded from document extraction progress during OCR. */
  phase?: 'embedded' | 'ocr'
  page?: number
  totalPages?: number
  /** Citation verification: chunk i of n. */
  chunk?: number
  totalChunks?: number
}
