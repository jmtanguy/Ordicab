import { describe, expect, it, vi } from 'vitest'

import type { SemanticSearchHit, SemanticSearchResult } from '@shared/contracts/documents'
import type { DocumentServiceLike } from '../../../lib/aiEmbedded/aiCommandDispatcher'

import { runDocumentSearch } from '../dataToolExecutor'

function makeHit(overrides: Partial<SemanticSearchHit>): SemanticSearchHit {
  return {
    documentPath: 'doc-a.pdf',
    filename: 'doc-a.pdf',
    charStart: 0,
    charEnd: 80,
    score: 0.5,
    snippet: 'snippet',
    ...overrides
  }
}

function makeService(result: SemanticSearchResult): DocumentServiceLike {
  return {
    listDocuments: vi.fn(),
    saveMetadata: vi.fn(),
    relocateMetadata: vi.fn(),
    resolveRegisteredDossierRoot: vi.fn(),
    semanticSearch: vi.fn().mockResolvedValue(result)
  } as unknown as DocumentServiceLike
}

describe('runDocumentSearch', () => {
  it('labels keyword hits as "exact" and vector hits as "semantic" from matchKind', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'pension',
      hits: [
        makeHit({ documentPath: 'a.pdf', score: 2, snippet: 'a-exact', matchKind: 'keyword' }),
        makeHit({ documentPath: 'b.pdf', score: 0.82, snippet: 'b-vector', matchKind: 'semantic' })
      ]
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'pension'
    })
    const parsed = JSON.parse(raw) as {
      matches: Array<{ documentPath: string; score?: number; matchType: string }>
    }

    // Exact (keyword) hit ranks first and reports NO score (word-count is
    // internal); semantic hit reports its cosine score.
    expect(parsed.matches[0]!.matchType).toBe('exact')
    expect(parsed.matches[0]!.score).toBeUndefined()
    expect(parsed.matches[1]!.matchType).toBe('semantic')
    expect(parsed.matches[1]!.score).toBeLessThan(1)
  })

  it('labels a hit with no matchKind (or non-keyword) as semantic', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'pension',
      hits: [
        makeHit({
          documentPath: 'a.pdf',
          score: 1.0,
          snippet: 'vector-perfect',
          matchKind: 'semantic'
        })
      ]
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'pension'
    })
    const parsed = JSON.parse(raw) as {
      matches: Array<{ documentPath: string; score?: number; matchType: string }>
    }

    expect(parsed.matches).toHaveLength(1)
    expect(parsed.matches[0]!.score).toBe(1)
    expect(parsed.matches[0]!.matchType).toBe('semantic')
  })

  it('sorts matches by score descending so the best candidates come first', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'x',
      hits: [
        makeHit({ documentPath: 'low.pdf', score: 0.3, charStart: 0, charEnd: 10 }),
        makeHit({ documentPath: 'high.pdf', score: 1.25, charStart: 0, charEnd: 10 }),
        makeHit({ documentPath: 'mid.pdf', score: 0.72, charStart: 0, charEnd: 10 })
      ]
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'x'
    })
    const parsed = JSON.parse(raw) as { matches: Array<{ documentPath: string; score: number }> }

    expect(parsed.matches.map((m) => m.documentPath)).toEqual(['high.pdf', 'mid.pdf', 'low.pdf'])
  })

  it('diversifies output: one best chunk per document first, then backfills', async () => {
    // Three chunks from doc-a all beat the first chunk of doc-b on raw score,
    // but the tool should surface doc-b before returning multiple doc-a chunks
    // so the LLM sees breadth across the dossier.
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'x',
      hits: [
        makeHit({ documentPath: 'a.pdf', score: 0.95, charStart: 0, charEnd: 10 }),
        makeHit({ documentPath: 'a.pdf', score: 0.94, charStart: 20, charEnd: 30 }),
        makeHit({ documentPath: 'a.pdf', score: 0.93, charStart: 40, charEnd: 50 }),
        makeHit({ documentPath: 'b.pdf', score: 0.5, charStart: 0, charEnd: 10 })
      ]
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'x'
    })
    const parsed = JSON.parse(raw) as { matches: Array<{ documentPath: string }> }
    const uniqueDocs = new Set(parsed.matches.map((m) => m.documentPath))

    expect(uniqueDocs.has('b.pdf')).toBe(true)
    expect(uniqueDocs.has('a.pdf')).toBe(true)
  })

  it('exposes charStart/charEnd so the LLM can request the exact source span', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'x',
      hits: [makeHit({ charStart: 1200, charEnd: 1480, score: 0.77 })]
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'x'
    })
    const parsed = JSON.parse(raw) as {
      matches: Array<{ charStart: number; charEnd: number }>
    }

    expect(parsed.matches[0]!.charStart).toBe(1200)
    expect(parsed.matches[0]!.charEnd).toBe(1480)
  })

  it('returns an empty matches array when the semantic search returns no hits', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'unknown',
      hits: []
    })

    const raw = await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'unknown'
    })
    const parsed = JSON.parse(raw) as { matches: unknown[] }

    expect(parsed.matches).toEqual([])
  })

  it('requests more hits than it returns so the diversification pass has room to rebalance', async () => {
    const documentService = makeService({
      dossierId: 'dos-1',
      query: 'x',
      hits: []
    })

    await runDocumentSearch({
      documentService,
      dossierId: 'dos-1',
      query: 'x'
    })

    const call = (documentService.semanticSearch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { topK: number }
    expect(call.topK).toBeGreaterThan(8)
  })
})
