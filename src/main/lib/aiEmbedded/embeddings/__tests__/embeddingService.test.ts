import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetModelRegistryForTests } from '../../modelRegistry'
import {
  cosineSimilarity,
  decodeVectorBase64,
  embed,
  embedBatch,
  encodeVectorBase64
} from '../embeddingService'

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

function fakeTensor(vectors: Float32Array[]): { data: Float32Array; dims: number[] } {
  // Mimic transformers.js: flat `.data` + `.dims` = [batch, dim]
  const dim = vectors[0]?.length ?? 0
  const flat = new Float32Array(vectors.length * dim)
  vectors.forEach((v, i) => flat.set(v, i * dim))
  return { data: flat, dims: [vectors.length, dim] }
}

describe('embeddingService', () => {
  it('returns a single Float32Array for embed()', async () => {
    const fakePipe = vi.fn(async () => fakeTensor([new Float32Array([0.1, 0.2, 0.3, 0.4])]))
    pipelineSpy.mockResolvedValue(fakePipe)

    const vec = await embed('hello', {}, { inputPrefix: '' })

    expect(vec).toBeInstanceOf(Float32Array)
    expect(Array.from(vec!)).toEqual([
      expect.closeTo(0.1, 6),
      expect.closeTo(0.2, 6),
      expect.closeTo(0.3, 6),
      expect.closeTo(0.4, 6)
    ])
  })

  it('applies the default E5 passage prefix to every input', async () => {
    const fakePipe = vi.fn(async () => fakeTensor([new Float32Array([1, 0])]))
    pipelineSpy.mockResolvedValue(fakePipe)

    await embed('document body')

    expect(fakePipe).toHaveBeenCalledWith(['passage: document body'], {
      pooling: 'mean',
      normalize: true
    })
  })

  it('lets callers override the prefix (e.g. "query: " on the search path)', async () => {
    const fakePipe = vi.fn(async () => fakeTensor([new Float32Array([1, 0])]))
    pipelineSpy.mockResolvedValue(fakePipe)

    await embed('find me', {}, { inputPrefix: 'query: ' })

    expect(fakePipe).toHaveBeenCalledWith(['query: find me'], expect.any(Object))
  })

  it('returns a vector per input for embedBatch', async () => {
    const vectors = [new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0])]
    const fakePipe = vi.fn(async () => fakeTensor(vectors))
    pipelineSpy.mockResolvedValue(fakePipe)

    const result = await embedBatch(['a', 'b'], {}, { inputPrefix: '' })

    expect(result).toHaveLength(2)
    expect(Array.from(result![0]!)).toEqual([1, 0, 0])
    expect(Array.from(result![1]!)).toEqual([0, 1, 0])
  })

  it('embedBatch([]) short-circuits without loading the pipeline', async () => {
    const result = await embedBatch([])
    expect(result).toEqual([])
    expect(pipelineSpy).not.toHaveBeenCalled()
  })

  it('returns null when the model fails to load', async () => {
    pipelineSpy.mockRejectedValue(new Error('missing model'))
    const vec = await embed('anything')
    expect(vec).toBeNull()
  })

  it('returns null when inference throws', async () => {
    const fakePipe = vi.fn(async () => {
      throw new Error('inference crash')
    })
    pipelineSpy.mockResolvedValue(fakePipe)

    const vec = await embed('anything')
    expect(vec).toBeNull()
  })

  it('returns null when the pipeline returns a malformed tensor', async () => {
    // Missing .dims → cannot reshape.
    const fakePipe = vi.fn(async () => ({ data: new Float32Array([1, 2, 3]) }))
    pipelineSpy.mockResolvedValue(fakePipe)

    const vec = await embed('anything')
    expect(vec).toBeNull()
  })
})

describe('encode / decode / cosine helpers', () => {
  it('base64 round-trips a Float32Array losslessly', () => {
    const original = new Float32Array([0.1, -0.2, 0.3, 0.4, -0.5])
    const encoded = encodeVectorBase64(original)
    const decoded = decodeVectorBase64(encoded, original.length)

    expect(decoded).toBeInstanceOf(Float32Array)
    expect(decoded!.length).toBe(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(decoded![i]).toBeCloseTo(original[i]!, 6)
    }
  })

  it('decodeVectorBase64 rejects a dim mismatch', () => {
    const encoded = encodeVectorBase64(new Float32Array([1, 2, 3]))
    expect(decodeVectorBase64(encoded, 4)).toBeNull()
  })

  it('cosine similarity on normalized vectors equals the dot product', () => {
    // Unit vectors along axes — cosine = 0.
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6)

    // Same vector — cosine = 1.
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6)

    // Mismatched lengths → 0 (guard rather than throw).
    expect(cosineSimilarity(a, new Float32Array([1, 0]))).toBe(0)
  })
})
