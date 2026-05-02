/**
 * modelRegistry — shared loader for in-process ML models via @huggingface/transformers.
 *
 * All embedded-AI features (NER, embeddings) run on the same
 * ONNX runtime, so there is no reason each feature should re-implement the
 * dynamic import, local-model-path wiring, pipeline caching, and graceful
 * failure fallbacks. This module owns that shared plumbing:
 *
 *   - One dynamic import of `@huggingface/transformers` — any subsequent
 *     caller reuses the same module handle.
 *   - Pipeline cache keyed by `(task, model)` — loading the same pipeline
 *     twice (e.g. NER during warmup + NER during detection) only pays the
 *     cost once.
 *   - Centralised `localModelPath` handling — the first consumer that
 *     provides a bundled model path wins. Mixing bundled and downloaded
 *     models in the same process is intentionally not supported: the
 *     transformers.js `env` is module-global.
 *   - Graceful failure — when the package is missing or the model cannot
 *     load, callers receive `null` and degrade rather than throwing.
 *
 * Callers stay small: they pass a `ModelConfig`, receive a pipeline (or null),
 * and only own their post-processing. See `pii/nerDetection.ts` for the
 * pattern.
 */

export type TransformersTask = 'token-classification' | 'feature-extraction'

export interface ModelConfig {
  /** HuggingFace model id (e.g. "Xenova/bert-base-multilingual-cased-ner-hrl"). */
  model: string
  /** Pipeline task — determines the output shape and default pre/post-processing. */
  task: TransformersTask
  /** Absolute filesystem path to the bundled model directory. When set, remote model downloads are disabled. */
  modelPath?: string
  /** Use int8-quantized weights. Defaults to true — smaller + faster, minor quality hit. */
  quantized?: boolean
}

// A transformers.js pipeline is a callable. We type the minimum surface
// used across our consumers; task-specific option / return shapes are the
// caller's concern.
export type PipelineFn = (input: unknown, opts?: unknown) => Promise<unknown>

type TransformersModule = {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<PipelineFn>
  env: {
    localModelPath?: string
    allowRemoteModels?: boolean
  }
}

// Module-level singletons — the transformers.js `env` is itself module-global,
// so there is no value in per-caller caches. All state is process-wide.
let modulePromise: Promise<TransformersModule | null> | null = null
let moduleFailureLogged = false
const pipelineCache = new Map<string, Promise<PipelineFn | null>>()

// Path of the first bundled-model consumer to claim ownership of the
// transformers.js `localModelPath`. Subsequent consumers with a different
// modelPath are ignored (the env is global); they still succeed because
// their model id is resolved relative to the claimed path.
let claimedLocalModelPath: string | null = null

function cacheKey(config: ModelConfig): string {
  return `${config.task}::${config.model}::${config.quantized !== false ? 'q' : 'f'}`
}

async function loadModule(): Promise<TransformersModule | null> {
  if (modulePromise) return modulePromise
  modulePromise = (async () => {
    try {
      // Dynamic import keeps the dependency optional — the app still runs
      // when @huggingface/transformers is not installed or fails to load.
      const mod = (await import(
        /* @vite-ignore */ '@huggingface/transformers'
      )) as TransformersModule
      return mod
    } catch (err) {
      if (!moduleFailureLogged) {
        moduleFailureLogged = true
        console.warn(
          '[model-registry] @huggingface/transformers unavailable — embedded AI features disabled.',
          err instanceof Error ? err.message : err
        )
      }
      return null
    }
  })()
  return modulePromise
}

/**
 * Load (or return the cached) pipeline for `config`. Returns `null` when the
 * transformers package is missing or the model fails to load — callers are
 * expected to degrade gracefully rather than surface an error.
 */
export async function getPipeline(config: ModelConfig): Promise<PipelineFn | null> {
  const key = cacheKey(config)
  const cached = pipelineCache.get(key)
  if (cached) return cached

  const promise: Promise<PipelineFn | null> = (async () => {
    const mod = await loadModule()
    if (!mod) return null

    try {
      if (config.modelPath) {
        // First bundled-model consumer claims ownership of the global env.
        // Subsequent consumers with a different modelPath are ignored — the
        // transformers.js env is module-global and cannot honour more than
        // one localModelPath at once.
        if (!claimedLocalModelPath) {
          mod.env.localModelPath = config.modelPath
          mod.env.allowRemoteModels = false
          claimedLocalModelPath = config.modelPath
        } else if (claimedLocalModelPath !== config.modelPath) {
          console.warn(
            `[model-registry] ignoring modelPath=${config.modelPath} for task=${config.task} model=${config.model} — localModelPath already claimed by ${claimedLocalModelPath}.`
          )
        }
      }

      // transformers.js v3 replaced the boolean `quantized` option with a
      // `dtype` string. We map `quantized: true` (our default) to `q8` so the
      // int8 `onnx/model_quantized.onnx` file is loaded — that matches what
      // `scripts/prepare-models.mjs` downloads for bundled models and keeps
      // memory/CPU cost in check for the fp32 fallback.
      const dtype = config.quantized === false ? 'fp32' : 'q8'
      const pipe = await mod.pipeline(config.task, config.model, {
        dtype
      })
      return pipe
    } catch (err) {
      console.warn(
        `[model-registry] failed to load ${config.task}:${config.model} — falling back to no-op.`,
        err instanceof Error ? err.message : err
      )
      // Evict the failed entry so a subsequent call can retry (e.g. after
      // the user installs a missing model), rather than permanently sticking
      // on the first failure.
      pipelineCache.delete(key)
      return null
    }
  })()

  pipelineCache.set(key, promise)
  return promise
}

/**
 * Preload a pipeline so the first user-facing call doesn't pay the cold-start
 * cost. Fire-and-forget safe — always resolves, never throws.
 */
export async function warmup(config: ModelConfig): Promise<void> {
  await getPipeline(config)
}

/**
 * Reset all cached state — module handle, pipeline cache, claimed modelPath.
 * Intended for tests; calling at runtime does not unload ONNX sessions from
 * the ORT runtime (the next getPipeline call will create new sessions).
 */
export function __resetModelRegistryForTests(): void {
  modulePromise = null
  moduleFailureLogged = false
  pipelineCache.clear()
  claimedLocalModelPath = null
}
