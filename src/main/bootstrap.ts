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
 *  4. Show the main window.
 *  5. Kick off the background update check.
 */
import type { DomainSelectionResult, DomainStatusSnapshot } from '@shared/types'

import type { BrowserWindowLike, MainWindowLifecycle } from './window'

export interface DomainServiceLike {
  selectDomain(): Promise<DomainSelectionResult>
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface UpdaterServiceLike {
  applyPendingUpdateOnLaunch(): Promise<boolean>
  checkForUpdatesOnStartup(): Promise<void>
}

export interface BootstrapApplicationOptions<TWindow extends BrowserWindowLike> {
  createMainWindowLifecycle(): MainWindowLifecycle<TWindow>
  createDomainService(): DomainServiceLike
  registerIpcHandlers(domainService: DomainServiceLike): void
  onActivate(listener: () => void): void
  updater: UpdaterServiceLike
}

export interface BootstrapApplicationResult {
  started: boolean
  installingUpdate: boolean
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

  options.onActivate(() => {
    mainWindowLifecycle.showWindow()
  })

  mainWindowLifecycle.showWindow()

  void options.updater.checkForUpdatesOnStartup().catch(() => undefined)

  return { started: true, installingUpdate: false }
}
