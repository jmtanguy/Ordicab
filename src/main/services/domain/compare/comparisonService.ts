/**
 * Orchestrates a « Comparaison de conclusions » run: extract both
 * versions (disk-cached), diff them, detect newly cited pièces, then
 * verify the legal citations found in the added text. Citation
 * verification is best-effort — a missing PISTE configuration or an
 * API failure never fails the comparison itself.
 */
import type { LegalReferenceCheckItem } from '@shared/domain/legal'
import type {
  CompareProgressEvent,
  CompareRunInput,
  ComparisonCitations,
  ComparisonResult
} from '@shared/domain/compare'

import type { LegalService } from '../../legal/legalService'
import type { DocumentService } from '../documentService'

import { collectAddedText, computeDiff } from './diffEngine'
import { detectPieceReferences } from './pieceReferenceDetector'

/**
 * verifyReferences extracts at most 20 references per call, so the
 * added text is verified in chunks; this bounds each PISTE request.
 */
const CITATION_CHUNK_MAX_CHARS = 6000

/** verifyReferences caps extraction at this many references per call. */
const REFERENCE_EXTRACTION_CAP = 20

const STATUS_RANK: Record<LegalReferenceCheckItem['status'], number> = {
  found: 0,
  ambiguous: 1,
  not_found: 2,
  api_error: 3
}

export type CompareProgressCallback = (event: CompareProgressEvent) => void

export interface ComparisonService {
  compare(input: CompareRunInput, onProgress?: CompareProgressCallback): Promise<ComparisonResult>
}

function chunkAddedEntries(
  entries: Array<{ text: string; blockIndex: number }>
): Array<Array<{ text: string; blockIndex: number }>> {
  const chunks: Array<Array<{ text: string; blockIndex: number }>> = []
  let current: Array<{ text: string; blockIndex: number }> = []
  let currentLength = 0
  for (const entry of entries) {
    if (current.length > 0 && currentLength + entry.text.length > CITATION_CHUNK_MAX_CHARS) {
      chunks.push(current)
      current = []
      currentLength = 0
    }
    current.push(entry)
    currentLength += entry.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function createComparisonService(options: {
  documentService: DocumentService
  legalService: LegalService | null
}): ComparisonService {
  const { documentService, legalService } = options

  async function verifyAddedCitations(
    dossierId: string,
    added: Array<{ text: string; blockIndex: number }>,
    onProgress?: CompareProgressCallback
  ): Promise<ComparisonCitations> {
    if (!legalService) {
      return { references: [], truncated: false, unavailable: true }
    }
    const chunks = chunkAddedEntries(added)
    const byReference = new Map<string, LegalReferenceCheckItem & { blockIndex?: number }>()
    let truncated = false
    try {
      for (const [chunkIndex, chunk] of chunks.entries()) {
        onProgress?.({
          dossierId,
          stage: 'citations',
          chunk: chunkIndex + 1,
          totalChunks: chunks.length
        })
        const result = await legalService.verifyReferences({
          text: chunk.map((entry) => entry.text).join('\n\n')
        })
        if (result.references.length >= REFERENCE_EXTRACTION_CAP) truncated = true
        for (const reference of result.references) {
          const blockIndex = chunk.find((entry) =>
            entry.text.includes(reference.reference)
          )?.blockIndex
          const key = reference.normalizedReference ?? reference.reference
          const existing = byReference.get(key)
          if (!existing || STATUS_RANK[reference.status] < STATUS_RANK[existing.status]) {
            byReference.set(key, { ...reference, blockIndex })
          }
        }
      }
    } catch (error) {
      return {
        references: [],
        truncated: false,
        unavailable: true,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    return { references: [...byReference.values()], truncated, unavailable: false }
  }

  return {
    compare: async (input, onProgress) => {
      const { dossierId, oldDocumentPath, newDocumentPath } = input

      const extract = async (
        documentPath: string,
        stage: 'extract-old' | 'extract-new'
      ): Promise<Awaited<ReturnType<DocumentService['extractContent']>>> => {
        onProgress?.({ dossierId, stage, documentPath })
        return documentService.extractContent({ dossierId, documentPath }, (progress) => {
          onProgress?.({ dossierId, stage, documentPath, ...progress })
        })
      }

      // OCR is CPU-bound and progress events are per-document: sequential
      // extraction keeps the progress display legible.
      const oldContent = await extract(oldDocumentPath, 'extract-old')
      const newContent = await extract(newDocumentPath, 'extract-new')

      onProgress?.({ dossierId, stage: 'diff' })
      const { blocks, stats } = computeDiff(oldContent.text, newContent.text)
      const added = collectAddedText(blocks)

      const pieceReferences = detectPieceReferences(added)

      let citations: ComparisonCitations | undefined
      if (input.verifyCitations && added.length > 0) {
        citations = await verifyAddedCitations(dossierId, added, onProgress)
      }

      return {
        dossierId,
        oldDocument: {
          documentPath: oldDocumentPath,
          filename: oldContent.filename,
          method: oldContent.method
        },
        newDocument: {
          documentPath: newDocumentPath,
          filename: newContent.filename,
          method: newContent.method
        },
        blocks,
        stats,
        pieceReferences,
        citations
      }
    }
  }
}
