import { describe, expect, it } from 'vitest'

import { chunkText } from '../chunker'

describe('chunkText', () => {
  it('returns a single chunk when the text fits in one window', () => {
    const text = 'Short document that fits entirely.'
    const chunks = chunkText(text, { maxChars: 1000 })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ charStart: 0, charEnd: text.length, text })
  })

  it('returns [] on empty input', () => {
    expect(chunkText('')).toEqual([])
  })

  it('preserves the charStart/charEnd → slice invariant for every chunk', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `Paragraphe ${i} ` + 'a'.repeat(200))
    const text = paragraphs.join('<NL>')
    const chunks = chunkText(text, { maxChars: 500, overlapChars: 50 })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    }
  })

  it('produces overlapping windows so boundary spans are still retrievable', () => {
    // Two paragraphs each 400 chars, separator costs 4 chars → single chunk
    // would be ~800 chars. With maxChars=500 we expect two chunks whose
    // ranges overlap.
    const paragraphs = ['Le demandeur ' + 'x'.repeat(390), 'Le défendeur ' + 'y'.repeat(390)]
    const text = paragraphs.join('<NL>')
    const chunks = chunkText(text, { maxChars: 500, overlapChars: 100 })

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!
      const next = chunks[i]!
      expect(next.charStart).toBeLessThan(prev.charEnd)
    }
  })

  it('hard-splits paragraphs larger than the window without losing content', () => {
    // One massive paragraph, no separators.
    const text = 'a '.repeat(3000) // 6000 chars
    const chunks = chunkText(text, { maxChars: 500, overlapChars: 50 })

    // Coverage: union of chunk ranges must cover [0, text.length) with no
    // gaps. We reconstruct by walking end-to-start given overlap.
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.charStart).toBe(0)
    expect(chunks[chunks.length - 1]!.charEnd).toBe(text.length)
    for (let i = 1; i < chunks.length; i++) {
      // No gap: each chunk starts at or before the prior chunk's end.
      expect(chunks[i]!.charStart).toBeLessThanOrEqual(chunks[i - 1]!.charEnd)
    }
  })

  it('each chunk stays within maxChars ±1 paragraph size', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `Para ${i} ` + 'z'.repeat(150))
    const text = paragraphs.join('<NL>')
    const maxChars = 500
    const chunks = chunkText(text, { maxChars, overlapChars: 50 })

    for (const chunk of chunks) {
      // A chunk may slightly exceed maxChars when a single paragraph is
      // close to the limit — but never by more than one paragraph's worth.
      expect(chunk.text.length).toBeLessThanOrEqual(maxChars + 160)
    }
  })

  it('accepts both the normalized <NL> separator and raw double-newlines', () => {
    const a = 'alpha paragraph content'
    const b = 'beta paragraph content'
    const withNl = chunkText(`${a}<NL>${b}`, { maxChars: 10 })
    const withDouble = chunkText(`${a}\n\n${b}`, { maxChars: 10 })

    // Both inputs must produce multiple chunks (otherwise the splitter
    // didn't recognize the separator and the windowing degenerated).
    expect(withNl.length).toBeGreaterThan(1)
    expect(withDouble.length).toBeGreaterThan(1)
  })
})
