import { describe, expect, it } from 'vitest'

import type { DossierSummary } from '@shared/types'

import {
  buildCommandPaletteGroups,
  type BuildCommandPaletteGroupsOptions,
  filterDossiers,
  matchScore,
  selectRecentDossiers
} from '../commandPaletteItems'

function createDossier(options: Partial<DossierSummary> = {}): DossierSummary {
  return {
    slug: 'Client Alpha',
    uuid: 'uuid-client-alpha',
    name: 'Client Alpha',
    status: 'active',
    type: '',
    updatedAt: '2026-03-13T09:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    ...options
  }
}

function createBuildOptions(
  options: Partial<BuildCommandPaletteGroupsOptions> = {}
): BuildCommandPaletteGroupsOptions {
  return {
    query: '',
    dossiers: [],
    destinations: [
      { id: 'dossiers', label: 'Dossiers' },
      { id: 'legal', label: 'Recherche Droit' },
      { id: 'factures', label: 'Factures' },
      { id: 'modeles', label: 'Modèles' },
      { id: 'cabinet', label: 'Cabinet' },
      { id: 'parametres', label: 'Paramètres' }
    ],
    sections: [],
    actions: [{ id: 'new-dossier', label: 'Nouveau dossier' }],
    groupLabels: {
      recent: 'Dossiers récents',
      dossiers: 'Dossiers',
      navigation: 'Navigation',
      sections: 'Sections du dossier',
      actions: 'Actions'
    },
    ...options
  }
}

describe('matchScore', () => {
  it('returns null when the query is empty or does not match', () => {
    expect(matchScore('', 'Dossiers')).toBeNull()
    expect(matchScore('   ', 'Dossiers')).toBeNull()
    expect(matchScore('xyz', 'Dossiers')).toBeNull()
  })

  it('ranks prefix above word-start above substring above subsequence', () => {
    const prefix = matchScore('dos', 'Dossier Dupont')
    const wordStart = matchScore('dup', 'Dossier Dupont')
    const substring = matchScore('pont', 'Dossier Dupont')
    const subsequence = matchScore('drt', 'Dossier Dupont')

    expect(prefix).toBe(3)
    expect(wordStart).toBe(2)
    expect(substring).toBe(1)
    expect(subsequence).toBe(0)
  })

  it('ignores case and diacritics', () => {
    expect(matchScore('modeles', 'Modèles')).toBe(3)
    expect(matchScore('PARAMETRES', 'Paramètres')).toBe(3)
    expect(matchScore('échéances', 'Echeances')).toBe(3)
  })
})

describe('selectRecentDossiers', () => {
  it('keeps only opened dossiers, most recent first, capped at the limit', () => {
    const dossiers = [
      createDossier({ slug: 'a', name: 'A', lastOpenedAt: '2026-06-01T08:00:00.000Z' }),
      createDossier({ slug: 'never', name: 'Never opened', lastOpenedAt: null }),
      createDossier({ slug: 'b', name: 'B', lastOpenedAt: '2026-06-05T08:00:00.000Z' }),
      createDossier({ slug: 'c', name: 'C', lastOpenedAt: '2026-06-03T08:00:00.000Z' })
    ]

    expect(selectRecentDossiers(dossiers).map((dossier) => dossier.slug)).toEqual(['b', 'c', 'a'])
    expect(selectRecentDossiers(dossiers, 2).map((dossier) => dossier.slug)).toEqual(['b', 'c'])
  })
})

describe('filterDossiers', () => {
  it('matches on name or type and drops non-matching dossiers', () => {
    const dossiers = [
      createDossier({ slug: 'dupont', name: 'Dupont c. Martin' }),
      createDossier({ slug: 'bail', name: 'SCI Lemoine', type: 'Bail commercial' }),
      createDossier({ slug: 'other', name: 'Succession Bernard' })
    ]

    expect(filterDossiers(dossiers, 'dupont').map((dossier) => dossier.slug)).toEqual(['dupont'])
    expect(filterDossiers(dossiers, 'bail').map((dossier) => dossier.slug)).toEqual(['bail'])
    expect(filterDossiers(dossiers, 'introuvable')).toEqual([])
  })

  it('orders results by match quality', () => {
    const dossiers = [
      createDossier({ slug: 'substring', name: 'SCI Pradurand' }),
      createDossier({ slug: 'prefix', name: 'Durand c. Petit' }),
      createDossier({ slug: 'word-start', name: 'Affaire Durand' })
    ]

    expect(filterDossiers(dossiers, 'durand').map((dossier) => dossier.slug)).toEqual([
      'prefix',
      'word-start',
      'substring'
    ])
  })
})

describe('buildCommandPaletteGroups', () => {
  it('shows recent dossiers, navigation and actions when the query is empty', () => {
    const groups = buildCommandPaletteGroups(
      createBuildOptions({
        dossiers: [
          createDossier({ slug: 'a', name: 'A', lastOpenedAt: '2026-06-01T08:00:00.000Z' }),
          createDossier({ slug: 'never', name: 'Never opened' })
        ]
      })
    )

    expect(groups.map((group) => group.key)).toEqual(['recent', 'navigation', 'actions'])
    expect(groups[0]?.items).toEqual([
      { kind: 'dossier', dossierId: 'a', label: 'A', sublabel: null }
    ])
    expect(groups[1]?.items).toHaveLength(6)
    expect(groups[2]?.items).toEqual([
      { kind: 'action', action: 'new-dossier', label: 'Nouveau dossier' }
    ])
  })

  it('caps recent dossiers at five', () => {
    const dossiers = Array.from({ length: 7 }, (_, index) =>
      createDossier({
        slug: `d${index}`,
        name: `Dossier ${index}`,
        lastOpenedAt: `2026-06-0${index + 1}T08:00:00.000Z`
      })
    )

    const groups = buildCommandPaletteGroups(createBuildOptions({ dossiers }))

    expect(groups[0]?.key).toBe('recent')
    expect(groups[0]?.items.map((item) => item.label)).toEqual([
      'Dossier 6',
      'Dossier 5',
      'Dossier 4',
      'Dossier 3',
      'Dossier 2'
    ])
  })

  it('includes dossier sections when provided', () => {
    const groups = buildCommandPaletteGroups(
      createBuildOptions({
        sections: [
          { id: 'echeances', label: 'Échéances' },
          { id: 'notes', label: 'Notes' }
        ]
      })
    )

    expect(groups.map((group) => group.key)).toEqual(['navigation', 'sections', 'actions'])
    expect(groups[1]?.items).toEqual([
      { kind: 'section', section: 'echeances', label: 'Échéances' },
      { kind: 'section', section: 'notes', label: 'Notes' }
    ])
  })

  it('filters every group by the query and drops empty groups', () => {
    const groups = buildCommandPaletteGroups(
      createBuildOptions({
        query: 'fact',
        dossiers: [
          createDossier({ slug: 'facture', name: 'Facturation Leroy' }),
          createDossier({ slug: 'other', name: 'Succession Bernard' })
        ],
        sections: [
          { id: 'factures', label: 'Factures' },
          { id: 'notes', label: 'Notes' }
        ]
      })
    )

    expect(groups.map((group) => group.key)).toEqual(['dossiers', 'navigation', 'sections'])
    expect(groups[0]?.items.map((item) => item.label)).toEqual(['Facturation Leroy'])
    expect(groups[1]?.items.map((item) => item.label)).toEqual(['Factures'])
    expect(groups[2]?.items.map((item) => item.label)).toEqual(['Factures'])
  })

  it('matches the query without regard to accents', () => {
    const groups = buildCommandPaletteGroups(createBuildOptions({ query: 'parametres' }))

    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe('navigation')
    expect(groups[0]?.items.map((item) => item.label)).toEqual(['Paramètres'])
  })
})
