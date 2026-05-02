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
 * Default model: Xenova/multilingual-e5-small. It produces 384-dim vectors
 * and has strong FR/EN retrieval quality at ~120 MB int8.
 *
 * Model-specific prefixes: the E5 family expects inputs prefixed with
 * "query: " for search queries and "passage: " for documents. Callers pass
 * the prefix via options; the service does NOT assume one, because other
 * models (e.g. MiniLM) don't want a prefix at all. Defaults match E5.
 */

import {
  getPipeline,
  warmup as warmupPipeline,
  type ModelConfig,
  type PipelineFn
} from '../modelRegistry'

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const DEFAULT_EMBEDDING_DIM = 384

export interface EmbeddingServiceConfig {
  /** HuggingFace model id or local directory. Defaults to multilingual-e5-small. */
  model?: string
  /** Absolute filesystem path to the bundled model directory. */
  modelPath?: string
  /** Use int8-quantized weights. Defaults to true. */
  quantized?: boolean
}

export interface EmbedOptions {
  /**
   * Prefix prepended to every input before encoding. E5 convention:
   * "passage: " for documents being indexed, "query: " for search queries.
   * Default is "passage: " so that indexing calls do the right thing by
   * default; search-path callers should pass `"query: "` explicitly.
   */
  inputPrefix?: string
}

const DEFAULT_INPUT_PREFIX = 'passage: '

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
  const result = (await pipe(inputs, { pooling: 'mean', normalize: true })) as PipelineTensor
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

function applyPrefix(texts: string[], prefix: string): string[] {
  if (!prefix) return texts
  return texts.map((t) => `${prefix}${t}`)
}

export async function embedBatch(
  texts: string[],
  config: EmbeddingServiceConfig = {},
  options: EmbedOptions = {}
): Promise<Float32Array[] | null> {
  if (!texts.length) return []

  const pipe = await getPipeline(toModelConfig(config))
  if (!pipe) return null

  const prefix = options.inputPrefix ?? DEFAULT_INPUT_PREFIX
  const inputs = applyPrefix(texts, prefix)

  try {
    return await runPipeline(pipe, inputs)
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
  config: EmbeddingServiceConfig = {},
  options: EmbedOptions = {}
): Promise<Float32Array | null> {
  const batch = await embedBatch([text], config, options)
  if (!batch || batch.length === 0) return null
  return batch[0] ?? null
}

/**
 * Preload the embedding model so the first indexing / search call isn't
 * blocked by a cold start. Fire-and-forget safe.
 */
export async function warmupEmbeddings(config: EmbeddingServiceConfig = {}): Promise<void> {
  await warmupPipeline(toModelConfig(config))
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
