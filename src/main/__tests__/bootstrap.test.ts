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
  it('does not create the tray or window lifecycle when a pending update is being installed', async () => {
    const createMainWindowLifecycle = vi.fn()
    const createDomainService = vi.fn()
    const registerIpcHandlers = vi.fn()
    const initTray = vi.fn()

    const result = await bootstrapApplication({
      createMainWindowLifecycle,
      createDomainService,
      registerIpcHandlers,
      initTray,
      onActivate: vi.fn(),
      onBeforeQuit: vi.fn(),
      quitApplication: vi.fn(),
      updater: {
        applyPendingUpdateOnLaunch: vi.fn(async () => true),
        checkForUpdatesOnStartup: vi.fn(async () => undefined)
      }
    })

    expect(result).toEqual({ started: false, installingUpdate: true })
    expect(createMainWindowLifecycle).not.toHaveBeenCalled()
    expect(createDomainService).not.toHaveBeenCalled()
    expect(registerIpcHandlers).not.toHaveBeenCalled()
    expect(initTray).not.toHaveBeenCalled()
  })

  it('keeps local-first startup working when the background update check fails offline', async () => {
    const showWindow = vi.fn()
    const markQuitting = vi.fn()
    const domainService = {
      selectDomain: vi.fn(),
      getStatus: vi.fn(async () => createDomainStatus())
    }
    const createMainWindowLifecycle = vi.fn(() => ({
      getWindow: vi.fn(() => null),
      getOrCreateWindow: vi.fn(),
      showWindow,
      hideWindow: vi.fn(),
      markQuitting
    }))
    const registerIpcHandlers = vi.fn()
    const quitApplication = vi.fn()
    const tray = { destroy: vi.fn() }

    let activateListener: (() => void) | undefined
    let beforeQuitListener: (() => void) | undefined
    let quitHandler: (() => void) | undefined

    await expect(
      bootstrapApplication({
        createMainWindowLifecycle,
        createDomainService: () => domainService,
        registerIpcHandlers,
        initTray: (handlers) => {
          quitHandler = handlers.quit
          return tray
        },
        onActivate: (listener) => {
          activateListener = listener
        },
        onBeforeQuit: (listener) => {
          beforeQuitListener = listener
        },
        quitApplication,
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
    expect(domainService.getStatus).toHaveBeenCalledTimes(1)
    expect(showWindow).toHaveBeenCalledTimes(1)

    activateListener?.()
    expect(showWindow).toHaveBeenCalledTimes(2)

    quitHandler?.()
    expect(markQuitting).toHaveBeenCalledTimes(1)
    expect(quitApplication).toHaveBeenCalledTimes(1)

    beforeQuitListener?.()
    expect(tray.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not open the main window when a domain is registered and available (tray-silent launch)', async () => {
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
        showWindow,
        hideWindow: vi.fn(),
        markQuitting: vi.fn()
      })),
      createDomainService: () => domainService,
      registerIpcHandlers: vi.fn(),
      initTray: vi.fn(() => ({ destroy: vi.fn() })),
      onActivate: vi.fn(),
      onBeforeQuit: vi.fn(),
      quitApplication: vi.fn(),
      updater: {
        applyPendingUpdateOnLaunch: vi.fn(async () => false),
        checkForUpdatesOnStartup: vi.fn(async () => undefined)
      }
    })

    await Promise.resolve()

    expect(showWindow).not.toHaveBeenCalled()
  })
})
