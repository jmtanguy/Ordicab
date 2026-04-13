import { describe, expect, it, vi } from 'vitest'

import {
  createUpdaterService,
  type PendingUpdateRecord,
  type PendingUpdateStore,
  type UpdaterEventMap,
  type UpdaterLogger,
  type UpdaterLike
} from '../updater'

function createLogger(): UpdaterLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}

function createPendingUpdateStore(
  initialRecord: PendingUpdateRecord | null = null
): PendingUpdateStore & { current(): PendingUpdateRecord | null } {
  let record = initialRecord

  return {
    read: vi.fn(async () => record),
    write: vi.fn(async (nextRecord: PendingUpdateRecord) => {
      record = nextRecord
    }),
    clear: vi.fn(async () => {
      record = null
    }),
    current: () => record
  }
}

function createUpdaterMock(): UpdaterLike & {
  emit<TKey extends keyof UpdaterEventMap>(
    eventName: TKey,
    ...args: Parameters<UpdaterEventMap[TKey]>
  ): void
} {
  const listeners: {
    [TKey in keyof UpdaterEventMap]?: Array<UpdaterEventMap[TKey]>
  } = {}

  return {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn(
      <TKey extends keyof UpdaterEventMap>(eventName: TKey, listener: UpdaterEventMap[TKey]) => {
        listeners[eventName] ??= []
        listeners[eventName]?.push(listener)
        return undefined
      }
    ),
    checkForUpdates: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
    emit<TKey extends keyof UpdaterEventMap>(
      eventName: TKey,
      ...args: Parameters<UpdaterEventMap[TKey]>
    ): void {
      for (const listener of listeners[eventName] ?? []) {
        ;(listener as (...listenerArgs: Parameters<UpdaterEventMap[TKey]>) => void)(...args)
      }
    }
  }
}

describe('updater service', () => {
  it('configures silent background downloads and persists downloaded updates for the next launch', async () => {
    const updater = createUpdaterMock()
    const pendingUpdateStore = createPendingUpdateStore()
    const logger = createLogger()
    const service = createUpdaterService({
      updater,
      pendingUpdateStore,
      logger,
      isPackaged: true
    })

    await service.checkForUpdatesOnStartup()
    updater.emit('update-downloaded', {
      downloadedFile: '/tmp/Ordicab-1.2.0.zip',
      files: [],
      path: '/tmp/Ordicab-1.2.0.zip',
      sha512: 'sha512',
      releaseDate: '2026-03-11T08:00:00.000Z',
      version: '1.2.0'
    } as unknown as Parameters<UpdaterEventMap['update-downloaded']>[0])
    await Promise.resolve()

    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(pendingUpdateStore.write).toHaveBeenCalledWith({
      version: '1.2.0',
      downloadedAt: expect.any(String)
    })
  })

  it('applies a previously downloaded update before the UI becomes interactive', async () => {
    const updater = createUpdaterMock()
    const pendingUpdateStore = createPendingUpdateStore({
      version: '1.2.0',
      downloadedAt: '2026-03-11T08:00:00.000Z'
    })
    const service = createUpdaterService({
      updater,
      pendingUpdateStore,
      logger: createLogger(),
      isPackaged: true
    })

    await expect(service.applyPendingUpdateOnLaunch()).resolves.toBe(true)

    expect(pendingUpdateStore.clear).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('treats offline failures as quiet background events', async () => {
    const updater = createUpdaterMock()
    const logger = createLogger()
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED while requesting update feed')
    })

    const service = createUpdaterService({
      updater,
      pendingUpdateStore: createPendingUpdateStore(),
      logger,
      isPackaged: true
    })

    await expect(service.checkForUpdatesOnStartup()).resolves.toBeUndefined()

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('offline'), expect.any(Error))
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('keeps background event handling quiet when updates are available or absent', async () => {
    const updater = createUpdaterMock()
    const pendingUpdateStore = createPendingUpdateStore()
    const logger = createLogger()
    const service = createUpdaterService({
      updater,
      pendingUpdateStore,
      logger,
      isPackaged: true
    })

    await service.checkForUpdatesOnStartup()

    updater.emit('update-available', {
      files: [],
      path: '/tmp/Ordicab-1.2.0.zip',
      sha512: 'sha512',
      releaseDate: '2026-03-11T08:00:00.000Z',
      version: '1.2.0'
    } as never)
    updater.emit('update-not-available', {
      files: [],
      path: '/tmp/Ordicab-1.0.0.zip',
      sha512: 'sha512',
      releaseDate: '2026-03-10T08:00:00.000Z',
      version: '1.0.0'
    } as never)

    expect(logger.info).toHaveBeenCalledWith(
      '[Updater] Update 1.2.0 available. Downloading silently.'
    )
    expect(logger.info).toHaveBeenCalledWith('[Updater] No update available.')
    expect(pendingUpdateStore.write).not.toHaveBeenCalled()
  })

  it('restores the pending update marker when quitAndInstall throws', async () => {
    const pendingRecord = { version: '1.2.0', downloadedAt: '2026-03-11T08:00:00.000Z' }
    const pendingUpdateStore = createPendingUpdateStore(pendingRecord)
    const logger = createLogger()
    const updater = createUpdaterMock()
    updater.quitAndInstall = vi.fn(() => {
      throw new Error('quitAndInstall failed')
    })

    const service = createUpdaterService({
      updater,
      pendingUpdateStore,
      logger,
      isPackaged: true
    })

    await expect(service.applyPendingUpdateOnLaunch()).resolves.toBe(false)

    expect(pendingUpdateStore.clear).toHaveBeenCalledTimes(1)
    expect(pendingUpdateStore.write).toHaveBeenCalledWith(pendingRecord)
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to trigger deferred update installation'),
      expect.any(Error)
    )
  })

  it('skips update checks in unpackaged development builds', async () => {
    const updater = createUpdaterMock()
    const service = createUpdaterService({
      updater,
      pendingUpdateStore: createPendingUpdateStore(),
      logger: createLogger(),
      isPackaged: false
    })

    await expect(service.checkForUpdatesOnStartup()).resolves.toBeUndefined()

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})
