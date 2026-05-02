import { describe, expect, it } from 'vitest'

import { fakeAlphanumericReference, fakeDate, inferGender } from '../fakegen'

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

describe('fakeDate', () => {
  it('moves textual dates across the calendar instead of preserving month and year', () => {
    const fake = fakeDate('12 mars 1981')

    expect(fake).not.toBe('12 mars 1981')
    expect(fake).not.toMatch(/mars 1981$/)
  })
})

describe('fakeAlphanumericReference', () => {
  it('replaces embedded letters as well as digits', () => {
    const fake = fakeAlphanumericReference('DUPONT-2024-001')

    expect(fake).toMatch(/^[A-Z]+-\d{4}-\d{3}$/)
    expect(fake).not.toContain('DUPONT')
    expect(fake).not.toContain('2024')
  })
})
