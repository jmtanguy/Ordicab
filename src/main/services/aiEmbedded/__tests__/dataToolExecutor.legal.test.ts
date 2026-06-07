import { describe, expect, it, vi } from 'vitest'

import { DataToolExecutor } from '../dataToolExecutor'
import type { LegalService } from '../../legal/legalService'

function makeLegalService(): LegalService {
  return {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    deleteCredentials: vi.fn(),
    connectionStatus: vi.fn(),
    searchLegifrance: vi.fn().mockResolvedValue({ source: 'legifrance', results: [] }),
    consultLegifrance: vi.fn().mockResolvedValue({ source: 'legifrance', id: 'x', raw: {} }),
    searchJudilibre: vi.fn().mockResolvedValue({ source: 'judilibre', results: [] }),
    consultJudilibre: vi.fn().mockResolvedValue({ source: 'judilibre', id: 'x', raw: {} }),
    taxonomyJudilibre: vi.fn().mockResolvedValue({ id: 'chamber', result: { civ1: 'Première' } }),
    verifyReferences: vi.fn().mockResolvedValue({ references: [] })
  } as unknown as LegalService
}

function makeExecutor(legalService: LegalService): DataToolExecutor {
  const noop = vi.fn()
  return new DataToolExecutor({
    dossierId: null,
    dossiers: [],
    contactService: { list: noop, upsert: noop, delete: noop } as never,
    templateService: { list: noop } as never,
    documentService: {} as never,
    dossierService: {} as never,
    invoiceService: {} as never,
    legalService,
    entityProfile: null
  })
}

describe('DataToolExecutor legal tools', () => {
  it('forwards Légifrance date range and sort to the service', async () => {
    const legal = makeLegalService()
    const executor = makeExecutor(legal)

    await executor.execute('legal_search_legifrance', {
      recherche: 'responsabilité',
      fond: 'JURI',
      dateDebut: '2020-01-01',
      dateFin: '2020-12-31',
      tri: 'DATE_PUBLI_DESC',
      pageTaille: 5
    })

    expect(legal.searchLegifrance).toHaveBeenCalledWith(
      expect.objectContaining({
        recherche: 'responsabilité',
        fond: 'JURI',
        dateDebut: '2020-01-01',
        dateFin: '2020-12-31',
        tri: 'DATE_PUBLI_DESC',
        pageTaille: 5
      })
    )
  })

  it('drops malformed dates and unknown sort values', async () => {
    const legal = makeLegalService()
    const executor = makeExecutor(legal)

    await executor.execute('legal_search_legifrance', {
      recherche: 'x',
      dateDebut: '01/01/2020',
      tri: 'NONSENSE'
    })

    const arg = (legal.searchLegifrance as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(arg.dateDebut).toBeUndefined()
    expect(arg.tri).toBeUndefined()
  })

  it('leaves fond/typeChamp/typeRecherche unset when omitted so the service auto-detects', async () => {
    const legal = makeLegalService()
    const executor = makeExecutor(legal)

    await executor.execute('legal_search_legifrance', {
      recherche: 'article 1240 du code civil'
    })

    const arg = (legal.searchLegifrance as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(arg.fond).toBeUndefined()
    expect(arg.typeChamp).toBeUndefined()
    expect(arg.typeRecherche).toBeUndefined()
  })

  it('forwards Judilibre chamber, theme, dates and sort', async () => {
    const legal = makeLegalService()
    const executor = makeExecutor(legal)

    await executor.execute('legal_search_judilibre', {
      recherche: 'préjudice',
      juridiction: 'cc',
      chambre: 'civ1',
      theme: 'accident de la circulation',
      dateDebut: '2023-01-01',
      dateFin: '2023-12-31',
      tri: 'date',
      nombreResultats: 5
    })

    expect(legal.searchJudilibre).toHaveBeenCalledWith(
      expect.objectContaining({
        recherche: 'préjudice',
        juridiction: 'cc',
        chambre: 'civ1',
        theme: 'accident de la circulation',
        dateDebut: '2023-01-01',
        dateFin: '2023-12-31',
        tri: 'date',
        nombreResultats: 5
      })
    )
  })

  it('dispatches the taxonomy tool', async () => {
    const legal = makeLegalService()
    const executor = makeExecutor(legal)

    const raw = await executor.execute('legal_taxonomy_judilibre', {
      taxonomyId: 'chamber',
      contextValue: 'cc'
    })

    expect(legal.taxonomyJudilibre).toHaveBeenCalledWith(
      expect.objectContaining({ taxonomyId: 'chamber', contextValue: 'cc' })
    )
    expect(JSON.parse(raw)).toMatchObject({ id: 'chamber' })
  })

  it('reports an error when the legal service is unavailable', async () => {
    const executor = makeExecutor(undefined as unknown as LegalService)
    const raw = await executor.execute('legal_taxonomy_judilibre', { taxonomyId: 'chamber' })
    expect(JSON.parse(raw).error).toContain('unavailable')
  })
})
