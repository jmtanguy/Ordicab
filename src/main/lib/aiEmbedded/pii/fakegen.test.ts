import { describe, expect, it } from 'vitest'

import { inferGender } from './fakegen'

describe('inferGender', () => {
  it('recognizes compound male first names', () => {
    expect(inferGender('Jean-Michel')).toBe('M')
  })

  it('recognizes compound female first names', () => {
    expect(inferGender('Marie-Claire')).toBe('F')
  })

  it('is accent- and case-insensitive for known first names', () => {
    expect(inferGender('séverine')).toBe('F')
    expect(inferGender('REMY')).toBe('M')
  })
})
