import { describe, expect, it } from 'vitest'

import {
  formatEurosFromCents,
  formatMoneyInput,
  parseDecimalInput,
  parseEurosToCents
} from '../billingFormatters'

/** Intl 'fr-FR' uses narrow no-break spaces; normalize for stable assertions. */
function plainSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ')
}

describe('parseDecimalInput', () => {
  it('accepts comma decimals', () => {
    expect(parseDecimalInput('150,50')).toBe(150.5)
  })

  it('accepts dot decimals', () => {
    expect(parseDecimalInput('150.50')).toBe(150.5)
  })

  it('returns undefined for empty or invalid input', () => {
    expect(parseDecimalInput('')).toBeUndefined()
    expect(parseDecimalInput('  ')).toBeUndefined()
    expect(parseDecimalInput('abc')).toBeUndefined()
  })
})

describe('parseEurosToCents', () => {
  it('converts comma-decimal euros to rounded cents', () => {
    expect(parseEurosToCents('900,00')).toBe(90000)
    expect(parseEurosToCents('0,015')).toBe(2)
  })

  it('returns undefined for invalid input', () => {
    expect(parseEurosToCents('12,3,4')).toBeUndefined()
  })
})

describe('formatMoneyInput', () => {
  it('renders cents as a two-decimal euro string', () => {
    expect(formatMoneyInput(90050)).toBe('900.50')
  })

  it('renders undefined as an empty string', () => {
    expect(formatMoneyInput(undefined)).toBe('')
  })
})

describe('formatEurosFromCents', () => {
  it('formats cents using the fr-FR currency style', () => {
    expect(plainSpaces(formatEurosFromCents(123456))).toBe('1 234,56 €')
  })

  it('renders undefined as a placeholder', () => {
    expect(formatEurosFromCents(undefined)).toBe('—')
  })
})
