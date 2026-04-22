import { readFile, rm } from 'node:fs/promises'

import type { AppUpdater, ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

import type { UpdaterProgressPayload, UpdaterStatus } from '@shared/types'

import { atomicWrite } from './lib/system/atomicWrite'

export interface PendingUpdateRecord {
  version: string
  downloadedAt: string
}

export interface PendingUpdateStore {
  read(): Promise<PendingUpdateRecord | null>
  write(record: PendingUpdateRecord): Promise<void>
  clear(): Promise<void>
}

export interface UpdaterLogger {
  info(message: string, error?: unknown): void
  warn(message: string, error?: unknown): void
  error(message: string, error?: unknown): void
}

export interface UpdaterEventMap {
  error: (error: Error, message?: string) => void
  'checking-for-update': () => void
  'update-not-available': (info: UpdateInfo) => void
  'update-available': (info: UpdateInfo) => void
  'download-progress': (info: ProgressInfo) => void
  'update-downloaded': (event: UpdateDownloadedEvent) => void
}

export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: AppUpdater['logger']
  on<TKey extends keyof UpdaterEventMap>(eventName: TKey, listener: UpdaterEventMap[TKey]): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterNotifier {
  status(status: UpdaterStatus): void
  progress(progress: UpdaterProgressPayload): void
}

export interface UpdaterService {
  applyPendingUpdateOnLaunch(): Promise<boolean>
  checkForUpdatesOnStartup(): Promise<void>
  startDownload(): Promise<void>
  installNow(): Promise<void>
  installOnQuit(): Promise<void>
  dismiss(): void
  getStatus(): UpdaterStatus
}

interface CreateUpdaterServiceOptions {
  updater: UpdaterLike
  pendingUpdateStore: PendingUpdateStore
  logger?: UpdaterLogger
  isPackaged: boolean
  notifier?: UpdaterNotifier
  now?: () => Date
}

const OFFLINE_ERROR_TOKENS = [
  'err_internet_disconnected',
  'eai_again',
  'eai_noname',
  'enotfound',
  'err_network_changed',
  'err_connection_refused',
  'err_connection_reset',
  'etimedout',
  'econnaborted',
  'ehostunreach',
  'offline'
]

const consoleLogger: UpdaterLogger = {
  info(message, error) {
    if (error) {
      console.info(message, error)
      return
    }
    console.info(message)
  },
  warn(message, error) {
    if (error) {
      console.warn(message, error)
      return
    }
    console.warn(message)
  },
  error(message, error) {
    if (error) {
      console.error(message, error)
      return
    }
    console.error(message)
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(typeof error === 'string' ? error : 'Unknown updater error')
}

function isOfflineUpdaterError(error: unknown): boolean {
  const message = toError(error).message.toLowerCase()
  return OFFLINE_ERROR_TOKENS.some((token) => message.includes(token))
}

function logUpdaterError(logger: UpdaterLogger, error: unknown): void {
  const normalizedError = toError(error)
  if (isOfflineUpdaterError(normalizedError)) {
    logger.info('[Updater] Update check skipped while offline.', normalizedError)
    return
  }
  logger.error('[Updater] Update flow failed.', normalizedError)
}

export function createPendingUpdateStore(filePath: string): PendingUpdateStore {
  return {
    async read(): Promise<PendingUpdateRecord | null> {
      try {
        const raw = await readFile(filePath, 'utf8')
        return JSON.parse(raw) as PendingUpdateRecord
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return null
        }
        throw error
      }
    },
    async write(record: PendingUpdateRecord): Promise<void> {
      await atomicWrite(filePath, JSON.stringify(record, null, 2))
    },
    async clear(): Promise<void> {
      await rm(filePath, { force: true })
    }
  }
}

export function createUpdaterService(options: CreateUpdaterServiceOptions): UpdaterService {
  const logger = options.logger ?? consoleLogger
  const notifier = options.notifier
  let handlersBound = false
  let errorSeenDuringCheck = false
  let currentStatus: UpdaterStatus = { kind: 'idle' }
  let availableVersion: string | null = null

  function setStatus(next: UpdaterStatus): void {
    currentStatus = next
    notifier?.status(next)
  }

  function bindHandlers(): void {
    if (handlersBound) {
      return
    }

    handlersBound = true
    options.updater.autoDownload = false
    options.updater.autoInstallOnAppQuit = false
    options.updater.logger = {
      info: (message) => logger.info(`[electron-updater] ${String(message ?? '')}`),
      warn: (message) => logger.warn(`[electron-updater] ${String(message ?? '')}`),
      error: (message) => logger.error(`[electron-updater] ${String(message ?? '')}`),
      debug: (message) => logger.info(`[electron-updater:debug] ${String(message ?? '')}`)
    }

    options.updater.on('checking-for-update', () => {
      logger.info('[Updater] Checking GitHub Releases for updates.')
      setStatus({ kind: 'checking' })
    })

    options.updater.on('update-available', (info) => {
      availableVersion = info.version
      logger.info(`[Updater] Update ${info.version} available — awaiting user confirmation.`)
      const releaseNotes = typeof info.releaseNotes === 'string' ? info.releaseNotes : null
      setStatus({ kind: 'available', version: info.version, releaseNotes })
    })

    options.updater.on('update-not-available', () => {
      logger.info('[Updater] No update available.')
      setStatus({ kind: 'idle' })
    })

    options.updater.on('download-progress', (info) => {
      const version = availableVersion ?? 'unknown'
      notifier?.progress({
        version,
        percent: info.percent,
        bytesPerSecond: info.bytesPerSecond,
        transferred: info.transferred,
        total: info.total
      })
      if (currentStatus.kind !== 'downloading') {
        setStatus({ kind: 'downloading', version })
      }
    })

    options.updater.on('update-downloaded', (event) => {
      availableVersion = event.version
      const pendingRecord: PendingUpdateRecord = {
        version: event.version,
        downloadedAt: (options.now ?? (() => new Date()))().toISOString()
      }

      void options.pendingUpdateStore
        .write(pendingRecord)
        .then(() => {
          logger.info(`[Updater] Update ${event.version} downloaded and ready to install.`)
        })
        .catch((error) => {
          logger.error('[Updater] Failed to persist downloaded update marker.', error)
        })

      setStatus({ kind: 'downloaded', version: event.version })
    })

    options.updater.on('error', (error) => {
      errorSeenDuringCheck = true
      logUpdaterError(logger, error)
      const normalized = toError(error)
      if (!isOfflineUpdaterError(normalized)) {
        setStatus({ kind: 'error', message: normalized.message })
      } else {
        setStatus({ kind: 'idle' })
      }
    })
  }

  return {
    async applyPendingUpdateOnLaunch(): Promise<boolean> {
      if (!options.isPackaged) {
        return false
      }

      bindHandlers()

      let pendingUpdate: PendingUpdateRecord | null
      try {
        pendingUpdate = await options.pendingUpdateStore.read()
      } catch (error) {
        logger.error('[Updater] Failed to read pending update state.', error)
        return false
      }

      if (!pendingUpdate) {
        return false
      }

      logger.info(
        `[Updater] Applying downloaded update ${pendingUpdate.version} before showing the UI.`
      )

      try {
        await options.pendingUpdateStore.clear()
        options.updater.quitAndInstall(true, true)
        return true
      } catch (error) {
        logger.error('[Updater] Failed to trigger deferred update installation.', error)

        try {
          await options.pendingUpdateStore.write(pendingUpdate)
        } catch (restoreError) {
          logger.error('[Updater] Failed to restore pending update marker.', restoreError)
        }

        return false
      }
    },

    async checkForUpdatesOnStartup(): Promise<void> {
      if (!options.isPackaged) {
        logger.info('[Updater] Skipping update checks for unpackaged development builds.')
        return
      }

      bindHandlers()
      errorSeenDuringCheck = false

      try {
        await options.updater.checkForUpdates()
      } catch (error) {
        if (!errorSeenDuringCheck) {
          logUpdaterError(logger, error)
        }
      }
    },

    async startDownload(): Promise<void> {
      if (!options.isPackaged) {
        return
      }

      bindHandlers()

      const version = availableVersion ?? 'unknown'
      setStatus({ kind: 'downloading', version })

      try {
        await options.updater.downloadUpdate()
      } catch (error) {
        logUpdaterError(logger, error)
        const normalized = toError(error)
        setStatus({ kind: 'error', message: normalized.message })
      }
    },

    async installNow(): Promise<void> {
      if (!options.isPackaged) {
        return
      }

      try {
        await options.pendingUpdateStore.clear()
      } catch (error) {
        logger.warn('[Updater] Failed to clear pending update marker before install.', error)
      }

      try {
        options.updater.quitAndInstall(false, true)
      } catch (error) {
        logger.error('[Updater] Failed to trigger immediate install.', error)
        const normalized = toError(error)
        setStatus({ kind: 'error', message: normalized.message })
      }
    },

    async installOnQuit(): Promise<void> {
      options.updater.autoInstallOnAppQuit = true
      logger.info('[Updater] Will install the downloaded update on next app quit.')
    },

    dismiss(): void {
      setStatus({ kind: 'idle' })
    },

    getStatus(): UpdaterStatus {
      return currentStatus
    }
  }
}
