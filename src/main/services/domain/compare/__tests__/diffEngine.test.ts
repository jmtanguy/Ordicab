import { describe, expect, it } from 'vitest'

import { collectAddedText, computeDiff, normalizeForComparison, paragraphKey } from '../diffEngine'

function paragraphs(...items: string[]): string {
  return items.join('\n\n')
}

describe('normalizeForComparison', () => {
  it('collapses in-paragraph line wraps and whitespace', () => {
    expect(normalizeForComparison('foo\nbar  baz')).toEqual(['foo bar baz'])
  })

  it('repairs PDF end-of-line hyphenation', () => {
    expect(normalizeForComparison('les conclu-\nsions récapitulatives')).toEqual([
      'les conclusions récapitulatives'
    ])
  })

  it('drops standalone page markers', () => {
    expect(
      normalizeForComparison(paragraphs('Premier moyen', '3/25', 'Page 4', 'Second moyen'))
    ).toEqual(['Premier moyen', 'Second moyen'])
  })

  it('drops short paragraphs repeated at least three times (running headers)', () => {
    const header = 'Dupont c/ Durand - RG 23/01234'
    const result = normalizeForComparison(
      paragraphs(header, 'Premier paragraphe.', header, 'Second paragraphe.', header)
    )
    expect(result).toEqual(['Premier paragraphe.', 'Second paragraphe.'])
  })

  it('normalizes non-breaking spaces and curly apostrophes', () => {
    expect(normalizeForComparison('l’article 1240')).toEqual(["l'article 1240"])
  })
})

describe('paragraphKey', () => {
  it('ignores case and punctuation but keeps words and numbers', () => {
    expect(paragraphKey('Sur l’article 1240, du Code civil :')).toBe(
      paragraphKey('sur l article 1240 du code civil')
    )
  })
})

describe('computeDiff', () => {
  const base = [
    'Premier paragraphe sur la recevabilité de la demande.',
    'Deuxième paragraphe sur la responsabilité contractuelle du vendeur.',
    'Troisième paragraphe sur le préjudice subi par le demandeur.'
  ]

  it('returns only unchanged blocks and zero stats for identical texts', () => {
    const { blocks, stats } = computeDiff(paragraphs(...base), paragraphs(...base))
    expect(blocks.every((block) => block.type === 'unchanged')).toBe(true)
    expect(stats).toEqual({
      addedWords: 0,
      removedWords: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      modifiedBlocks: 0
    })
  })

  it('reports an appended paragraph as a single added block', () => {
    const addition = 'Nouveau moyen fondé sur l’article 1240 du code civil.'
    const { blocks, stats } = computeDiff(paragraphs(...base), paragraphs(...base, addition))
    const added = blocks.filter((block) => block.type === 'added')
    expect(added).toHaveLength(1)
    expect(added[0]!.segments).toEqual([{ kind: 'added', text: addition.replace('’', "'") }])
    expect(stats.addedBlocks).toBe(1)
    expect(stats.removedBlocks).toBe(0)
  })

  it('reports a deleted paragraph as a single removed block', () => {
    const { blocks, stats } = computeDiff(paragraphs(...base), paragraphs(base[0]!, base[2]!))
    const removed = blocks.filter((block) => block.type === 'removed')
    expect(removed).toHaveLength(1)
    expect(removed[0]!.segments[0]!.text).toBe(base[1])
    expect(stats.removedBlocks).toBe(1)
    expect(stats.addedBlocks).toBe(0)
  })

  it('reports a reworded paragraph as one modified block with word-level segments', () => {
    const reworded = 'Deuxième paragraphe sur la responsabilité délictuelle du fabricant.'
    const { blocks, stats } = computeDiff(
      paragraphs(...base),
      paragraphs(base[0]!, reworded, base[2]!)
    )
    const modified = blocks.filter((block) => block.type === 'modified')
    expect(modified).toHaveLength(1)
    const addedWords = modified[0]!.segments
      .filter((segment) => segment.kind === 'added')
      .map((segment) => segment.text.trim())
    const removedWords = modified[0]!.segments
      .filter((segment) => segment.kind === 'removed')
      .map((segment) => segment.text.trim())
    expect(addedWords.join(' ')).toContain('délictuelle')
    expect(addedWords.join(' ')).toContain('fabricant')
    expect(removedWords.join(' ')).toContain('contractuelle')
    expect(removedWords.join(' ')).toContain('vendeur')
    expect(stats.modifiedBlocks).toBe(1)
    expect(stats.addedBlocks).toBe(0)
    expect(stats.removedBlocks).toBe(0)
  })

  it('ignores line-wrap-only differences inside a paragraph', () => {
    const wrapped = base.map((p) =>
      p.replace(' sur la ', ' sur\nla ').replace(' sur le ', ' sur\nle ')
    )
    const { stats } = computeDiff(paragraphs(...base), paragraphs(...wrapped))
    expect(stats).toEqual({
      addedWords: 0,
      removedWords: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      modifiedBlocks: 0
    })
  })

  it('ignores hyphenation-only differences', () => {
    const hyphenated = paragraphs(
      'les conclu-\nsions récapitulatives signifiées par la partie adverse'
    )
    const plain = paragraphs('les conclusions récapitulatives signifiées par la partie adverse')
    const { stats } = computeDiff(hyphenated, plain)
    expect(stats.addedWords + stats.removedWords + stats.modifiedBlocks).toBe(0)
  })

  it('ignores a running header present in only one version', () => {
    const header = 'Dupont c/ Durand - RG 23/01234'
    const withHeaders = paragraphs(header, base[0]!, header, base[1]!, header, base[2]!)
    const { stats } = computeDiff(withHeaders, paragraphs(...base))
    expect(stats).toEqual({
      addedWords: 0,
      removedWords: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      modifiedBlocks: 0
    })
  })

  it('collapses long unchanged runs keeping one context paragraph per side', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Paragraphe inchangé numéro ${i + 1}.`)
    const { blocks } = computeDiff(paragraphs(...many), paragraphs(...many))
    expect(blocks).toHaveLength(3)
    expect(blocks[0]!.segments[0]!.text).toBe(many[0])
    expect(blocks[1]).toEqual({ type: 'unchanged', segments: [], collapsedCount: 8 })
    expect(blocks[2]!.segments[0]!.text).toBe(many[9])
  })
})

describe('collectAddedText', () => {
  it('returns added text with block provenance for added and modified blocks', () => {
    const base = [
      'Premier paragraphe sur la recevabilité de la demande.',
      'Deuxième paragraphe sur la responsabilité contractuelle du vendeur.'
    ]
    const reworded = 'Deuxième paragraphe sur la responsabilité délictuelle du vendeur.'
    const appended = 'Nouveau moyen tiré de la pièce n°12.'
    const { blocks } = computeDiff(paragraphs(...base), paragraphs(base[0]!, reworded, appended))
    const entries = collectAddedText(blocks)
    expect(entries).toHaveLength(2)
    const modifiedIndex = blocks.findIndex((block) => block.type === 'modified')
    const addedIndex = blocks.findIndex((block) => block.type === 'added')
    expect(entries[0]).toEqual({ text: 'délictuelle', blockIndex: modifiedIndex })
    expect(entries[1]).toEqual({ text: appended.replace('’', "'"), blockIndex: addedIndex })
    expect(blocks[addedIndex]!.segments[0]!.text).toBe(appended)
  })

  it('returns nothing for unchanged or removed blocks', () => {
    expect(
      collectAddedText([
        { type: 'unchanged', segments: [{ kind: 'same', text: 'x' }] },
        { type: 'removed', segments: [{ kind: 'removed', text: 'y' }] }
      ])
    ).toEqual([])
  })
})
