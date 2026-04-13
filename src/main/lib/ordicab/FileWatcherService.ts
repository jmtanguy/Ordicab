import chokidar, { type ChokidarOptions } from 'chokidar'
import { access } from 'node:fs/promises'

import type { DocumentChangeEvent, DocumentWatchStatus, DossierScopedQuery } from '@shared/types'
import { ORDICAB_DIRECTORY_NAME } from './ordicabPaths'

export interface FileWatcherLike {
  on(event: string, listener: (...args: unknown[]) => void): this
  close(): Promise<unknown>
}

export type WatchFactory = (path: string, options: ChokidarOptions) => FileWatcherLike

interface FileWatcherEntry {
  dossierId: string
  dossierPath: string
  watcher: FileWatcherLike | null
  changeTimer: ReturnType<typeof setTimeout> | null
  recoveryTimer: ReturnType<typeof setTimeout> | null
  status: DocumentWatchStatus
  onDocumentsChanged: (event: DocumentChangeEvent) => void
  onAvailabilityChanged: (status: DocumentWatchStatus) => void
}

export interface FileWatcherServiceOptions {
  changeDebounceMs?: number
  checkPathAccessible?: (path: string) => Promise<boolean>
  now?: () => Date
  recoveryPollIntervalMs?: number
  watchFactory?: WatchFactory
}

export interface FileWatcherService {
  subscribe: (
    input: DossierScopedQuery & {
      dossierPath: string
      onDocumentsChanged: (event: DocumentChangeEvent) => void
      onAvailabilityChanged: (status: DocumentWatchStatus) => void
    }
  ) => Promise<DocumentWatchStatus>
  unsubscribe: (input: DossierScopedQuery) => Promise<void>
  disposeAll: () => Promise<void>
}

const DEFAULT_CHANGE_DEBOUNCE_MS = 250
const DEFAULT_RECOVERY_POLL_INTERVAL_MS = 2_000
const DEFAULT_UNAVAILABLE_MESSAGE = 'Waiting for dossier folder to come back online.'
const WATCHER_CHANGE_EVENTS = ['add', 'change', 'unlink'] as const

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

  const entries = new Map<string, FileWatcherEntry>()

  async function closeWatcher(entry: FileWatcherEntry): Promise<void> {
    const watcher = entry.watcher
    entry.watcher = null

    if (watcher) {
      await watcher.close()
    }
  }

  function emitAvailability(
    entry: FileWatcherEntry,
    status: DocumentWatchStatus['status'],
    message: string | null
  ): DocumentWatchStatus {
    entry.status = createStatus(entry.dossierId, status, now, message)
    entry.onAvailabilityChanged(entry.status)
    return entry.status
  }

  function emitDocumentsChanged(entry: FileWatcherEntry): void {
    entry.onDocumentsChanged(createChangedEvent(entry.dossierId, now))
  }

  function scheduleDocumentsChanged(entry: FileWatcherEntry): void {
    if (entry.changeTimer) {
      clearTimeout(entry.changeTimer)
    }

    entry.changeTimer = setTimeout(() => {
      entry.changeTimer = null
      emitDocumentsChanged(entry)
    }, changeDebounceMs)
  }

  async function scheduleRecovery(entry: FileWatcherEntry): Promise<void> {
    if (entry.recoveryTimer) {
      return
    }

    entry.recoveryTimer = setTimeout(async () => {
      entry.recoveryTimer = null
      const isAccessible = await checkPathAccessible(entry.dossierPath)

      if (!isAccessible) {
        await scheduleRecovery(entry)
        return
      }

      await createWatcher(entry)
      emitAvailability(entry, 'available', null)
      emitDocumentsChanged(entry)
    }, recoveryPollIntervalMs)
  }

  async function markUnavailable(
    entry: FileWatcherEntry,
    message = DEFAULT_UNAVAILABLE_MESSAGE
  ): Promise<void> {
    if (entry.status.status === 'unavailable' && entry.recoveryTimer) {
      return
    }

    if (entry.changeTimer) {
      clearTimeout(entry.changeTimer)
      entry.changeTimer = null
    }

    await closeWatcher(entry)
    emitAvailability(entry, 'unavailable', message)
    await scheduleRecovery(entry)
  }

  async function createWatcher(entry: FileWatcherEntry): Promise<void> {
    await closeWatcher(entry)
    const normalizedDossierPath = normalizePath(entry.dossierPath)

    const watcher = watchFactory(entry.dossierPath, {
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

    entry.watcher = watcher

    for (const eventName of WATCHER_CHANGE_EVENTS) {
      watcher.on(eventName, (path) => {
        if (typeof path === 'string' && !shouldIgnoreDossierWatchPath(path)) {
          scheduleDocumentsChanged(entry)
        }
      })
    }
    watcher.on('unlinkDir', (path) => {
      if (typeof path !== 'string') {
        return
      }

      const normalizedPath = normalizePath(path)
      if (normalizedPath === normalizedDossierPath) {
        void markUnavailable(entry)
        return
      }

      if (!shouldIgnoreDossierWatchPath(normalizedPath)) {
        scheduleDocumentsChanged(entry)
      }
    })
    watcher.on('addDir', (path) => {
      if (
        typeof path === 'string' &&
        !shouldIgnoreDossierWatchPath(path) &&
        normalizePath(path) !== normalizedDossierPath
      ) {
        scheduleDocumentsChanged(entry)
      }
    })
    watcher.on('error', () => {
      void markUnavailable(entry)
    })
  }

  return {
    subscribe: async (input) => {
      await createFileWatcherServiceCleanup(input.dossierId)

      const entry: FileWatcherEntry = {
        dossierId: input.dossierId,
        dossierPath: input.dossierPath,
        watcher: null,
        changeTimer: null,
        recoveryTimer: null,
        status: createStatus(input.dossierId, 'available', now, null),
        onDocumentsChanged: input.onDocumentsChanged,
        onAvailabilityChanged: input.onAvailabilityChanged
      }

      entries.set(input.dossierId, entry)

      if (!(await checkPathAccessible(input.dossierPath))) {
        await markUnavailable(entry)
        return entry.status
      }

      await createWatcher(entry)
      return entry.status
    },

    unsubscribe: async (input) => {
      const entry = entries.get(input.dossierId)

      if (!entry) {
        return
      }

      if (entry.changeTimer) {
        clearTimeout(entry.changeTimer)
      }

      if (entry.recoveryTimer) {
        clearTimeout(entry.recoveryTimer)
      }

      await closeWatcher(entry)
      entries.delete(input.dossierId)
    },

    disposeAll: async () => {
      await Promise.all(
        [...entries.keys()].map(async (dossierId) => createFileWatcherServiceCleanup(dossierId))
      )
    }
  }

  async function createFileWatcherServiceCleanup(dossierId: string): Promise<void> {
    const entry = entries.get(dossierId)

    if (!entry) {
      return
    }

    if (entry.changeTimer) {
      clearTimeout(entry.changeTimer)
      entry.changeTimer = null
    }

    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer)
      entry.recoveryTimer = null
    }

    await closeWatcher(entry)
    entries.delete(dossierId)
  }
}
