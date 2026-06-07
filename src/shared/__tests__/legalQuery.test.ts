import { describe, expect, it } from 'vitest'

import { normalizeCodeName, parseLegalQuery } from '../domain/legalQuery'

describe('parseLegalQuery', () => {
  it('parses "article 1240 du code civil" as a citation', () => {
    expect(parseLegalQuery('article 1240 du code civil')).toEqual({
      articleNumber: '1240',
      codeName: 'Code civil',
      fond: 'CODE_DATE',
      isCitation: true
    })
  })

  it('parses the abbreviated form "art. 1240 c. civ."', () => {
    expect(parseLegalQuery('art. 1240 c. civ.')).toMatchObject({
      articleNumber: '1240',
      codeName: 'Code civil',
      fond: 'CODE_DATE',
      isCitation: true
    })
  })

  it('parses "1240 code civil" without the article keyword', () => {
    expect(parseLegalQuery('1240 code civil')).toMatchObject({
      articleNumber: '1240',
      codeName: 'Code civil',
      isCitation: true
    })
  })

  it('parses an L-prefixed reference "L. 121-3 code de la consommation"', () => {
    expect(parseLegalQuery('L. 121-3 code de la consommation')).toMatchObject({
      articleNumber: 'L121-3',
      codeName: 'Code de la consommation',
      fond: 'CODE_DATE',
      isCitation: true
    })
  })

  it('treats a conceptual query as free text', () => {
    expect(parseLegalQuery('jurisprudence sur le mariage')).toEqual({ isCitation: false })
  })

  it('treats "responsabilité civile" as free text', () => {
    expect(parseLegalQuery('responsabilité civile')).toEqual({ isCitation: false })
  })

  it('returns no citation for an empty query', () => {
    expect(parseLegalQuery('   ')).toEqual({ isCitation: false })
  })
})

describe('normalizeCodeName', () => {
  it('resolves known spellings and abbreviations', () => {
    expect(normalizeCodeName('code civil')).toBe('Code civil')
    expect(normalizeCodeName('CODE CIVIL')).toBe('Code civil')
    expect(normalizeCodeName('c. civ.')).toBe('Code civil')
    expect(normalizeCodeName('cpc')).toBe('Code de procédure civile')
    expect(normalizeCodeName('code conso')).toBe('Code de la consommation')
  })

  it('title-cases an unknown "code X" as a fallback', () => {
    expect(normalizeCodeName('code des transports')).toBe('Code des transports')
  })

  it('returns undefined for non-code input', () => {
    expect(normalizeCodeName('mariage')).toBeUndefined()
  })
})
