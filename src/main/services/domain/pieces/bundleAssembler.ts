/**
 * Assembles the merged "pièces cotées" bundle: index pages (bordereau with a
 * Page column) followed by every stamped pièce in numeric order.
 *
 * Page numbers are computed in two passes because the index page count is not
 * known until the index itself is rendered:
 *   1. render the index with placeholder page numbers and measure its length P
 *   2. pièce k then starts at P + 1 + Σ pages of pièces 1..k-1; re-render with
 *      the real numbers and assert the index length did not change (row heights
 *      are value-independent; a bounded loop absorbs the pathological case).
 */
import type { PDFDocument as PdfLibDocument } from 'pdf-lib'

import { IpcErrorCode } from '@shared/types'

import { PiecesServiceError } from './piecesError'

export interface BundlePieceEntry {
  pieceNumber: number
  document: PdfLibDocument
}

export interface PageAssignment {
  pieceNumber: number
  pageStart: number
  pageCount: number
}

const MAX_INDEX_PASSES = 3

export async function assembleBundle(options: {
  pieces: BundlePieceEntry[]
  /** Renders the index PDF for the given page assignments (null = placeholder pass). */
  renderIndexPdf: (assignments: PageAssignment[] | null) => Promise<Uint8Array>
}): Promise<{ bytes: Uint8Array; indexPageCount: number; assignments: PageAssignment[] }> {
  const { PDFDocument } = await import('pdf-lib')
  const pageCounts = options.pieces.map((piece) => piece.document.getPageCount())

  const computeAssignments = (indexPageCount: number): PageAssignment[] => {
    let nextStart = indexPageCount + 1
    return options.pieces.map((piece, index) => {
      const assignment: PageAssignment = {
        pieceNumber: piece.pieceNumber,
        pageStart: nextStart,
        pageCount: pageCounts[index]!
      }
      nextStart += pageCounts[index]!
      return assignment
    })
  }

  let indexBytes = await options.renderIndexPdf(null)
  let indexPageCount = (await PDFDocument.load(indexBytes)).getPageCount()
  let assignments = computeAssignments(indexPageCount)

  for (let pass = 0; pass < MAX_INDEX_PASSES; pass += 1) {
    indexBytes = await options.renderIndexPdf(assignments)
    const renderedCount = (await PDFDocument.load(indexBytes)).getPageCount()
    if (renderedCount === indexPageCount) break
    indexPageCount = renderedCount
    assignments = computeAssignments(indexPageCount)
    if (pass === MAX_INDEX_PASSES - 1) {
      throw new PiecesServiceError(
        IpcErrorCode.FILE_SYSTEM_ERROR,
        'The bundle index page count did not stabilize.'
      )
    }
  }

  const output = await PDFDocument.create()
  const indexDocument = await PDFDocument.load(indexBytes)
  for (const page of await output.copyPages(indexDocument, indexDocument.getPageIndices())) {
    output.addPage(page)
  }
  for (const piece of options.pieces) {
    for (const page of await output.copyPages(piece.document, piece.document.getPageIndices())) {
      output.addPage(page)
    }
  }

  return { bytes: await output.save(), indexPageCount, assignments }
}
