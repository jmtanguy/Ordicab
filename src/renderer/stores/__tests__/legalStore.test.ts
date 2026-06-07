import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrdicabAPI } from '@shared/types'

import { GLOBAL_LEGAL_SCOPE, useLegalStore } from '../legalStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

describe('legalStore taxonomy', () => {
  beforeEach(() => {
    useLegalStore.setState(useLegalStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('normalizes a map result (chambers) and an array result (themes)', async () => {
    const taxonomyJudilibre = vi.fn(async (input: { taxonomyId?: string }) => {
      if (input.taxonomyId === 'chamber') {
        return {
          success: true as const,
          data: {
            id: 'chamber',
            result: { civ1: 'Première chambre civile', comm: 'Chambre commerciale' }
          }
        }
      }
      return {
        success: true as const,
        data: { id: 'theme', result: ['abus de confiance', 'accident de la circulation'] }
      }
    })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { taxonomyJudilibre }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().loadJudilibreTaxonomy()

    const state = useLegalStore.getState()
    expect(state.chambers).toEqual([
      { code: 'civ1', label: 'Première chambre civile' },
      { code: 'comm', label: 'Chambre commerciale' }
    ])
    expect(state.themes).toEqual([
      { code: 'abus de confiance', label: 'abus de confiance' },
      { code: 'accident de la circulation', label: 'accident de la circulation' }
    ])
    expect(state.isLoadingTaxonomy).toBe(false)
  })

  it('does not refetch when taxonomy is already loaded', async () => {
    const taxonomyJudilibre = vi.fn(async (input: { taxonomyId?: string }) => ({
      success: true as const,
      data:
        input.taxonomyId === 'chamber'
          ? { result: { civ1: 'Première chambre civile' } }
          : { result: ['abus de confiance'] }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { taxonomyJudilibre }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().loadJudilibreTaxonomy()
    expect(taxonomyJudilibre).toHaveBeenCalledTimes(2)

    await useLegalStore.getState().loadJudilibreTaxonomy()
    // Still 2 — the second call short-circuits because both lists are populated.
    expect(taxonomyJudilibre).toHaveBeenCalledTimes(2)
  })
})

describe('legalStore scoped search', () => {
  beforeEach(() => {
    useLegalStore.setState(useLegalStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  function makeSearchResult(id: string): {
    success: true
    data: { results: Array<{ source: 'legifrance'; id: string; title: string }> }
  } {
    return {
      success: true as const,
      data: { results: [{ source: 'legifrance' as const, id, title: id }] }
    }
  }

  it('isolates search results across scopes', async () => {
    const searchLegifrance = vi.fn(async (input: { recherche: string }) =>
      makeSearchResult(input.recherche)
    )
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance }
    } as unknown as OrdicabAPI

    await useLegalStore
      .getState()
      .searchLegifrance(GLOBAL_LEGAL_SCOPE, { recherche: 'global-query' })
    await useLegalStore.getState().searchLegifrance('dossier-1', { recherche: 'dossier-query' })

    const state = useLegalStore.getState()
    expect(state.searchByScope[GLOBAL_LEGAL_SCOPE]?.searchResult?.results[0]?.id).toBe(
      'global-query'
    )
    expect(state.searchByScope['dossier-1']?.searchResult?.results[0]?.id).toBe('dossier-query')
  })

  it('drops a stale response when a newer search starts on the same scope', async () => {
    type SearchResult = ReturnType<typeof makeSearchResult>
    let resolveFirst: (value: SearchResult) => void = () => {}
    const searchLegifrance = vi.fn((input: { recherche: string }) => {
      if (input.recherche === 'first') {
        return new Promise<SearchResult>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(makeSearchResult('second'))
    })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance }
    } as unknown as OrdicabAPI

    // Start a slow first search, then a fast second search that overwrites the token.
    const firstPromise = useLegalStore
      .getState()
      .searchLegifrance('dossier-1', { recherche: 'first' })
    await useLegalStore.getState().searchLegifrance('dossier-1', { recherche: 'second' })

    // Now resolve the first (now-stale) response.
    resolveFirst(makeSearchResult('first'))
    await firstPromise

    const state = useLegalStore.getState()
    expect(state.searchByScope['dossier-1']?.searchResult?.results[0]?.id).toBe('second')
  })

  it('saveScopeForm creates the entry with the given fields and defaults', () => {
    useLegalStore.getState().saveScopeForm(GLOBAL_LEGAL_SCOPE, {
      query: 'foo',
      fond: 'CODE_ETAT'
    })

    const entry = useLegalStore.getState().searchByScope[GLOBAL_LEGAL_SCOPE]
    expect(entry?.query).toBe('foo')
    expect(entry?.fond).toBe('CODE_ETAT')
    // Untouched fields keep their defaults.
    expect(entry?.source).toBe('all')
    expect(entry?.searchResult).toBeNull()
  })

  it('clearSearch only clears the targeted scope', async () => {
    const searchLegifrance = vi.fn(async (input: { recherche: string }) =>
      makeSearchResult(input.recherche)
    )
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().searchLegifrance('a', { recherche: 'a' })
    await useLegalStore.getState().searchLegifrance('b', { recherche: 'b' })

    useLegalStore.getState().clearSearch('a')

    const state = useLegalStore.getState()
    expect(state.searchByScope['a']?.searchResult).toBeNull()
    expect(state.searchByScope['b']?.searchResult?.results[0]?.id).toBe('b')
  })

  it('resetSearchScopes empties the whole record', () => {
    useLegalStore.getState().saveScopeForm('a', { query: 'x' })
    useLegalStore.getState().saveScopeForm('b', { query: 'y' })
    expect(Object.keys(useLegalStore.getState().searchByScope)).toHaveLength(2)

    useLegalStore.getState().resetSearchScopes()
    expect(useLegalStore.getState().searchByScope).toEqual({})
  })
})

describe('legalStore searchAll', () => {
  beforeEach(() => {
    useLegalStore.setState(useLegalStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  const allInputs = {
    legifrance: { recherche: 'q' },
    judilibre: { recherche: 'q' }
  }

  it('merges results from both sources into one list', async () => {
    const searchLegifrance = vi.fn(async () => ({
      success: true as const,
      data: {
        source: 'legifrance' as const,
        page: 1,
        pageSize: 1,
        total: 5,
        results: [{ source: 'legifrance' as const, id: 'L1', title: 'Légi' }]
      }
    }))
    const searchJudilibre = vi.fn(async () => ({
      success: true as const,
      data: {
        source: 'judilibre' as const,
        page: 1,
        pageSize: 1,
        total: 7,
        results: [{ source: 'judilibre' as const, id: 'J1', title: 'Judi' }]
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance, searchJudilibre }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().searchAll(GLOBAL_LEGAL_SCOPE, allInputs)

    const result = useLegalStore.getState().searchByScope[GLOBAL_LEGAL_SCOPE]?.searchResult
    expect(result?.results.map((r) => r.id)).toEqual(['L1', 'J1'])
    expect(result?.total).toBe(12)
    expect(result?.pageSize).toBe(2)
  })

  it('shows the surviving source when one source fails', async () => {
    const searchLegifrance = vi.fn(async () => ({
      success: false as const,
      error: 'Légifrance down'
    }))
    const searchJudilibre = vi.fn(async () => ({
      success: true as const,
      data: {
        source: 'judilibre' as const,
        page: 1,
        pageSize: 1,
        results: [{ source: 'judilibre' as const, id: 'J1', title: 'Judi' }]
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance, searchJudilibre }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().searchAll(GLOBAL_LEGAL_SCOPE, allInputs)

    const scope = useLegalStore.getState().searchByScope[GLOBAL_LEGAL_SCOPE]
    expect(scope?.searchError).toBeNull()
    expect(scope?.searchResult?.results.map((r) => r.id)).toEqual(['J1'])
  })

  it('sets searchError only when both sources fail', async () => {
    const searchLegifrance = vi.fn(async () => ({
      success: false as const,
      error: 'Légifrance down'
    }))
    const searchJudilibre = vi.fn(async () => ({
      success: false as const,
      error: 'Judilibre down'
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance, searchJudilibre }
    } as unknown as OrdicabAPI

    await useLegalStore.getState().searchAll(GLOBAL_LEGAL_SCOPE, allInputs)

    const scope = useLegalStore.getState().searchByScope[GLOBAL_LEGAL_SCOPE]
    expect(scope?.searchResult).toBeNull()
    expect(scope?.searchError).toContain('Légifrance down')
    expect(scope?.searchError).toContain('Judilibre down')
  })

  it('drops a stale combined response when a newer search starts', async () => {
    type Resp = { success: true; data: import('@shared/types').LegalSearchResponse }
    let resolveSlow: (value: Resp) => void = () => {}
    const slow = new Promise<Resp>((resolve) => {
      resolveSlow = resolve
    })
    const searchLegifrance = vi.fn((input: { recherche: string }) =>
      input.recherche === 'first'
        ? slow
        : Promise.resolve({
            success: true as const,
            data: {
              source: 'legifrance' as const,
              page: 1,
              pageSize: 1,
              results: [{ source: 'legifrance' as const, id: 'second', title: 'second' }]
            }
          })
    )
    const searchJudilibre = vi.fn(async () => ({
      success: true as const,
      data: {
        source: 'judilibre' as const,
        page: 1,
        pageSize: 0,
        results: []
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      legalSearch: { searchLegifrance, searchJudilibre }
    } as unknown as OrdicabAPI

    const firstPromise = useLegalStore.getState().searchAll('d', {
      legifrance: { recherche: 'first' },
      judilibre: { recherche: 'first' }
    })
    await useLegalStore.getState().searchAll('d', {
      legifrance: { recherche: 'second' },
      judilibre: { recherche: 'second' }
    })

    resolveSlow({
      success: true,
      data: {
        source: 'legifrance',
        page: 1,
        pageSize: 1,
        results: [{ source: 'legifrance', id: 'first', title: 'first' }]
      }
    })
    await firstPromise

    const result = useLegalStore.getState().searchByScope['d']?.searchResult
    expect(result?.results.map((r) => r.id)).toEqual(['second'])
  })
})
