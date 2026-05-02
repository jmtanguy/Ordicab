import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createOrdicabDataWatcher,
  inferOrdicabDataChangeTarget,
  type OrdicabDataFileWatcherLike,
  type OrdicabDataWatchFactory
} from '../OrdicabDataWatcher'

class FakeWatcher extends EventEmitter implements OrdicabDataFileWatcherLike {
  close = vi.fn(async () => undefined)
}

describe('OrdicabDataWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('infers typed renderer refresh targets from watched .ordicab files', () => {
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/Client Alpha/.ordicab/contacts.json')
    ).toEqual({
      dossierId: 'Client Alpha',
      type: 'contacts'
    })
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/Client Alpha/.ordicab/dossier.json')
    ).toEqual({
      dossierId: 'Client Alpha',
      type: 'dossier'
    })
    expect(inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/entity.json')).toEqual(
      {
        dossierId: null,
        type: 'entity'
      }
    )
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/templates.json')
    ).toEqual({
      dossierId: null,
      type: 'templates'
    })
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/unknown.json')
    ).toBeNull()
    expect(
      inferOrdicabDataChangeTarget(
        '/tmp/domain',
        '/tmp/domain/.ordicab-delegated/inbox/intent.json'
      )
    ).toBeNull()
  })

  it('does not regenerate CLAUDE.md for dossier-scoped metadata changes', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }, { id: 'Client Beta' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts.json')
    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/dossier.json')

    await vi.advanceTimersByTimeAsync(499)
    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()
  })

  it('regenerates only the domain-root CLAUDE.md when a domain-scoped file changes', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 2
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }, { id: 'Client Beta' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/.ordicab/templates.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateForMode).toHaveBeenCalledWith('/tmp/domain', 'claude-code')
  })

  it('does not regenerate CLAUDE.md when only dossier metadata files change', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('add', '/tmp/domain/Client Alpha/.ordicab/dossier.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()
  })

  it('ignores delegated queue files outside the canonical .ordicab paths', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/.ordicab-delegated/inbox/intent-1.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()
  })

  it('ignores unrelated internal .ordicab files that do not affect generated CLAUDE.md content', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/.ordicab/preferences.json')
    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/cache.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()
  })

  it('does not regenerate CLAUDE.md when dossier documents change', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn()
    }
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator,
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/hearing-notes.txt')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).not.toHaveBeenCalled()
  })

  it('emits debounced typed ordicab data-changed events for renderer refreshes', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const onDataChanged = vi.fn()
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator: {
        generateDossier: vi.fn(async () => undefined),
        generateDomainRoot: vi.fn(async () => undefined),
        generateForMode: vi.fn(async () => undefined),
        getStatus: vi.fn()
      },
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts.json')
    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(onDataChanged).toHaveBeenCalledTimes(1)
    expect(onDataChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        dossierId: 'Client Alpha',
        type: 'contacts'
      })
    )
  })

  it('flushes queued dossier and domain refresh events together when a domain change supersedes dossier timers', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const onDataChanged = vi.fn()
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      instructionsGenerator: {
        generateDossier: vi.fn(async () => undefined),
        generateDomainRoot: vi.fn(async () => undefined),
        generateForMode: vi.fn(async () => undefined),
        getStatus: vi.fn()
      },
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts.json')
    watchers[0]!.emit('change', '/tmp/domain/.ordicab/templates.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(onDataChanged).toHaveBeenCalledTimes(2)
    expect(onDataChanged).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        dossierId: null,
        type: 'templates'
      })
    )
    expect(onDataChanged).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        dossierId: 'Client Alpha',
        type: 'contacts'
      })
    )
  })

  it('logs watcher and regeneration errors without throwing', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const logError = vi.fn()
    const watcher = createOrdicabDataWatcher({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: true,
          dossierCount: 1
        }))
      },
      listRegisteredDossiers: vi.fn(async () => [{ id: 'Client Alpha' }]),
      instructionsGenerator: {
        generateDossier: vi.fn(async () => {
          throw new Error('disk full')
        }),
        generateDomainRoot: vi.fn(async () => undefined),
        generateForMode: vi.fn(async () => {
          throw new Error('disk full')
        }),
        getStatus: vi.fn()
      },
      logError,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('error', new Error('watch failed'))
    watchers[0]!.emit('change', '/tmp/domain/.ordicab/templates.json')
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(logError).toHaveBeenCalledWith(
      '[OrdicabDataWatcher] File watching error.',
      expect.any(Error)
    )
    expect(logError).toHaveBeenCalledWith(
      '[OrdicabDataWatcher] Unexpected regeneration failure.',
      expect.any(Error)
    )
  })

  it('replaces the watcher when the active domain changes and disposes cleanly', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const domainService = {
      getStatus: vi
        .fn<
          () => Promise<{
            registeredDomainPath: string | null
            isAvailable: boolean
            dossierCount: number
          }>
        >()
        .mockResolvedValueOnce({
          registeredDomainPath: '/tmp/domain-a',
          isAvailable: true,
          dossierCount: 1
        })
        .mockResolvedValueOnce({
          registeredDomainPath: '/tmp/domain-b',
          isAvailable: true,
          dossierCount: 2
        })
    }
    const watcher = createOrdicabDataWatcher({
      domainService,
      instructionsGenerator: {
        generateDossier: vi.fn(async () => undefined),
        generateDomainRoot: vi.fn(async () => undefined),
        generateForMode: vi.fn(async () => undefined),
        getStatus: vi.fn()
      },
      listRegisteredDossiers: vi.fn(async () => []),
      watchFactory
    })

    await watcher.watchActiveDomain()
    await watcher.watchActiveDomain()

    expect(watchers).toHaveLength(2)
    expect(watchers[0]!.close).toHaveBeenCalledTimes(1)

    await watcher.dispose()
    expect(watchers[1]!.close).toHaveBeenCalledTimes(1)
  })
})
