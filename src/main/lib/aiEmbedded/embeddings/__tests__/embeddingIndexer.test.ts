import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetModelRegistryForTests } from '../../modelRegistry'
import { readEmbeddingsFromCache } from '../embeddingCache'
import { indexDocumentEmbeddings } from '../embeddingIndexer'

const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return { pipelineSpy: vi.fn(), envRef: env }
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineSpy,
  env: envRef
}))

beforeEach(() => {
  __resetModelRegistryForTests()
  pipelineSpy.mockReset()
  envRef.localModelPath = undefined
  envRef.allowRemoteModels = true
})

async function makeCacheFile(entry: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'embeddings-test-'))
  const path = join(dir, 'cache.json')
  await writeFile(path, JSON.stringify(entry, null, 2), 'utf8')
  return path
}

function fakeTensor(batchSize: number, dim: number): { data: Float32Array; dims: number[] } {
  const flat = new Float32Array(batchSize * dim)
  // Fill with deterministic but distinct values per chunk.
  for (let i = 0; i < batchSize; i++) {
    for (let j = 0; j < dim; j++) {
      flat[i * dim + j] = (i + 1) * 0.01 + j * 0.001
    }
  }
  return { data: flat, dims: [batchSize, dim] }
}

describe('indexDocumentEmbeddings', () => {
  it('chunks, embeds, and persists vectors into the cache JSON', async () => {
    const text =
      'Paragraphe un avec du contenu.<NL>' +
      'Paragraphe deux avec plus de texte.<NL>' +
      'Paragraphe trois pour être sûr.'
    const cachePath = await makeCacheFile({
      version: 2,
      name: 'doc.pdf',
      method: 'embedded',
      extractedAt: '2026-04-23T00:00:00.000Z',
      text
    })

    const fakePipe = vi.fn(async (inputs: string[]) => fakeTensor(inputs.length, 4))
    pipelineSpy.mockResolvedValue(fakePipe)

    const result = await indexDocumentEmbeddings(cachePath, {
      dim: 4,
      chunkOptions: { maxChars: 40, overlapChars: 5 }
    })

    expect(result.status).toBe('indexed')
    if (result.status !== 'indexed') throw new Error('unexpected')
    expect(result.chunkCount).toBeGreaterThanOrEqual(1)

    const stored = await readEmbeddingsFromCache(cachePath)
    expect(stored).not.toBeNull()
    expect(stored!.dim).toBe(4)
    expect(stored!.chunks).toHaveLength(result.chunkCount)
    for (const chunk of stored!.chunks) {
      expect(chunk.vector).toBeInstanceOf(Float32Array)
      expect(chunk.vector.length).toBe(4)
      expect(text.slice(chunk.charStart, chunk.charEnd).length).toBeGreaterThan(0)
    }

    // Original cache fields are preserved verbatim.
    const rawAfter = JSON.parse(await readFile(cachePath, 'utf8'))
    expect(rawAfter.text).toBe(text)
    expect(rawAfter.method).toBe('embedded')
    expect(rawAfter.embeddings).toBeTruthy()
  })

  it('skips when the cache already has fresh embeddings for the same model/dim', async () => {
    const cachePath = await makeCacheFile({
      version: 2,
      text: 'some text that would otherwise be chunked',
      embeddings: {
        model: 'Xenova/multilingual-e5-small',
        dim: 4,
        chunks: [
          {
            charStart: 0,
            charEnd: 10,
            vector: Buffer.from(new Float32Array([1, 0, 0, 0]).buffer).toString('base64')
          }
        ],
        createdAt: '2026-04-22T12:00:00Z'
      }
    })

    const result = await indexDocumentEmbeddings(cachePath, { dim: 4 })

    expect(result.status).toBe('fresh')
    expect(pipelineSpy).not.toHaveBeenCalled()
  })

  it('force re-indexes even when fresh embeddings exist', async () => {
    const cachePath = await makeCacheFile({
      version: 2,
      text: 'rebuild me',
      embeddings: {
        model: 'Xenova/multilingual-e5-small',
        dim: 4,
        chunks: [
          {
            charStart: 0,
            charEnd: 10,
            vector: Buffer.from(new Float32Array([1, 0, 0, 0]).buffer).toString('base64')
          }
        ],
        createdAt: '2026-04-22T12:00:00Z'
      }
    })

    const fakePipe = vi.fn(async (inputs: string[]) => fakeTensor(inputs.length, 4))
    pipelineSpy.mockResolvedValue(fakePipe)

    const result = await indexDocumentEmbeddings(cachePath, { dim: 4, force: true })
    expect(result.status).toBe('indexed')
    expect(fakePipe).toHaveBeenCalledTimes(1)
  })

  it('skips with a descriptive reason when the cache is missing text', async () => {
    const cachePath = await makeCacheFile({ version: 2, isEmpty: true })
    const result = await indexDocumentEmbeddings(cachePath)
    expect(result).toEqual({ status: 'skipped', reason: 'no-text' })
  })

  it('returns skipped when the embedding model fails to load', async () => {
    const cachePath = await makeCacheFile({
      version: 2,
      text: 'paragraph<NL>paragraph two'
    })
    pipelineSpy.mockRejectedValue(new Error('cold start failed'))

    const result = await indexDocumentEmbeddings(cachePath)
    expect(result).toEqual({ status: 'skipped', reason: 'embedding-failed' })

    // The cache file must be left untouched when indexing fails.
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
    expect(parsed.embeddings).toBeUndefined()
  })

  it('returns skipped with dim-mismatch when vectors have the wrong size', async () => {
    const cachePath = await makeCacheFile({
      version: 2,
      text: 'short enough to be one chunk'
    })
    // Model returns dim=8 but the caller declared dim=4 → mismatch, persistence must be skipped.
    const fakePipe = vi.fn(async (inputs: string[]) => fakeTensor(inputs.length, 8))
    pipelineSpy.mockResolvedValue(fakePipe)

    const result = await indexDocumentEmbeddings(cachePath, { dim: 4 })
    expect(result).toEqual({ status: 'skipped', reason: 'dim-mismatch' })

    const parsed = JSON.parse(await readFile(cachePath, 'utf8'))
    expect(parsed.embeddings).toBeUndefined()
  })
})
