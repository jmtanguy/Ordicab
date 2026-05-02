/**
 * embeddingIndexer — post-extraction indexing pass.
 *
 * Reads the extracted text from a document's content cache, chunks it,
 * computes embeddings, and writes them back into the same cache JSON via
 * embeddingCache.writeEmbeddingsToCache.
 *
 * Invariants
 *   - Extraction owns the cache file's `text` and `version` fields.
 *   - This module only touches the optional `embeddings` field.
 *   - If the text has been re-extracted, the existing `embeddings` field is
 *     gone (writeCache replaces the JSON), which causes isEmbeddingCacheFresh
 *     to return false and this pass to re-run — the desired reindex trigger.
 *
 * Failure mode: every step is best-effort. A missing model, a parse error,
 * or a bad chunk returns `false` without throwing — the caller logs and
 * moves on. Documents remain usable; the next trigger retries.
 */

import { readFile } from 'node:fs/promises'

import { chunkText, type ChunkOptions } from './chunker'
import {
  isEmbeddingCacheFresh,
  writeEmbeddingsToCache,
  type StoredEmbeddings
} from './embeddingCache'
import {
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  embedBatch,
  type EmbeddingServiceConfig
} from './embeddingService'

export interface IndexDocumentOptions {
  /** Embedding model configuration — passed to modelRegistry via embeddingService. */
  embeddingConfig?: EmbeddingServiceConfig
  /** Chunking strategy overrides. Defaults to chunker's own defaults. */
  chunkOptions?: ChunkOptions
  /** Expected vector dimensionality. Defaults to 384 (multilingual-e5-small). */
  dim?: number
  /** Forces re-indexing even when a fresh embedding set already exists. */
  force?: boolean
}

export type IndexDocumentResult =
  | { status: 'indexed'; chunkCount: number }
  | { status: 'fresh' }
  | { status: 'skipped'; reason: string }

async function readCacheText(cachePath: string): Promise<string | null> {
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as { text?: unknown; isEmpty?: unknown }
    if (typeof parsed.text !== 'string') return null
    if (parsed.isEmpty === true) return null
    return parsed.text
  } catch {
    return null
  }
}

/**
 * Index a single document's extracted text.
 *
 * @param cachePath  Path to the per-document content cache JSON.
 * @param options    Configuration + overrides.
 */
export async function indexDocumentEmbeddings(
  cachePath: string,
  options: IndexDocumentOptions = {}
): Promise<IndexDocumentResult> {
  const model = options.embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
  const dim = options.dim ?? DEFAULT_EMBEDDING_DIM

  if (!options.force) {
    const fresh = await isEmbeddingCacheFresh(cachePath, model, dim)
    if (fresh) return { status: 'fresh' }
  }

  const text = await readCacheText(cachePath)
  if (text === null) {
    return { status: 'skipped', reason: 'no-text' }
  }

  const chunks = chunkText(text, options.chunkOptions)
  if (chunks.length === 0) {
    return { status: 'skipped', reason: 'no-chunks' }
  }

  const vectors = await embedBatch(
    chunks.map((c) => c.text),
    options.embeddingConfig
  )
  if (!vectors) {
    return { status: 'skipped', reason: 'embedding-failed' }
  }
  if (vectors.length !== chunks.length) {
    return { status: 'skipped', reason: 'length-mismatch' }
  }
  // Reject any vector that doesn't match the declared dimension.
  for (const v of vectors) {
    if (v.length !== dim) {
      return { status: 'skipped', reason: 'dim-mismatch' }
    }
  }

  const written = await writeEmbeddingsToCache(cachePath, {
    model,
    dim,
    chunks: chunks.map((chunk, i) => ({
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      vector: vectors[i]!
    }))
  })

  if (!written) {
    return { status: 'skipped', reason: 'persist-failed' }
  }
  return { status: 'indexed', chunkCount: chunks.length }
}

export type { StoredEmbeddings }
