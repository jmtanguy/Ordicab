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

  it('generates a real fake for OCR-hyphenated textual dates instead of echoing the original', () => {
    // "16-octobre 2024" used to fall through every branch and return the
    // original unchanged — the real date then leaked behind an opaque marker.
    const fake = fakeDate('16-octobre 2024')

    expect(fake).not.toBe('16-octobre 2024')
    expect(fake).not.toMatch(/octobre 2024/)
    // Output is rendered with clean spaces (OCR separator normalised away).
    expect(fake).toMatch(/^\d{1,2} [a-zà-ÿ]+ \d{4}$/)
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
