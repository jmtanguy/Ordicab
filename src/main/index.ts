/**
 * Main process entry point — the Node.js backend of the Electron application.
 *
 * This file owns the Electron-specific lifecycle only:
 *  - Bootstrap on `app.whenReady` via bootstrap.ts (testable)
 *  - Build the native menu and resolve filesystem paths to bundled resources
 *  - Wire the auto-updater so it can push state into the active window
 *  - Construct the AppContainer (services + handlers) via container.ts
 *
 * Service composition, AI mode lifecycle and IPC handler registration live in
 * `container.ts` so this file stays focused on Electron concerns and the
 * domain logic stays free of `electron` imports.
 */
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  safeStorage,
  session,
  shell,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'

import { IPC_CHANNELS, IpcErrorCode, type IpcError, type IpcResult } from '@shared/types'
import { bootstrapApplication } from './bootstrap'
import { createMainI18n } from './lib/i18n/i18nMain'
import { createDomainService } from './services/domain/domainService'
import { createEulaStore } from './lib/system/eulaStore'
import { createPendingUpdateStore, createUpdaterService } from './updater'
import { createMainWindow, createMainWindowLifecycle, type MainWindowLifecycle } from './window'
import { buildContainer, registerAllHandlers, type AppContainer } from './container'

const isDev = !app.isPackaged

// Set the app name before `whenReady` so macOS reads the correct name from
// the process as early as possible (affects the menu bar and About dialog).
app.setName('Ordicab')

/**
 * Converts an unknown thrown value into a typed IpcError so updater handlers
 * can return a consistent `{ success: false, error, code }` shape.
 */
function mapUnknownError(
  error: unknown,
  fallbackMessage: string,
  code: IpcErrorCode = IpcErrorCode.UNKNOWN
): IpcError {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    code
  }
}

/**
 * Builds and sets the native application menu.
 *
 * On macOS the first submenu becomes the "app menu" (leftmost, named after the
 * app). We include:
 *  - About  (native dialog)
 *  - standard hide/quit items
 *  - an Edit submenu so Copy/Paste/Undo keyboard shortcuts work in the renderer
 *
 * Role-based items (undo, cut, copy, paste, selectAll, hide, hideOthers,
 * unhide) are labelled and translated automatically by Electron/the OS.
 */
function buildApplicationMenu(i18n: { t(key: string): string }, dev: boolean): void {
  const appName = app.getName()

  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { label: i18n.t('menu.app_about'), role: 'about' },
        { type: 'separator' },
        { label: i18n.t('menu.app_hide'), role: 'hide' },
        { label: i18n.t('menu.app_hide_others'), role: 'hideOthers' },
        { label: i18n.t('menu.app_show_all'), role: 'unhide' },
        { type: 'separator' },
        {
          label: i18n.t('menu.app_quit'),
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: i18n.t('menu.edit'),
      submenu: [
        { label: i18n.t('menu.edit_undo'), role: 'undo' },
        { label: i18n.t('menu.edit_redo'), role: 'redo' },
        { type: 'separator' },
        { label: i18n.t('menu.edit_cut'), role: 'cut' },
        { label: i18n.t('menu.edit_copy'), role: 'copy' },
        { label: i18n.t('menu.edit_paste'), role: 'paste' },
        { label: i18n.t('menu.edit_select_all'), role: 'selectAll' }
      ]
    },
    ...(dev
      ? [
          {
            label: 'Dev',
            submenu: [{ role: 'toggleDevTools' as const }, { role: 'reload' as const }]
          }
        ]
      : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function resolveTessDataPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'tessdata')
  }

  const appPathCandidate = join(app.getAppPath(), 'resources', 'tessdata')

  if (existsSync(appPathCandidate)) {
    return appPathCandidate
  }

  return join(process.cwd(), 'resources', 'tessdata')
}

// Returns the directory transformers.js should treat as `localModelPath`.
// Every bundled model (NER, embeddings) lives under a single
// `resources/models/` root so the module-global `env.localModelPath` can
// resolve all of them through one claim — see modelRegistry.ts for why.
// Returns null when the bundle is absent (e.g. dev install without
// `npm run prepare:models`) so callers can fall back to remote downloads.
function resolveModelsPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'models')]
    : [join(app.getAppPath(), 'resources', 'models'), join(process.cwd(), 'resources', 'models')]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveAppIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png')
  }
  return join(app.getAppPath(), 'resources', 'icon.png')
}

app
  .whenReady()
  .then(async () => {
    const iconPath = resolveAppIconPath()

    // On macOS, set the Dock icon explicitly so the custom icon appears in dev
    // mode (where the process runs inside the Electron binary).
    if (existsSync(iconPath)) {
      app.dock?.setIcon(iconPath)
    }

    // Standard desktop-app behaviour: quit the app when the last window is
    // closed. No tray, no background mode.
    app.on('window-all-closed', () => {
      app.quit()
    })

    let mainWindowLifecycle: MainWindowLifecycle<BrowserWindow> | null = null
    let appContainer: AppContainer | null = null

    const mainI18n = await createMainI18n({
      stateFilePath: join(app.getPath('userData'), 'app-preferences.json'),
      preferredSystemLanguages:
        typeof app.getPreferredSystemLanguages === 'function'
          ? app.getPreferredSystemLanguages()
          : [app.getLocale()]
    })
    buildApplicationMenu(mainI18n, isDev)

    const stateFilePath = join(app.getPath('userData'), 'app-state.json')

    const updater = createUpdaterService({
      updater: autoUpdater,
      pendingUpdateStore: createPendingUpdateStore(
        join(app.getPath('userData'), 'pending-update.json')
      ),
      isPackaged: app.isPackaged,
      notifier: {
        status: (status) => {
          const window = mainWindowLifecycle?.getWindow()
          if (window && !window.isDestroyed()) {
            window.webContents.send(IPC_CHANNELS.updater.state, status)
          }
        },
        progress: (progress) => {
          const window = mainWindowLifecycle?.getWindow()
          if (!window || window.isDestroyed()) {
            return
          }
          window.webContents.send(IPC_CHANNELS.updater.progress, progress)
          const ratio = Math.max(0, Math.min(1, progress.percent / 100))
          window.setProgressBar(ratio)
          if (ratio >= 1) {
            window.setProgressBar(-1)
          }
        }
      }
    })

    ipcMain.handle(IPC_CHANNELS.updater.startDownload, async (): Promise<IpcResult<null>> => {
      try {
        await updater.startDownload()
        return { success: true, data: null }
      } catch (error) {
        return mapUnknownError(error, 'Unable to start update download.')
      }
    })
    ipcMain.handle(IPC_CHANNELS.updater.installNow, async (): Promise<IpcResult<null>> => {
      try {
        await updater.installNow()
        return { success: true, data: null }
      } catch (error) {
        return mapUnknownError(error, 'Unable to install update.')
      }
    })
    ipcMain.handle(IPC_CHANNELS.updater.installOnQuit, async (): Promise<IpcResult<null>> => {
      try {
        await updater.installOnQuit()
        return { success: true, data: null }
      } catch (error) {
        return mapUnknownError(error, 'Unable to schedule update on quit.')
      }
    })
    ipcMain.handle(IPC_CHANNELS.updater.dismiss, async (): Promise<IpcResult<null>> => {
      updater.dismiss()
      return { success: true, data: null }
    })

    // Tear down container resources on quit so dangling handles don't keep
    // the process alive.
    app.on('before-quit', () => {
      appContainer?.dispose()
    })

    await bootstrapApplication({
      createMainWindowLifecycle: () => {
        mainWindowLifecycle = createMainWindowLifecycle({
          createWindow: () =>
            createMainWindow({
              BrowserWindow,
              preloadPath: join(__dirname, '../preload/index.js'),
              rendererIndexPath: join(__dirname, '../renderer/index.html'),
              rendererUrl: isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
              platform: process.platform,
              linuxIconPath: iconPath,
              openExternal: (url: string) => {
                void shell.openExternal(url)
              },
              defaultSession: session.defaultSession
            })
        })

        return mainWindowLifecycle
      },
      createDomainService: () =>
        createDomainService({
          stateFilePath,
          openDirectoryDialog: async () => {
            const parentWindow = mainWindowLifecycle?.getWindow()
            const options: OpenDialogOptions = {
              title: mainI18n.t('dialog.select_domain_title'),
              properties: ['openDirectory', 'createDirectory']
            }

            if (parentWindow) {
              return dialog.showOpenDialog(parentWindow, options)
            }

            return dialog.showOpenDialog(options)
          }
        }),
      registerIpcHandlers: (domainService) => {
        appContainer = buildContainer({
          stateFilePath,
          tessDataPath: resolveTessDataPath(),
          modelsPath: resolveModelsPath(),
          domainService,
          mainI18n,
          safeStorage,
          getWebContents: () => mainWindowLifecycle?.getWindow()?.webContents ?? null
        })

        registerAllHandlers({
          container: appContainer,
          ipcMain,
          appName: app.getName(),
          appVersion: app.getVersion(),
          mainI18n,
          rebuildApplicationMenu: () => buildApplicationMenu(mainI18n, isDev),
          eulaStore: createEulaStore({
            stateFilePath,
            appContext: { isPackaged: app.isPackaged, getAppPath: () => app.getAppPath() }
          }),
          showOpenDialog: dialog.showOpenDialog,
          showSaveDialog: dialog.showSaveDialog,
          openExternal: (url) => shell.openExternal(url),
          openPath: (path) => shell.openPath(path),
          stateFilePath,
          getWebContents: () => mainWindowLifecycle?.getWindow()?.webContents ?? null
        })
      },
      onActivate: (listener) => {
        app.on('activate', listener)
      },
      updater
    })
  })
  .catch((error) => {
    console.error('[Main] Failed to bootstrap the Electron main process.', error)
    app.quit()
  })
