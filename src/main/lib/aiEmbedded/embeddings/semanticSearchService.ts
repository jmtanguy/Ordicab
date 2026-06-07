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
  embedBatch,
  type EmbeddingServiceConfig
} from './embeddingService'
import { readEmbeddingsFromCache, type StoredEmbeddings } from './embeddingCache'
import {
  buildSnippetWithContext,
  limitHitsPerDocument,
  MAX_HITS_PER_DOCUMENT,
  SNIPPET_MAX_CHARS,
  splitIntoSentences,
  type IndexedDocument,
  type SemanticSearchHit,
  type Sentence
} from './textSearchShared'

export type { IndexedDocument, SemanticSearchHit } from './textSearchShared'

export interface SemanticSearchParams {
  documents: IndexedDocument[]
  query: string
  topK?: number
  /** Model config for the query-side embedding. Should match the indexing config. */
  embeddingConfig?: EmbeddingServiceConfig
  /** Expected vector dim. Used to skip docs indexed with an incompatible model. */
  dim?: number
  /**
   * Optional embedder. Defaults to the in-process embeddingService.embedBatch.
   * Pass the worker-thread client here to keep ONNX inference off the Electron
   * main thread and prevent HandleScope crashes in Electron's CFRunLoop integration.
   */
  embedder?: (
    texts: string[],
    config?: EmbeddingServiceConfig,
    options?: { inputPrefix?: string }
  ) => Promise<Float32Array[] | null>
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

// Embedding models are anisotropic: any two texts share a large common
// component, so raw cosine has a high noise floor (~0.5-0.6 here) and an
// off-topic query like "recette de cuisine" can score as high as a real one.
// We subtract the corpus mean vector ("all-but-the-top" centering) before
// scoring vector hits — this collapses the shared component so the genuine
// signal (the *difference* from the average document) dominates. After
// centering, clearly off-topic queries fall near/below zero.
//
// Relative keep-band: a vector hit survives when its centered score is within
// this margin of the best centered score for the query. Keeps the strong
// match plus its near-neighbours; drops documents far below the top.
const RELATIVE_MARGIN = 0.1

// Absolute guard: only documents MORE similar than the dossier average survive
// (centered score > 0). A negative centered score means the document is less
// like the query than a typical document in the dossier — pure noise.
//
// IMPORTANT: this does NOT separate on-topic from off-topic. Measurements
// across dossiers showed the vector signal simply cannot make that call in a
// small homogeneous legal corpus — an off-topic word ("football") can land as
// close to some document as a real term. No fixed/z-score/gap threshold fixes
// this. So semantic results are presented honestly as "approximate suggestions"
// in the UI, and literal keyword matches (keywordSearchService) carry real
// precision. This guard only trims the obvious negative-similarity noise.
const RELEVANCE_GUARD = 0

// MAX_HITS_PER_DOCUMENT and SNIPPET_MAX_CHARS are shared with the keyword
// search path — see ./textSearchShared.

// Safety bounds for the snippet-refinement embedBatch call. The naive
// "embed every sentence of every top-K hit in one shot" path easily hits
// 200-600 inputs on real legal documents, which is enough to OOM/segfault
// the ONNX runtime — and a native crash in the main process hard-quits
// the whole Electron app. We cap the per-call batch size and the per-input
// length, and we cap how many sentences a single hit contributes.
const REFINE_BATCH_SIZE = 32
const REFINE_MAX_SENTENCE_CHARS = 1200
const REFINE_MAX_SENTENCES_PER_HIT = 24

// STOP_WORDS, KEYWORD_BONUS_PER_WORD, buildContentWordRegexes, and
// computeKeywordBonus are shared with the keyword search path — see
// ./textSearchShared.

/** Centroid of every chunk vector across the loaded documents, or null if none. */
function computeMeanVector(docs: LoadedDocument[]): Float32Array | null {
  let dim = 0
  let count = 0
  for (const doc of docs) {
    for (const chunk of doc.embeddings.chunks) {
      if (dim === 0) dim = chunk.vector.length
      count += 1
    }
  }
  if (dim === 0 || count === 0) return null
  const mean = new Float32Array(dim)
  for (const doc of docs) {
    for (const chunk of doc.embeddings.chunks) {
      const v = chunk.vector
      for (let i = 0; i < dim; i++) mean[i]! += v[i]!
    }
  }
  for (let i = 0; i < dim; i++) mean[i]! /= count
  return mean
}

function subtractVector(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i]! - b[i]!
  return out
}

/** Cosine similarity that normalizes by magnitude (for non-unit vectors). */
function fullCosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

export async function searchDossier(params: SemanticSearchParams): Promise<SemanticSearchHit[]> {
  const query = params.query.trim()
  if (!query) return []

  const topK = Math.max(1, params.topK ?? DEFAULT_TOP_K)
  const expectedModel = params.embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
  const expectedDim = params.dim ?? DEFAULT_EMBEDDING_DIM

  const embedder = params.embedder ?? embedBatch

  // Kick off query embedding and cache decode in parallel so we don't pay them
  // sequentially. bge-m3 uses no input prefix, so query and passage embeddings
  // share the same (empty) prefix — we leave inputPrefix unset.
  const [queryVecBatch, loadResult] = await Promise.all([
    embedder([query], params.embeddingConfig),
    loadAll(params.documents, expectedModel, expectedDim)
  ])
  const queryVec = queryVecBatch?.[0] ?? null

  if (loadResult.droppedByModelMismatch > 0) {
    console.warn(
      `[semantic-search] skipped ${loadResult.droppedByModelMismatch}/${params.documents.length} document(s) indexed with a different embedding model/dim (expected ${expectedModel}@${expectedDim}). Re-index the dossier to include them.`
    )
  }

  if (!queryVec) return []
  if (loadResult.loaded.length === 0) return []

  // Mean-center to defeat embedding anisotropy (see CENTERED_SCORE_FLOOR). The
  // mean is computed over every chunk vector loaded for this dossier, so it is
  // the centroid of *this* corpus and adapts to its content. Vectors are
  // L2-normalized at index time; the centered vectors are not re-normalized
  // because centered cosine (a correlation) is exactly what separates signal
  // from the shared component.
  //
  // Centering needs at least 2 distinct chunk vectors: with a single chunk the
  // mean equals that chunk, so centering zeroes it out and the score collapses
  // to 0. Below that threshold we skip centering entirely and rank on raw
  // cosine with no floor (nothing to denoise against).
  const totalChunks = loadResult.loaded.reduce((n, d) => n + d.embeddings.chunks.length, 0)
  const meanVec = totalChunks >= 2 ? computeMeanVector(loadResult.loaded) : null
  const centeredQuery = meanVec ? subtractVector(queryVec, meanVec) : queryVec

  // Pure cosine search — no keyword bonus yet. The bonus is applied later,
  // on the refined snippet, so only hits whose displayed sentence actually
  // contains the query terms benefit. Applying it on the raw chunk (~2000
  // chars) was causing chunks to be over-ranked when the keyword appeared
  // in a different sentence than the one eventually displayed.
  //
  // We rank/filter on the CENTERED cosine (defeats the noise floor) but keep
  // the raw cosine for display, since centered scores can be negative and are
  // not intuitive to show.
  //
  // Filtering uses a RELATIVE threshold rather than a fixed centered floor:
  // a hit is kept when its centered score is within RELATIVE_MARGIN of the
  // best centered score for this query. This adapts per query — when a strong
  // match exists we keep its near-neighbours; when everything is weak we keep
  // little. A low absolute guard (RELEVANCE_GUARD) still applies so a query
  // with no real match (e.g. "recette de cuisine", whose best centered score
  // is near zero) doesn't drag in a pile of equally-irrelevant documents.
  type ScoredChunk = { doc: LoadedDocument; chunk: StoredEmbeddings['chunks'][number]; centered: number }
  const scored: ScoredChunk[] = []
  for (const doc of loadResult.loaded) {
    for (const chunk of doc.embeddings.chunks) {
      const centeredChunk = meanVec ? subtractVector(chunk.vector, meanVec) : chunk.vector
      // Centered vectors are not unit-length, so use a full cosine (with
      // magnitude normalization), not the dot-product fast path.
      const centered = fullCosine(centeredQuery, centeredChunk)
      scored.push({ doc, chunk, centered })
    }
  }
  const bestCentered = scored.reduce((max, s) => Math.max(max, s.centered), -Infinity)
  // Keep threshold: relative to the best, but never below the absolute guard.
  const keepThreshold = Math.max(bestCentered - RELATIVE_MARGIN, RELEVANCE_GUARD)

  const vectorHits: SemanticSearchHit[] = []
  for (const s of scored) {
    if (s.centered < keepThreshold) continue
    vectorHits.push({
      documentId: s.doc.meta.documentId,
      displayName: s.doc.meta.displayName,
      charStart: s.chunk.charStart,
      charEnd: s.chunk.charEnd,
      score: cosineSimilarity(queryVec, s.chunk.vector),
      snippet: ''
    })
  }

  // searchDossier returns PURE VECTOR (meaning-based) results. Literal keyword
  // matches are handled separately by keywordSearchService and merged upstream
  // in documentService.semanticSearch — doing exact-match here too would inject
  // duplicate 1.25-scored hits that pollute the "approximate" (semantic) lane.
  vectorHits.sort((a, b) => b.score - a.score)

  // Take a generous candidate pool (topK * 2) so relevant documents are not
  // excluded before the snippet-based re-ranking below. A light per-doc cap
  // (MAX_HITS_PER_DOCUMENT + 1) prevents one document from monopolising the
  // pool while still giving it more than its final allocation.
  const candidatePool = limitHitsPerDocument(vectorHits, MAX_HITS_PER_DOCUMENT + 1).slice(
    0,
    topK * 2
  )

  // Refine each candidate: narrow the displayed snippet from the full chunk
  // down to the sentence(s) that best match the query. For exact hits the
  // containing sentence is located directly; for vector hits the sentences
  // are re-embedded and scored.
  const loadedById = new Map(loadResult.loaded.map((doc) => [doc.meta.documentId, doc]))
  try {
    await refineSnippets(candidatePool, loadedById, queryVec, params.embeddingConfig, embedder)
  } catch (err) {
    // refineSnippets is best-effort presentation. If anything goes wrong
    // (re-embedding throws, malformed text, …) we fall back to the raw
    // chunk so the user still gets results instead of an error / crash.
    console.warn(
      '[semantic-search] snippet refinement failed — falling back to raw chunk excerpts.',
      err instanceof Error ? err.message : err
    )
    for (const hit of candidatePool) {
      if (hit.snippet) continue
      const doc = loadedById.get(hit.documentId)
      if (!doc) continue
      const chunk = doc.embeddings.chunks.find(
        (c) => c.charStart < hit.charEnd && hit.charStart < c.charEnd
      )
      if (!chunk) continue
      hit.snippet = doc.text
        .slice(chunk.charStart, chunk.charEnd)
        .trim()
        .slice(0, SNIPPET_MAX_CHARS)
    }
  }

  // Pure vector ranking — no keyword bonus here (the keyword lane is separate;
  // see comment above). Apply the final per-doc limit and slice to topK.
  candidatePool.sort((a, b) => b.score - a.score)

  return limitHitsPerDocument(candidatePool, MAX_HITS_PER_DOCUMENT).slice(0, topK)
}

// Sentence, splitIntoSentences, BuiltSnippet, and buildSnippetWithContext are
// shared with the keyword search path — see ./textSearchShared.

async function refineSnippets(
  hits: SemanticSearchHit[],
  loadedById: Map<string, LoadedDocument>,
  queryVec: Float32Array,
  embeddingConfig?: EmbeddingServiceConfig,
  embedder: (
    texts: string[],
    config?: EmbeddingServiceConfig,
    options?: { inputPrefix?: string }
  ) => Promise<Float32Array[] | null> = embedBatch
): Promise<void> {
  interface Plan {
    hit: SemanticSearchHit
    chunkStart: number
    chunkText: string
    sentences: Sentence[]
    isExact: boolean
  }

  const plans: Plan[] = []
  for (const hit of hits) {
    const doc = loadedById.get(hit.documentId)
    if (!doc) {
      hit.snippet = hit.snippet || ''
      continue
    }
    const chunk = doc.embeddings.chunks.find(
      (c) => c.charStart < hit.charEnd && hit.charStart < c.charEnd
    )
    const chunkStart = chunk ? chunk.charStart : hit.charStart
    const chunkEnd = chunk ? chunk.charEnd : hit.charEnd
    const chunkText = doc.text.slice(chunkStart, chunkEnd)
    let sentences = splitIntoSentences(chunkText)
    // Discard pathological inputs that can blow up the ONNX runtime:
    // empty/whitespace, or single sentences longer than the model context.
    sentences = sentences
      .filter((s) => s.text.length >= 5 && s.text.length <= REFINE_MAX_SENTENCE_CHARS)
      .slice(0, REFINE_MAX_SENTENCES_PER_HIT)
    if (sentences.length === 0) {
      hit.snippet = chunkText.trim().slice(0, SNIPPET_MAX_CHARS)
      continue
    }
    plans.push({
      hit,
      chunkStart,
      chunkText,
      sentences,
      isExact: hit.score >= SEMANTIC_SEARCH_EXACT_MATCH_SCORE
    })
  }

  // Vector hits with more than one sentence need re-embedding to locate
  // the best sub-span. We chunk the batch so a single inference call never
  // exceeds REFINE_BATCH_SIZE inputs — large batches on E5-small are the
  // most likely native-crash trigger (OOM inside the ONNX runtime, which
  // would hard-quit the whole Electron process).
  const refinable = plans.filter((p) => !p.isExact && p.sentences.length > 1)
  let sentenceVecs: Float32Array[] | null = null
  if (refinable.length > 0) {
    const allSentences = refinable.flatMap((p) => p.sentences.map((s) => s.text))
    const collected: Float32Array[] = []
    for (let i = 0; i < allSentences.length; i += REFINE_BATCH_SIZE) {
      const slice = allSentences.slice(i, i + REFINE_BATCH_SIZE)
      const part = await embedder(slice, embeddingConfig)
      if (!part || part.length !== slice.length) {
        sentenceVecs = null
        break
      }
      for (const vec of part) collected.push(vec)
      if (i + REFINE_BATCH_SIZE >= allSentences.length) sentenceVecs = collected
    }
  }

  let cursor = 0
  for (const plan of plans) {
    let pickedIdx: number
    if (plan.isExact) {
      const localStart = plan.hit.charStart - plan.chunkStart
      const found = plan.sentences.findIndex(
        (s) => s.charStart <= localStart && localStart < s.charEnd
      )
      pickedIdx = found >= 0 ? found : 0
    } else if (plan.sentences.length === 1) {
      pickedIdx = 0
    } else if (!sentenceVecs) {
      // Re-embedding failed (e.g. model unavailable). Highlight the first
      // sentence so we still ship something readable.
      pickedIdx = 0
    } else {
      let bestIdx = 0
      let bestScore = -Infinity
      for (let i = 0; i < plan.sentences.length; i++) {
        const vec = sentenceVecs[cursor + i]
        if (!vec) continue
        const score = cosineSimilarity(queryVec, vec)
        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      cursor += plan.sentences.length
      pickedIdx = bestIdx
    }

    const built = buildSnippetWithContext(plan.sentences, pickedIdx)
    plan.hit.snippet = built.text
    plan.hit.snippetMatchStart = built.matchStart
    plan.hit.snippetMatchEnd = built.matchEnd

    // Narrow the full-text highlight (charStart/charEnd) from the whole chunk
    // down to the picked sentence so the right-hand viewer marks the same
    // passage shown in the snippet instead of an entire ~2000-char chunk.
    // The sentence offsets are relative to the chunk; shift by chunkStart to
    // get absolute offsets into the document text. Trim the leading/trailing
    // boundary whitespace that splitIntoSentences keeps in charStart/charEnd.
    const picked = plan.sentences[pickedIdx]!
    const doc = loadedById.get(plan.hit.documentId)
    if (doc) {
      const absStart = plan.chunkStart + picked.charStart
      const absEnd = plan.chunkStart + picked.charEnd
      const raw = doc.text.slice(absStart, absEnd)
      const leading = raw.length - raw.trimStart().length
      const trailing = raw.length - raw.trimEnd().length
      const start = absStart + leading
      const end = absEnd - trailing
      if (end > start) {
        plan.hit.charStart = start
        plan.hit.charEnd = end
      }
    }
  }
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

// limitHitsPerDocument is shared with the keyword search path — see
// ./textSearchShared.
//
// Literal/exact matching used to live here (buildExactMatchHits, mergeHits,
// readSnippet) but was removed: keyword matching is now owned by
// keywordSearchService and merged upstream in documentService.semanticSearch.
// searchDossier is intentionally pure-vector so the two lanes stay distinct.
