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
  /** Offsets within `snippet` marking the sentence that actually carried the
   *  match. Surrounding text is context. Undefined when no refinement ran. */
  snippetMatchStart?: number
  snippetMatchEnd?: number
}

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

// Cap exact-match hits per document so one high-frequency term (e.g. a
// common name) can't crowd the top-K and starve vector matches from other
// documents in the dossier.
const EXACT_MATCH_MAX_HITS_PER_DOCUMENT = 3

// Maximum number of hits returned per document in the final top-K.
// Prevents a single document from occupying multiple slots when a common
// term matches it many times — the reader can open the document to see all
// occurrences; the search panel should prioritise breadth across documents.
const MAX_HITS_PER_DOCUMENT = 2

// Snippet refinement bounds. Chunks can be ~2000 chars — too long to read
// at a glance. We re-embed each sentence of the chunk against the query and
// surface the best one, then frame it with the surrounding sentences so the
// reader sees enough context to interpret the match. Caps avoid edge cases
// (one giant unpunctuated chunk) overflowing the panel.
const SNIPPET_MAX_CHARS = 280

// Safety bounds for the snippet-refinement embedBatch call. The naive
// "embed every sentence of every top-K hit in one shot" path easily hits
// 200-600 inputs on real legal documents, which is enough to OOM/segfault
// the ONNX runtime — and a native crash in the main process hard-quits
// the whole Electron app. We cap the per-call batch size and the per-input
// length, and we cap how many sentences a single hit contributes.
const REFINE_BATCH_SIZE = 32
const REFINE_MAX_SENTENCE_CHARS = 1200
const REFINE_MAX_SENTENCES_PER_HIT = 24

// Stop words stripped from the query before keyword-presence scoring.
// Covers French and English (tests use English text).
const STOP_WORDS = new Set([
  // French
  'de',
  'du',
  'des',
  'le',
  'la',
  'les',
  'un',
  'une',
  'et',
  'ou',
  'au',
  'aux',
  'en',
  'pour',
  'par',
  'sur',
  'avec',
  'dans',
  'qui',
  'que',
  'se',
  'ce',
  'sa',
  'son',
  'ses',
  'leur',
  'leurs',
  'je',
  'tu',
  'il',
  'elle',
  'nous',
  'vous',
  'ils',
  'elles',
  'est',
  'sont',
  'ont',
  'été',
  'ne',
  'pas',
  'mais',
  'car',
  'ni',
  'dont',
  'si',
  'or',
  // English
  'the',
  'an',
  'and',
  'in',
  'of',
  'to',
  'is',
  'are',
  'was',
  'for',
  'on',
  'at',
  'this',
  'that',
  'it',
  'be',
  'by',
  'with'
])

// Score added per matched content word from the query found verbatim in the
// candidate chunk. This provides a hybrid keyword-presence signal so that
// documents literally containing the query terms beat documents that are
// only semantically adjacent — critical in legal dossiers where all docs
// cluster tightly in embedding space (scores often 0.80–0.85 across the
// board regardless of actual relevance). The bonus is small enough that
// vector similarity remains the dominant signal.
const KEYWORD_BONUS_PER_WORD = 0.04

function buildContentWordRegexes(query: string): RegExp[] {
  return query
    .toLocaleLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => {
      const alt = w.endsWith('s') ? w.slice(0, -1) : w + 's'
      // Word-boundary match prevents "nom" hitting "notamment", etc.
      return new RegExp(`\\b(${w}|${alt})\\b`)
    })
}

function computeKeywordBonus(chunkText: string, wordRegexes: readonly RegExp[]): number {
  if (wordRegexes.length === 0) return 0
  const lower = chunkText.toLocaleLowerCase()
  let bonus = 0
  for (const re of wordRegexes) {
    if (re.test(lower)) bonus += KEYWORD_BONUS_PER_WORD
  }
  return bonus
}

export async function searchDossier(params: SemanticSearchParams): Promise<SemanticSearchHit[]> {
  const query = params.query.trim()
  if (!query) return []

  const topK = Math.max(1, params.topK ?? DEFAULT_TOP_K)
  const expectedModel = params.embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
  const expectedDim = params.dim ?? DEFAULT_EMBEDDING_DIM

  const embedder = params.embedder ?? embedBatch

  // Kick off query embedding and cache decode in parallel so we don't pay
  // them sequentially. The query side uses the "query: " E5 prefix.
  const [queryVecBatch, loadResult] = await Promise.all([
    embedder([query], params.embeddingConfig, { inputPrefix: 'query: ' }),
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

  // Pure cosine search — no keyword bonus yet. The bonus is applied later,
  // on the refined snippet, so only hits whose displayed sentence actually
  // contains the query terms benefit. Applying it on the raw chunk (~2000
  // chars) was causing chunks to be over-ranked when the keyword appeared
  // in a different sentence than the one eventually displayed.
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

  // Take a generous candidate pool (topK * 2) so relevant documents are not
  // excluded before the snippet-based re-ranking below. A light per-doc cap
  // (MAX_HITS_PER_DOCUMENT + 1) prevents one document from monopolising the
  // pool while still giving it more than its final allocation.
  const candidatePool = limitHitsPerDocument(mergedHits, MAX_HITS_PER_DOCUMENT + 1).slice(
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

  // Re-rank: add keyword bonus based on the SNIPPET text (not the raw chunk)
  // so the bonus only fires when the displayed passage actually contains the
  // query terms. Then apply the final per-doc limit and slice to topK.
  const wordRegexes = buildContentWordRegexes(query)
  for (const hit of candidatePool) {
    hit.score += computeKeywordBonus(hit.snippet, wordRegexes)
  }
  candidatePool.sort((a, b) => b.score - a.score)

  return limitHitsPerDocument(candidatePool, MAX_HITS_PER_DOCUMENT).slice(0, topK)
}

interface Sentence {
  /** Offset relative to the chunk text. */
  charStart: number
  charEnd: number
  /** Trimmed text. */
  text: string
}

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
  }
}

function splitIntoSentences(text: string): Sentence[] {
  const sentences: Sentence[] = []
  // Sentence terminators: a run of .!? followed by whitespace, one or more
  // newlines, or a semicolon followed by whitespace. Semicolons are included
  // because French legal text uses them heavily as clause/article separators
  // (e.g. "L.114-17 du code de la Sécurité sociale ; Article L6145-11...").
  const boundaryRe = /[.!?]+\s+|\n+|;\s+/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = boundaryRe.exec(text)) !== null) {
    const end = m.index + m[0].length
    const slice = text.slice(last, end)
    const trimmed = slice.trim()
    // Skip tiny fragments (abbreviations like "L.", "N°", lone digits) that
    // produce useless embeddings and clutter context.
    if (trimmed.length >= 5) sentences.push({ charStart: last, charEnd: end, text: trimmed })
    last = end
  }
  if (last < text.length) {
    const trimmed = text.slice(last).trim()
    if (trimmed) sentences.push({ charStart: last, charEnd: text.length, text: trimmed })
  }
  return sentences
}

interface BuiltSnippet {
  text: string
  /** Offset into `text` where the picked sentence starts. */
  matchStart: number
  /** Offset into `text` where the picked sentence ends. */
  matchEnd: number
}

/**
 * Build a snippet from the picked sentence, padded with the sentences
 * immediately before and after so the reader can interpret the match in
 * context. We alternate before/after additions to keep the match roughly
 * centred and stop as soon as we hit SNIPPET_MAX_CHARS.
 */
function buildSnippetWithContext(sentences: Sentence[], pickedIdx: number): BuiltSnippet {
  const match = sentences[pickedIdx]!.text
  let before = ''
  let after = ''
  let prev = pickedIdx - 1
  let next = pickedIdx + 1
  let addAfterNext = true

  const totalLen = (): number =>
    (before ? before.length + 1 : 0) + match.length + (after ? after.length + 1 : 0)

  while (prev >= 0 || next < sentences.length) {
    let added = false
    if (addAfterNext && next < sentences.length) {
      const candidate = sentences[next]!.text
      if (totalLen() + 1 + candidate.length <= SNIPPET_MAX_CHARS) {
        after = after ? `${after} ${candidate}` : candidate
        next += 1
        added = true
      } else {
        // Can't fit any more on this side
        next = sentences.length
      }
    } else if (!addAfterNext && prev >= 0) {
      const candidate = sentences[prev]!.text
      if (totalLen() + 1 + candidate.length <= SNIPPET_MAX_CHARS) {
        before = before ? `${candidate} ${before}` : candidate
        prev -= 1
        added = true
      } else {
        prev = -1
      }
    }
    if (!added) {
      addAfterNext = !addAfterNext
      // If both directions are now exhausted, bail
      if (prev < 0 && next >= sentences.length) break
      continue
    }
    addAfterNext = !addAfterNext
  }

  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(match)
  if (after) parts.push(after)
  const text = parts.join(' ')
  const matchStart = before ? before.length + 1 : 0
  const matchEnd = matchStart + match.length
  return { text, matchStart, matchEnd }
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

function limitHitsPerDocument(hits: SemanticSearchHit[], max: number): SemanticSearchHit[] {
  const countByDoc = new Map<string, number>()
  return hits.filter((hit) => {
    const n = countByDoc.get(hit.documentId) ?? 0
    if (n >= max) return false
    countByDoc.set(hit.documentId, n + 1)
    return true
  })
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
