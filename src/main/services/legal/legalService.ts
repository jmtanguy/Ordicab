import type {
  JudilibreConsultInput,
  JudilibreSearchInput,
  JudilibreTaxonomyInput,
  LegalConnectionStatus,
  LegalConnectionStatusInput,
  LegalConsultResponse,
  LegalCredentialStatus,
  LegalReferenceCheckInput,
  LegalReferenceCheckItem,
  LegalReferenceCheckResult,
  LegalSearchResponse,
  LegalSearchResultItem,
  LegalSettingsResponse,
  LegalSettingsSaveInput,
  LegifranceConsultInput,
  LegifranceSearchInput
} from '@shared/types'
import { IpcErrorCode, parseLegalQuery } from '@shared/types'

import type { CredentialStore } from '../../lib/system/credentialStore'

// Secret keys keep their historical `production` namespace so credentials saved
// before PISTE became production-only continue to resolve.
const PISTE_CLIENT_ID_SECRET_KEY = 'legal.piste.production.clientId'
const PISTE_CLIENT_SECRET_SECRET_KEY = 'legal.piste.production.clientSecret'
const TOKEN_EXPIRY_SAFETY_MS = 60_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const VERIFY_CONCURRENCY = 4

class LegalServiceError extends Error {
  constructor(
    message: string,
    readonly code: IpcErrorCode = IpcErrorCode.REMOTE_API_ERROR,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LegalServiceError'
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof LegalServiceError && (error.status === 401 || error.status === 403)
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

/**
 * Fetch wrapper that retries transient failures (429 / 5xx / network errors)
 * with exponential backoff, honouring a `Retry-After` header when present.
 * Timeout aborts are NOT retried — the caller decides whether to wait longer.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, init)
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
        return response
      }
      const retryAfter = parseRetryAfterMs(response.headers?.get?.('Retry-After') ?? null)
      await delayMs(retryAfter ?? RETRY_BASE_DELAY_MS * 2 ** attempt)
    } catch (error) {
      // AbortSignal.timeout fires an AbortError — do not retry a deliberate timeout.
      if (error instanceof Error && error.name === 'AbortError') throw error
      lastError = error
      if (attempt === MAX_RETRIES) break
      await delayMs(RETRY_BASE_DELAY_MS * 2 ** attempt)
    }
  }
  throw lastError instanceof Error
    ? new LegalServiceError(`PISTE request failed: ${lastError.message}`)
    : new LegalServiceError('PISTE request failed.')
}

/** Run tasks with a bounded number in flight, preserving result order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index]!, index)
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext)
  await Promise.all(runners)
  return results
}

interface PisteCredentials {
  clientId: string
  clientSecret: string
}

interface PisteEndpoints {
  oauthUrl: string
  baseUrl: string
  legifranceBaseUrl: string
  judilibreBaseUrl: string
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const PISTE_BASE_URL = 'https://api.piste.gouv.fr'
const PISTE_ENDPOINTS: PisteEndpoints = {
  oauthUrl: 'https://oauth.piste.gouv.fr/api/oauth/token',
  baseUrl: PISTE_BASE_URL,
  legifranceBaseUrl: `${PISTE_BASE_URL}/dila/legifrance/lf-engine-app`,
  judilibreBaseUrl: `${PISTE_BASE_URL}/cassation/judilibre/v1.0`
}

function getSuffix(secret: string | null): string | undefined {
  if (!secret || secret.length < 4) return undefined
  return secret.slice(-4)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return undefined
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function stripHtml(value: string): string {
  return (
    value
      // Preserve the document structure: turn block-level boundaries and <br>
      // into newlines before stripping tags, otherwise legal texts (which use
      // <p>/<br> heavily) collapse into one unreadable paragraph.
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|article|section)\s*>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<[^>]*>/g, ' ')
      // Decode the few entities Légifrance/Judilibre payloads commonly emit.
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      // Collapse runs of spaces/tabs but keep newlines, then cap blank-line runs.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// Build a deep link to the legifrance.gouv.fr page for a given identifier.
// The site uses distinct routes per object type, recognizable from the id
// prefix (LEGIARTI = code article, LEGITEXT = code/text, JORFTEXT = official
// journal, KALICONT = collective agreement…). Unknown ids fall back to search.
function legifranceUrl(id: string): string {
  const base = 'https://www.legifrance.gouv.fr'
  const encoded = encodeURIComponent(id)
  if (/^LEGIARTI/i.test(id)) return `${base}/codes/article_lc/${encoded}`
  if (/^LEGITEXT/i.test(id)) return `${base}/codes/id/${encoded}`
  if (/^JORFARTI/i.test(id)) return `${base}/jorf/article_jo/${encoded}`
  if (/^JORF(TEXT|CONT)/i.test(id)) return `${base}/jorf/id/${encoded}`
  if (/^(LEGI|JORF)SCTA/i.test(id)) return `${base}/codes/section_lc/${encoded}`
  if (/^KALIARTI/i.test(id)) return `${base}/conv_coll/article/${encoded}`
  if (/^KALI(CONT|TEXT)/i.test(id)) return `${base}/conv_coll/id/${encoded}`
  if (/^CETATEXT/i.test(id)) return `${base}/ceta/id/${encoded}`
  if (/^JURITEXT/i.test(id)) return `${base}/juri/id/${encoded}`
  return `${base}/search/all?query=${encoded}`
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function assertOkJson(response: Response, fallback: string): Promise<unknown> {
  const payload = await readJsonResponse(response)
  if (!response.ok) {
    const details =
      isRecord(payload) && typeof payload['message'] === 'string'
        ? payload['message']
        : typeof payload === 'string'
          ? payload.slice(0, 300)
          : `HTTP ${response.status}`
    throw new LegalServiceError(
      `${fallback}: ${details}`,
      IpcErrorCode.REMOTE_API_ERROR,
      response.status
    )
  }
  return payload
}

interface LegifranceConsultRoute {
  path: string
  body: Record<string, unknown>
}

/**
 * Légifrance exposes one consult endpoint per kind of identifier. `getArticle`
 * only resolves article ids (LEGIARTI…); full texts, JORF texts and case law
 * each need their own endpoint, so route by id prefix.
 */
function legifranceConsultRoute(rawId: string, date: string): LegifranceConsultRoute {
  // Code/text ids may carry a version suffix (e.g. LEGITEXT…_10-12-1965); the
  // consult endpoints expect the bare id.
  const id = rawId.replace(/_\d{2}-\d{2}-\d{4}$/, '')
  const prefix = id.slice(0, 8).toUpperCase()
  if (prefix === 'LEGIARTI' || prefix === 'JORFARTI') {
    return { path: '/consult/getArticle', body: { id } }
  }
  if (prefix === 'LEGITEXT' || prefix === 'LEGISCTA') {
    return { path: '/consult/legiPart', body: { textId: id, date } }
  }
  if (prefix.startsWith('JORFTEXT')) {
    return { path: '/consult/jorf', body: { textCid: id } }
  }
  if (prefix.startsWith('JURITEXT') || prefix.startsWith('CETATEXT')) {
    return { path: '/consult/juri', body: { textId: id } }
  }
  if (prefix.startsWith('KALITEXT') || prefix.startsWith('KALICONT')) {
    return { path: '/consult/kaliText', body: { id } }
  }
  // Unknown prefix: fall back to getArticle, which is the most common case.
  return { path: '/consult/getArticle', body: { id } }
}

function buildLegifranceSearchBody(input: LegifranceSearchInput): Record<string, unknown> {
  // Detect article-citation queries ("article 1240 du code civil") so we can
  // target the article number precisely instead of dumping the whole string as
  // free text. Free-text/conceptual queries fall through to UN_DES_MOTS, which
  // ranks by relevance like a search engine rather than requiring every word.
  const parsed = parseLegalQuery(input.recherche)
  const isStructured = parsed.isCitation && !input.typeChamp

  const operateur = input.operateur ?? 'ET'
  const codeName = input.code ?? (isStructured ? parsed.codeName : undefined)
  // A structured citation builds a CODE-specific body (typeChamp NUM_ARTICLE +
  // NOM_CODE facette). The DILA `/search` endpoint returns an unhandled 500
  // ("Une exception non gérée est survenue") if that body is sent against the
  // cross-fond `ALL` fond — NUM_ARTICLE / NOM_CODE only exist on the CODE fonds.
  // So when the query is a citation with a detected code, the parsed CODE fond
  // takes precedence over an explicit/default `fond: 'ALL'`. Free-text queries
  // keep honouring the caller's chosen fond (defaulting to ALL).
  const explicitFond = input.fond && input.fond !== 'ALL' ? input.fond : undefined
  const fond = isStructured ? (parsed.fond ?? explicitFond ?? 'ALL') : (input.fond ?? 'ALL')

  const champs =
    isStructured && parsed.articleNumber
      ? [
          {
            typeChamp: 'NUM_ARTICLE',
            criteres: [{ valeur: parsed.articleNumber, typeRecherche: 'EXACTE', operateur }],
            operateur
          }
        ]
      : [
          {
            typeChamp: input.typeChamp ?? 'ALL',
            criteres: [
              {
                valeur: input.recherche,
                typeRecherche: input.typeRecherche ?? 'UN_DES_MOTS',
                operateur
              }
            ],
            operateur
          }
        ]

  const filtres: Array<Record<string, unknown>> = []

  if (codeName) {
    filtres.push({ facette: 'NOM_CODE', valeurs: [codeName] })
  }

  const dateFacetByFond: Partial<Record<string, string>> = {
    JORF: 'DATE_PUBLICATION',
    LODA_DATE: 'DATE_PUBLICATION',
    LODA_ETAT: 'DATE_PUBLICATION',
    JURI: 'DATE_DECISION',
    CETAT: 'DATE_DECISION',
    JUFI: 'DATE_DECISION',
    CONSTIT: 'DATE_DECISION',
    KALI: 'DATE_SIGNATURE',
    CIRC: 'DATE_SIGNATURE',
    ACCO: 'DATE_SIGNATURE'
  }
  const dateFacet = dateFacetByFond[fond]
  if (dateFacet && input.dateDebut) {
    filtres.push({
      facette: dateFacet,
      dates: { start: input.dateDebut, end: input.dateFin ?? input.dateDebut }
    })
  }

  return {
    fond,
    recherche: {
      champs,
      filtres,
      pageNumber: (input.page ?? 0) + 1,
      pageSize: input.pageTaille ?? 20,
      operateur,
      // Sort tokens are fond-specific. PERTINENCE is universally valid; a date
      // sort (e.g. DATE_PUBLI_DESC) only applies to certain fonds, so for the
      // cross-fond `ALL` search we always fall back to relevance ranking.
      sort: fond === 'ALL' ? 'PERTINENCE' : (input.tri ?? 'PERTINENCE'),
      // `secondSort` is omitted on purpose: the DILA `/search` endpoint throws an
      // unhandled server exception ("Une exception non gérée est survenue") when
      // given a secondSort token that is not valid for the selected fond. The
      // primary sort already produces a deterministic order.
      typePagination: 'DEFAUT'
    }
  }
}

function extractArrayPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []

  for (const key of ['results', 'resultats', 'items', 'documents', 'listArticle', 'decisions']) {
    const value = payload[key]
    if (Array.isArray(value)) return value
    if (isRecord(value)) {
      const nested = extractArrayPayload(value)
      if (nested.length > 0) return nested
    }
  }

  return []
}

/** The containing code/text title, e.g. "Code civil", from the `titles` array. */
function extractContainerTitle(item: Record<string, unknown>): string | undefined {
  if (!Array.isArray(item['titles'])) return undefined
  for (const entry of item['titles']) {
    if (isRecord(entry)) {
      const title = firstString(entry, ['title', 'titre'])
      if (title) return title
    }
  }
  return undefined
}

/**
 * Find the first matched article extract nested under `sections[].extracts[]`.
 * DILA code/text search results carry the actual matched article (LEGIARTI…)
 * here rather than at the top level. Returns the extract record or undefined.
 */
function findMatchedExtract(item: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(item['sections'])) return undefined
  for (const section of item['sections']) {
    if (!isRecord(section) || !Array.isArray(section['extracts'])) continue
    for (const extract of section['extracts']) {
      if (isRecord(extract) && firstString(extract, ['id'])?.startsWith('LEGIARTI')) {
        return extract
      }
    }
  }
  return undefined
}

function normalizeLegifranceItem(item: unknown): LegalSearchResultItem | null {
  if (!isRecord(item)) return null
  const metadata = isRecord(item['metadata']) ? item['metadata'] : {}

  // For code/text searches the matched article lives in `sections[].extracts[]`
  // (id `LEGIARTI…`, `num` the article number, `values` the article text), while
  // the top-level item only identifies the containing code. Surface the matched
  // article itself so an article search opens the article, not the whole code.
  const extract = findMatchedExtract(item)
  if (extract) {
    const containerTitle = extractContainerTitle(item)
    const num = firstString(extract, ['num', 'title'])
    const extractText = Array.isArray(extract['values'])
      ? extract['values'].map(asString).filter(Boolean).join(' ')
      : firstString(extract, ['values', 'text'])
    return {
      source: 'legifrance',
      id: firstString(extract, ['id']) ?? '',
      title: stripHtml(
        [containerTitle, num ? `art. ${num}` : undefined].filter(Boolean).join(' — ') || (num ?? '')
      ),
      summary: extractText ? stripHtml(extractText) : undefined,
      date: firstString(extract, ['dateVersion', 'dateDebut']) ?? firstString(item, ['date']),
      nature: 'article',
      url: legifranceUrl(firstString(extract, ['id']) ?? ''),
      raw: item
    }
  }

  // The DILA search response nests identifiers and titles inside a `titles`
  // array (one entry per matching version/section). Section entries (LEGISCTA…)
  // carry a null title and are not directly consultable, so prefer the entry
  // that actually has a title — that is the text/article we want to open.
  const titleEntries = Array.isArray(item['titles'])
    ? item['titles'].filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : []
  const titleEntry = titleEntries.find((entry) => asString(entry['title'])) ?? titleEntries[0] ?? {}

  // Prefer the clean container id (`cid`, e.g. LEGITEXT…) over a versioned or
  // section id so that consult routing can resolve it.
  const id =
    firstString(item, ['id', 'textId', 'cid', 'idTexte', 'articleId']) ??
    firstString(titleEntry, ['cid', 'id']) ??
    firstString(metadata, ['id', 'textId', 'cid', 'idTexte', 'articleId'])
  if (!id) return null

  const title =
    firstString(item, ['title', 'titre', 'textTitle', 'num', 'articleNumber']) ??
    firstString(titleEntry, ['title', 'titre']) ??
    firstString(metadata, ['title', 'titre', 'textTitle', 'num', 'articleNumber']) ??
    id
  // Codes/texts carry no snippet but expose matched sections; surface the first.
  const sectionTitle =
    Array.isArray(item['sections']) && isRecord(item['sections'][0])
      ? firstString(item['sections'][0], ['title', 'titre'])
      : undefined
  const summary =
    firstString(item, ['summary', 'resume', 'snippet', 'highlight', 'text']) ??
    firstString(metadata, ['summary', 'resume', 'snippet', 'highlight', 'text']) ??
    sectionTitle
  const date =
    firstString(item, ['date', 'datePublication', 'dateDecision', 'dateSignature']) ??
    firstString(titleEntry, ['startDate']) ??
    firstString(metadata, ['date', 'datePublication', 'dateDecision', 'dateSignature'])
  const nature =
    firstString(item, ['nature', 'type', 'fond']) ??
    firstString(titleEntry, ['nature']) ??
    firstString(metadata, ['nature', 'type', 'fond'])

  return {
    source: 'legifrance',
    id,
    title: stripHtml(title),
    summary: summary ? stripHtml(summary) : undefined,
    date,
    nature,
    url: legifranceUrl(id),
    raw: item
  }
}

function normalizeJudilibreItem(item: unknown): LegalSearchResultItem | null {
  if (!isRecord(item)) return null
  const id = firstString(item, ['id', '_id'])
  if (!id) return null
  const number = firstString(item, ['number', 'numero'])
  const jurisdiction = firstString(item, ['jurisdiction', 'juridiction'])
  const chamber = firstString(item, ['chamber', 'chambre'])
  const date = firstString(item, ['decision_date', 'date', 'dateDecision'])
  const summary =
    firstString(item, ['summary', 'sommaire', 'text']) ??
    (isRecord(item['highlights']) && Array.isArray(item['highlights'].text)
      ? asString(item['highlights'].text[0])
      : undefined)
  const title = [jurisdiction, chamber, number, date].filter(Boolean).join(' · ') || id
  // Judilibre exposes a relevance score per hit (`score`, or `scorepub` for the
  // public ranking). DILA/Légifrance results carry no comparable per-item score.
  const score = firstNumber(item, ['score', 'scorepub'])

  return {
    source: 'judilibre',
    id,
    title,
    summary: summary ? stripHtml(summary).slice(0, 800) : undefined,
    date,
    jurisdiction,
    nature: firstString(item, ['type', 'solution']),
    score,
    url: `https://www.courdecassation.fr/decision/${encodeURIComponent(id)}`,
    raw: item
  }
}

function extractTextFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') return stripHtml(value)
  if (Array.isArray(value)) {
    return value.map(extractTextFromUnknown).filter(Boolean).join('\n\n') || undefined
  }
  if (!isRecord(value)) return undefined

  for (const key of ['text', 'texte', 'content', 'rawContent']) {
    const text = extractTextFromUnknown(value[key])
    if (text) return text
  }
  if (isRecord(value['article'])) return extractTextFromUnknown(value['article'])
  if (Array.isArray(value['articles'])) return extractTextFromUnknown(value['articles'])
  if (isRecord(value['decision'])) return extractTextFromUnknown(value['decision'])
  return undefined
}

function getPayloadTotal(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined
  const value = payload['total'] ?? payload['totalResultNumber'] ?? payload['totalNbResult']
  return typeof value === 'number' ? value : undefined
}

class PisteAuthClient {
  private cachedToken: CachedToken | null = null
  private inFlight: Promise<string> | null = null

  /** Drop the cached token so the next call re-authenticates (e.g. after a 401). */
  invalidate(): void {
    this.cachedToken = null
  }

  /**
   * Perform a Bearer-authenticated request, retrying once with a fresh token if
   * the server rejects the (possibly server-side-invalidated) cached token.
   */
  async authenticatedJson(
    credentials: PisteCredentials,
    fallback: string,
    request: (token: string) => Promise<Response>
  ): Promise<unknown> {
    const token = await this.getAccessToken(credentials)
    try {
      return await assertOkJson(await request(token), fallback)
    } catch (error) {
      if (!isUnauthorized(error)) throw error
      this.invalidate()
      const freshToken = await this.getAccessToken(credentials)
      return assertOkJson(await request(freshToken), fallback)
    }
  }

  async getAccessToken(credentials: PisteCredentials): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken
    }

    // Coalesce concurrent callers onto a single token request so a burst of
    // searches doesn't trigger a thundering herd against OAuth.
    if (this.inFlight) return this.inFlight

    const request = this.requestToken(credentials).finally(() => {
      this.inFlight = null
    })
    this.inFlight = request
    return request
  }

  private async requestToken(credentials: PisteCredentials): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: 'openid'
    })
    const response = await fetchWithRetry(PISTE_ENDPOINTS.oauthUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body,
      signal: AbortSignal.timeout(15_000)
    })
    const payload = await assertOkJson(response, 'Unable to obtain PISTE token')
    if (!isRecord(payload) || typeof payload['access_token'] !== 'string') {
      throw new LegalServiceError('PISTE token response is malformed.')
    }
    const expiresIn =
      typeof payload['expires_in'] === 'number' && payload['expires_in'] > 0
        ? payload['expires_in']
        : 3600
    const token = payload['access_token']
    this.cachedToken = {
      accessToken: token,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_SAFETY_MS
    }
    return token
  }
}

class LegifranceClient {
  constructor(private readonly authClient: PisteAuthClient) {}

  async search(
    credentials: PisteCredentials,
    input: LegifranceSearchInput
  ): Promise<LegalSearchResponse> {
    const payload = await this.authClient.authenticatedJson(
      credentials,
      'Légifrance search failed',
      (token) =>
        fetchWithRetry(`${PISTE_ENDPOINTS.legifranceBaseUrl}/search`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(buildLegifranceSearchBody(input)),
          signal: AbortSignal.timeout(20_000)
        })
    )
    // The DILA search returns one entry per matching version, so the same
    // article/text can appear several times with the same id; keep the first.
    const seen = new Set<string>()
    const results = extractArrayPayload(payload)
      .map(normalizeLegifranceItem)
      .filter((item): item is LegalSearchResultItem => Boolean(item))
      .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
    return {
      source: 'legifrance',
      total: getPayloadTotal(payload),
      page: input.page ?? 0,
      pageSize: input.pageTaille ?? 20,
      results,
      raw: payload
    }
  }

  async consult(
    credentials: PisteCredentials,
    input: LegifranceConsultInput
  ): Promise<LegalConsultResponse> {
    const today = new Date().toISOString().slice(0, 10)
    const route = legifranceConsultRoute(input.id, today)
    const payload = await this.authClient.authenticatedJson(
      credentials,
      'Légifrance consultation failed',
      (token) =>
        fetchWithRetry(`${PISTE_ENDPOINTS.legifranceBaseUrl}${route.path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(route.body),
          signal: AbortSignal.timeout(20_000)
        })
    )
    const title = isRecord(payload)
      ? firstString(payload, ['title', 'titre', 'num', 'articleNumber'])
      : undefined
    return {
      source: 'legifrance',
      id: input.id,
      title,
      text: extractTextFromUnknown(payload),
      url: legifranceUrl(input.id),
      raw: payload
    }
  }
}

class JudilibreClient {
  constructor(private readonly authClient: PisteAuthClient) {}

  private headers(token: string): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  }

  async search(
    credentials: PisteCredentials,
    input: JudilibreSearchInput
  ): Promise<LegalSearchResponse> {
    const params = new URLSearchParams()
    if (input.recherche) params.set('query', input.recherche)
    if (input.juridiction) params.append('jurisdiction', input.juridiction)
    if (input.localisation) params.append('location', input.localisation)
    if (input.chambre) params.append('chamber', input.chambre)
    if (input.typeDecision) params.append('type', input.typeDecision)
    if (input.theme) params.append('theme', input.theme)
    if (input.solution) params.append('solution', input.solution)
    if (input.dateDebut) params.set('date_start', input.dateDebut)
    if (input.dateFin) params.set('date_end', input.dateFin)
    params.set('sort', input.tri ?? 'scorepub')
    params.set('order', input.ordre ?? 'desc')
    params.set('page_size', String(input.nombreResultats ?? 20))
    params.set('page', String(input.page ?? 0))
    params.set('resolve_references', 'true')

    const payload = await this.authClient.authenticatedJson(
      credentials,
      'Judilibre search failed',
      (token) =>
        fetchWithRetry(`${PISTE_ENDPOINTS.judilibreBaseUrl}/search?${params}`, {
          method: 'GET',
          headers: this.headers(token),
          signal: AbortSignal.timeout(20_000)
        })
    )
    const results = extractArrayPayload(payload)
      .map(normalizeJudilibreItem)
      .filter((item): item is LegalSearchResultItem => Boolean(item))
    return {
      source: 'judilibre',
      total: getPayloadTotal(payload),
      page: input.page ?? 0,
      pageSize: input.nombreResultats ?? 20,
      results,
      raw: payload
    }
  }

  async consult(
    credentials: PisteCredentials,
    input: JudilibreConsultInput
  ): Promise<LegalConsultResponse> {
    const params = new URLSearchParams({ id: input.decisionId, resolve_references: 'true' })
    const payload = await this.authClient.authenticatedJson(
      credentials,
      'Judilibre consultation failed',
      (token) =>
        fetchWithRetry(`${PISTE_ENDPOINTS.judilibreBaseUrl}/decision?${params}`, {
          method: 'GET',
          headers: this.headers(token),
          signal: AbortSignal.timeout(20_000)
        })
    )
    const record = isRecord(payload) ? payload : {}
    return {
      source: 'judilibre',
      id: input.decisionId,
      title:
        [
          firstString(record, ['jurisdiction']),
          firstString(record, ['chamber']),
          firstString(record, ['number'])
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      text: extractTextFromUnknown(payload),
      date: firstString(record, ['decision_date', 'date']),
      url: `https://www.courdecassation.fr/decision/${encodeURIComponent(input.decisionId)}`,
      raw: payload
    }
  }

  async taxonomy(credentials: PisteCredentials, input: JudilibreTaxonomyInput): Promise<unknown> {
    const params = new URLSearchParams()
    if (input.taxonomyId) params.set('id', input.taxonomyId)
    if (input.key) params.set('key', input.key)
    if (input.value) params.set('value', input.value)
    if (input.contextValue) params.set('context_value', input.contextValue)
    return this.authClient.authenticatedJson(credentials, 'Judilibre taxonomy failed', (token) =>
      fetchWithRetry(`${PISTE_ENDPOINTS.judilibreBaseUrl}/taxonomy?${params}`, {
        method: 'GET',
        headers: this.headers(token),
        signal: AbortSignal.timeout(15_000)
      })
    )
  }
}

export interface LegalService {
  getSettings(): Promise<LegalSettingsResponse>
  saveSettings(input: LegalSettingsSaveInput): Promise<void>
  deleteCredentials(): Promise<void>
  connectionStatus(input?: LegalConnectionStatusInput): Promise<LegalConnectionStatus>
  searchLegifrance(input: LegifranceSearchInput): Promise<LegalSearchResponse>
  consultLegifrance(input: LegifranceConsultInput): Promise<LegalConsultResponse>
  searchJudilibre(input: JudilibreSearchInput): Promise<LegalSearchResponse>
  consultJudilibre(input: JudilibreConsultInput): Promise<LegalConsultResponse>
  taxonomyJudilibre(input: JudilibreTaxonomyInput): Promise<unknown>
  verifyReferences(input: LegalReferenceCheckInput): Promise<LegalReferenceCheckResult>
}

/** Compact an article number for comparison: drop spaces/dots, upper-case the
 * optional L/R/D prefix. "L. 121-3" and "l121-3" both become "L121-3". */
function normalizeArticleNumber(raw: string): string {
  return raw.replace(/[\s.]/g, '').toUpperCase()
}

/** Pull the article number a Légifrance result actually carries, from the
 * normalized title ("Code civil — art. 1240") or the raw payload (`num`). */
function resultArticleNumber(item: LegalSearchResultItem): string | undefined {
  const raw = isRecord(item.raw) ? item.raw : undefined
  const extract = raw ? findMatchedExtract(raw) : undefined
  const fromRaw =
    (extract ? firstString(extract, ['num']) : undefined) ??
    (raw ? firstString(raw, ['num', 'articleNumber']) : undefined)
  if (fromRaw) return normalizeArticleNumber(fromRaw)
  // Fall back to the "art. <num>" / "Article <num>" fragment in the title.
  const fromTitle = item.title.match(/\b(?:art\.?|article)\s*([LRD]?\.?\s*\d+(?:-\d+)*)/i)?.[1]
  return fromTitle ? normalizeArticleNumber(fromTitle) : undefined
}

/** The containing code/text title of a Légifrance result, used to tell whether
 * the same article number resolves to one code or several (ambiguous). */
function resultCodeName(item: LegalSearchResultItem): string | undefined {
  const raw = isRecord(item.raw) ? item.raw : undefined
  const container = raw ? extractContainerTitle(raw) : undefined
  if (container) return container
  // "Code civil — art. 1240" → "Code civil".
  const head = item.title.split('—')[0]?.trim()
  return head || undefined
}

interface ReferenceVerdict {
  status: LegalReferenceCheckItem['status']
  confidence: LegalReferenceCheckItem['confidence']
  /** Results that genuinely match the reference, narrowed from the raw hits. */
  matches: LegalSearchResultItem[]
}

/**
 * Decide whether a reference is genuinely found, by matching the parsed
 * reference against the search results rather than counting raw hits.
 *
 * Article citations are confirmed when a result carries the exact article
 * number; if that number resolves to several distinct codes (e.g. "L. 121-3"
 * with no code given) the verdict is `ambiguous` so the user disambiguates.
 * Pourvoi numbers are confirmed when a Judilibre result carries that number.
 * Anything we can't structurally anchor falls back to a hits-present heuristic.
 */
function classifyReference(
  reference: string,
  source: 'legifrance' | 'judilibre',
  results: LegalSearchResultItem[]
): ReferenceVerdict {
  if (results.length === 0) {
    return { status: 'not_found', confidence: 'low', matches: [] }
  }

  if (source === 'judilibre') {
    const pourvoi = reference.match(/\b\d{2}-\d{2}\.\d{3}\b/)?.[0]
    const exact = pourvoi
      ? results.filter((item) => {
          const number =
            (isRecord(item.raw) ? firstString(item.raw, ['number', 'numero']) : undefined) ??
            item.title
          return number?.includes(pourvoi)
        })
      : []
    if (exact.length >= 1) {
      return { status: 'found', confidence: 'high', matches: exact }
    }
    // Hits exist but none carries the cited pourvoi number — likely the wrong
    // decision surfaced by relevance ranking, so flag it for a human check.
    return { status: 'ambiguous', confidence: 'low', matches: results.slice(0, 5) }
  }

  const parsed = parseLegalQuery(reference)
  if (!parsed.articleNumber) {
    // Non-article Légifrance reference (named statute, decree, case law): we
    // can't anchor on an article number, so report hits-present with medium
    // confidence and let the user inspect the matches.
    return { status: 'ambiguous', confidence: 'medium', matches: results.slice(0, 5) }
  }

  const wanted = normalizeArticleNumber(parsed.articleNumber)
  const exact = results.filter((item) => resultArticleNumber(item) === wanted)
  if (exact.length === 0) {
    // The structured NUM_ARTICLE search returned texts but none with the exact
    // number — the article likely does not exist as cited.
    return { status: 'ambiguous', confidence: 'low', matches: results.slice(0, 5) }
  }

  // Group the exact matches by the code they belong to. One code → unambiguous
  // found; several distinct codes → the citation needs a code to disambiguate.
  const codes = new Set(exact.map((item) => resultCodeName(item) ?? item.id))
  if (codes.size > 1 && !parsed.codeName) {
    return { status: 'ambiguous', confidence: 'medium', matches: exact.slice(0, 5) }
  }
  return { status: 'found', confidence: 'high', matches: exact.slice(0, 5) }
}

export function createLegalService(options: { credentialStore: CredentialStore }): LegalService {
  const { credentialStore } = options
  const authClient = new PisteAuthClient()
  const legifranceClient = new LegifranceClient(authClient)
  const judilibreClient = new JudilibreClient(authClient)

  async function getCredentialStatus(): Promise<LegalCredentialStatus> {
    const clientId = await credentialStore.getSecret(PISTE_CLIENT_ID_SECRET_KEY)
    const clientSecret = await credentialStore.getSecret(PISTE_CLIENT_SECRET_SECRET_KEY)
    return {
      hasClientId: clientId !== null,
      clientIdSuffix: getSuffix(clientId),
      hasClientSecret: clientSecret !== null,
      clientSecretSuffix: getSuffix(clientSecret)
    }
  }

  async function getCredentials(draft?: {
    clientId?: string
    clientSecret?: string
  }): Promise<PisteCredentials> {
    const clientId =
      draft?.clientId ?? (await credentialStore.getSecret(PISTE_CLIENT_ID_SECRET_KEY))
    const clientSecret =
      draft?.clientSecret ?? (await credentialStore.getSecret(PISTE_CLIENT_SECRET_SECRET_KEY))
    if (!clientId || !clientSecret) {
      throw new LegalServiceError(
        'PISTE credentials are not configured.',
        IpcErrorCode.INVALID_INPUT
      )
    }
    return { clientId, clientSecret }
  }

  async function runLegifranceSearch(input: LegifranceSearchInput): Promise<LegalSearchResponse> {
    return legifranceClient.search(await getCredentials(), input)
  }

  async function runJudilibreSearch(input: JudilibreSearchInput): Promise<LegalSearchResponse> {
    return judilibreClient.search(await getCredentials(), input)
  }

  function extractReferences(text: string): string[] {
    const patterns = [
      // "article 1240 du code civil", "art. L. 121-3 du code de la consommation".
      /\b(?:article|art\.)\s+[A-Z]?\s*\.?\s*\d+(?:-\d+)*(?:-\d+)?\s+(?:du|de la|de l'|des)\s+code\s+[a-zàâçéèêëîïôûùüÿñæœ\s-]+/gi,
      // Bare code-article references like "L. 121-3", "R. 431-5", "D. 311-1".
      /\b(?:L|R|D)\.?\s*\d+(?:-\d+)+\b/gi,
      // Judilibre pourvoi numbers like "14-82.234".
      /\b\d{2}-\d{2}\.\d{3}\b/g,
      // Numbered statutes/decrees: "loi n° 2016-1547 du 18 novembre 2016",
      // "décret n° 2020-1310". The date tail, when present, is kept so the
      // reference reads naturally and search ranks the right text.
      /\b(?:loi|décret|décret-loi|ordonnance|règlement|arrêté)\s+n[°o]\s*\d{2,4}-\d+(?:\s+du\s+\d{1,2}(?:er)?\s+[a-zàâçéèêëîïôûùüÿñæœ]+\s+\d{4})?/gi,
      // Case-law citations by court/date: "Cass. civ. 1re, 12 mars 2020",
      // "CE, 5 mai 2021", "Cass. com., 3 février 2015". The court tag is short
      // (Cass./CE/CAA/TA/Cons. const.) and is followed by an optional chamber
      // then a French date.
      /\b(?:Cass\.|CE|CAA|TA|Cons\.\s*const\.|Crim\.|Com\.|Soc\.|Civ\.)[^,.]*,?\s+\d{1,2}(?:er)?\s+[a-zàâçéèêëîïôûùüÿñæœ]+\s+\d{4}/gi
    ]
    const refs = new Set<string>()
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const value = match[0]?.replace(/\s+/g, ' ').trim()
        if (value) refs.add(value)
      }
    }
    return Array.from(refs).slice(0, 20)
  }

  return {
    async getSettings(): Promise<LegalSettingsResponse> {
      return {
        credentials: await getCredentialStatus()
      }
    },

    async saveSettings(input: LegalSettingsSaveInput): Promise<void> {
      if (input.clientId) {
        await credentialStore.saveSecret(PISTE_CLIENT_ID_SECRET_KEY, input.clientId)
      }
      if (input.clientSecret) {
        await credentialStore.saveSecret(PISTE_CLIENT_SECRET_SECRET_KEY, input.clientSecret)
      }
    },

    async deleteCredentials(): Promise<void> {
      await credentialStore.deleteSecret(PISTE_CLIENT_ID_SECRET_KEY)
      await credentialStore.deleteSecret(PISTE_CLIENT_SECRET_SECRET_KEY)
    },

    async connectionStatus(input?: LegalConnectionStatusInput): Promise<LegalConnectionStatus> {
      try {
        const credentials = await getCredentials(input)
        await authClient.getAccessToken(credentials)
        let legifranceReachable = false
        let judilibreReachable = false
        try {
          await legifranceClient.search(credentials, {
            recherche: 'responsabilité',
            fond: 'ALL',
            pageTaille: 1
          })
          legifranceReachable = true
        } catch {
          legifranceReachable = false
        }
        try {
          await judilibreClient.search(credentials, {
            recherche: 'responsabilité',
            nombreResultats: 1
          })
          judilibreReachable = true
        } catch {
          judilibreReachable = false
        }
        return {
          reachable: legifranceReachable || judilibreReachable,
          tokenObtained: true,
          legifranceReachable,
          judilibreReachable
        }
      } catch (error) {
        return {
          reachable: false,
          tokenObtained: false,
          error: error instanceof Error ? error.message : 'Unable to reach PISTE.'
        }
      }
    },

    searchLegifrance: runLegifranceSearch,

    async consultLegifrance(input: LegifranceConsultInput): Promise<LegalConsultResponse> {
      return legifranceClient.consult(await getCredentials(), input)
    },

    searchJudilibre: runJudilibreSearch,

    async consultJudilibre(input: JudilibreConsultInput): Promise<LegalConsultResponse> {
      return judilibreClient.consult(await getCredentials(), input)
    },

    async taxonomyJudilibre(input: JudilibreTaxonomyInput): Promise<unknown> {
      return judilibreClient.taxonomy(await getCredentials(), input)
    },

    async verifyReferences(input: LegalReferenceCheckInput): Promise<LegalReferenceCheckResult> {
      const references = extractReferences(input.text)
      const checks = await mapWithConcurrency<string, LegalReferenceCheckItem>(
        references,
        VERIFY_CONCURRENCY,
        async (reference) => {
          const source = /\b\d{2}-\d{2}\.\d{3}\b/.test(reference) ? 'judilibre' : 'legifrance'
          // Build a canonical "<article> · <code>" form when the reference is an
          // article citation, so the UI shows what we actually matched against.
          const parsed = source === 'legifrance' ? parseLegalQuery(reference) : null
          const normalizedReference =
            parsed?.articleNumber || parsed?.codeName
              ? [parsed.articleNumber ? `art. ${parsed.articleNumber}` : undefined, parsed.codeName]
                  .filter(Boolean)
                  .join(' · ')
              : reference
          try {
            // Pass the raw reference straight to search: Légifrance routes article
            // citations through the structured NUM_ARTICLE path (see
            // buildLegifranceSearchBody), so we get article-level hits to match on
            // rather than a noisy free-text EXACTE query.
            const response =
              source === 'judilibre'
                ? await runJudilibreSearch({
                    recherche: reference,
                    nombreResultats: 5
                  })
                : await runLegifranceSearch({
                    recherche: reference,
                    pageTaille: 10
                  })
            const verdict = classifyReference(reference, source, response.results)
            return {
              reference,
              normalizedReference,
              status: verdict.status,
              confidence: verdict.confidence,
              source,
              matches: verdict.matches
            }
          } catch (error) {
            return {
              reference,
              normalizedReference,
              status: 'api_error',
              confidence: 'low',
              source,
              matches: [],
              error: error instanceof Error ? error.message : 'Reference verification failed.'
            }
          }
        }
      )
      return { references: checks }
    }
  }
}
