import { describe, expect, it } from 'vitest'

import { mergeHybridHits, type SemanticSearchHit } from '../textSearchShared'

function hit(documentId: string, charStart: number, score: number): SemanticSearchHit {
  return { documentId, charStart, charEnd: charStart + 10, score, snippet: '' }
}

describe('mergeHybridHits', () => {
  it('puts keyword hits first and tags lanes', () => {
    const merged = mergeHybridHits([hit('a', 0, 2)], [hit('b', 5, 0.9)])
    expect(merged.map((m) => m.matchKind)).toEqual(['keyword', 'semantic'])
    expect(merged.map((m) => m.hit.documentId)).toEqual(['a', 'b'])
  })

  it('drops a semantic hit on a document already represented by a keyword hit', () => {
    const merged = mergeHybridHits([hit('a', 0, 2)], [hit('a', 100, 0.95), hit('b', 5, 0.8)])
    // 'a' is already a keyword hit, so its semantic span is dropped; 'b' survives.
    expect(merged.map((m) => `${m.matchKind}:${m.hit.documentId}`)).toEqual([
      'keyword:a',
      'semantic:b'
    ])
  })

  it('drops a semantic hit duplicating the exact same keyword span', () => {
    const merged = mergeHybridHits([hit('a', 0, 2)], [hit('a', 0, 0.9)])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.matchKind).toBe('keyword')
  })
})
