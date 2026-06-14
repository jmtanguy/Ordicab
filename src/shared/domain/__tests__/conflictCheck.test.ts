import { describe, expect, it } from 'vitest'

import {
  compareConflictMatches,
  evaluateNameConflict,
  normalizeNameForConflictCheck,
  type ConflictMatch
} from '../conflictCheck'

function makeMatch(overrides: Partial<ConflictMatch>): ConflictMatch {
  return {
    dossierId: 'dossier-a',
    dossierName: 'Dossier A',
    contactUuid: 'contact-1',
    contactDisplayName: 'Camille Martin',
    matchKind: 'exact',
    ...overrides
  }
}

describe('normalizeNameForConflictCheck', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeNameForConflictCheck('  Camille   MARTIN  ')).toBe('camille martin')
  })

  it('strips accents', () => {
    expect(normalizeNameForConflictCheck('Hélène Lefèvre-Çois')).toBe('helene lefevre cois')
  })

  it('treats hyphen variants as spaces', () => {
    expect(normalizeNameForConflictCheck('Jean-Pierre')).toBe('jean pierre')
    expect(normalizeNameForConflictCheck('Jean–Pierre')).toBe('jean pierre')
  })

  it('returns an empty string for undefined or blank input', () => {
    expect(normalizeNameForConflictCheck(undefined)).toBe('')
    expect(normalizeNameForConflictCheck('   ')).toBe('')
  })
})

describe('evaluateNameConflict', () => {
  it('matches exactly when first and last names are equal', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'Camille', lastName: 'Martin' },
        { firstName: 'Camille', lastName: 'Martin' }
      )
    ).toBe('exact')
  })

  it('matches exactly regardless of case and accents', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'hélène', lastName: 'LEFÈVRE' },
        { firstName: 'Helene', lastName: 'Lefevre' }
      )
    ).toBe('exact')
  })

  it('matches hyphenated names against their space-separated form', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'Jean-Pierre', lastName: 'Saint-Exupéry' },
        { firstName: 'Jean Pierre', lastName: 'Saint Exupery' }
      )
    ).toBe('exact')
  })

  it('flags a last-name-only match as partial', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'Camille', lastName: 'Martin' },
        { firstName: 'Alex', lastName: 'Martin' }
      )
    ).toBe('partial')
  })

  it('flags a match as partial when the query has no first name', () => {
    expect(
      evaluateNameConflict({ lastName: 'Martin' }, { firstName: 'Camille', lastName: 'Martin' })
    ).toBe('partial')
  })

  it('ignores last names of 2 characters or fewer for partial matches', () => {
    expect(evaluateNameConflict({ lastName: 'Le' }, { firstName: 'Anna', lastName: 'Le' })).toBe(
      null
    )
  })

  it('still matches short last names exactly when first names also match', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'Anna', lastName: 'Le' },
        { firstName: 'Anna', lastName: 'Le' }
      )
    ).toBe('exact')
  })

  it('never matches without a last name', () => {
    expect(
      evaluateNameConflict({ firstName: 'Camille' }, { firstName: 'Camille', lastName: 'Martin' })
    ).toBe(null)
    expect(evaluateNameConflict({ firstName: 'Camille', lastName: 'Martin' }, {})).toBe(null)
  })

  it('does not match different last names', () => {
    expect(
      evaluateNameConflict(
        { firstName: 'Camille', lastName: 'Martin' },
        { firstName: 'Camille', lastName: 'Martins' }
      )
    ).toBe(null)
  })
})

describe('compareConflictMatches', () => {
  it('orders exact matches before partial ones, then by dossier and contact name', () => {
    const matches: ConflictMatch[] = [
      makeMatch({ matchKind: 'partial', dossierName: 'Dossier A', contactDisplayName: 'B Martin' }),
      makeMatch({ matchKind: 'exact', dossierName: 'Dossier B' }),
      makeMatch({ matchKind: 'partial', dossierName: 'Dossier A', contactDisplayName: 'A Martin' }),
      makeMatch({ matchKind: 'exact', dossierName: 'Dossier A' })
    ]

    const sorted = [...matches].sort(compareConflictMatches)

    expect(
      sorted.map((entry) => `${entry.matchKind}:${entry.dossierName}:${entry.contactDisplayName}`)
    ).toEqual([
      'exact:Dossier A:Camille Martin',
      'exact:Dossier B:Camille Martin',
      'partial:Dossier A:A Martin',
      'partial:Dossier A:B Martin'
    ])
  })
})
