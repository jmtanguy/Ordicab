import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CredentialStore } from '../../../lib/system/credentialStore'
import { createLegalService } from '../legalService'

const CLIENT_ID_KEY = 'legal.piste.production.clientId'
const CLIENT_SECRET_KEY = 'legal.piste.production.clientSecret'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  } as Response
}

function createMemoryCredentials(): CredentialStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    saveSecret: vi.fn(async (key: string, value: string) => {
      values.set(key, value)
    }),
    getSecret: vi.fn(async (key: string) => values.get(key) ?? null),
    deleteSecret: vi.fn(async (key: string) => {
      values.delete(key)
    }),
    hasSecret: vi.fn(async (key: string) => values.has(key))
  }
}

describe('legalService', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('stores PISTE settings in named secrets and exposes only status', async () => {
    const credentials = createMemoryCredentials()
    const service = createLegalService({ credentialStore: credentials })

    await service.saveSettings({
      clientId: 'client-id-1234',
      clientSecret: 'secret-5678'
    })

    expect(credentials.values.get(CLIENT_ID_KEY)).toBe('client-id-1234')
    expect(credentials.values.get(CLIENT_SECRET_KEY)).toBe('secret-5678')

    const settings = await service.getSettings()
    expect(settings.credentials).toMatchObject({
      hasClientId: true,
      clientIdSuffix: '1234',
      hasClientSecret: true,
      clientSecretSuffix: '5678'
    })
  })

  it('gets an OAuth token and searches Légifrance with a normalized response', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          totalResultNumber: 1,
          results: [
            {
              id: 'LEGIARTI000006419280',
              title: 'Article 1240',
              text: '<em>responsabilité</em>'
            }
          ]
        })
      )

    const result = await service.searchLegifrance({
      recherche: 'article 1240 code civil',
      pageTaille: 5
    })

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://oauth.piste.gouv.fr/api/oauth/token')
    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search'
    )
    expect(result.results[0]).toMatchObject({
      source: 'legifrance',
      id: 'LEGIARTI000006419280',
      title: 'Article 1240'
    })
  })

  it('builds a structured NUM_ARTICLE search for an article citation', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await service.searchLegifrance({ recherche: 'article 1240 du code civil' })

    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as {
      fond: string
      recherche: {
        champs: Array<{
          typeChamp: string
          criteres: Array<{ valeur: string; typeRecherche: string }>
        }>
        filtres: Array<{ facette: string; valeurs: string[] }>
      }
    }

    expect(body.fond).toBe('CODE_DATE')
    expect(body.recherche.champs[0]?.typeChamp).toBe('NUM_ARTICLE')
    expect(body.recherche.champs[0]?.criteres[0]?.valeur).toBe('1240')
    expect(body.recherche.champs[0]?.criteres[0]?.typeRecherche).toBe('EXACTE')
    expect(body.recherche.filtres).toContainEqual({ facette: 'NOM_CODE', valeurs: ['Code civil'] })
  })

  it('keeps the citation CODE fond even when the caller forces fond=ALL', async () => {
    // The "all sources" search passes fond:'ALL'. A citation builds a
    // NUM_ARTICLE + NOM_CODE body that the DILA endpoint rejects with a 500 on
    // the ALL fond, so the parsed CODE fond must win over the explicit ALL.
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await service.searchLegifrance({ recherche: 'article 1240 du code civil', fond: 'ALL' })

    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as {
      fond: string
      recherche: { champs: Array<{ typeChamp: string }> }
    }

    expect(body.fond).toBe('CODE_DATE')
    expect(body.recherche.champs[0]?.typeChamp).toBe('NUM_ARTICLE')
  })

  it('forces a CODE fond for an article citation with no named code', async () => {
    // "article 1240" with no code still builds a NUM_ARTICLE body. Sending that
    // against fond=ALL is the exact 500 trigger, so the fond must default to a
    // CODE fond (CODE_DATE) even though no NOM_CODE facette can be added.
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await service.searchLegifrance({ recherche: 'article 1240' })

    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as {
      fond: string
      recherche: { champs: Array<{ typeChamp: string }> }
    }

    expect(body.fond).not.toBe('ALL')
    expect(body.fond).toBe('CODE_DATE')
    expect(body.recherche.champs[0]?.typeChamp).toBe('NUM_ARTICLE')
  })

  it('uses UN_DES_MOTS relevance search for a free-text query', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await service.searchLegifrance({ recherche: 'jurisprudence sur le mariage' })

    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as {
      fond: string
      recherche: {
        champs: Array<{
          typeChamp: string
          criteres: Array<{ valeur: string; typeRecherche: string }>
        }>
      }
    }

    expect(body.fond).toBe('ALL')
    expect(body.recherche.champs[0]?.typeChamp).toBe('ALL')
    expect(body.recherche.champs[0]?.criteres[0]?.valeur).toBe('jurisprudence sur le mariage')
    expect(body.recherche.champs[0]?.criteres[0]?.typeRecherche).toBe('UN_DES_MOTS')
  })

  it('does not retry fetch timeouts', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockRejectedValueOnce(timeout)

    await expect(service.searchLegifrance({ recherche: 'responsabilité' })).rejects.toThrow(
      'The operation was aborted due to timeout'
    )
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not override explicit typeChamp / fond on a citation query', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    await service.searchLegifrance({
      recherche: 'article 1240 du code civil',
      typeChamp: 'TEXTE',
      fond: 'JURI'
    })

    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as {
      fond: string
      recherche: { champs: Array<{ typeChamp: string }> }
    }

    expect(body.fond).toBe('JURI')
    expect(body.recherche.champs[0]?.typeChamp).toBe('TEXTE')
  })

  it('searches Judilibre with an OAuth Bearer token', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'judi-token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          total: 1,
          results: [
            {
              id: 'decision-1',
              jurisdiction: 'cc',
              chamber: 'civ1',
              number: '14-82.234',
              decision_date: '2024-01-02',
              score: 12.5
            }
          ]
        })
      )

    const result = await service.searchJudilibre({ recherche: '14-82.234' })

    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://oauth.piste.gouv.fr/api/oauth/token')
    const [, init] = mockFetch.mock.calls[1] ?? []
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain(
      'https://api.piste.gouv.fr/cassation/judilibre/v1.0/search'
    )
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      'Bearer judi-token'
    )
    expect(result.results[0]).toMatchObject({
      source: 'judilibre',
      id: 'decision-1',
      jurisdiction: 'cc',
      score: 12.5
    })
  })

  it('normalizes DILA results that nest id/title in a titles array', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          totalResultNumber: 1,
          results: [
            {
              // Section entries carry a null title; the real text entry wins,
              // and its `cid` (not the versioned `id`) is preferred.
              titles: [
                { id: 'LEGISCTA000022356630', cid: 'LEGISCTA000022356630', title: null },
                {
                  id: 'LEGITEXT000006069577_10-12-1965',
                  cid: 'LEGITEXT000006069577',
                  title: 'Code général des impôts',
                  startDate: '1952-01-01'
                }
              ],
              nature: 'CODE',
              sections: [{ title: 'Livre premier' }]
            }
          ]
        })
      )

    const result = await service.searchLegifrance({
      recherche: 'responsabilité',
      fond: 'CODE_ETAT'
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      id: 'LEGITEXT000006069577',
      title: 'Code général des impôts',
      summary: 'Livre premier',
      date: '1952-01-01'
    })
  })

  it('routes Légifrance consult by id prefix (full text → legiPart)', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ title: 'Code civil', text: 'contenu' }))

    await service.consultLegifrance({ id: 'LEGITEXT000006070721' })

    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/legiPart'
    )
    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>
    expect(body.textId).toBe('LEGITEXT000006070721')
    expect(typeof body.date).toBe('string')
  })

  it('routes Légifrance consult for an article id to getArticle', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ num: '1240', text: 'contenu' }))

    await service.consultLegifrance({ id: 'LEGIARTI000006419280' })

    expect(mockFetch.mock.calls[1]?.[0]).toBe(
      'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/consult/getArticle'
    )
    const [, init] = mockFetch.mock.calls[1] ?? []
    const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>
    expect(body.id).toBe('LEGIARTI000006419280')
  })

  it('verifies article references through Légifrance search', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'LEGIARTI000006419280', title: 'Article 1240 du Code civil' }]
        })
      )

    const result = await service.verifyReferences({
      text: 'La demande vise l’article 1240 du code civil.'
    })

    expect(result.references[0]).toMatchObject({
      reference: 'article 1240 du code civil',
      normalizedReference: 'art. 1240 · Code civil',
      status: 'found',
      confidence: 'high',
      source: 'legifrance'
    })
  })

  it('marks an article as not_found when the search returns no hit', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))

    const result = await service.verifyReferences({
      text: 'Voir l’article 99999 du code civil.'
    })

    expect(result.references[0]).toMatchObject({
      reference: 'article 99999 du code civil',
      status: 'not_found',
      source: 'legifrance'
    })
    expect(result.references[0]?.matches).toHaveLength(0)
  })

  it('marks an article as ambiguous when hits exist but none carries the cited number', async () => {
    // The structured NUM_ARTICLE search can still surface neighbouring articles;
    // if none has the exact number, the citation should not read as confirmed.
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'LEGIARTI000000000001', num: '1241', title: 'Article 1241' }]
        })
      )

    const result = await service.verifyReferences({
      text: 'Au visa de l’article 1240 du code civil.'
    })

    expect(result.references[0]).toMatchObject({
      reference: 'article 1240 du code civil',
      status: 'ambiguous'
    })
  })

  it('flags a bare article number found in several codes as ambiguous', async () => {
    // "L. 121-3" with no code given exists in multiple codes; without a code to
    // disambiguate, the verdict must be ambiguous rather than a false "found".
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 'LEGIARTI000000000010',
              num: 'L121-3',
              titles: [{ title: 'Code de la consommation' }]
            },
            {
              id: 'LEGIARTI000000000011',
              num: 'L121-3',
              titles: [{ title: 'Code des assurances' }]
            }
          ]
        })
      )

    const result = await service.verifyReferences({ text: 'Au visa de l’article L. 121-3.' })

    expect(result.references[0]).toMatchObject({
      reference: 'L. 121-3',
      status: 'ambiguous',
      source: 'legifrance'
    })
  })

  it('confirms a Judilibre pourvoi number when a decision carries it', async () => {
    const credentials = createMemoryCredentials()
    credentials.values.set(CLIENT_ID_KEY, 'client-id')
    credentials.values.set(CLIENT_SECRET_KEY, 'client-secret')
    const service = createLegalService({ credentialStore: credentials })

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: 'decision-1', number: '14-82.234', jurisdiction: 'cc', chamber: 'crim' }]
        })
      )

    const result = await service.verifyReferences({ text: 'Cass. crim., pourvoi n° 14-82.234.' })

    expect(result.references[0]).toMatchObject({
      reference: '14-82.234',
      status: 'found',
      confidence: 'high',
      source: 'judilibre'
    })
  })
})
