/**
 * Live integration tests against the real PISTE APIs (Légifrance + Judilibre).
 *
 * These are gated and SKIP automatically unless BOTH hold:
 *   1. Real PISTE credentials are present (env vars or .env.local), and
 *   2. The machine has working internet (a reachability probe succeeds).
 *
 * They use the real global `fetch` (no mocking) and never log credentials.
 * Run explicitly with: `npx vitest run *.integration.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { CredentialStore } from '../../../lib/system/credentialStore'
import { createLegalService, type LegalService } from '../legalService'

const CLIENT_ID_KEY = 'legal.piste.production.clientId'
const CLIENT_SECRET_KEY = 'legal.piste.production.clientSecret'

/** Parse a dotenv file into key/value pairs without mutating process.env globally. */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (key) out[key] = value
  }
  return out
}

const fileEnv = parseEnvFile(resolve(__dirname, '../../../../../.env.local'))

function envValue(key: string): string | undefined {
  return process.env[key] ?? fileEnv[key]
}

interface ResolvedCredentials {
  clientId: string
  clientSecret: string
}

/** Production PISTE credentials from env/.env.local; undefined if not set. */
function resolveCredentials(): ResolvedCredentials | undefined {
  const clientId = envValue('PISTE_CLIENT_ID')
  const clientSecret = envValue('PISTE_CLIENT_SECRET')
  if (clientId && clientSecret) {
    return { clientId, clientSecret }
  }
  return undefined
}

async function hasInternet(): Promise<boolean> {
  try {
    const response = await fetch('https://oauth.piste.gouv.fr/api/oauth/token', {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(5_000)
    })
    return response.status > 0
  } catch {
    return false
  }
}

function createCredentialStore(creds: ResolvedCredentials): CredentialStore {
  const values = new Map<string, string>([
    [CLIENT_ID_KEY, creds.clientId],
    [CLIENT_SECRET_KEY, creds.clientSecret]
  ])
  return {
    async saveSecret(key, value) {
      values.set(key, value)
    },
    async getSecret(key) {
      return values.get(key) ?? null
    },
    async deleteSecret(key) {
      values.delete(key)
    },
    async hasSecret(key) {
      return values.has(key)
    }
  }
}

const credentials = resolveCredentials()
let online = false

// Resolve internet reachability once before deciding whether to run.
beforeAll(async () => {
  if (credentials) online = await hasInternet()
})

const reason = !credentials
  ? 'no PISTE credentials in env/.env.local'
  : 'offline (PISTE unreachable)'

// describe.skipIf evaluates lazily, so the `online` flag set in beforeAll is honoured.
describe('legalService (live PISTE)', () => {
  let service: LegalService

  beforeAll(() => {
    if (!credentials) return
    service = createLegalService({
      credentialStore: createCredentialStore(credentials)
    })
  })

  it('obtains a token and reports a reachable connection', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const status = await service.connectionStatus()
    expect(status.tokenObtained).toBe(true)
    expect(status.reachable).toBe(true)
  }, 30_000)

  it('searches Légifrance for a known code article', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.searchLegifrance({
      recherche: 'responsabilité',
      fond: 'CODE_ETAT',
      pageTaille: 5
    })
    expect(result.source).toBe('legifrance')
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]?.id).toBeTruthy()
  }, 30_000)

  it('returns article 1240 of the Code civil at the top for its citation', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.searchLegifrance({
      recherche: 'article 1240 du code civil',
      pageTaille: 5
    })
    expect(result.results.length).toBeGreaterThan(0)
    const top = result.results[0]
    // The structured NUM_ARTICLE + NOM_CODE search should surface the article
    // itself (LEGIARTI…) titled "1240" rather than unrelated noise.
    expect(top?.id).toMatch(/^LEGIARTI/)
    expect(`${top?.title ?? ''}`).toMatch(/1240/)
  }, 30_000)

  it('ranks relevant results for a natural-language query', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.searchLegifrance({
      recherche: 'jurisprudence sur le mariage',
      pageTaille: 5
    })
    // UN_DES_MOTS must still return results despite the stop-words "sur"/"le".
    expect(result.results.length).toBeGreaterThan(0)
  }, 30_000)

  it('searches Judilibre with a Bearer token', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.searchJudilibre({
      recherche: 'responsabilité',
      nombreResultats: 5
    })
    expect(result.source).toBe('judilibre')
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]?.id).toBeTruthy()
  }, 30_000)

  it('lists Judilibre taxonomy (Cour de cassation chambers)', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const taxonomy = (await service.taxonomyJudilibre({
      taxonomyId: 'chamber',
      contextValue: 'cc'
    })) as { result?: Record<string, string> }
    expect(taxonomy.result).toBeTruthy()
    // "civ1" → "Première chambre civile" is a stable Cour de cassation code.
    expect(taxonomy.result?.civ1).toMatch(/civile/i)
  }, 30_000)

  it('searches Judilibre filtered by chamber and date range', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.searchJudilibre({
      recherche: 'préjudice',
      juridiction: 'cc',
      chambre: 'civ1',
      dateDebut: '2022-01-01',
      dateFin: '2023-12-31',
      nombreResultats: 3
    })
    expect(result.source).toBe('judilibre')
    expect(result.results.length).toBeGreaterThan(0)
  }, 30_000)

  it('verifies a real article citation as found and a fabricated one as not found', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const result = await service.verifyReferences({
      text:
        "Le demandeur invoque l'article 1240 du code civil. " +
        "Il vise aussi l'article 999999 du code civil, qui n'existe pas."
    })
    const real = result.references.find((r) => /1240/.test(r.reference))
    const fake = result.references.find((r) => /999999/.test(r.reference))
    // The genuine article is confirmed by an exact NUM_ARTICLE match; the
    // fabricated one must not read as found (no article carries that number).
    expect(real?.status).toBe('found')
    expect(fake?.status).not.toBe('found')
  }, 30_000)

  it('consults a Légifrance result it just found', async (ctx) => {
    if (!credentials || !online) return ctx.skip()
    const search = await service.searchLegifrance({
      recherche: 'liberté',
      fond: 'CODE_ETAT',
      pageTaille: 1
    })
    const first = search.results[0]
    if (!first) return ctx.skip()
    const consult = await service.consultLegifrance({ id: first.id })
    expect(consult.id).toBe(first.id)
    expect(consult.source).toBe('legifrance')
  }, 30_000)
})

afterAll(() => {
  if (!credentials || !online) {
    // Surface why the live suite was skipped without failing the run.
    console.info(`[legalService.integration] live tests skipped: ${reason}`)
  }
})
