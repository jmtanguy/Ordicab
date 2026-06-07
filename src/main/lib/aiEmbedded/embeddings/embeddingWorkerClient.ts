/**
 * embeddingWorkerClient — main-thread client for the embedding pipeline that
 * lives in a node:worker_threads worker.
 *
 * Drop-in replacement for `embedBatch(...)` of embeddingService.ts on the
 * indexing hot path. The query path keeps using the in-process embeddingService
 * because (a) it's a one-off call with low frequency and (b) running both in a
 * worker would force the model to be loaded twice.
 *
 * Lifecycle: the worker is spawned lazily on the first request and stays alive
 * until `dispose()`. If the worker crashes (ONNX is known to segfault on
 * malformed inputs), pending requests reject and the next request spawns a
 * fresh worker.
 */

import { Worker } from 'node:worker_threads'
import { join } from 'node:path'

import type { EmbeddingServiceConfig } from './embeddingService'
import { DEFAULT_EMBEDDING_MODEL } from './embeddingService'

interface WorkerOutgoing {
  type: 'embed'
  id: number
  texts: string[]
  prefix: string
}

interface WorkerEmbedResult {
  type: 'embed-result'
  id: number
  ok: boolean
  vectors?: Float32Array[]
  error?: string
}

interface WorkerReady {
  type: 'ready'
  ok: boolean
}

interface WorkerLog {
  type: 'log'
  level: 'warn' | 'error'
  message: string
}

type WorkerIncoming = WorkerEmbedResult | WorkerReady | WorkerLog

interface PendingRequest {
  resolve: (vectors: Float32Array[] | null) => void
  reject: (err: Error) => void
}

export interface EmbeddingWorkerClient {
  embedBatch(
    texts: string[],
    config?: EmbeddingServiceConfig,
    options?: { inputPrefix?: string }
  ): Promise<Float32Array[] | null>
  /**
   * Tear down the current worker so the next embedBatch spawns a fresh one.
   * Needed when the embedding model becomes available after startup (e.g.
   * bge-m3 finishes downloading): a worker spawned earlier may have cached the
   * "model missing" failure, and transformers.js binds its localModelPath
   * per-process. rebind() forces a clean reload from the (now-populated) path.
   */
  rebind(): Promise<void>
  dispose(): Promise<void>
}

// bge-m3 uses no input prefix. Kept configurable per call for E5-style models.
const DEFAULT_INPUT_PREFIX = ''

export interface CreateEmbeddingWorkerClientOptions {
  /**
   * Absolute path to the compiled worker file. In production with
   * electron-vite, this is `path.join(__dirname, 'embeddingWorker.js')` from
   * the main entry. Tests can pass a stub path.
   */
  workerPath: string
  /** Default model config used when none is passed to embedBatch. */
  defaultConfig?: EmbeddingServiceConfig
}

export function createEmbeddingWorkerClient(
  options: CreateEmbeddingWorkerClientOptions
): EmbeddingWorkerClient {
  let worker: Worker | null = null
  let nextId = 1
  const pending = new Map<number, PendingRequest>()
  let disposed = false

  // The worker is bound to ONE model at startup (transformers.js env is module
  // global). The first embedBatch call picks the model; subsequent calls with
  // a different model fall back to running on the main thread to avoid
  // restarting the worker mid-stream.
  let boundModel: string | null = null

  function rejectAll(err: Error): void {
    for (const [, p] of pending) {
      p.reject(err)
    }
    pending.clear()
  }

  function spawnWorker(config: EmbeddingServiceConfig): Worker {
    const w = new Worker(options.workerPath, {
      workerData: {
        model: config.model ?? DEFAULT_EMBEDDING_MODEL,
        modelPath: config.modelPath,
        quantized: config.quantized
      }
    })
    w.on('message', (msg: WorkerIncoming) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'embed-result') {
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.ok && msg.vectors) {
          p.resolve(msg.vectors)
        } else {
          // Treat a single-request failure as recoverable: resolve null so
          // the indexer marks the document as "skipped: embedding-failed".
          p.resolve(null)
          console.warn('[embeddingWorker] inference failed:', msg.error)
        }
        return
      }
      if (msg.type === 'log') {
        if (msg.level === 'warn') {
          console.warn(msg.message)
        } else {
          console.error(msg.message)
        }
      }
    })
    w.on('error', (err) => {
      console.warn('[embeddingWorker] worker error:', err.message)
      rejectAll(err)
      worker = null
    })
    w.on('exit', (code) => {
      worker = null
      if (code !== 0 && !disposed) {
        rejectAll(new Error(`worker exited with code ${code}`))
      }
    })
    return w
  }

  async function ensureWorker(config: EmbeddingServiceConfig): Promise<Worker | null> {
    if (disposed) return null
    const targetModel = config.model ?? DEFAULT_EMBEDDING_MODEL
    if (worker && boundModel && boundModel !== targetModel) {
      // Model swap not supported in the worker (transformers env is global).
      // Fall back to null so the caller can route to the in-process path.
      return null
    }
    if (!worker) {
      worker = spawnWorker(config)
      boundModel = targetModel
    }
    return worker
  }

  async function embedBatch(
    texts: string[],
    config: EmbeddingServiceConfig = options.defaultConfig ?? {},
    embedOptions: { inputPrefix?: string } = {}
  ): Promise<Float32Array[] | null> {
    if (!texts.length) return []
    if (disposed) return null

    const w = await ensureWorker(config)
    if (!w) return null

    const id = nextId++
    const prefix = embedOptions.inputPrefix ?? DEFAULT_INPUT_PREFIX
    const message: WorkerOutgoing = { type: 'embed', id, texts, prefix }

    return new Promise<Float32Array[] | null>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        w.postMessage(message)
      } catch (err) {
        pending.delete(id)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async function teardownWorker(reason: string): Promise<void> {
    const w = worker
    worker = null
    boundModel = null
    rejectAll(new Error(reason))
    if (!w) return
    try {
      w.postMessage({ type: 'shutdown' })
    } catch {
      // worker may already be dead
    }
    // Wait for the worker to exit gracefully (parentPort.close() drains the
    // ONNX native threads) before force-terminating, to avoid V8 HandleScope
    // errors. Fall back to terminate() after 3 s if it hangs.
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        w.terminate().catch(() => undefined)
        resolve()
      }, 3000)
      w.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  async function rebind(): Promise<void> {
    if (disposed) return
    // Tear down only; the next embedBatch lazily respawns with the current
    // defaultConfig (which now resolves the freshly-downloaded model).
    await teardownWorker('worker rebind')
  }

  async function dispose(): Promise<void> {
    disposed = true
    await teardownWorker('client disposed')
  }

  return { embedBatch, rebind, dispose }
}

/** Convenience: resolves the worker path emitted by electron-vite alongside the main bundle. */
export function defaultEmbeddingWorkerPath(mainDirname: string): string {
  return join(mainDirname, 'embeddingWorker.js')
}
