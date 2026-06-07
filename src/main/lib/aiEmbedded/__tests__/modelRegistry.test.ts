import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetModelRegistryForTests,
  getPipeline,
  warmup,
  type ModelConfig
} from '../modelRegistry'

// Mock @huggingface/transformers to keep tests hermetic — no model downloads,
// no ONNX runtime boot, no filesystem dependencies. The mock exposes the
// subset of the module the registry actually uses: pipeline() + env.
//
// `pipelineSpy` and `envRef` are hoisted via vi.hoisted so the factory and
// the test bodies see the same references.
const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return {
    pipelineSpy: vi.fn(),
    envRef: env
  }
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

describe('modelRegistry', () => {
  it('loads a pipeline through the transformers module and returns the callable', async () => {
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValue(fakePipe)

    const config: ModelConfig = { task: 'token-classification', model: 'Xenova/test-ner' }
    const pipe = await getPipeline(config)

    expect(pipe).toBe(fakePipe)
    expect(pipelineSpy).toHaveBeenCalledWith('token-classification', 'Xenova/test-ner', {
      dtype: 'q8'
    })
  })

  it('caches pipelines by (task, model, quantized) so the same config loads once', async () => {
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValue(fakePipe)

    const config: ModelConfig = { task: 'feature-extraction', model: 'Xenova/test-embed' }
    const [a, b] = await Promise.all([getPipeline(config), getPipeline(config)])

    expect(a).toBe(fakePipe)
    expect(b).toBe(fakePipe)
    expect(pipelineSpy).toHaveBeenCalledTimes(1)
  })

  it('caches distinct entries for different tasks on the same model id', async () => {
    pipelineSpy.mockImplementation(async (task: string) => {
      return vi.fn(async () => ({ task }))
    })

    await getPipeline({ task: 'token-classification', model: 'same-id' })
    await getPipeline({ task: 'feature-extraction', model: 'same-id' })

    expect(pipelineSpy).toHaveBeenCalledTimes(2)
  })

  it('returns null without throwing when the pipeline fails to load', async () => {
    pipelineSpy.mockRejectedValue(new Error('model not found'))

    const pipe = await getPipeline({ task: 'token-classification', model: 'missing-model' })

    expect(pipe).toBeNull()
  })

  it('evicts failed entries so a retry can succeed after the failure mode clears', async () => {
    pipelineSpy.mockRejectedValueOnce(new Error('transient'))
    const fakePipe = vi.fn(async () => [])
    pipelineSpy.mockResolvedValueOnce(fakePipe)

    const config: ModelConfig = { task: 'token-classification', model: 'flaky' }
    expect(await getPipeline(config)).toBeNull()
    expect(await getPipeline(config)).toBe(fakePipe)
    expect(pipelineSpy).toHaveBeenCalledTimes(2)
  })

  it('claims localModelPath on the first bundled-model consumer and keeps it stable', async () => {
    pipelineSpy.mockResolvedValue(vi.fn(async () => []))

    await getPipeline({
      task: 'token-classification',
      model: 'Xenova/test-ner',
      modelPath: '/opt/models/bundle-a'
    })
    expect(envRef.localModelPath).toBe('/opt/models/bundle-a')
    expect(envRef.allowRemoteModels).toBe(false)

    // Second consumer with a different modelPath is ignored — the env is
    // module-global and cannot honour two localModelPath values at once.
    await getPipeline({
      task: 'feature-extraction',
      model: 'Xenova/test-embed',
      modelPath: '/opt/models/bundle-b'
    })
    expect(envRef.localModelPath).toBe('/opt/models/bundle-a')
  })

  it('warmup resolves without throwing even when the pipeline fails to load', async () => {
    pipelineSpy.mockRejectedValue(new Error('cold start failure'))
    await expect(warmup({ task: 'token-classification', model: 'broken' })).resolves.toBeUndefined()
  })
})
