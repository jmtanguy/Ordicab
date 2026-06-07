/**
 * modelDownloadService — fetches the ONNX models the embedded-AI features need
 * (NER for PII pseudonymisation, bge-m3 for semantic search) at runtime into
 * the user-data directory, instead of bundling them in the installer.
 *
 * Why runtime download: the bundled models added ~300 MB to the installer.
 * bge-m3 alone is ~570 MB. Shipping them on first use keeps the installer light
 * and lets the embedding model be swapped without re-releasing the app.
 *
 * Layout mirrors transformers.js's `{localModelPath}/{modelId}/` convention so
 * a single `env.localModelPath = <userData>/models` claim resolves every model
 * (see modelRegistry.ts). Each model is downloaded into a temp directory and
 * atomically renamed into place, so a crash or offline interruption never
 * leaves a half-written model that transformers.js would try to load.
 *
 * Everything here is best-effort and offline-safe: a failed download throws,
 * the caller surfaces it to the UI, and the feature stays disabled until the
 * download succeeds. No partial state is ever made visible to the model loader.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HF_BASE = 'https://huggingface.co'

export type ModelTask = 'token-classification' | 'feature-extraction'

// Files required at runtime by transformers.js for each pipeline task.
// `model_quantized.onnx` maps to dtype 'q8' at the call site (see modelRegistry).
const FILES_BY_TASK: Record<ModelTask, readonly string[]> = {
  'token-classification': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ],
  'feature-extraction': [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx'
  ]
}

export interface ManagedModel {
  /** Human label for progress UI. */
  name: string
  /** HuggingFace id, also the on-disk subdirectory under the models root. */
  modelId: string
  task: ModelTask
  revision: string
}

// The two models the app downloads at runtime. NER is required for PII
// pseudonymisation (download it first); bge-m3 powers semantic search.
export const NER_MODEL: ManagedModel = {
  name: 'NER',
  modelId: 'Xenova/bert-base-multilingual-cased-ner-hrl',
  task: 'token-classification',
  revision: 'main'
}

export const EMBEDDING_MODEL: ManagedModel = {
  name: 'Embeddings',
  modelId: 'Xenova/bge-m3',
  task: 'feature-extraction',
  revision: 'main'
}

export interface ModelDownloadProgress {
  modelId: string
  /** File currently downloading, relative to the model dir. */
  file: string
  /** Index of the file being downloaded (0-based) and total file count. */
  fileIndex: number
  fileCount: number
  /** Bytes received for the current file, and its total size if known. */
  receivedBytes: number
  totalBytes: number | null
}

export type ProgressCallback = (progress: ModelDownloadProgress) => void

export interface ModelDownloadDeps {
  /** Override for tests. Defaults to global fetch. */
  fetch?: typeof fetch
}

/** Directory where a model's files live: `{modelsRoot}/{modelId}`. */
export function modelDirFor(modelsRoot: string, modelId: string): string {
  return join(modelsRoot, modelId)
}

/**
 * True when every required file for the model exists (non-empty) under the
 * models root — i.e. the model is fully downloaded and loadable.
 */
export async function isModelPresent(modelsRoot: string, model: ManagedModel): Promise<boolean> {
  const dir = modelDirFor(modelsRoot, model.modelId)
  const files = FILES_BY_TASK[model.task]
  for (const rel of files) {
    try {
      const st = await stat(join(dir, rel))
      if (!st.isFile() || st.size === 0) return false
    } catch {
      return false
    }
  }
  return true
}

async function downloadFileTo(
  url: string,
  target: string,
  doFetch: typeof fetch,
  onChunk: (received: number, total: number | null) => void
): Promise<void> {
  const res = await doFetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  }
  const lengthHeader = res.headers.get('content-length')
  const total = lengthHeader ? Number.parseInt(lengthHeader, 10) : null

  await mkdir(dirname(target), { recursive: true })
  let received = 0
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    onChunk(received, Number.isFinite(total) ? total : null)
  })
  await pipeline(body, createWriteStream(target))
}

/**
 * Download a model into `{modelsRoot}/{modelId}`. Files are written into a
 * sibling temp directory and atomically renamed into place on full success, so
 * an interrupted download never leaves a partial model that the loader sees.
 * No-op (returns immediately) when the model is already present.
 */
export async function downloadModel(
  modelsRoot: string,
  model: ManagedModel,
  onProgress?: ProgressCallback,
  deps: ModelDownloadDeps = {}
): Promise<void> {
  const doFetch = deps.fetch ?? fetch
  if (await isModelPresent(modelsRoot, model)) return

  const finalDir = modelDirFor(modelsRoot, model.modelId)
  // Temp dir is a sibling of the final dir so the rename is same-filesystem
  // (atomic). Suffix avoids colliding with a previous interrupted attempt.
  const tmpDir = `${finalDir}.downloading`
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })

  const files = FILES_BY_TASK[model.task]
  try {
    for (let i = 0; i < files.length; i += 1) {
      const rel = files[i]!
      const url = `${HF_BASE}/${model.modelId}/resolve/${model.revision}/${rel}`
      const target = join(tmpDir, rel)
      await downloadFileTo(url, target, doFetch, (received, total) => {
        onProgress?.({
          modelId: model.modelId,
          file: rel,
          fileIndex: i,
          fileCount: files.length,
          receivedBytes: received,
          totalBytes: total
        })
      })
    }
    // Atomic swap: remove any stale final dir, then rename temp into place.
    await rm(finalDir, { recursive: true, force: true })
    await rename(tmpDir, finalDir)
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  }
}
