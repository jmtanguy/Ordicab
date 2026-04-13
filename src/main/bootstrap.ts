/**
 * Application bootstrap — orchestrates the startup sequence after Electron is ready.
 *
 * `bootstrapApplication` is the single entry-point called by index.ts. It is
 * deliberately free of Electron globals so that the logic can be unit-tested
 * without a real Electron environment (all platform dependencies are injected).
 *
 * Startup order:
 *  1. Check for a pending auto-update; if one is installing, bail out early.
 *  2. Create the main window lifecycle (window is NOT shown yet).
 *  3. Create the domain service and register all IPC handlers.
 *  4. Create the system tray.
 *  5. Decide whether to show the window immediately based on domain status:
 *       - No domain selected, or domain folder unavailable → show window (onboarding).
 *       - Domain is ready → stay in tray (background mode).
 *  6. Kick off the background update check.
 */
import type { DomainSelectionResult, DomainStatusSnapshot } from '@shared/types'

import type { BrowserWindowLike, MainWindowLifecycle } from './window'

export interface DomainServiceLike {
  selectDomain(): Promise<DomainSelectionResult>
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface TrayLike {
  destroy(): void
}

export interface UpdaterServiceLike {
  applyPendingUpdateOnLaunch(): Promise<boolean>
  checkForUpdatesOnStartup(): Promise<void>
}

export interface BootstrapHandlers {
  openWindow(): void
  quit(): void
}

export interface BootstrapApplicationOptions<TWindow extends BrowserWindowLike> {
  createMainWindowLifecycle(): MainWindowLifecycle<TWindow>
  createDomainService(): DomainServiceLike
  registerIpcHandlers(domainService: DomainServiceLike): void
  initTray(handlers: BootstrapHandlers): TrayLike
  onActivate(listener: () => void): void
  onBeforeQuit(listener: () => void): void
  quitApplication(): void
  updater: UpdaterServiceLike
}

export interface BootstrapApplicationResult {
  started: boolean
  installingUpdate: boolean
}

/**
 * The main window is hidden by default (app lives in the tray).
 * It is revealed only when the user has not yet configured a domain, or when
 * the previously registered domain folder is no longer accessible on disk.
 */
function shouldRevealMainWindow(snapshot: DomainStatusSnapshot): boolean {
  return snapshot.registeredDomainPath === null || !snapshot.isAvailable
}

export async function bootstrapApplication<TWindow extends BrowserWindowLike>(
  options: BootstrapApplicationOptions<TWindow>
): Promise<BootstrapApplicationResult> {
  const pendingUpdateIsInstalling = await options.updater.applyPendingUpdateOnLaunch()
  if (pendingUpdateIsInstalling) {
    return { started: false, installingUpdate: true }
  }

  const mainWindowLifecycle = options.createMainWindowLifecycle()
  const domainService = options.createDomainService()
  options.registerIpcHandlers(domainService)

  const tray = options.initTray({
    openWindow: () => {
      mainWindowLifecycle.showWindow()
    },
    quit: () => {
      mainWindowLifecycle.markQuitting()
      options.quitApplication()
    }
  })

  options.onActivate(() => {
    mainWindowLifecycle.showWindow()
  })

  options.onBeforeQuit(() => {
    tray.destroy()
  })

  void domainService
    .getStatus()
    .then((snapshot) => {
      if (shouldRevealMainWindow(snapshot)) {
        mainWindowLifecycle.showWindow()
      }
    })
    .catch((error) => {
      console.error(
        '[Bootstrap] Failed to read domain status; opening main window as fallback.',
        error
      )
      mainWindowLifecycle.showWindow()
    })

  void options.updater.checkForUpdatesOnStartup().catch(() => undefined)

  return { started: true, installingUpdate: false }
}
