/**
 * embeddingCache — reads and writes the `embeddings` field inside the per-
 * document content cache JSON produced by documentContentService.
 *
 * Shape (added alongside the existing ContentCacheEntry fields):
 *
 *   {
 *     version: 2,
 *     text: "...",
 *     ...,
 *     embeddings?: {
 *       model: string,
 *       dim: number,
 *       chunks: Array<{ charStart, charEnd, vector: string (base64) }>,
 *       createdAt: string
 *     }
 *   }
 *
 * The extraction path (writeCache in documentContentService) is untouched —
 * when text is re-extracted the entry is rewritten without an embeddings
 * field, which naturally signals "stale" to the indexing pass. This module
 * is the only writer that ever adds or refreshes that field.
 */

import { readFile } from 'node:fs/promises'

import { atomicWrite } from '../../system/atomicWrite'
import { decodeVectorBase64, encodeVectorBase64, DEFAULT_EMBEDDING_MODEL } from './embeddingService'

export interface StoredEmbeddingChunk {
  charStart: number
  charEnd: number
  vector: Float32Array
}

export interface StoredEmbeddings {
  model: string
  dim: number
  chunks: StoredEmbeddingChunk[]
  createdAt: string
}

interface SerializedEmbeddingChunk {
  charStart: number
  charEnd: number
  vector: string
}

interface SerializedEmbeddings {
  model: string
  dim: number
  chunks: SerializedEmbeddingChunk[]
  createdAt: string
}

interface CacheJsonShape {
  embeddings?: SerializedEmbeddings
  [key: string]: unknown
}

export async function readEmbeddingsFromCache(cachePath: string): Promise<StoredEmbeddings | null> {
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return null
  }

  let parsed: CacheJsonShape
  try {
    parsed = JSON.parse(raw) as CacheJsonShape
  } catch {
    return null
  }

  const serialized = parsed.embeddings
  if (!serialized || typeof serialized !== 'object') return null
  if (typeof serialized.model !== 'string' || typeof serialized.dim !== 'number') return null
  if (!Array.isArray(serialized.chunks)) return null

  const chunks: StoredEmbeddingChunk[] = []
  for (const chunk of serialized.chunks) {
    if (
      !chunk ||
      typeof chunk.charStart !== 'number' ||
      typeof chunk.charEnd !== 'number' ||
      typeof chunk.vector !== 'string'
    ) {
      return null
    }
    const vector = decodeVectorBase64(chunk.vector, serialized.dim)
    if (!vector) return null
    chunks.push({ charStart: chunk.charStart, charEnd: chunk.charEnd, vector })
  }

  return {
    model: serialized.model,
    dim: serialized.dim,
    chunks,
    createdAt: typeof serialized.createdAt === 'string' ? serialized.createdAt : ''
  }
}

export interface WriteEmbeddingsInput {
  model?: string
  dim: number
  chunks: Array<{ charStart: number; charEnd: number; vector: Float32Array }>
}

/**
 * Merge `embeddings` into an existing cache JSON at `cachePath`. Fails
 * silently when the cache is missing or unreadable — the indexing pass is
 * opportunistic and should never surface errors to the user.
 */
export async function writeEmbeddingsToCache(
  cachePath: string,
  input: WriteEmbeddingsInput
): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return false
  }

  let parsed: CacheJsonShape
  try {
    parsed = JSON.parse(raw) as CacheJsonShape
  } catch {
    return false
  }

  for (const chunk of input.chunks) {
    if (chunk.vector.length !== input.dim) return false
  }

  const serialized: SerializedEmbeddings = {
    model: input.model ?? DEFAULT_EMBEDDING_MODEL,
    dim: input.dim,
    chunks: input.chunks.map((chunk) => ({
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      vector: encodeVectorBase64(chunk.vector)
    })),
    createdAt: new Date().toISOString()
  }

  const next: CacheJsonShape = { ...parsed, embeddings: serialized }
  // atomicWrite (tmp + rename) avoids leaving a truncated JSON behind if the
  // process dies mid-write — the existing cache stays valid and the next
  // indexing pass retries cleanly.
  await atomicWrite(cachePath, JSON.stringify(next, null, 2))
  return true
}

/**
 * Returns true when the cache has a fresh embedding set that matches the
 * requested model (same id, same dim). Callers use this to decide whether
 * to trigger a re-index after text changes or a model swap.
 */
export async function isEmbeddingCacheFresh(
  cachePath: string,
  model: string,
  dim: number
): Promise<boolean> {
  const existing = await readEmbeddingsFromCache(cachePath)
  if (!existing) return false
  return existing.model === model && existing.dim === dim && existing.chunks.length > 0
}
