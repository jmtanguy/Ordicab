import { describe, expect, it } from 'vitest'

import { extractStructuredDocumentAnalysis } from '../documentStructuredAnalysis'

describe('documentStructuredAnalysis', () => {
  it('extracts dates, amounts, parties, clauses, and suggested tags from document text', () => {
    const text = [
      'Article 1 - Objet du contrat.',
      'Madame Alice Martin demande le paiement de 1 250,50 euros.',
      'La société SARL DUPONT CONSEIL est également mentionnée.',
      'Audience fixée au 12 avril 2026.',
      'Rappel du 2026-05-03.'
    ].join(' ')

    const analysis = extractStructuredDocumentAnalysis(text)

    expect(analysis.clauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Article 1 - Objet du contrat', confidence: 'medium' })
      ])
    )
    expect(analysis.parties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Madame Alice Martin', kind: 'person' }),
        expect.objectContaining({
          name: expect.stringContaining('SARL DUPONT CONSEIL'),
          kind: 'organization'
        })
      ])
    )
    expect(analysis.monetaryAmounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          raw: '1 250,50 euros',
          normalizedAmount: '1250.50',
          currency: 'EUR'
        })
      ])
    )
    expect(analysis.dates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ raw: '12 avril 2026', isoDate: '2026-04-12' }),
        expect.objectContaining({ raw: '2026-05-03', isoDate: '2026-05-03' })
      ])
    )
    expect(analysis.suggestedTags).toEqual(
      expect.arrayContaining(['2026', 'clauses', 'montants', 'parties'])
    )
  })
})
