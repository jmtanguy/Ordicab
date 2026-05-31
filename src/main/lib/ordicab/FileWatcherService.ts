import chokidar, { type ChokidarOptions } from 'chokidar'
import { access } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import type { DocumentChangeEvent, DocumentWatchStatus, DossierScopedQuery } from '@shared/types'
import { ORDICAB_DIRECTORY_NAME } from './ordicabPaths'

export interface FileWatcherLike {
  on(event: string, listener: (...args: unknown[]) => void): this
  close(): Promise<unknown>
}

export type WatchFactory = (path: string, options: ChokidarOptions) => FileWatcherLike

export type FileEventKind = 'add' | 'change' | 'unlink'

export interface FileLevelEvent {
  dossierId: string
  dossierPath: string
  kind: FileEventKind
  absolutePath: string
  /** POSIX-separated path relative to the dossier root. */
  relativePath: string
}

export type FileEventListener = (event: FileLevelEvent) => void

interface AggregatedSubscriber {
  onDocumentsChanged: (event: DocumentChangeEvent) => void
  onAvailabilityChanged: (status: DocumentWatchStatus) => void
}

interface WatcherState {
  dossierId: string
  dossierPath: string
  watcher: FileWatcherLike | null
  changeTimer: ReturnType<typeof setTimeout> | null
  recoveryTimer: ReturnType<typeof setTimeout> | null
  status: DocumentWatchStatus
  /** Single aggregated subscriber (the renderer panel watching this dossier). */
  aggregated: AggregatedSubscriber | null
  /** Multiple file-level subscribers (typically the indexing queue at boot). */
  fileListeners: Set<FileEventListener>
}

export interface FileWatcherServiceOptions {
  changeDebounceMs?: number
  checkPathAccessible?: (path: string) => Promise<boolean>
  now?: () => Date
  recoveryPollIntervalMs?: number
  watchFactory?: WatchFactory
}

export interface FileWatcherService {
  /**
   * Renderer-facing subscription: debounced "documents changed" plus
   * availability transitions. Replaces any previous aggregated subscriber for
   * the same dossier (the renderer only opens one dossier at a time).
   */
  subscribe: (
    input: DossierScopedQuery & {
      dossierPath: string
      onDocumentsChanged: (event: DocumentChangeEvent) => void
      onAvailabilityChanged: (status: DocumentWatchStatus) => void
    }
  ) => Promise<DocumentWatchStatus>
  /**
   * Removes the aggregated subscriber. The underlying chokidar watcher stays
   * alive if any file-level listener is still registered (typical when the
   * indexing queue is watching at boot independently of the UI).
   */
  unsubscribe: (input: DossierScopedQuery) => Promise<void>
  /**
   * Main-process subscription used by the indexing queue. Listener is called
   * per raw file event (add/change/unlink). The watcher is started lazily on
   * the first subscriber and shared across subscriber types.
   *
   * Returns an unsubscribe callback. Multiple file-level listeners per dossier
   * are supported.
   */
  subscribeFileEvents: (input: {
    dossierId: string
    dossierPath: string
    listener: FileEventListener
  }) => Promise<{ unsubscribe: () => Promise<void>; status: DocumentWatchStatus }>
  disposeAll: () => Promise<void>
}

const DEFAULT_CHANGE_DEBOUNCE_MS = 250
const DEFAULT_RECOVERY_POLL_INTERVAL_MS = 2_000
const DEFAULT_UNAVAILABLE_MESSAGE = 'Waiting for dossier folder to come back online.'
const WATCHER_CHANGE_EVENTS: readonly FileEventKind[] = ['add', 'change', 'unlink']

function createChangedEvent(dossierId: string, now: () => Date): DocumentChangeEvent {
  return {
    dossierId,
    kind: 'documents-changed',
    changedAt: now().toISOString()
  }
}

function createStatus(
  dossierId: string,
  status: DocumentWatchStatus['status'],
  now: () => Date,
  message: string | null = null
): DocumentWatchStatus {
  return {
    dossierId,
    status,
    changedAt: now().toISOString(),
    message
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function isOrdicabPath(path: string): boolean {
  return normalizePath(path).includes('/.ordicab/')
}

function isIgnoredGeneratedPath(path: string): boolean {
  return normalizePath(path).endsWith('/CLAUDE.md')
}

function shouldIgnoreDossierWatchPath(path: string): boolean {
  return isOrdicabPath(path) || isIgnoredGeneratedPath(path)
}

function toRelativePosix(dossierPath: string, absolutePath: string): string {
  return relative(dossierPath, absolutePath).split(sep).join('/')
}

async function defaultCheckPathAccessible(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createFileWatcherService(
  options: FileWatcherServiceOptions = {}
): FileWatcherService {
  const changeDebounceMs = options.changeDebounceMs ?? DEFAULT_CHANGE_DEBOUNCE_MS
  const recoveryPollIntervalMs = options.recoveryPollIntervalMs ?? DEFAULT_RECOVERY_POLL_INTERVAL_MS
  const checkPathAccessible = options.checkPathAccessible ?? defaultCheckPathAccessible
  const now = options.now ?? (() => new Date())
  const watchFactory =
    options.watchFactory ??
    ((path, watchOptions) => chokidar.watch(path, watchOptions) as unknown as FileWatcherLike)

  const states = new Map<string, WatcherState>()

  async function closeWatcher(state: WatcherState): Promise<void> {
    const watcher = state.watcher
    state.watcher = null
    if (watcher) {
      await watcher.close()
    }
  }

  function hasAnySubscriber(state: WatcherState): boolean {
    return state.aggregated !== null || state.fileListeners.size > 0
  }

  function emitAvailability(
    state: WatcherState,
    status: DocumentWatchStatus['status'],
    message: string | null
  ): DocumentWatchStatus {
    state.status = createStatus(state.dossierId, status, now, message)
    if (state.aggregated) {
      state.aggregated.onAvailabilityChanged(state.status)
    }
    return state.status
  }

  function emitDocumentsChangedToAggregated(state: WatcherState): void {
    if (!state.aggregated) return
    state.aggregated.onDocumentsChanged(createChangedEvent(state.dossierId, now))
  }

  function scheduleAggregatedEmit(state: WatcherState): void {
    if (!state.aggregated) return
    if (state.changeTimer) {
      clearTimeout(state.changeTimer)
    }
    state.changeTimer = setTimeout(() => {
      state.changeTimer = null
      emitDocumentsChangedToAggregated(state)
    }, changeDebounceMs)
  }

  function fanOutFileEvent(state: WatcherState, kind: FileEventKind, absolutePath: string): void {
    if (state.fileListeners.size === 0) return
    const relativePath = toRelativePosix(state.dossierPath, absolutePath)
    const event: FileLevelEvent = {
      dossierId: state.dossierId,
      dossierPath: state.dossierPath,
      kind,
      absolutePath,
      relativePath
    }
    // Copy the set so a listener mutating it during emission (subscribing or
    // unsubscribing inside the callback) doesn't reshape the iteration.
    for (const listener of [...state.fileListeners]) {
      try {
        listener(event)
      } catch {
        // Listener failures must not crash the watcher.
      }
    }
  }

  async function scheduleRecovery(state: WatcherState): Promise<void> {
    if (state.recoveryTimer) return
    state.recoveryTimer = setTimeout(async () => {
      state.recoveryTimer = null
      if (!hasAnySubscriber(state)) return
      const isAccessible = await checkPathAccessible(state.dossierPath)
      if (!isAccessible) {
        await scheduleRecovery(state)
        return
      }
      await createWatcher(state)
      emitAvailability(state, 'available', null)
      emitDocumentsChangedToAggregated(state)
    }, recoveryPollIntervalMs)
  }

  async function markUnavailable(
    state: WatcherState,
    message = DEFAULT_UNAVAILABLE_MESSAGE
  ): Promise<void> {
    if (state.status.status === 'unavailable' && state.recoveryTimer) return
    if (state.changeTimer) {
      clearTimeout(state.changeTimer)
      state.changeTimer = null
    }
    await closeWatcher(state)
    emitAvailability(state, 'unavailable', message)
    await scheduleRecovery(state)
  }

  async function createWatcher(state: WatcherState): Promise<void> {
    await closeWatcher(state)
    const normalizedDossierPath = normalizePath(state.dossierPath)

    const watcher = watchFactory(state.dossierPath, {
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      },
      ignoreInitial: true,
      ignored: (path) => {
        const normalized = normalizePath(path)
        return (
          normalized.includes(`/${ORDICAB_DIRECTORY_NAME}/`) ||
          normalized.endsWith(`/${ORDICAB_DIRECTORY_NAME}`) ||
          normalized.endsWith('/CLAUDE.md') ||
          /\/~\$[^/]+$/.test(normalized)
        )
      },
      persistent: true
    })

    state.watcher = watcher

    for (const eventName of WATCHER_CHANGE_EVENTS) {
      watcher.on(eventName, (path) => {
        if (typeof path !== 'string' || shouldIgnoreDossierWatchPath(path)) return
        fanOutFileEvent(state, eventName, path)
        scheduleAggregatedEmit(state)
      })
    }
    watcher.on('unlinkDir', (path) => {
      if (typeof path !== 'string') return
      const normalizedPath = normalizePath(path)
      if (normalizedPath === normalizedDossierPath) {
        void markUnavailable(state)
        return
      }
      if (!shouldIgnoreDossierWatchPath(normalizedPath)) {
        scheduleAggregatedEmit(state)
      }
    })
    watcher.on('addDir', (path) => {
      if (
        typeof path === 'string' &&
        !shouldIgnoreDossierWatchPath(path) &&
        normalizePath(path) !== normalizedDossierPath
      ) {
        scheduleAggregatedEmit(state)
      }
    })
    watcher.on('error', () => {
      void markUnavailable(state)
    })
  }

  async function ensureState(
    dossierId: string,
    dossierPath: string
  ): Promise<{ state: WatcherState; createdNow: boolean }> {
    const existing = states.get(dossierId)
    if (existing) {
      if (existing.dossierPath !== dossierPath) {
        // Dossier moved on disk. Rebuild the watcher rooted at the new path.
        await closeWatcher(existing)
        existing.dossierPath = dossierPath
        if (await checkPathAccessible(dossierPath)) {
          await createWatcher(existing)
        } else {
          await markUnavailable(existing)
        }
      }
      return { state: existing, createdNow: false }
    }
    const state: WatcherState = {
      dossierId,
      dossierPath,
      watcher: null,
      changeTimer: null,
      recoveryTimer: null,
      status: createStatus(dossierId, 'available', now, null),
      aggregated: null,
      fileListeners: new Set()
    }
    states.set(dossierId, state)
    if (!(await checkPathAccessible(dossierPath))) {
      await markUnavailable(state)
    } else {
      await createWatcher(state)
    }
    return { state, createdNow: true }
  }

  async function teardownIfIdle(state: WatcherState): Promise<void> {
    if (hasAnySubscriber(state)) return
    if (state.changeTimer) {
      clearTimeout(state.changeTimer)
      state.changeTimer = null
    }
    if (state.recoveryTimer) {
      clearTimeout(state.recoveryTimer)
      state.recoveryTimer = null
    }
    await closeWatcher(state)
    states.delete(state.dossierId)
  }

  return {
    subscribe: async (input) => {
      const { state } = await ensureState(input.dossierId, input.dossierPath)
      state.aggregated = {
        onDocumentsChanged: input.onDocumentsChanged,
        onAvailabilityChanged: input.onAvailabilityChanged
      }
      return state.status
    },

    unsubscribe: async (input) => {
      const state = states.get(input.dossierId)
      if (!state) return
      state.aggregated = null
      if (state.changeTimer) {
        clearTimeout(state.changeTimer)
        state.changeTimer = null
      }
      await teardownIfIdle(state)
    },

    subscribeFileEvents: async (input) => {
      const { state } = await ensureState(input.dossierId, input.dossierPath)
      state.fileListeners.add(input.listener)
      return {
        status: state.status,
        unsubscribe: async () => {
          state.fileListeners.delete(input.listener)
          await teardownIfIdle(state)
        }
      }
    },

    disposeAll: async () => {
      const all = [...states.values()]
      states.clear()
      await Promise.all(
        all.map(async (state) => {
          if (state.changeTimer) {
            clearTimeout(state.changeTimer)
            state.changeTimer = null
          }
          if (state.recoveryTimer) {
            clearTimeout(state.recoveryTimer)
            state.recoveryTimer = null
          }
          await closeWatcher(state)
        })
      )
    }
  }
}
