import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetNerCacheForTests, applyNerHints, warmupNer } from '../nerDetection'

// Mock @huggingface/transformers — the modelRegistry that nerDetection now
// delegates to imports it lazily, so the mock factory has to intercept it.
const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return { pipelineSpy: vi.fn(), envRef: env }
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineSpy,
  env: envRef
}))

beforeEach(() => {
  __resetNerCacheForTests()
  pipelineSpy.mockReset()
  envRef.localModelPath = undefined
  envRef.allowRemoteModels = true
})

describe('applyNerHints', () => {
  it('returns the input unchanged with no regions when disabled — no pipeline load', async () => {
    const text = 'Jean Dupont works for Acme SA.'
    const result = await applyNerHints(text, { enabled: false })
    expect(result).toEqual({ hintedText: text, nerRegions: [] })
    expect(pipelineSpy).not.toHaveBeenCalled()
  })

  it('returns the input unchanged when pipeline load fails', async () => {
    pipelineSpy.mockRejectedValue(new Error('cold start failed'))

    const text = 'Jean Dupont works for Acme SA.'
    const result = await applyNerHints(text, { enabled: true })

    expect(result).toEqual({ hintedText: text, nerRegions: [] })
  })

  it('capitalizes PER / ORG / LOC regions so the regex layer can pick them up', async () => {
    const text = 'ajouter le contact luc merlin chez acme sa a paris.'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.99, index: 4, word: 'luc' },
      { entity: 'I-PER', score: 0.98, index: 5, word: 'merlin' },
      { entity: 'B-ORG', score: 0.95, index: 7, word: 'acme' },
      { entity: 'I-ORG', score: 0.94, index: 8, word: 'sa' },
      { entity: 'B-LOC', score: 0.97, index: 10, word: 'paris' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText, nerRegions } = await applyNerHints(text, {
      enabled: true,
      minScore: 0.5
    })

    expect(hintedText).toContain('Luc Merlin')
    expect(hintedText).toContain('Acme Sa')
    expect(hintedText).toContain('Paris')
    // Positions preserved — case-only mutation.
    expect(hintedText).toHaveLength(text.length)
    expect(nerRegions.map((r) => r.type).sort()).toEqual(['address', 'company', 'name'])
    for (const region of nerRegions) {
      // The region still references the original (lowercase) text slice.
      expect(text.slice(region.start, region.end)).toBe(region.value)
    }
  })

  it('capitalizes hyphenated name tokens into Title Case on each segment', async () => {
    const text = 'contact jean-michel durand demain'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.99, index: 2, word: 'jean-michel' },
      { entity: 'I-PER', score: 0.99, index: 3, word: 'durand' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText } = await applyNerHints(text, { enabled: true, minScore: 0.5 })

    expect(hintedText).toBe('contact Jean-Michel Durand demain')
  })

  it('drops entities below minScore before hinting', async () => {
    const text = 'pierre travaille.'
    const fakePipe = vi.fn(async () => [
      { entity_group: 'PER', score: 0.6, start: 0, end: 6, word: 'pierre' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText, nerRegions } = await applyNerHints(text, {
      enabled: true,
      minScore: 0.85
    })

    expect(hintedText).toBe(text)
    expect(nerRegions).toEqual([])
  })

  it('uses a lower default score threshold on short texts', async () => {
    const text = 'avocat martin'
    const fakePipe = vi.fn(async () => [{ entity: 'B-PER', score: 0.78, index: 2, word: 'martin' }])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText, nerRegions } = await applyNerHints(text, { enabled: true })

    expect(hintedText).toBe('avocat Martin')
    expect(nerRegions).toHaveLength(1)
    expect(nerRegions[0]).toMatchObject({ type: 'name', value: 'martin' })
  })

  it('runs a title-case second pass for short lowercase queries and keeps the final hint', async () => {
    const text = 'trouver les informations pour l avocat martin'
    const fakePipe = vi.fn(async (input: string) => {
      if (input.includes('avocat Martin')) {
        return [{ entity: 'B-PER', score: 0.79, index: 7, word: 'Martin' }]
      }
      return []
    })
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText, nerRegions } = await applyNerHints(text, { enabled: true })

    expect(fakePipe).toHaveBeenNthCalledWith(1, text, { ignore_labels: [] })
    expect(fakePipe).toHaveBeenNthCalledWith(2, 'trouver les informations pour l avocat Martin', {
      ignore_labels: []
    })
    expect(hintedText).toBe('trouver les informations pour l avocat Martin')
    expect(nerRegions).toHaveLength(1)
    expect(nerRegions[0]).toMatchObject({ type: 'name', value: 'martin' })
  })

  it('drops second-pass regions that overlap one already emitted by the first pass', async () => {
    const text = 'contact jean-michel durand directement'
    const fakePipe = vi.fn(async (input: string) => {
      if (input === text) {
        return [{ entity: 'B-PER', score: 0.95, index: 3, word: 'durand' }]
      }
      // Second pass on title-cased text would emit an overlapping wider span.
      return [
        { entity: 'B-PER', score: 0.95, index: 2, word: 'Jean-michel' },
        { entity: 'I-PER', score: 0.95, index: 3, word: 'Durand' }
      ]
    })
    pipelineSpy.mockResolvedValue(fakePipe)

    const { nerRegions } = await applyNerHints(text, { enabled: true })

    expect(nerRegions).toEqual([
      {
        type: 'name',
        value: 'durand',
        start: text.indexOf('durand'),
        end: text.indexOf('durand') + 'durand'.length
      }
    ])
  })

  it('reconstructs a span from subword pieces like du ##ra ##nd', async () => {
    const text = 'ajouter aux contacts jean-michel durand, 2 bd de Cimiez 06100 nice'
    const fakePipe = vi.fn(async () => [
      { entity: 'I-PER', score: 0.969, index: 7, word: 'du' },
      { entity: 'I-PER', score: 0.99, index: 8, word: '##ra' },
      { entity: 'I-PER', score: 0.966, index: 9, word: '##nd' },
      { entity: 'B-LOC', score: 0.874, index: 15, word: 'bd' },
      { entity: 'I-LOC', score: 0.983, index: 16, word: 'de' },
      { entity: 'I-LOC', score: 0.987, index: 17, word: 'Cimiez' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { hintedText, nerRegions } = await applyNerHints(text, {
      enabled: true,
      minScore: 0.8
    })

    // The address region gets capitalized for the regex pass.
    expect(hintedText).toContain('Bd De Cimiez')
    expect(nerRegions.map((r) => r.value).sort()).toEqual(['bd de Cimiez', 'durand'])
  })

  it('falls back to the short-query cue heuristic for standalone names after "pour"', async () => {
    const text = 'trouver les informations de contact dans les documents pour Mercier'
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { nerRegions } = await applyNerHints(text, { enabled: true })

    expect(nerRegions).toEqual([
      {
        type: 'name',
        value: 'Mercier',
        start: text.indexOf('Mercier'),
        end: text.indexOf('Mercier') + 'Mercier'.length
      }
    ])
  })

  it('does not flag a lowercase common adjective sitting after "contacts"', async () => {
    const text = 'trouver les contacts supplémentaires dans les documents'
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValue(fakePipe)

    const { nerRegions } = await applyNerHints(text, { enabled: true })

    expect(nerRegions).toEqual([])
  })

  it('returns hintedText unchanged when the model call itself throws', async () => {
    const fakePipe = vi.fn(async () => {
      throw new Error('inference crashed')
    })
    pipelineSpy.mockResolvedValue(fakePipe)

    const text = 'Jean Dupont.'
    const result = await applyNerHints(text, { enabled: true })

    expect(result).toEqual({ hintedText: text, nerRegions: [] })
  })

  it('warmupNer is a no-op when disabled', async () => {
    await warmupNer({ enabled: false })
    expect(pipelineSpy).not.toHaveBeenCalled()
  })

  it('warmupNer triggers the pipeline load so the first detect call is warm', async () => {
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValue(fakePipe)

    await warmupNer({ enabled: true })
    expect(pipelineSpy).toHaveBeenCalledTimes(1)

    // Second call (applyNerHints) reuses the cached pipeline — no second load.
    await applyNerHints('something', { enabled: true })
    expect(pipelineSpy).toHaveBeenCalledTimes(1)
  })
})
