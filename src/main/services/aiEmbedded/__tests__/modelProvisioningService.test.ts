import { describe, expect, it, vi } from 'vitest'

import { createModelProvisioningService } from '../modelProvisioningService'
import { EMBEDDING_MODEL, NER_MODEL } from '../../../lib/aiEmbedded/modelDownloadService'

describe('modelProvisioningService', () => {
  it('downloads NER before the embedding model', async () => {
    const order: string[] = []
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => false,
      download: (async (_root, model) => {
        order.push(model.modelId)
      }) as never
    })
    await svc.ensureModels()
    expect(order).toEqual([NER_MODEL.modelId, EMBEDDING_MODEL.modelId])
  })

  it('calls onEmbeddingModelReady after bge-m3 downloads', async () => {
    const onReady = vi.fn()
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => false,
      download: (async () => undefined) as never,
      onEmbeddingModelReady: onReady
    })
    await svc.ensureModels()
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('skips already-present models without downloading', async () => {
    const download = vi.fn(async () => undefined)
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => true,
      download: download as never
    })
    await svc.ensureModels()
    expect(download).not.toHaveBeenCalled()
    expect(svc.getStatus().ner).toBe('ready')
    expect(svc.getStatus().embedding).toBe('ready')
  })

  it('records an error in status without rejecting', async () => {
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => false,
      download: (async (_root, model) => {
        if (model.modelId === NER_MODEL.modelId) throw new Error('offline')
      }) as never
    })
    await expect(svc.ensureModels()).resolves.toBeUndefined()
    expect(svc.getStatus().ner).toBe('error')
    expect(svc.getStatus().error).toContain('offline')
  })

  it('emits status updates', async () => {
    const statuses: string[] = []
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => false,
      download: (async () => undefined) as never,
      onStatus: (s) => statuses.push(`${s.ner}/${s.embedding}`)
    })
    await svc.ensureModels()
    expect(statuses).toContain('downloading/missing')
    expect(statuses.at(-1)).toBe('ready/ready')
  })

  it('coalesces concurrent ensureModels calls', async () => {
    const download = vi.fn(async () => undefined)
    const svc = createModelProvisioningService({
      modelsRoot: '/models',
      isPresent: async () => false,
      download: download as never
    })
    await Promise.all([svc.ensureModels(), svc.ensureModels()])
    // Two models downloaded once each, not twice.
    expect(download).toHaveBeenCalledTimes(2)
  })
})
