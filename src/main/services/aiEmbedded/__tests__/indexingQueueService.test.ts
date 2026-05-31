import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createIndexingQueueService,
  walkExtractableDocuments,
  type IndexableInventoryEntry,
  type IndexingEmittedEvent,
  type IndexingQueueService
} from '../indexingQueueService'
import {
  computeFileSha256,
  writeIndexedHashToCache
} from '../../../lib/aiEmbedded/embeddings/contentHashStore'
import { getDossierContentCachePath } from '../../../lib/ordicab/ordicabPaths'
import { getDocumentContentCachePath } from '../../../lib/aiEmbedded/documentContentService'
import { atomicWrite } from '../../../lib/system/atomicWrite'

// The queue ends up calling indexDocumentEmbeddings (which loads the
// transformers.js pipeline). We stub it to keep these tests fast and offline.
const { indexerMock } = vi.hoisted(() => ({
  indexerMock: vi.fn(async () => ({ status: 'indexed' as const, chunkCount: 1 }))
}))
vi.mock('../../../lib/aiEmbedded/embeddings/embeddingIndexer', () => ({
  indexDocumentEmbeddings: indexerMock
}))

interface Harness {
  dossierRoot: string
  dossierId: string
  extractMock: ReturnType<typeof vi.fn>
  emitMock: ReturnType<typeof vi.fn>
  inventory: IndexableInventoryEntry[]
  service: IndexingQueueService
  flush: () => Promise<void>
  events: IndexingEmittedEvent[]
}

async function makeTxt(dossierRoot: string, name: string, body: string): Promise<string> {
  const abs = join(dossierRoot, name)
  await writeFile(abs, body, 'utf8')
  return abs
}

async function setup(
  opts: {
    enabled?: () => boolean
    concurrency?: number
    extract?: () => Promise<void>
  } = {}
): Promise<Harness> {
  const dossierRoot = await mkdtemp(join(tmpdir(), 'idx-queue-'))
  await mkdir(join(dossierRoot, '.ordicab'), { recursive: true })
  const dossierId = 'dossier-A'

  const inventory: IndexableInventoryEntry[] = []
  const events: IndexingEmittedEvent[] = []

  const emitMock = vi.fn((event: IndexingEmittedEvent) => {
    events.push(event)
  })

  // Default extract writes the cache JSON so the queue can later persist a hash.
  const extractMock = vi.fn(async (input: { dossierId: string; documentId: string }) => {
    const cacheDir = getDossierContentCachePath(dossierRoot)
    await mkdir(cacheDir, { recursive: true })
    const abs = join(dossierRoot, input.documentId)
    const cachePath = getDocumentContentCachePath(cacheDir, abs)
    await atomicWrite(
      cachePath,
      JSON.stringify(
        {
          version: 3,
          name: input.documentId,
          method: 'direct',
          extractedAt: new Date().toISOString(),
          text: 'simulated extracted text'
        },
        null,
        2
      )
    )
    if (opts.extract) await opts.extract()
  })

  const service = createIndexingQueueService({
    concurrency: opts.concurrency ?? 1,
    statusDebounceMs: 0,
    extractContent: extractMock,
    resolveDossierPath: async (id) => (id === dossierId ? dossierRoot : null),
    listIndexableDocuments: async (id) => (id === dossierId ? inventory : null),
    emit: emitMock,
    isEnabled: opts.enabled ?? (() => true)
  })

  async function flush(): Promise<void> {
    await service.awaitIdle()
  }

  return { dossierRoot, dossierId, extractMock, emitMock, events, inventory, service, flush }
}

afterEach(() => {
  indexerMock.mockClear()
})

describe('IndexingQueueService — basic processing', () => {
  it('extracts and embeds a fresh document end-to-end', async () => {
    const h = await setup()
    const abs = await makeTxt(h.dossierRoot, 'a.txt', 'hello world')
    h.inventory.push({ relativePath: 'a.txt', absolutePath: abs })

    await h.service.enqueueDossierBatch(h.dossierId, { reason: 'initial-registration' })
    await h.flush()

    expect(h.extractMock).toHaveBeenCalledTimes(1)
    expect(indexerMock).toHaveBeenCalledTimes(1)
    expect(h.service.getSnapshot().dossiers[h.dossierId]).toMatchObject({
      pending: 0,
      running: 0,
      indexed: 1,
      extractable: 1
    })

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })

  it('skips extraction and embedding when the cached hash matches the file', async () => {
    const h = await setup()
    const abs = await makeTxt(h.dossierRoot, 'b.txt', 'unchanged contents')
    h.inventory.push({ relativePath: 'b.txt', absolutePath: abs })

    // Pre-seed the cache with the matching hash so the queue's freshness gate trips.
    const cacheDir = getDossierContentCachePath(h.dossierRoot)
    await mkdir(cacheDir, { recursive: true })
    const cachePath = getDocumentContentCachePath(cacheDir, abs)
    await atomicWrite(
      cachePath,
      JSON.stringify({ version: 3, text: 'unchanged contents' }, null, 2)
    )
    const hash = await computeFileSha256(abs)
    await writeIndexedHashToCache(cachePath, hash, 'unchanged contents'.length)

    await h.service.enqueueDossierBatch(h.dossierId, { reason: 'startup-catchup' })
    await h.flush()

    expect(h.extractMock).not.toHaveBeenCalled()
    expect(indexerMock).not.toHaveBeenCalled()
    expect(h.service.getSnapshot().dossiers[h.dossierId]?.indexed).toBe(1)

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })
})

describe('IndexingQueueService — dedup and priorities', () => {
  it('dedupes a re-enqueue of the same file before the worker picks it up', async () => {
    const blocker = makeManualGate()
    const h = await setup({ concurrency: 1, extract: () => blocker.gate.promise })

    const abs1 = await makeTxt(h.dossierRoot, 'first.txt', 'first')
    const abs2 = await makeTxt(h.dossierRoot, 'second.txt', 'second')

    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'first.txt',
      absolutePath: abs1,
      reason: 'file-add'
    })
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'second.txt',
      absolutePath: abs2,
      reason: 'file-add'
    })
    // Re-enqueue second with a different reason — must not create a 2nd job.
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'second.txt',
      absolutePath: abs2,
      reason: 'manual-reindex'
    })

    expect(h.service.getSnapshot().dossiers[h.dossierId]?.pending).toBeLessThanOrEqual(2)

    blocker.open()
    await h.flush()
    expect(h.extractMock).toHaveBeenCalledTimes(2)

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })

  it('picks active-bucket jobs before catchup jobs', async () => {
    const order: string[] = []
    const h = await setup({
      concurrency: 1,
      extract: async () => {
        // capture the current job order via call args at the extract call site.
      }
    })
    h.extractMock.mockImplementation(async (input) => {
      order.push(input.documentId)
      const cacheDir = getDossierContentCachePath(h.dossierRoot)
      await mkdir(cacheDir, { recursive: true })
      const abs = join(h.dossierRoot, input.documentId)
      const cachePath = getDocumentContentCachePath(cacheDir, abs)
      await atomicWrite(cachePath, JSON.stringify({ version: 3, text: 'x' }))
    })

    const aAbs = await makeTxt(h.dossierRoot, 'a.txt', 'catchup A')
    const bAbs = await makeTxt(h.dossierRoot, 'b.txt', 'manual B')
    const cAbs = await makeTxt(h.dossierRoot, 'c.txt', 'watch C')

    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'a.txt',
      absolutePath: aAbs,
      reason: 'startup-catchup'
    })
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'c.txt',
      absolutePath: cAbs,
      reason: 'file-add'
    })
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'b.txt',
      absolutePath: bAbs,
      reason: 'manual-reindex'
    })

    await h.flush()
    expect(order).toEqual(['b.txt', 'c.txt', 'a.txt'])

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })
})

describe('IndexingQueueService — cancel and pause', () => {
  it('drops pending jobs of a dossier when cancelDossier is called', async () => {
    const blocker = makeManualGate()
    const h = await setup({ concurrency: 1, extract: () => blocker.gate.promise })

    const aAbs = await makeTxt(h.dossierRoot, 'a.txt', 'a')
    const bAbs = await makeTxt(h.dossierRoot, 'b.txt', 'b')
    const cAbs = await makeTxt(h.dossierRoot, 'c.txt', 'c')

    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'a.txt',
      absolutePath: aAbs,
      reason: 'startup-catchup'
    })
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'b.txt',
      absolutePath: bAbs,
      reason: 'startup-catchup'
    })
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'c.txt',
      absolutePath: cAbs,
      reason: 'startup-catchup'
    })

    // Let the first job spin up.
    await new Promise((resolve) => setImmediate(resolve))

    h.service.cancelDossier(h.dossierId)
    blocker.open()
    await h.flush()

    // Only the in-flight job ran to completion; the rest were dropped.
    expect(h.extractMock).toHaveBeenCalledTimes(1)

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })

  it('stops picking jobs when isEnabled returns false (paused via settings)', async () => {
    let enabled = false
    const h = await setup({ concurrency: 1, enabled: () => enabled })
    const abs = await makeTxt(h.dossierRoot, 'x.txt', 'x')
    h.service.enqueueOne({
      dossierId: h.dossierId,
      relativePath: 'x.txt',
      absolutePath: abs,
      reason: 'startup-catchup'
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(h.extractMock).not.toHaveBeenCalled()

    enabled = true
    h.service.resume()
    await h.flush()
    expect(h.extractMock).toHaveBeenCalledTimes(1)

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })
})

describe('IndexingQueueService — initial-complete event', () => {
  it('emits dossier-initial-complete once after the initial batch finishes', async () => {
    const h = await setup({ concurrency: 2 })
    const a = await makeTxt(h.dossierRoot, 'a.txt', 'a')
    const b = await makeTxt(h.dossierRoot, 'b.txt', 'b')
    h.inventory.push(
      { relativePath: 'a.txt', absolutePath: a },
      { relativePath: 'b.txt', absolutePath: b }
    )

    await h.service.enqueueDossierBatch(h.dossierId, {
      reason: 'initial-registration',
      trackInitialComplete: true
    })
    await h.flush()

    const completion = h.events.filter((e) => e.kind === 'dossier-initial-complete')
    expect(completion).toHaveLength(1)
    expect(completion[0]).toMatchObject({
      kind: 'dossier-initial-complete',
      payload: { dossierId: h.dossierId, totalIndexed: 2 }
    })

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })

  it('emits dossier-initial-complete with zero documents when the inventory is empty', async () => {
    const h = await setup()
    await h.service.enqueueDossierBatch(h.dossierId, {
      reason: 'initial-registration',
      trackInitialComplete: true
    })

    const completion = h.events.filter((e) => e.kind === 'dossier-initial-complete')
    expect(completion).toHaveLength(1)
    expect(completion[0]).toMatchObject({
      payload: { dossierId: h.dossierId, totalIndexed: 0 }
    })

    await h.service.dispose()
    await rm(h.dossierRoot, { recursive: true, force: true })
  })
})

describe('walkExtractableDocuments', () => {
  it('skips .ordicab and hidden directories, picks supported extensions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'inventory-'))
    await mkdir(join(root, '.ordicab'), { recursive: true })
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'note.txt'), 'a')
    await writeFile(join(root, 'README.md'), 'b')
    await writeFile(join(root, 'binary.exe'), 'irrelevant')
    await writeFile(join(root, '.hidden.txt'), 'skip me')
    await writeFile(join(root, '.ordicab', 'state.json'), '{}')
    await writeFile(join(root, 'sub', 'nested.txt'), 'c')

    const inventory = await walkExtractableDocuments(root)
    const rels = new Set(inventory.map((e) => e.relativePath))
    expect(rels).toEqual(new Set(['note.txt', 'README.md', 'sub/nested.txt']))

    await rm(root, { recursive: true, force: true })
  })
})

function makeManualGate(): { gate: { promise: Promise<void> }; open: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { gate: { promise }, open: () => resolve() }
}
