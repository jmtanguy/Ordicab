import { describe, expect, it } from 'vitest'

import { buildSalutationFields } from '../contactSalutation'

describe('buildSalutationFields', () => {
  it('builds masculine salutations', () => {
    expect(buildSalutationFields('M', 'LASTNAME-A', 'Person-C LASTNAME-A')).toEqual({
      salutation: 'Monsieur',
      salutationFull: 'Monsieur LASTNAME-A',
      dear: 'Cher Monsieur'
    })
  })

  it('builds feminine salutations', () => {
    expect(buildSalutationFields('F', 'LASTNAME-B', 'Camille LASTNAME-B')).toEqual({
      salutation: 'Madame',
      salutationFull: 'Madame LASTNAME-B',
      dear: 'Chère Madame'
    })
  })

  it('falls back to neutral output for N', () => {
    expect(buildSalutationFields('N', undefined, 'Tribunal judiciaire')).toEqual({
      salutation: '',
      salutationFull: 'Tribunal judiciaire',
      dear: 'Madame, Monsieur,'
    })
  })

  it('falls back to neutral output when gender is undefined', () => {
    expect(buildSalutationFields(undefined, undefined, 'SCP LASTNAME-B')).toEqual({
      salutation: '',
      salutationFull: 'SCP LASTNAME-B',
      dear: 'Madame, Monsieur,'
    })
  })
})
