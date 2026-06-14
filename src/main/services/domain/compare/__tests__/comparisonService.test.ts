import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompareProgressEvent } from '@shared/domain/compare'
import type { LegalReferenceCheckItem } from '@shared/domain/legal'

import { createComparisonService } from '../comparisonService'

function checkItem(overrides: Partial<LegalReferenceCheckItem> = {}): LegalReferenceCheckItem {
  return {
    reference: 'article 1240 du code civil',
    normalizedReference: 'art. 1240 · Code civil',
    status: 'found',
    confidence: 'high',
    source: 'legifrance',
    matches: [],
    ...overrides
  }
}

const baseInput = {
  dossierId: 'dos-1',
  oldDocumentPath: 'Conclusions/v1.docx',
  newDocumentPath: 'Conclusions/v2.pdf',
  verifyCitations: true
}

describe('comparisonService', () => {
  const extractContent = vi.fn()
  const verifyReferences = vi.fn()
  const documentService = { extractContent } as never
  const legalService = { verifyReferences } as never

  beforeEach(() => {
    vi.resetAllMocks()
    extractContent.mockImplementation(async ({ documentPath }: { documentPath: string }) => ({
      documentPath,
      filename: documentPath.split('/').pop() ?? documentPath,
      text:
        documentPath === baseInput.oldDocumentPath
          ? 'Premier paragraphe commun à toutes les versions.'
          : 'Premier paragraphe commun à toutes les versions.\n\nNouveau moyen fondé sur l’article 1240 du code civil et la pièce n°12.',
      textLength: 10,
      method: documentPath.endsWith('.pdf') ? 'embedded' : 'docx',
      status: { state: 'extracted', isExtractable: true }
    }))
    verifyReferences.mockResolvedValue({ references: [checkItem()] })
  })

  function createService(): ReturnType<typeof createComparisonService> {
    return createComparisonService({ documentService, legalService })
  }

  it('extracts both documents and forwards staged progress', async () => {
    const events: CompareProgressEvent[] = []
    const result = await createService().compare(baseInput, (event) => events.push(event))

    expect(extractContent).toHaveBeenCalledTimes(2)
    expect(extractContent.mock.calls[0]![0]).toEqual({
      dossierId: 'dos-1',
      documentPath: baseInput.oldDocumentPath
    })
    expect(extractContent.mock.calls[1]![0]).toEqual({
      dossierId: 'dos-1',
      documentPath: baseInput.newDocumentPath
    })
    expect(events.map((event) => event.stage)).toEqual([
      'extract-old',
      'extract-new',
      'diff',
      'citations'
    ])
    expect(result.oldDocument).toEqual({
      documentPath: baseInput.oldDocumentPath,
      filename: 'v1.docx',
      method: 'docx'
    })
    expect(result.newDocument.method).toBe('embedded')
    expect(result.stats.addedBlocks).toBe(1)
  })

  it('forwards OCR extraction progress with the active stage', async () => {
    extractContent.mockImplementation(async (input, onProgress) => {
      onProgress?.({ phase: 'ocr', page: 2, totalPages: 5 })
      return {
        documentPath: input.documentPath,
        filename: 'x.pdf',
        text: 'Texte.',
        textLength: 6,
        method: 'tesseract',
        status: { state: 'extracted', isExtractable: true }
      }
    })
    const events: CompareProgressEvent[] = []
    await createService().compare({ ...baseInput, verifyCitations: false }, (event) =>
      events.push(event)
    )
    const ocrEvents = events.filter((event) => event.phase === 'ocr')
    expect(ocrEvents).toHaveLength(2)
    expect(ocrEvents[0]!).toMatchObject({ stage: 'extract-old', page: 2, totalPages: 5 })
    expect(ocrEvents[1]!).toMatchObject({ stage: 'extract-new', page: 2, totalPages: 5 })
  })

  it('detects newly cited pièces in the added text', async () => {
    const result = await createService().compare(baseInput)
    expect(result.pieceReferences).toHaveLength(1)
    expect(result.pieceReferences[0]!.numbers).toEqual([12])
  })

  it('skips citation verification when verifyCitations is false', async () => {
    const result = await createService().compare({ ...baseInput, verifyCitations: false })
    expect(verifyReferences).not.toHaveBeenCalled()
    expect(result.citations).toBeUndefined()
  })

  it('skips citation verification when nothing was added', async () => {
    extractContent.mockImplementation(async ({ documentPath }: { documentPath: string }) => ({
      documentPath,
      filename: 'same.pdf',
      text: 'Texte identique.',
      textLength: 16,
      method: 'embedded',
      status: { state: 'extracted', isExtractable: true }
    }))
    const result = await createService().compare(baseInput)
    expect(verifyReferences).not.toHaveBeenCalled()
    expect(result.citations).toBeUndefined()
  })

  it('verifies added text, tags references with their block and maps verdicts', async () => {
    const result = await createService().compare(baseInput)
    expect(verifyReferences).toHaveBeenCalledTimes(1)
    const sentText = verifyReferences.mock.calls[0]![0].text
    expect(sentText).toContain('article 1240 du code civil')
    expect(sentText).not.toContain('Premier paragraphe commun')
    expect(result.citations).toBeDefined()
    expect(result.citations?.unavailable).toBe(false)
    expect(result.citations?.references).toHaveLength(1)
    const addedBlockIndex = result.blocks.findIndex((block) => block.type === 'added')
    expect(result.citations?.references[0]!.blockIndex).toBe(addedBlockIndex)
  })

  it('chunks long added corpora and dedupes references keeping the best status', async () => {
    const longAdded = Array.from(
      { length: 4 },
      (_, i) =>
        `Moyen additionnel numéro ${i} citant l'article 1240 du code civil. ${'développement '.repeat(200)}`
    )
    extractContent.mockImplementation(async ({ documentPath }: { documentPath: string }) => ({
      documentPath,
      filename: 'x',
      text:
        documentPath === baseInput.oldDocumentPath
          ? 'Socle commun.'
          : ['Socle commun.', ...longAdded].join('\n\n'),
      textLength: 1,
      method: 'embedded',
      status: { state: 'extracted', isExtractable: true }
    }))
    verifyReferences
      .mockResolvedValueOnce({ references: [checkItem({ status: 'ambiguous' })] })
      .mockResolvedValue({ references: [checkItem({ status: 'found' })] })

    const result = await createService().compare(baseInput)
    expect(verifyReferences.mock.calls.length).toBeGreaterThan(1)
    expect(result.citations?.references).toHaveLength(1)
    expect(result.citations?.references[0]!.status).toBe('found')
  })

  it('flags truncation when a chunk hits the 20-reference extraction cap', async () => {
    verifyReferences.mockResolvedValue({
      references: Array.from({ length: 20 }, (_, i) => checkItem({ reference: `réf ${i}` }))
    })
    const result = await createService().compare(baseInput)
    expect(result.citations?.truncated).toBe(true)
  })

  it('degrades gracefully when the legal service throws', async () => {
    verifyReferences.mockRejectedValue(new Error('PISTE credentials missing'))
    const result = await createService().compare(baseInput)
    expect(result.citations).toEqual({
      references: [],
      truncated: false,
      unavailable: true,
      error: 'PISTE credentials missing'
    })
    expect(result.blocks.length).toBeGreaterThan(0)
    expect(result.stats.addedBlocks).toBe(1)
  })

  it('reports citations unavailable when no legal service is wired', async () => {
    const service = createComparisonService({ documentService, legalService: null })
    const result = await service.compare(baseInput)
    expect(result.citations).toEqual({ references: [], truncated: false, unavailable: true })
  })
})
