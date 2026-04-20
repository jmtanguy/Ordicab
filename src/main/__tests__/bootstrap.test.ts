import { describe, expect, it, vi } from 'vitest'

import type { DomainStatusSnapshot } from '@shared/types'

import { bootstrapApplication } from '../bootstrap'

function createDomainStatus(overrides: Partial<DomainStatusSnapshot> = {}): DomainStatusSnapshot {
  return {
    registeredDomainPath: null,
    isAvailable: false,
    dossierCount: 0,
    ...overrides
  }
}

describe('bootstrapApplication', () => {
  it('does not create the window lifecycle when a pending update is being installed', async () => {
    const createMainWindowLifecycle = vi.fn()
    const createDomainService = vi.fn()
    const registerIpcHandlers = vi.fn()

    const result = await bootstrapApplication({
      createMainWindowLifecycle,
      createDomainService,
      registerIpcHandlers,
      onActivate: vi.fn(),
      updater: {
        applyPendingUpdateOnLaunch: vi.fn(async () => true),
        checkForUpdatesOnStartup: vi.fn(async () => undefined)
      }
    })

    expect(result).toEqual({ started: false, installingUpdate: true })
    expect(createMainWindowLifecycle).not.toHaveBeenCalled()
    expect(createDomainService).not.toHaveBeenCalled()
    expect(registerIpcHandlers).not.toHaveBeenCalled()
  })

  it('keeps local-first startup working when the background update check fails offline', async () => {
    const showWindow = vi.fn()
    const domainService = {
      selectDomain: vi.fn(),
      getStatus: vi.fn(async () => createDomainStatus())
    }
    const createMainWindowLifecycle = vi.fn(() => ({
      getWindow: vi.fn(() => null),
      getOrCreateWindow: vi.fn(),
      showWindow
    }))
    const registerIpcHandlers = vi.fn()

    let activateListener: (() => void) | undefined

    await expect(
      bootstrapApplication({
        createMainWindowLifecycle,
        createDomainService: () => domainService,
        registerIpcHandlers,
        onActivate: (listener) => {
          activateListener = listener
        },
        updater: {
          applyPendingUpdateOnLaunch: vi.fn(async () => false),
          checkForUpdatesOnStartup: vi.fn(async () => {
            throw new Error('net::ERR_INTERNET_DISCONNECTED')
          })
        }
      })
    ).resolves.toEqual({ started: true, installingUpdate: false })

    await Promise.resolve()

    expect(registerIpcHandlers).toHaveBeenCalledWith(domainService)
    expect(showWindow).toHaveBeenCalledTimes(1)

    activateListener?.()
    expect(showWindow).toHaveBeenCalledTimes(2)
  })

  it('opens the main window on launch regardless of domain status', async () => {
    const showWindow = vi.fn()
    const domainService = {
      selectDomain: vi.fn(),
      getStatus: vi.fn(async () =>
        createDomainStatus({ registeredDomainPath: '/Users/jm/Cases', isAvailable: true })
      )
    }

    await bootstrapApplication({
      createMainWindowLifecycle: vi.fn(() => ({
        getWindow: vi.fn(() => null),
        getOrCreateWindow: vi.fn(),
        showWindow
      })),
      createDomainService: () => domainService,
      registerIpcHandlers: vi.fn(),
      onActivate: vi.fn(),
      updater: {
        applyPendingUpdateOnLaunch: vi.fn(async () => false),
        checkForUpdatesOnStartup: vi.fn(async () => undefined)
      }
    })

    await Promise.resolve()

    expect(showWindow).toHaveBeenCalledTimes(1)
  })
})
