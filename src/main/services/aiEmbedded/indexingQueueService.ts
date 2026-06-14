/**
 * indexingQueueService — main-process background pipeline that keeps every
 * registered dossier's documents extracted + embedded, without ever asking
 * the user to click "Extract".
 *
 * Triggers:
 *   • dossierRegistryService.registerDossier  → enqueueDossierBatch(initial)
 *   • FileWatcherService add/change events    → enqueueOne(file-add | file-change)
 *   • bootstrap                                → runStartupCatchUp (silent)
 *   • IPC indexing:reindex-dossier            → enqueueDossierBatch(manual)
 *
 * Each worker job is hash-gated: the SHA256 of the source file is compared to
 * the hash stored in the document's content-cache entry. A match short-circuits
 * the job — no re-OCR, no re-embedding — which makes the queue safe against
 * chokidar's spurious change events (iCloud touch, Word close-write).
 *
 * Per-document jobs always go through the documentService extractor and the
 * embedding indexer in the same worker, so CPU scheduling lives in one place
 * (no fire-and-forget). The status snapshot is debounced and emitted via the
 * caller-supplied `emit` callback so the IPC layer can fan-out to the renderer.
 */

import { stat } from 'node:fs/promises'
import { join, sep } from 'node:path'

import type {
  DossierIndexingStatus,
  IndexingDossierInitialCompleteEvent,
  IndexingReason,
  IndexingStatusSnapshot
} from '@shared/types'

import {
  ensurePlainTextDocumentCache,
  getDocumentContentCachePath,
  isDocumentTextExtractable,
  isPlainTextDocument
} from '../../lib/aiEmbedded/documentContentService'
import {
  computeFileSha256,
  isContentHashFresh,
  writeIndexedHashToCache
} from '../../lib/aiEmbedded/embeddings/contentHashStore'
import {
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingServiceConfig
} from '../../lib/aiEmbedded/embeddings/embeddingService'
import { isEmbeddingCacheFresh } from '../../lib/aiEmbedded/embeddings/embeddingCache'
import { indexDocumentEmbeddings } from '../../lib/aiEmbedded/embeddings/embeddingIndexer'
import { getDossierContentCachePath, ORDICAB_DIRECTORY_NAME } from '../../lib/ordicab/ordicabPaths'

export type { IndexingReason } from '@shared/types'

interface IndexingJob {
  dossierId: string
  /** POSIX-separated path relative to the dossier root. */
  relativePath: string
  /** Absolute path on disk — pre-resolved so workers don't redo path validation. */
  absolutePath: string
  reason: IndexingReason
}

export interface IndexableInventoryEntry {
  relativePath: string
  absolutePath: string
}

interface IndexingQueueServiceDeps {
  /** Calls documentService.extractContent for a {dossierId, documentPath} pair. */
  extractContent: (input: { dossierId: string; documentPath: string }) => Promise<void>
  /** Resolves the on-disk root of a registered dossier. Returns null if the dossier disappeared. */
  resolveDossierPath: (dossierId: string) => Promise<string | null>
  /** Lists every extractable document below a dossier root. Used at startup and by enqueueDossierBatch. */
  listIndexableDocuments: (dossierId: string) => Promise<IndexableInventoryEntry[] | null>
  embeddingConfig?: EmbeddingServiceConfig
  /**
   * Optional embedder forwarded to indexDocumentEmbeddings. Container.ts wires
   * this to the worker_thread-backed client so ONNX inference doesn't block
   * the Electron main thread.
   */
  embedder?: (texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>
  /**
   * Gate: returns true when the embedding model is downloaded and loadable.
   * When false, processFile still extracts text (so keyword search works) but
   * SKIPS the embedding step entirely — no worker calls, no failure spam — and
   * leaves the document un-indexed so it is re-embedded once the model arrives.
   * Defaults to always-true when omitted.
   */
  isEmbeddingModelReady?: () => Promise<boolean>
}

export interface IndexingQueueServiceOptions extends IndexingQueueServiceDeps {
  /** Parallel workers. Default 2. */
  concurrency?: number
  /** Debounce of status snapshots in ms. Default 250. */
  statusDebounceMs?: number
  /** Snapshot consumer (e.g. IPC fan-out). */
  emit: (event: IndexingEmittedEvent) => void
  /** Gate: when false, the queue stops picking new jobs (current job in flight finishes). */
  isEnabled: () => boolean
  /** Optional clock for tests. */
  now?: () => number
  /** Optional schedule hook (defaults to setTimeout / clearTimeout). */
  setTimer?: (cb: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type IndexingEmittedEvent =
  | { kind: 'status'; snapshot: IndexingStatusSnapshot }
  | { kind: 'dossier-initial-complete'; payload: IndexingDossierInitialCompleteEvent }

export interface IndexingQueueService {
  enqueueOne(job: IndexingJob): void
  enqueueDossierBatch(
    dossierId: string,
    opts: { reason: IndexingReason; trackInitialComplete?: boolean }
  ): Promise<void>
  cancelDossier(dossierId: string): void
  runStartupCatchUp(dossierIds: string[]): Promise<void>
  getSnapshot(): IndexingStatusSnapshot
  setConcurrency(n: number): void
  pause(): void
  resume(): void
  reindex(job: IndexingJob): void
  /** Resolves the next time every queued and in-flight job has settled. Intended for tests and graceful shutdown. */
  awaitIdle(): Promise<void>
  dispose(): Promise<void>
}

type BucketName = 'active' | 'watch' | 'catchup'
const BUCKET_ORDER: readonly BucketName[] = ['active', 'watch', 'catchup'] as const

function bucketFor(reason: IndexingReason): BucketName {
  switch (reason) {
    case 'manual-reindex':
      return 'active'
    case 'file-add':
    case 'file-change':
      return 'watch'
    case 'initial-registration':
    case 'startup-catchup':
    default:
      return 'catchup'
  }
}

function jobKey(dossierId: string, relativePath: string): string {
  return `${dossierId}|${relativePath}`
}

function normalizeRelative(p: string): string {
  return p.split(sep).join('/')
}

interface DossierState extends DossierIndexingStatus {
  /** Set of relativePath strings known to be indexed (hash fresh after a job). */
  indexedKeys: Set<string>
}

interface InitialBatchTracker {
  startedAt: number
  remaining: number
  indexedAtStart: number
}

// One worker by default — keep the Electron main thread free for IPC. Even
// with a worker_thread offload for embeddings, OCR orchestration, PDF parsing
// and atomic cache writes still cost main-thread time; running two jobs in
// parallel doubles that pressure for almost no extraction gain (each pipeline
// is dominated by I/O + the inference worker, which is already serialised).
const DEFAULT_CONCURRENCY = 1
const DEFAULT_STATUS_DEBOUNCE_MS = 250
/**
 * Wall-clock budget for awaitIdle() before it gives up (tests + graceful
 * shutdown). Generous on purpose: real dossiers can have hundreds of docs and
 * CI disks are slow, but a hung worker should still surface rather than hang
 * the suite forever.
 */
const AWAIT_IDLE_TIMEOUT_MS = 30_000

export function createIndexingQueueService(
  options: IndexingQueueServiceOptions
): IndexingQueueService {
  const {
    extractContent,
    resolveDossierPath,
    listIndexableDocuments,
    embeddingConfig,
    embedder,
    emit,
    isEnabled
  } = options
  const isEmbeddingModelReady = options.isEmbeddingModelReady ?? (async () => true)

  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms))
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const statusDebounceMs = options.statusDebounceMs ?? DEFAULT_STATUS_DEBOUNCE_MS

  let concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  let paused = false
  let disposed = false

  const buckets: Record<BucketName, IndexingJob[]> = {
    active: [],
    watch: [],
    catchup: []
  }
  /** Tracks every job currently sitting in a bucket so re-enqueues replace position. */
  const enqueued = new Map<string, { bucket: BucketName; index: number }>()
  /** Tracks jobs currently being processed by a worker. Used to dedup against re-enqueues during flight. */
  const inFlight = new Map<string, IndexingJob>()
  /** When a job is re-enqueued while in flight, flag it so the worker re-runs after current completion. */
  const reRunFlags = new Set<string>()
  /** Per-dossier counters. */
  const dossierStates = new Map<string, DossierState>()
  /** Per-dossier initial-batch trackers (only set when trackInitialComplete is true). */
  const initialTrackers = new Map<string, InitialBatchTracker>()
  /** Active worker promises, used so dispose() can await drain. */
  const workerPromises = new Set<Promise<void>>()
  /** Promise that resolves the next time any state changes — workers awake from here when the queue is empty. */
  let wakeup: { promise: Promise<void>; resolve: () => void } = makeWakeup()
  let statusTimer: unknown = null

  function makeWakeup(): { promise: Promise<void>; resolve: () => void } {
    let resolveFn: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve
    })
    return { promise, resolve: resolveFn }
  }

  function wakeWorkers(): void {
    const prev = wakeup
    wakeup = makeWakeup()
    prev.resolve()
  }

  function ensureDossierState(dossierId: string): DossierState {
    let state = dossierStates.get(dossierId)
    if (!state) {
      state = {
        pending: 0,
        running: 0,
        indexed: 0,
        extractable: 0,
        lastErrorAt: null,
        lastErrorMessage: null,
        indexedKeys: new Set()
      }
      dossierStates.set(dossierId, state)
    }
    return state
  }

  function markIndexed(state: DossierState, relativePath: string): void {
    if (!state.indexedKeys.has(relativePath)) {
      state.indexedKeys.add(relativePath)
      state.indexed += 1
    }
  }

  function unmarkIndexed(state: DossierState, relativePath: string): void {
    if (state.indexedKeys.delete(relativePath)) {
      state.indexed = Math.max(0, state.indexed - 1)
    }
  }

  function scheduleStatusEmit(): void {
    if (disposed) return
    if (statusTimer !== null) return
    statusTimer = setTimer(() => {
      statusTimer = null
      if (!disposed) {
        emit({ kind: 'status', snapshot: getSnapshot() })
      }
    }, statusDebounceMs)
  }

  function getSnapshot(): IndexingStatusSnapshot {
    const dossiers: Record<string, DossierIndexingStatus> = {}
    let totalPending = 0
    let totalRunning = 0
    let totalErrored = 0
    for (const [id, state] of dossierStates) {
      dossiers[id] = {
        pending: state.pending,
        running: state.running,
        indexed: state.indexed,
        extractable: state.extractable,
        lastErrorAt: state.lastErrorAt,
        lastErrorMessage: state.lastErrorMessage
      }
      totalPending += state.pending
      totalRunning += state.running
      if (state.lastErrorMessage) totalErrored += 1
    }
    return {
      dossiers,
      totals: { pending: totalPending, running: totalRunning, errored: totalErrored }
    }
  }

  function enqueueInternal(job: IndexingJob): void {
    if (disposed) return
    const key = jobKey(job.dossierId, job.relativePath)
    const state = ensureDossierState(job.dossierId)

    if (inFlight.has(key)) {
      // Already being processed — flag for re-run after current job completes.
      reRunFlags.add(key)
      return
    }

    const existing = enqueued.get(key)
    if (existing) {
      // Replace in place: same bucket, same index. Newer reason wins.
      buckets[existing.bucket][existing.index] = job
      return
    }

    const bucket = bucketFor(job.reason)
    const index = buckets[bucket].length
    buckets[bucket].push(job)
    enqueued.set(key, { bucket, index })
    state.pending += 1
    scheduleStatusEmit()
    wakeWorkers()
    ensureWorkers()
  }

  function pickJob(): IndexingJob | null {
    for (const bucket of BUCKET_ORDER) {
      const queue = buckets[bucket]
      if (queue.length === 0) continue
      const job = queue.shift()!
      // Shift invalidates downstream indexes in `enqueued`. We refresh them
      // for this bucket. Costs O(n) per pick but the queues stay small (a
      // dossier has tens to hundreds of docs, not millions).
      enqueued.delete(jobKey(job.dossierId, job.relativePath))
      for (let i = 0; i < queue.length; i++) {
        const q = queue[i]!
        const k = jobKey(q.dossierId, q.relativePath)
        const tracker = enqueued.get(k)
        if (tracker && tracker.bucket === bucket) tracker.index = i
      }
      return job
    }
    return null
  }

  async function runWorker(): Promise<void> {
    // Yield once before the first pick so callers can batch-enqueue
    // synchronously (e.g. enqueueDossierBatch with N items) and the
    // priority bucket ordering reflects the full batch — without this,
    // the worker would grab the first-enqueued job before later
    // higher-priority jobs even reach a bucket.
    await Promise.resolve()
    while (!disposed) {
      if (paused || !isEnabled()) {
        await wakeup.promise
        continue
      }

      if (totalQueueSize() === 0) {
        await wakeup.promise
        continue
      }

      if (activeWorkerCount() > concurrency) {
        // Too many workers active (concurrency was just lowered) — let this
        // one drain after current job.
        return
      }

      const job = pickJob()
      if (!job) {
        await wakeup.promise
        continue
      }

      await runJob(job)
      // Yield the event loop between jobs so the IPC layer can answer
      // renderer requests. setImmediate is enough — heavy CPU lives in the
      // embedding worker thread now, so we don't need a wall-clock pause.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  async function runJob(job: IndexingJob): Promise<void> {
    const key = jobKey(job.dossierId, job.relativePath)
    const state = ensureDossierState(job.dossierId)

    state.pending = Math.max(0, state.pending - 1)
    state.running += 1
    inFlight.set(key, job)
    scheduleStatusEmit()

    try {
      const dossierPath = await resolveDossierPath(job.dossierId)
      if (!dossierPath) {
        // Dossier vanished while job was queued — drop silently.
        return
      }
      await processFile(job, dossierPath, state)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.lastErrorAt = new Date(now()).toISOString()
      state.lastErrorMessage = message
      // Unmark indexed if the document had been considered fresh before.
      unmarkIndexed(state, job.relativePath)
      console.warn(
        `[IndexingQueue] job failed (${job.dossierId}/${job.relativePath}, reason=${job.reason}):`,
        message
      )
    } finally {
      state.running = Math.max(0, state.running - 1)
      inFlight.delete(key)
      handleInitialTrackerCompletion(job.dossierId)
      scheduleStatusEmit()

      // If the file was re-enqueued mid-flight, run it again.
      if (reRunFlags.delete(key)) {
        enqueueInternal({ ...job, reason: 'file-change' })
      }
    }
  }

  async function processFile(
    job: IndexingJob,
    dossierPath: string,
    state: DossierState
  ): Promise<void> {
    const fileStats = await stat(job.absolutePath).catch(() => null)
    if (!fileStats?.isFile()) {
      // File deleted between enqueue and processing.
      unmarkIndexed(state, job.relativePath)
      return
    }
    if (!isDocumentTextExtractable(job.absolutePath)) {
      // Filter again — guards against extension changes between enqueue and run.
      return
    }

    const cacheDir = getDossierContentCachePath(dossierPath)
    const cachePath = isPlainTextDocument(job.absolutePath)
      ? await ensurePlainTextDocumentCache(job.absolutePath, cacheDir)
      : getDocumentContentCachePath(cacheDir, job.absolutePath)

    const currentHash = await computeFileSha256(job.absolutePath)
    const textFresh = await isContentHashFresh(cachePath, currentHash)

    // A document is fully indexed only when BOTH its text is extracted from the
    // current bytes AND embeddings exist for the active model/dim. We check the
    // embedding cache separately so that a document extracted while the model
    // was unavailable (e.g. bge-m3 not downloaded yet) gets re-embedded on a
    // later pass once the model is present — extraction freshness alone must
    // not short-circuit embedding.
    const model = embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL
    const embeddingsFresh = await isEmbeddingCacheFresh(cachePath, model, DEFAULT_EMBEDDING_DIM)
    if (textFresh && embeddingsFresh) {
      markIndexed(state, job.relativePath)
      return
    }

    if (!textFresh) {
      // Extract (writes text + hash inside the cache via documentService.extractContent).
      await extractContent({ dossierId: job.dossierId, documentPath: job.relativePath })

      // Belt-and-braces: ensure the hash is recorded even if extractContent
      // raced. Idempotent merge. This marks the TEXT as extracted; it does not
      // imply embeddings exist.
      await writeIndexedHashToCache(cachePath, currentHash, fileStats.size).catch(() => undefined)
    }

    // Gate the embed step on model availability. When the embedding model is
    // not downloaded yet, skip embedding entirely: the text is already
    // extracted (keyword search works), and the document stays un-indexed so a
    // later pass — triggered by reloadEmbeddingsAndReindex after the model
    // finishes downloading — embeds it. This avoids hammering the worker with
    // doomed inference calls (and the resulting log spam) on every queued doc.
    if (!(await isEmbeddingModelReady())) {
      return
    }

    // Embed synchronously — owned by this worker so CPU scheduling stays in
    // one place. indexDocumentEmbeddings does its own freshness check, so a
    // file whose text didn't change won't re-run inference. When the model is
    // unavailable it returns 'embedding-failed' and we deliberately do NOT mark
    // the document indexed — the next pass retries the embedding step.
    const outcome = await indexDocumentEmbeddings(cachePath, {
      embeddingConfig,
      embedder,
      dim: DEFAULT_EMBEDDING_DIM
    })

    if (outcome.status === 'indexed' || outcome.status === 'fresh') {
      markIndexed(state, job.relativePath)
    }
  }

  function totalQueueSize(): number {
    return buckets.active.length + buckets.watch.length + buckets.catchup.length
  }

  function activeWorkerCount(): number {
    return workerPromises.size
  }

  function ensureWorkers(): void {
    while (!disposed && activeWorkerCount() < concurrency) {
      const promise = runWorker().finally(() => {
        workerPromises.delete(promise)
      })
      workerPromises.add(promise)
    }
  }

  function handleInitialTrackerCompletion(dossierId: string): void {
    const tracker = initialTrackers.get(dossierId)
    if (!tracker) return
    tracker.remaining = Math.max(0, tracker.remaining - 1)
    if (tracker.remaining > 0) return
    initialTrackers.delete(dossierId)
    const state = dossierStates.get(dossierId)
    const totalIndexed = state ? state.indexed - tracker.indexedAtStart : 0
    emit({
      kind: 'dossier-initial-complete',
      payload: {
        dossierId,
        totalIndexed: Math.max(0, totalIndexed),
        durationMs: Math.max(0, now() - tracker.startedAt)
      }
    })
  }

  function enqueueOne(job: IndexingJob): void {
    const normalized: IndexingJob = {
      ...job,
      relativePath: normalizeRelative(job.relativePath)
    }
    enqueueInternal(normalized)
  }

  async function enqueueDossierBatch(
    dossierId: string,
    opts: { reason: IndexingReason; trackInitialComplete?: boolean }
  ): Promise<void> {
    const inventory = await listIndexableDocuments(dossierId)
    if (!inventory) return
    const state = ensureDossierState(dossierId)
    state.extractable = inventory.length

    if (opts.trackInitialComplete && inventory.length > 0) {
      initialTrackers.set(dossierId, {
        startedAt: now(),
        remaining: inventory.length,
        indexedAtStart: state.indexed
      })
    }

    for (const entry of inventory) {
      enqueueOne({
        dossierId,
        relativePath: normalizeRelative(entry.relativePath),
        absolutePath: entry.absolutePath,
        reason: opts.reason
      })
    }

    if (inventory.length === 0 && opts.trackInitialComplete) {
      emit({
        kind: 'dossier-initial-complete',
        payload: { dossierId, totalIndexed: 0, durationMs: 0 }
      })
    }

    scheduleStatusEmit()
  }

  function cancelDossier(dossierId: string): void {
    let removed = 0
    for (const bucket of BUCKET_ORDER) {
      const queue = buckets[bucket]
      const survivors: IndexingJob[] = []
      for (const job of queue) {
        if (job.dossierId === dossierId) {
          enqueued.delete(jobKey(job.dossierId, job.relativePath))
          removed += 1
          continue
        }
        survivors.push(job)
      }
      buckets[bucket] = survivors
      // Reindex remaining jobs in this bucket.
      for (let i = 0; i < survivors.length; i++) {
        const q = survivors[i]!
        const k = jobKey(q.dossierId, q.relativePath)
        const tracker = enqueued.get(k)
        if (tracker && tracker.bucket === bucket) tracker.index = i
      }
    }
    initialTrackers.delete(dossierId)
    const state = dossierStates.get(dossierId)
    if (state) {
      state.pending = Math.max(0, state.pending - removed)
    }
    // In-flight jobs are left to finish; their `finally` will tear down state.
    scheduleStatusEmit()
  }

  async function runStartupCatchUp(dossierIds: string[]): Promise<void> {
    for (const id of dossierIds) {
      // Silent — no trackInitialComplete, no toast at the end. Just refresh
      // the extractable count and enqueue what needs work; the hash check in
      // processFile is what actually decides whether a doc gets re-extracted.
      await enqueueDossierBatch(id, { reason: 'startup-catchup' }).catch((error) => {
        console.warn(
          `[IndexingQueue] startup catch-up failed for ${id}:`,
          error instanceof Error ? error.message : error
        )
      })
    }
  }

  function setConcurrency(n: number): void {
    concurrency = Math.max(1, Math.floor(n))
    if (concurrency > activeWorkerCount()) {
      ensureWorkers()
    }
    wakeWorkers()
  }

  function pause(): void {
    paused = true
    wakeWorkers()
  }

  function resume(): void {
    paused = false
    wakeWorkers()
    ensureWorkers()
  }

  function reindex(job: IndexingJob): void {
    enqueueOne({ ...job, reason: 'manual-reindex' })
  }

  async function awaitIdle(): Promise<void> {
    // Workers stay alive forever (awaiting `wakeup.promise` between jobs), so
    // we can't await their Promises — those only resolve on dispose. Instead
    // we poll the aggregated counters: idle == nothing pending AND nothing
    // running across every tracked dossier. setImmediate yields one tick per
    // iteration, letting the worker advance through its await chain
    // (stat → hash → mkdir → atomicWrite → embed).
    //
    // The cap is a WALL-CLOCK deadline, not an iteration count: a single fs op
    // (sha256, atomic temp-file + rename) can span many setImmediate ticks on a
    // slow/loaded CI disk, so an iteration cap that's ample on a fast dev box
    // can trip mid-job under CI load (symptom: "timed out — running:1"). A time
    // budget tracks the work that actually has to finish, not the tick count.
    const deadline = now() + AWAIT_IDLE_TIMEOUT_MS
    for (;;) {
      let totalPending = 0
      let totalRunning = 0
      for (const state of dossierStates.values()) {
        totalPending += state.pending
        totalRunning += state.running
      }
      if (totalPending === 0 && totalRunning === 0 && totalQueueSize() === 0) return
      if (now() >= deadline) {
        throw new Error(`awaitIdle: timed out — totals: ${JSON.stringify(getSnapshot().totals)}`)
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    if (statusTimer !== null) {
      clearTimer(statusTimer)
      statusTimer = null
    }
    wakeWorkers()
    await Promise.allSettled([...workerPromises])
  }

  return {
    enqueueOne,
    enqueueDossierBatch,
    cancelDossier,
    runStartupCatchUp,
    getSnapshot,
    setConcurrency,
    pause,
    resume,
    reindex,
    awaitIdle,
    dispose
  }
}

/**
 * Convenience walker used by callers that need to inventory a dossier's
 * extractable documents. Lives here so unit tests can exercise it without
 * pulling in documentService.
 */
export async function walkExtractableDocuments(
  dossierPath: string
): Promise<IndexableInventoryEntry[]> {
  const { readdir } = await import('node:fs/promises')

  const results: IndexableInventoryEntry[] = []

  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.name === ORDICAB_DIRECTORY_NAME) continue
      const absolute = join(currentDir, entry.name)
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(absolute, rel)
        continue
      }
      if (!entry.isFile()) continue
      if (!isDocumentTextExtractable(absolute)) continue
      results.push({ relativePath: rel, absolutePath: absolute })
    }
  }

  await walk(dossierPath, '')
  return results
}
