/**
 * semanticSearchService — dossier-scoped semantic search over per-document
 * embeddings persisted by embeddingIndexer.
 *
 * Scope: Ordicab dossiers are bounded (tens to low-hundreds of documents),
 * so there is no value in a persistent vector database. For each search the
 * service loads the relevant cache JSONs, decodes their vectors into memory,
 * runs a flat cosine-similarity search, and returns the top-K chunks with
 * snippets + offsets. A typical dossier (~50 docs × ~100 chunks × 384 dims)
 * is well under 10 MB in RAM — cheap to build on demand.
 *
 * Reload-on-query is the right default: content can change between searches
 * (new documents, re-extraction), and the on-disk cache is the source of
 * truth. Callers that need warmth can call `preloadDossierIndex` to pay the
 * decode cost ahead of time.
 *
 * The service is fail-open: a missing cache, a malformed embedding set, or
 * a failed query embedding returns an empty result list, never an error —
 * the search UI shows "no results" and the user can retry. Documents
 * indexed with a different model/dim than the caller expects are skipped
 * and summarised via a warn log so re-index drift is visible in the logs.
 */

import { readFile } from 'node:fs/promises'

import {
  cosineSimilarity,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  embed,
  type EmbeddingServiceConfig
} from './embeddingService'
import { readEmbeddingsFromCache, type StoredEmbeddings } from './embeddingCache'

export interface IndexedDocument {
  /** Stable identifier for the document (e.g. relative path inside the dossier). */
  documentId: string
  /** Human-readable name (shown in the search UI). */
  displayName?: string
  /** Absolute path to the per-document content cache JSON. */
  cachePath: string
}

export interface SemanticSearchHit {
  documentId: string
  displayName?: string
  charStart: number
  charEnd: number
  score: number
  snippet: string
}

export interface SemanticSearchParams {
  documents: IndexedDocument[]
  query: string
  topK?: number
  /** Model config for the query-side embedding. Should match the indexing config. */
  embeddingConfig?: EmbeddingServiceConfig
  /** Expected vector dim. Used to skip docs indexed with an incompatible model. */
  dim?: number
}

interface LoadedDocument {
  meta: IndexedDocument
  text: string
  embeddings: StoredEmbeddings
}

interface LoadAllResult {
  loaded: LoadedDocument[]
  droppedByModelMismatch: number
}

const DEFAULT_TOP_K = 10

// Score assigned to exact-substring hits so they outrank any vector hit.
// Cosine similarity with L2-normalized vectors lives in [-1, 1], so any
// value strictly greater than 1 guarantees an exact literal match wins
// over a near-synonym. 1.25 leaves a small margin for future scoring
// tweaks while staying well below any plausible noise floor.
export const SEMANTIC_SEARCH_EXACT_MATCH_SCORE = 1.25

// Cap exact-match hits per document so one high-frequency term (e.g. a
// common name) can't crowd the top-K and starve vector matches from other
// documents in the dossier.
const EXACT_MATCH_MAX_HITS_PER_DOCUMENT = 3

export async function searchDossier(params: SemanticSearchParams): Promise<SemanticSearchHit[]> {
  const query = params.query.trim()
  if (!query) return []

  const topK = Math.max(1, params.topK ?? DEFAULT_TOP_K)
  const expectedModel = params.embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
  const expectedDim = params.dim ?? DEFAULT_EMBEDDING_DIM

  // Kick off query embedding and cache decode in parallel so we don't pay
  // them sequentially. The query side uses the "query: " E5 prefix.
  const [queryVec, loadResult] = await Promise.all([
    embed(query, params.embeddingConfig, { inputPrefix: 'query: ' }),
    loadAll(params.documents, expectedModel, expectedDim)
  ])

  if (loadResult.droppedByModelMismatch > 0) {
    console.warn(
      `[semantic-search] skipped ${loadResult.droppedByModelMismatch}/${params.documents.length} document(s) indexed with a different embedding model/dim (expected ${expectedModel}@${expectedDim}). Re-index the dossier to include them.`
    )
  }

  if (!queryVec) return []
  if (loadResult.loaded.length === 0) return []

  // Flat cosine search across every chunk of every loaded document. A min-
  // heap of size K would be faster in theory, but for bounded dossiers the
  // collect-then-sort path is simpler and the constant factors dominate.
  const vectorHits: SemanticSearchHit[] = []
  for (const doc of loadResult.loaded) {
    for (const chunk of doc.embeddings.chunks) {
      vectorHits.push({
        documentId: doc.meta.documentId,
        displayName: doc.meta.displayName,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        score: cosineSimilarity(queryVec, chunk.vector),
        snippet: ''
      })
    }
  }

  const exactHits = buildExactMatchHits(loadResult.loaded, query)
  const mergedHits = mergeHits(vectorHits, exactHits)
  mergedHits.sort((a, b) => b.score - a.score)
  const topHits = mergedHits.slice(0, topK)

  // Snippets are expensive enough (chunk lookup + slice) that we only
  // build them for the top-K hits — exact-match hits already have one.
  const loadedById = new Map(loadResult.loaded.map((doc) => [doc.meta.documentId, doc]))
  for (const hit of topHits) {
    if (hit.snippet) continue
    const doc = loadedById.get(hit.documentId)
    hit.snippet = doc ? readSnippet(doc, hit.charStart, hit.charEnd) : ''
  }

  return topHits
}

/**
 * Warm the in-memory cache for a dossier. Returns the number of documents
 * that loaded cleanly. Failing docs are skipped silently — search still
 * works, just with fewer candidates.
 */
export async function preloadDossierIndex(
  documents: IndexedDocument[],
  embeddingConfig: EmbeddingServiceConfig = {},
  dim: number = DEFAULT_EMBEDDING_DIM
): Promise<number> {
  const expectedModel = embeddingConfig.model ?? DEFAULT_EMBEDDING_MODEL
  const result = await loadAll(documents, expectedModel, dim)
  return result.loaded.length
}

async function loadAll(
  documents: IndexedDocument[],
  expectedModel: string,
  expectedDim: number
): Promise<LoadAllResult> {
  // Per-document outcome: LoadedDocument (kept) | 'mismatch' (wrong
  // model/dim — the only drop reason the caller can act on) | null
  // (missing, unreadable, or empty — silent).
  type Outcome = LoadedDocument | 'mismatch' | null

  const outcomes = await Promise.all(
    documents.map(async (meta): Promise<Outcome> => {
      const loaded = await readDocumentCache(meta.cachePath)
      if (!loaded) return null
      const { text, embeddings } = loaded
      if (embeddings.model !== expectedModel || embeddings.dim !== expectedDim) return 'mismatch'
      if (embeddings.chunks.length === 0) return null
      return { meta, text, embeddings }
    })
  )

  const loaded: LoadedDocument[] = []
  let droppedByModelMismatch = 0
  for (const outcome of outcomes) {
    if (outcome === null) continue
    if (outcome === 'mismatch') {
      droppedByModelMismatch += 1
      continue
    }
    loaded.push(outcome)
  }
  return { loaded, droppedByModelMismatch }
}

async function readDocumentCache(
  cachePath: string
): Promise<{ text: string; embeddings: StoredEmbeddings } | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as { text?: unknown }
    if (typeof parsed.text !== 'string') return null
    const embeddings = await readEmbeddingsFromCache(cachePath)
    if (!embeddings) return null
    return { text: parsed.text, embeddings }
  } catch {
    return null
  }
}

function mergeHits(
  vectorHits: SemanticSearchHit[],
  exactHits: SemanticSearchHit[]
): SemanticSearchHit[] {
  // When a vector chunk and an exact-match hit land on the same span, keep
  // whichever has the higher score (exact always wins — see constant above).
  const merged = new Map<string, SemanticSearchHit>()
  for (const hit of [...vectorHits, ...exactHits]) {
    const key = `${hit.documentId}:${hit.charStart}:${hit.charEnd}`
    const existing = merged.get(key)
    if (!existing || hit.score > existing.score) {
      merged.set(key, hit)
    }
  }
  return [...merged.values()]
}

function buildExactMatchHits(documents: LoadedDocument[], query: string): SemanticSearchHit[] {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const needle = trimmed.toLocaleLowerCase()
  const hits: SemanticSearchHit[] = []

  for (const doc of documents) {
    const haystack = doc.text.toLocaleLowerCase()
    let fromIndex = 0
    let found = 0

    while (fromIndex < haystack.length && found < EXACT_MATCH_MAX_HITS_PER_DOCUMENT) {
      const matchIndex = haystack.indexOf(needle, fromIndex)
      if (matchIndex < 0) break

      const charStart = matchIndex
      const charEnd = matchIndex + trimmed.length
      hits.push({
        documentId: doc.meta.documentId,
        displayName: doc.meta.displayName,
        charStart,
        charEnd,
        score: SEMANTIC_SEARCH_EXACT_MATCH_SCORE,
        snippet: readSnippet(doc, charStart, charEnd)
      })

      found += 1
      fromIndex = charEnd
    }
  }

  return hits
}

function readSnippet(document: LoadedDocument, charStart: number, charEnd: number): string {
  // Prefer returning the surrounding chunk's full text so the UI has enough
  // context to show the match. We match on any overlap with the hit span,
  // which covers both chunk-aligned vector hits and mid-chunk exact hits.
  const chunk = document.embeddings.chunks.find(
    (c) => c.charStart < charEnd && charStart < c.charEnd
  )
  if (!chunk) return document.text.slice(charStart, charEnd)
  return document.text.slice(chunk.charStart, chunk.charEnd).trim()
}
