/**
 * semanticSearchService — dossier-scoped semantic search over per-document
 * embeddings persisted by embeddingIndexer.
 *
 * Scope: Ordicab dossiers are bounded (tens to low-hundreds of documents),
 * so there is no value in a persistent vector database. For each search the
 * service loads the relevant cache JSONs, decodes their vectors into memory,
 * runs a flat cosine-similarity search, and returns the top-K chunks with
 * snippets + offsets. A typical dossier (~50 docs × ~100 chunks × 1024 dims)
 * is well under 50 MB in RAM — cheap to build on demand.
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
  DEFAULT_EMBEDDING_POOLING,
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
  embedder?: (texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>
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

// Confidence floor for semantic suggestions, on the RAW query–passage cosine.
// Vectors are L2-normalized at index time, so cosine is a plain dot product.
//
// We rank and admit on raw cosine directly — no corpus-mean centering. That
// centering was inherited from the older, strongly-anisotropic E5 model, whose
// off-topic cosine floor sat around ~0.6 and buried real matches. bge-m3 is
// different: measured on the demo dossiers its query–passage cosine separates
// on-topic passages from off-topic probes on a stable, dossier-independent
// scale. Centering by the corpus mean instead made scores depend on how
// homogeneous the dossier is (an on-topic hit in a tight medical dossier
// collapsed to ~0.14 while an off-topic one in a looser dossier reached ~0.20),
// so no fixed floor could separate them. Raw cosine restores a single,
// interpretable cut.
//
// This floor is applied AFTER sentence refinement (so a strong chunk can't
// survive on a weak displayed sentence). Measured on the demo dossiers, the
// refined picked-sentence cosine of genuine on-topic queries bottoms out at
// ~0.50, while off-topic probes top out at ~0.46 — 0.47 sits in that gap,
// keeping real matches while dropping the "least bad" neighbour dense retrieval
// always returns for an out-of-corpus probe.
const MIN_SEMANTIC_SCORE = 0.47

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

const LOW_SIGNAL_HEADINGS = new Set([
  'discussion',
  'objet',
  'demandes',
  'moyens',
  'faits',
  'procedure',
  'procédure',
  'conclusions',
  'dispositif'
])

function isLowSignalSentence(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true

  const lower = trimmed.toLocaleLowerCase()
  const folded = lower.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const heading = lower.replace(/[^\p{L}\p{N}\s-]/gu, '').trim()
  const foldedHeading = folded.replace(/[^\p{L}\p{N}\s-]/gu, '').trim()

  if (LOW_SIGNAL_HEADINGS.has(heading) || LOW_SIGNAL_HEADINGS.has(foldedHeading)) return true
  if (trimmed.length <= 40 && /^[\p{L}\p{N}\s'’:-]+$/u.test(trimmed) && !/[.!?]$/.test(trimmed)) {
    return true
  }
  if (
    folded.includes('cabinet delacroix') ||
    folded.includes('avocat au barreau') ||
    lower.includes('contact@cabinet-delacroix.fr') ||
    /(?:\+33|0)\s*\d(?:[\s.()-]*\d){6,}/.test(trimmed)
  ) {
    return true
  }

  return false
}

export async function searchDossier(params: SemanticSearchParams): Promise<SemanticSearchHit[]> {
  const query = params.query.trim()
  if (!query) return []

  const topK = Math.max(1, params.topK ?? DEFAULT_TOP_K)
  const expectedModel = params.embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
  const expectedDim = params.dim ?? DEFAULT_EMBEDDING_DIM

  const embedder = params.embedder ?? embedBatch

  // Kick off query embedding and cache decode in parallel so we don't pay them
  // sequentially. bge-m3 pools the raw text, so the query is embedded the same
  // way as the indexed passages — no query/passage prefix to apply.
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

  // Score every chunk by raw cosine against the query. Vectors are L2-normalized
  // at index time, so cosineSimilarity is a plain dot product. We rank and admit
  // on this raw cosine directly: bge-m3's off-topic floor (~0.35) sits well below
  // its on-topic band (~0.5-0.6), so there is no anisotropic common component
  // worth subtracting first (see MIN_SEMANTIC_SCORE).
  //
  // Two-stage ranking:
  //   1. Candidate selection on the CHUNK cosine — order the pool by closeness
  //      so the chunks we refine are the genuinely-closest ones.
  //   2. FINAL ranking on the picked SENTENCE's cosine (set by refineSnippets).
  //      A ~800-char chunk's signal can be carried by a different sentence than
  //      the one we highlight, so ranking on the displayed sentence is finer.
  //
  // searchDossier returns PURE VECTOR (meaning-based) results; literal keyword
  // matches are handled separately by keywordSearchService and merged upstream.
  type ScoredChunk = {
    doc: LoadedDocument
    chunk: StoredEmbeddings['chunks'][number]
    score: number
  }
  const scored: ScoredChunk[] = []
  for (const doc of loadResult.loaded) {
    for (const chunk of doc.embeddings.chunks) {
      scored.push({ doc, chunk, score: cosineSimilarity(queryVec, chunk.vector) })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const vectorHits: SemanticSearchHit[] = scored.map((s) => ({
    itemId: s.doc.meta.itemId,
    displayName: s.doc.meta.displayName,
    charStart: s.chunk.charStart,
    charEnd: s.chunk.charEnd,
    // Raw chunk cosine — a placeholder that refineSnippets overwrites with the
    // picked sentence's cosine when sentence refinement runs.
    score: s.score,
    snippet: ''
  }))

  // Take a generous candidate pool (topK * 2) so relevant documents are not
  // excluded before the sentence-level re-ranking below. A light per-doc cap
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
  const loadedById = new Map(loadResult.loaded.map((doc) => [doc.meta.itemId, doc]))
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
      const doc = loadedById.get(hit.itemId)
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

  // Stage 2: rank on the picked-sentence cosine that refineSnippets wrote back
  // into hit.score (falls back to the chunk cosine for hits it couldn't refine).
  // Drop weak semantic neighbours before the final per-doc limit so approximate
  // search remains useful without showing forced matches.
  const confidentHits = candidatePool.filter((hit) => hit.score >= MIN_SEMANTIC_SCORE)
  confidentHits.sort((a, b) => b.score - a.score)

  return limitHitsPerDocument(confidentHits, MAX_HITS_PER_DOCUMENT).slice(0, topK)
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
    config?: EmbeddingServiceConfig
  ) => Promise<Float32Array[] | null> = embedBatch
): Promise<void> {
  interface Plan {
    hit: SemanticSearchHit
    chunkStart: number
    chunkText: string
    sentences: Sentence[]
  }

  const plans: Plan[] = []
  for (const hit of hits) {
    const doc = loadedById.get(hit.itemId)
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
    // empty/whitespace, single sentences longer than the model context, and
    // structural boilerplate ("Discussion", letterhead/contact lines) that
    // otherwise becomes the repeated best-looking snippet for unrelated queries.
    sentences = sentences
      .filter((s) => s.text.length >= 5 && s.text.length <= REFINE_MAX_SENTENCE_CHARS)
      .filter((s) => !isLowSignalSentence(s.text))
      .slice(0, REFINE_MAX_SENTENCES_PER_HIT)
    if (sentences.length === 0) {
      hit.snippet = chunkText.trim().slice(0, SNIPPET_MAX_CHARS)
      continue
    }
    plans.push({ hit, chunkStart, chunkText, sentences })
  }

  // Hits with more than one sentence need re-embedding to locate the best
  // sub-span. We chunk the batch so a single inference call never exceeds
  // REFINE_BATCH_SIZE inputs — large batches are the most likely native-crash
  // trigger (OOM inside the ONNX runtime, which would hard-quit the whole
  // Electron process).
  const refinable = plans.filter((p) => p.sentences.length > 1)
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
    if (plan.sentences.length === 1) {
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
      // Re-rank on the displayed sentence: replace the coarse chunk score with
      // the cosine of the sentence we actually highlight, so the ranking
      // reflects the passage the user sees (stage 2 in searchDossier).
      if (bestScore > -Infinity) plan.hit.score = bestScore
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
    const doc = loadedById.get(plan.hit.itemId)
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
      // Pooling is part of the identity: a doc still pooled with the old mode
      // must not be scored against a query pooled with the current mode (mixed
      // pooling = meaningless cosine). Treat it like a model/dim mismatch so the
      // warn log nudges a re-index; the startup catch-up rebuilds it.
      if (
        embeddings.model !== expectedModel ||
        embeddings.dim !== expectedDim ||
        embeddings.pooling !== DEFAULT_EMBEDDING_POOLING
      ) {
        return 'mismatch'
      }
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
