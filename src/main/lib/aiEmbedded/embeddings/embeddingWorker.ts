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
    if (config.modelPath) {
      mod.env.localModelPath = config.modelPath
      mod.env.allowRemoteModels = false
    }
    const dtype = config.quantized === false ? 'fp32' : 'q8'
    return await mod.pipeline('feature-extraction', config.model, {
      dtype,
      session_options: {
        executionProviders: [{ name: 'cpu', useArena: false }],
        enableCpuMemArena: false,
        enableMemPattern: false,
        executionMode: 'sequential',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all'
      }
    })
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
  return pipelinePromise
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
    const result = (await pipe(inputs, { pooling: 'mean', normalize: true })) as PipelineTensor
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
