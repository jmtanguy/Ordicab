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
      inferOrdicabDataChangeTarget(
        '/tmp/domain',
        '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json'
      )
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
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/Client Alpha/.ordicab/notes/n1.json')
    ).toEqual({
      dossierId: 'Client Alpha',
      type: 'dossier'
    })
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/registry.json')
    ).toEqual({
      dossierId: null,
      type: 'dossier'
    })
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/cabinet-billing.json')
    ).toEqual({
      dossierId: null,
      type: 'cabinet-billing'
    })
    expect(
      inferOrdicabDataChangeTarget('/tmp/domain', '/tmp/domain/.ordicab/general-key-dates/g1.json')
    ).toEqual({
      dossierId: null,
      type: 'general-key-dates'
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
      listRegisteredDossiers: vi.fn(async () => [
        { slug: 'Client Alpha' },
        { slug: 'Client Beta' }
      ]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json')
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
      listRegisteredDossiers: vi.fn(async () => [
        { slug: 'Client Alpha' },
        { slug: 'Client Beta' }
      ]),
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json')
    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json')

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

  it('watches deep enough to see dossier record directories (contacts live at depth 3)', async () => {
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => new FakeWatcher())
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    // <dossier>/.ordicab/contacts/*.json sits three levels below the domain
    // root; chokidar skips directory contents beyond `depth`, so anything
    // lower than 3 silently drops every contact/billing/key-date/note event.
    expect(watchFactory).toHaveBeenCalledWith('/tmp/domain', expect.objectContaining({ depth: 3 }))
  })

  it('emits a renderer event when a contact record is deleted externally', async () => {
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('unlink', '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json')

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

  it('emits renderer events for cabinet billing and general key dates without regenerating CLAUDE.md', async () => {
    const watchers: FakeWatcher[] = []
    const watchFactory: OrdicabDataWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const onDataChanged = vi.fn()
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/.ordicab/cabinet-billing.json')
    watchers[0]!.emit('add', '/tmp/domain/.ordicab/general-key-dates/g1.json')

    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()

    expect(onDataChanged).toHaveBeenCalledTimes(2)
    expect(onDataChanged).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId: null, type: 'cabinet-billing' })
    )
    expect(onDataChanged).toHaveBeenCalledWith(
      expect.objectContaining({ dossierId: null, type: 'general-key-dates' })
    )
    expect(instructionsGenerator.generateForMode).not.toHaveBeenCalled()
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
      onDataChanged,
      watchFactory
    })

    await watcher.watchDomain('/tmp/domain')

    watchers[0]!.emit('change', '/tmp/domain/Client Alpha/.ordicab/contacts/abc123.json')
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
      listRegisteredDossiers: vi.fn(async () => [{ slug: 'Client Alpha' }]),
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
