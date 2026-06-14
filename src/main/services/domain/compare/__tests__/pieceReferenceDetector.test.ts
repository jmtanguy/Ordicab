import { describe, expect, it } from 'vitest'

import { detectPieceReferences } from '../pieceReferenceDetector'

function entry(text: string, blockIndex = 0): { text: string; blockIndex: number } {
  return { text, blockIndex }
}

describe('detectPieceReferences', () => {
  it('detects a simple « pièce n° 12 »', () => {
    const result = detectPieceReferences([
      entry('Comme il résulte de la pièce n° 12, le contrat a été signé.')
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.numbers).toEqual([12])
    expect(result[0]!.raw).toBe('pièce n° 12')
    expect(result[0]!.excerpt).toContain('le contrat a été signé')
  })

  it('expands « pièces nos 4 à 7 » into the full range', () => {
    const result = detectPieceReferences([entry('Voir les pièces nos 4 à 7 produites.')])
    expect(result).toHaveLength(1)
    expect(result[0]!.numbers).toEqual([4, 5, 6, 7])
  })

  it('detects « (pièce adverse n°3) »', () => {
    const result = detectPieceReferences([entry('Le constat (pièce adverse n°3) établit que…')])
    expect(result).toHaveLength(1)
    expect(result[0]!.numbers).toEqual([3])
  })

  it('splits enumerations « pièces n°2 et 5 »', () => {
    const result = detectPieceReferences([entry('Il ressort des pièces n°2 et 5 que…')])
    expect(result).toHaveLength(1)
    expect(result[0]!.numbers).toEqual([2, 5])
  })

  it('keeps only the endpoints of a pathologically wide range', () => {
    const result = detectPieceReferences([entry('Les pièces 1 à 200 sont versées aux débats.')])
    expect(result).toHaveLength(1)
    expect(result[0]!.numbers).toEqual([1, 200])
  })

  it('dedupes the same reference repeated in the same block', () => {
    const result = detectPieceReferences([
      entry('La pièce n°9 le prouve. La pièce n°9 le confirme encore.')
    ])
    expect(result).toHaveLength(1)
  })

  it('keeps the same reference appearing in different blocks', () => {
    const result = detectPieceReferences([
      entry('La pièce n°9 le prouve.', 1),
      entry('La pièce n°9 le confirme.', 4)
    ])
    expect(result.map((r) => r.blockIndex)).toEqual([1, 4])
  })

  it('ignores « pièce maîtresse » and number-free mentions', () => {
    expect(
      detectPieceReferences([
        entry('Cette attestation est la pièce maîtresse du dossier.'),
        entry('Les pièces jointes au courrier ne sont pas datées.')
      ])
    ).toEqual([])
  })

  it('truncates the excerpt around the match with ellipses', () => {
    const padding = 'mot '.repeat(60)
    const result = detectPieceReferences([entry(`${padding}pièce n°4${padding}`)])
    expect(result[0]!.excerpt.startsWith('…')).toBe(true)
    expect(result[0]!.excerpt.endsWith('…')).toBe(true)
    expect(result[0]!.excerpt).toContain('pièce n°4')
  })
})
