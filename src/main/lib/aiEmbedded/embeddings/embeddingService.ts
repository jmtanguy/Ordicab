/**
 * embeddingService — wraps the transformers.js `feature-extraction` pipeline
 * behind a minimal, feature-agnostic API.
 *
 * The embedding model is shared across everything that needs a semantic
 * representation of text: semantic search, RAG retrieval, and future features
 * (clustering, dedup). Consumers stay small — they pass strings and receive
 * Float32Array vectors. Pipeline caching + failure handling live in
 * ../modelRegistry.
 *
 * Default model: Xenova/bge-m3. It produces 1024-dim vectors with strong
 * multilingual (incl. FR) retrieval and an 8K context window. Downloaded at
 * runtime into {userData}/models (not bundled) — see modelDownloadService.
 *
 * Pooling: bge-m3's dense embedding is the normalized [CLS] token (the FlagEmbedding
 * reference and the sentence-transformers config both use CLS), so we pool with
 * 'cls', NOT 'mean'. Mean pooling leaves a high cosine noise floor (an off-topic
 * text scores ~0.6 to any query); CLS pooling roughly doubles the relevant-vs-
 * irrelevant separation. The pooling mode is part of the embedding cache identity
 * (see embeddingCache) so changing it forces a re-index.
 *
 * bge-m3 pools the raw text, so there is no query/passage input prefix — query
 * and passage embeddings are produced from the bare string.
 */

import {
  getPipeline,
  runInferenceTracked,
  type ModelConfig,
  type PipelineFn
} from '../modelRegistry'

// bge-m3 is the sole embedding model. It produces 1024-dim vectors from the raw
// text (no query:/passage: prefix) and is downloaded at runtime into userData
// (see modelDownloadService) rather than bundled.
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-m3'
export const DEFAULT_EMBEDDING_DIM = 1024

// bge-m3's dense vector is the normalized [CLS] token, so feature-extraction must
// pool with 'cls'. This is part of the cache identity (embeddingCache) — vectors
// produced with a different pooling are treated as stale and re-indexed, so the
// query side and the stored document side never mix pooling modes. The
// embeddingWorker hardcodes the same value (it cannot import this module).
export const DEFAULT_EMBEDDING_POOLING = 'cls'

export interface EmbeddingServiceConfig {
  /** HuggingFace model id or local directory. Defaults to bge-m3. */
  model?: string
  /** Absolute filesystem path to the bundled model directory. */
  modelPath?: string
  /** Use int8-quantized weights. Defaults to true. */
  quantized?: boolean
}

// Minimal typing of the tensor-like object transformers.js returns for
// feature-extraction. Runtime-shape validated before use.
interface PipelineTensor {
  data?: Float32Array | number[]
  dims?: number[]
}

function toModelConfig(config: EmbeddingServiceConfig): ModelConfig {
  return {
    task: 'feature-extraction',
    model: config.model ?? DEFAULT_EMBEDDING_MODEL,
    modelPath: config.modelPath,
    quantized: config.quantized
  }
}

async function runPipeline(pipe: PipelineFn, inputs: string[]): Promise<Float32Array[] | null> {
  // truncation: true is REQUIRED, not optional. transformers.js does NOT
  // truncate by default; an input over the model's 512-token window produces an
  // oversized output tensor that crashes onnxruntime-node natively
  // (OrtValueToNapiValue → SIGSEGV) on macOS arm64. The chunker keeps inputs
  // near the limit, but query/refine paths can exceed it, so we enforce the cap
  // here as the last line of defence.
  const result = (await runInferenceTracked(async () =>
    pipe(inputs, { pooling: DEFAULT_EMBEDDING_POOLING, normalize: true, truncation: true })
  )) as PipelineTensor
  if (!result || !result.data || !result.dims || result.dims.length !== 2) {
    return null
  }
  const [batch, dim] = result.dims
  if (!batch || !dim || batch !== inputs.length) return null

  // Some versions return a plain number[]; copy defensively into a fresh
  // Float32Array so callers can't see shared tensor memory.
  const flat =
    result.data instanceof Float32Array ? result.data : Float32Array.from(result.data as number[])

  const vectors: Float32Array[] = []
  for (let i = 0; i < batch; i++) {
    vectors.push(flat.slice(i * dim, (i + 1) * dim))
  }
  return vectors
}

export async function embedBatch(
  texts: string[],
  config: EmbeddingServiceConfig = {}
): Promise<Float32Array[] | null> {
  if (!texts.length) return []

  const pipe = await getPipeline(toModelConfig(config))
  if (!pipe) return null

  try {
    return await runPipeline(pipe, texts)
  } catch (err) {
    console.warn(
      '[embedding-service] inference failed — returning null.',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

export async function embed(
  text: string,
  config: EmbeddingServiceConfig = {}
): Promise<Float32Array | null> {
  const batch = await embedBatch([text], config)
  if (!batch || batch.length === 0) return null
  return batch[0] ?? null
}

// -------- Encoding helpers for persistence ---------

/** Encode a single vector as base64. Used by the per-document cache JSON. */
export function encodeVectorBase64(vector: Float32Array): string {
  const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
  return bytes.toString('base64')
}

/** Decode a base64-encoded Float32Array. Returns null on malformed input. */
export function decodeVectorBase64(encoded: string, expectedDim?: number): Float32Array | null {
  try {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength % 4 !== 0) return null
    // Copy into a fresh buffer so callers never share Buffer-pool memory.
    const buf = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buf).set(bytes)
    const vector = new Float32Array(buf)
    if (expectedDim !== undefined && vector.length !== expectedDim) return null
    return vector
  } catch {
    return null
  }
}

/** Cosine similarity for L2-normalized vectors collapses to a dot product. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!
  }
  return sum
}
