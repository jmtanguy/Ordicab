import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFileWatcherService,
  type FileWatcherLike,
  type WatchFactory
} from '../FileWatcherService'

class FakeWatcher extends EventEmitter implements FileWatcherLike {
  close = vi.fn(async () => undefined)
}

describe('FileWatcherService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores .ordicab paths and publishes debounced changes for dossier files', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: WatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })

    const onDocumentsChanged = vi.fn()
    const onAvailabilityChanged = vi.fn()
    const service = createFileWatcherService({
      watchFactory,
      checkPathAccessible: vi.fn(async () => true)
    })

    await service.subscribe({
      dossierId: 'dos-1',
      dossierPath: '/tmp/domain/dos-1',
      onDocumentsChanged,
      onAvailabilityChanged
    })

    expect(watchers).toHaveLength(1)

    watchers[0]!.emit('add', '/tmp/domain/dos-1/.ordicab/dossier.json')
    watchers[0]!.emit('add', '/tmp/domain/dos-1/contract.pdf')
    await vi.advanceTimersByTimeAsync(300)

    expect(onDocumentsChanged).toHaveBeenCalledTimes(1)
    expect(onDocumentsChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        dossierId: 'dos-1',
        kind: 'documents-changed'
      })
    )
    expect(onAvailabilityChanged).not.toHaveBeenCalled()
    expect(watchFactory).toHaveBeenCalledWith(
      '/tmp/domain/dos-1',
      expect.objectContaining({
        ignored: expect.any(Function)
      })
    )
  })

  it('ignores generated CLAUDE.md changes in the dossier watcher', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: WatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })

    const onDocumentsChanged = vi.fn()
    const onAvailabilityChanged = vi.fn()
    const service = createFileWatcherService({
      watchFactory,
      checkPathAccessible: vi.fn(async () => true)
    })

    await service.subscribe({
      dossierId: 'dos-claude',
      dossierPath: '/tmp/domain/dos-claude',
      onDocumentsChanged,
      onAvailabilityChanged
    })

    watchers[0]!.emit('change', '/tmp/domain/dos-claude/CLAUDE.md')
    await vi.advanceTimersByTimeAsync(300)

    expect(onDocumentsChanged).not.toHaveBeenCalled()
    expect(onAvailabilityChanged).not.toHaveBeenCalled()
  })

  it('unsubscribe closes the watcher and cancels pending timers', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: WatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const onDocumentsChanged = vi.fn()
    const onAvailabilityChanged = vi.fn()
    const service = createFileWatcherService({
      watchFactory,
      checkPathAccessible: vi.fn(async () => true)
    })

    await service.subscribe({
      dossierId: 'dos-unsubscribe',
      dossierPath: '/tmp/domain/dos-unsubscribe',
      onDocumentsChanged,
      onAvailabilityChanged
    })

    // Trigger a pending debounce timer
    watchers[0]!.emit('add', '/tmp/domain/dos-unsubscribe/contract.pdf')

    await service.unsubscribe({ dossierId: 'dos-unsubscribe' })

    expect(watchers[0]!.close).toHaveBeenCalledTimes(1)

    // Advance timers — debounced callback must NOT fire after unsubscribe
    await vi.advanceTimersByTimeAsync(500)
    expect(onDocumentsChanged).not.toHaveBeenCalled()
  })

  it('disposeAll closes every active watcher', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: WatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const service = createFileWatcherService({
      watchFactory,
      checkPathAccessible: vi.fn(async () => true)
    })

    await service.subscribe({
      dossierId: 'dos-a',
      dossierPath: '/tmp/domain/dos-a',
      onDocumentsChanged: vi.fn(),
      onAvailabilityChanged: vi.fn()
    })
    await service.subscribe({
      dossierId: 'dos-b',
      dossierPath: '/tmp/domain/dos-b',
      onDocumentsChanged: vi.fn(),
      onAvailabilityChanged: vi.fn()
    })

    await service.disposeAll()

    expect(watchers).toHaveLength(2)
    expect(watchers[0]!.close).toHaveBeenCalledTimes(1)
    expect(watchers[1]!.close).toHaveBeenCalledTimes(1)
  })

  it('publishes unavailability, retries, and recreates the watcher when the folder becomes accessible again', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: WatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const checkPathAccessible = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true) // subscribe: path accessible → watcher created
      .mockResolvedValueOnce(false) // first recovery poll: still unavailable
      .mockResolvedValueOnce(true) // second recovery poll: back online
    const onDocumentsChanged = vi.fn()
    const onAvailabilityChanged = vi.fn()

    const service = createFileWatcherService({
      recoveryPollIntervalMs: 2_000,
      watchFactory,
      checkPathAccessible
    })

    await service.subscribe({
      dossierId: 'dos-2',
      dossierPath: '/tmp/domain/dos-2',
      onDocumentsChanged,
      onAvailabilityChanged
    })

    watchers[0]!.emit('error', new Error('ENOENT: dossier disappeared'))
    await vi.runOnlyPendingTimersAsync()

    expect(onAvailabilityChanged).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dossierId: 'dos-2',
        status: 'unavailable'
      })
    )
    expect(watchers[0]!.close).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(checkPathAccessible).toHaveBeenCalledWith('/tmp/domain/dos-2')
    expect(watchFactory).toHaveBeenCalledTimes(2)
    expect(onAvailabilityChanged).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dossierId: 'dos-2',
        status: 'available'
      })
    )
    expect(onDocumentsChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        dossierId: 'dos-2',
        kind: 'documents-changed'
      })
    )
  })
})
