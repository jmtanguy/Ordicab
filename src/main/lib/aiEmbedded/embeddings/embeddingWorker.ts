/**
 * embeddingWorker — node:worker_threads entry point for the indexing pipeline.
 *
 * Why a worker: `@huggingface/transformers` runs ONNX inference synchronously
 * on the JS thread that called `pipeline(...)`. In the Electron main process
 * that thread also serves IPC to the renderer, so a 200ms embed call freezes
 * the window. Off-loading the pipeline here keeps the main thread responsive
 * even while we're indexing a 30-document dossier.
 *
 * Protocol — main → worker:
 *   { type: 'embed', id: number, texts: string[], config: ModelConfig, prefix: string }
 *   { type: 'shutdown' }
 *
 * Protocol — worker → main:
 *   { type: 'ready' }                                              // sent once when the pipeline is warm
 *   { type: 'embed-result', id, ok: true,  vectors: Float32Array[] }
 *   { type: 'embed-result', id, ok: false, error: string }
 *
 * Failure mode: if the pipeline can't be loaded (missing model files in dev,
 * missing dependency, hardware issue), the worker still answers each request
 * with `ok: false`. The client treats that as a transient failure and
 * eventually shuts the worker down so the next request spins up a fresh one.
 */

import { parentPort, workerData } from 'node:worker_threads'

interface PipelineFn {
  (input: unknown, opts?: unknown): Promise<unknown>
}

interface WorkerData {
  model: string
  modelPath?: string
  quantized?: boolean
}

interface PipelineTensor {
  data?: Float32Array | number[]
  dims?: number[]
}

interface EmbedRequest {
  type: 'embed'
  id: number
  texts: string[]
  prefix: string
}

interface ShutdownRequest {
  type: 'shutdown'
}

type IncomingMessage = EmbedRequest | ShutdownRequest

let pipelinePromise: Promise<PipelineFn | null> | null = null

async function loadPipeline(config: WorkerData): Promise<PipelineFn | null> {
  try {
    const mod = (await import(/* @vite-ignore */ '@huggingface/transformers')) as {
      pipeline: (
        task: string,
        model: string,
        options?: Record<string, unknown>
      ) => Promise<PipelineFn>
      env: { localModelPath?: string; allowRemoteModels?: boolean }
    }
    // NEVER allow remote downloads from the worker: models are provisioned
    // explicitly into userData by modelDownloadService. A remote fetch here
    // would (a) bypass the RGPD-safe local-only guarantee and (b) write a
    // partial file into transformers.js's own .cache that then fails to parse
    // ("Protobuf parsing failed") and shadows the real model. If modelPath is
    // missing we'd rather fail loudly than silently download.
    mod.env.allowRemoteModels = false
    if (config.modelPath) {
      mod.env.localModelPath = config.modelPath
    } else {
      parentPort?.postMessage({
        type: 'log',
        level: 'warn',
        message:
          '[embeddingWorker] no modelPath provided — refusing remote download; pipeline will be unavailable until a model path is configured.'
      })
    }
    const dtype = config.quantized === false ? 'fp32' : 'q8'
    return await mod.pipeline('feature-extraction', config.model, { dtype })
  } catch (err) {
    parentPort?.postMessage({
      type: 'log',
      level: 'warn',
      message: `[embeddingWorker] pipeline load failed: ${err instanceof Error ? err.message : String(err)}`
    })
    return null
  }
}

async function ensurePipeline(config: WorkerData): Promise<PipelineFn | null> {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline(config)
  }
  const pipe = await pipelinePromise
  // Don't cache a failed load: the model may simply not be downloaded yet, in
  // which case a later call (after the model lands / a worker rebind) should be
  // able to retry rather than being stuck on the first failure.
  if (!pipe) {
    pipelinePromise = null
  }
  return pipe
}

function applyPrefix(texts: string[], prefix: string): string[] {
  if (!prefix) return texts
  return texts.map((t) => `${prefix}${t}`)
}

async function runEmbed(request: EmbedRequest, config: WorkerData): Promise<void> {
  const pipe = await ensurePipeline(config)
  if (!pipe) {
    parentPort?.postMessage({
      type: 'embed-result',
      id: request.id,
      ok: false,
      error: 'pipeline-unavailable'
    })
    return
  }
  try {
    const inputs = applyPrefix(request.texts, request.prefix)
    // truncation: true guards against inputs over the model's 512-token window.
    // Without it, transformers.js does not truncate and onnxruntime crashes
    // natively on the oversized output tensor. See embeddingService.runPipeline.
    const result = (await pipe(inputs, {
      pooling: 'mean',
      normalize: true,
      truncation: true
    })) as PipelineTensor
    if (!result || !result.data || !result.dims || result.dims.length !== 2) {
      parentPort?.postMessage({
        type: 'embed-result',
        id: request.id,
        ok: false,
        error: 'bad-tensor-shape'
      })
      return
    }
    const [batch, dim] = result.dims
    if (!batch || !dim || batch !== request.texts.length) {
      parentPort?.postMessage({
        type: 'embed-result',
        id: request.id,
        ok: false,
        error: 'batch-mismatch'
      })
      return
    }
    const flat =
      result.data instanceof Float32Array ? result.data : Float32Array.from(result.data as number[])
    const vectors: Float32Array[] = []
    for (let i = 0; i < batch; i++) {
      // Copy each slice so the array we transfer is independently owned —
      // transferring the parent buffer would invalidate sibling vectors.
      vectors.push(new Float32Array(flat.slice(i * dim, (i + 1) * dim)))
    }
    parentPort?.postMessage({
      type: 'embed-result',
      id: request.id,
      ok: true,
      vectors
    })
  } catch (err) {
    parentPort?.postMessage({
      type: 'embed-result',
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

const config = workerData as WorkerData
// Eagerly warm the pipeline so the first embed call doesn't pay the cold-start.
void ensurePipeline(config).then((pipe) => {
  parentPort?.postMessage({ type: 'ready', ok: pipe !== null })
})

parentPort?.on('message', (message: IncomingMessage) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'shutdown') {
    // Close the port so the event loop drains naturally — lets ONNX native
    // threads finish any in-flight cleanup before V8 tears down, avoiding
    // the "Cannot create a handle without a HandleScope" fatal error.
    parentPort?.close()
    return
  }
  if (message.type === 'embed') {
    void runEmbed(message, config)
  }
})
