/**
 * contentHashStore — tracks the SHA256 of a document's source bytes at the
 * moment its text was extracted, so the indexing queue can tell a real edit
 * from a stale `mtime` touch.
 *
 * Lives next to embeddingCache so the read/write/merge pattern stays
 * symmetric: both modules merge an opt-in field into the per-document content
 * cache JSON without touching the fields owned by documentContentService
 * (`version`, `text`, `method`, `extractedAt`, `isEmpty`).
 *
 * Persisted shape (added to ContentCacheEntry):
 *   {
 *     ...,
 *     sourceContentHash?: "sha256-<hex>",
 *     sourceByteLength?: number,
 *     ...
 *   }
 *
 * Backward compatibility: caches written before this field existed return null
 * here. Callers treat null as "needs hash recorded" — the next extraction pass
 * computes the current hash and persists it, no re-OCR required.
 *
 * Failure mode: every step is best-effort. Hashing reads via stream so a 100MB
 * PDF never sits in memory; persist failures are returned as `false` and never
 * surface to the user.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

import { atomicWrite } from '../../system/atomicWrite'

export interface IndexedContentHash {
  sourceContentHash: string
  sourceByteLength: number
}

/**
 * Stream-hash the file. Uses node:stream/promises.pipeline so the read stream
 * is fully consumed and node:crypto.createHash digests on the fly — zero
 * full-file buffer even for very large PDFs.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return `sha256-${hash.digest('hex')}`
}

export async function readIndexedHashFromCache(
  cachePath: string
): Promise<IndexedContentHash | null> {
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return null
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const hash = parsed.sourceContentHash
  const byteLength = parsed.sourceByteLength
  if (typeof hash !== 'string' || typeof byteLength !== 'number') return null
  return { sourceContentHash: hash, sourceByteLength: byteLength }
}

/**
 * Merge sourceContentHash + sourceByteLength into an existing cache JSON,
 * preserving every other field (text, embeddings, version, …). Atomic rename
 * via atomicWrite so a crash mid-write leaves the previous cache valid.
 *
 * Returns false if the cache file is missing or unparseable — the caller
 * (extractor or queue) logs and moves on; the next pass will retry.
 */
export async function writeIndexedHashToCache(
  cachePath: string,
  hash: string,
  byteLength: number
): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(cachePath, 'utf8')
  } catch {
    return false
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return false
  }
  const next: Record<string, unknown> = {
    ...parsed,
    sourceContentHash: hash,
    sourceByteLength: byteLength
  }
  await atomicWrite(cachePath, JSON.stringify(next, null, 2))
  return true
}

/**
 * True when the cache records the same SHA256 as `currentHash`. Used by the
 * indexing queue as the "fresh" gate: a hash match skips re-extraction.
 */
export async function isContentHashFresh(cachePath: string, currentHash: string): Promise<boolean> {
  const stored = await readIndexedHashFromCache(cachePath)
  if (!stored) return false
  return stored.sourceContentHash === currentHash
}
