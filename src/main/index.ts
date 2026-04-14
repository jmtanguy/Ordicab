/**
 * Main process entry point — the Node.js backend of the Electron application.
 *
 * Responsibilities:
 *  - Bootstrap the application on `app.whenReady` (see `bootstrap.ts`)
 *  - Instantiate every service (domain, dossier, document, templates, generate, updater…)
 *  - Register all IPC handlers so the renderer can call into Node.js APIs
 *  - Manage the system tray, main window lifecycle, and auto-updater
 *
 * Communication with the renderer:
 *  - Request/response:  ipcMain.handle ↔ ipcRenderer.invoke  (via preload/api.ts)
 *  - Push events:       webContents.send → ipcRenderer.on    (e.g. ordicab.dataChanged)
 *  - All channel names are defined in shared/types/api.ts (IPC_CHANNELS) so both
 *    sides share the same constants and TypeScript types.
 */
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  safeStorage,
  shell,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'

import {
  APP_LOCALES,
  AI_DELEGATED_MODES,
  IPC_CHANNELS,
  type AiMode,
  type AiSettingsSaveInput,
  type AppLocale,
  type AppLocaleInfo,
  IpcErrorCode,
  type AppVersionInfo,
  type IpcError,
  type IpcResult
} from '@shared/types'
import { resolveDefaultRemoteModel, type RemoteProviderKind } from '@shared/ai/remoteProviders'
import { bootstrapApplication } from './bootstrap'
import { createAiService } from './services/aiEmbedded/aiService'
import { createDocumentService } from './services/domain/documentService'
import { createDossierRegistryService } from './services/domain/dossierRegistryService'
import { registerAiHandlers } from './handlers/aiHandler'
import { registerInstructionsHandlers } from './handlers/instructionsHandler'
import { registerContactHandlers } from './handlers/contactHandler'
import { registerDossierHandlers } from './handlers/dossierHandler'
import { registerDossierTransferHandlers } from './handlers/dossierTransferHandler'
import { registerDocumentHandlers } from './handlers/documentHandler'
import { registerEntityHandlers } from './handlers/entityHandler'
import { registerGenerateHandlers } from './handlers/generateHandler'
import { registerTemplateHandlers, syncDocxTemplate } from './handlers/templateHandler'
import { createCredentialStore, type CredentialStore } from './lib/system/credentialStore'
import { createDelegatedOriginDeviceStore } from './lib/system/delegatedOriginDeviceStore'
import { createEulaStore, type EulaStore } from './lib/system/eulaStore'
import { createFileWatcherService } from './lib/ordicab/FileWatcherService'
import {
  createOrdicabDataWatcher,
  type OrdicabDataWatcherLike
} from './lib/ordicab/OrdicabDataWatcher'
import { createMainI18n } from './lib/i18n/i18nMain'
import { createTrayController, resolveTrayIconPath } from './tray'
import { createDomainService } from './services/domain/domainService'
import {
  createInstructionsGenerator,
  type InstructionsGeneratorLike
} from './lib/aiDelegated/aiDelegatedInstructionsGenerator'
import {
  createDelegatedAiActionProcessor,
  type DelegatedAiActionProcessorLike
} from './lib/aiDelegated/aiDelegatedActionProcessor'
import { createGenerateService } from './services/domain/generateService'
import { createContactService } from './services/domain/contactService'
import { createTemplateService } from './services/domain/templateService'
import { createDossierTransferService } from './services/domain/dossierTransferService'
import { createAiSdkAgentRuntime } from './lib/aiEmbedded/aiSdkAgentRuntime'
import { createOllamaSdkModel } from './lib/aiEmbedded/ollamaSdkProvider'
import { createOpenAiCompatibleSdkModel } from './lib/aiEmbedded/openAiCompatibleSdkProvider'
import { ensureOllamaRunning, type OllamaProcessManager } from './lib/aiEmbedded/ollamaProcess'
import { createInternalAICommandDispatcher } from './lib/aiEmbedded/aiCommandDispatcher'
import { createPendingUpdateStore, createUpdaterService } from './updater'
import { createMainWindow, createMainWindowLifecycle, type MainWindowLifecycle } from './window'

const isDev = !app.isPackaged

// Set the app name before `whenReady` so macOS reads the correct name from
// the process as early as possible (affects the menu bar and About dialog).
app.setName('Ordicab')

/**
 * Converts an unknown thrown value into a typed IpcError so every handler can
 * return a consistent `{ success: false, error, code }` shape to the renderer.
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
          label: i18n.t('tray.menu_quit_app'),
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

/** Type-guard: narrows a raw string to the union of supported AppLocale values. */
function isSupportedLocale(locale: string): locale is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(locale)
}

/**
 * Registers every ipcMain.handle channel.
 *
 * This function is the single place that wires the typed IPC_CHANNELS constants
 * (shared/types/api.ts) to their implementations in the various services.
 * Each domain area (app, domain, dossier, contact, entity, document, template,
 * generate, claudeMd) is handled either inline here for simple cases, or
 * delegated to a dedicated register*Handlers helper in ./handlers/.
 *
 * Called once during bootstrap, after all services are created.
 */
interface RegisterIpcHandlersOptions {
  aiService: ReturnType<typeof createAiService> | null
  webContents: { send(channel: string, ...args: unknown[]): void } | null
  eulaStore: EulaStore
}

function registerIpcHandlers(
  domainService: ReturnType<typeof createDomainService>,
  dossierService: ReturnType<typeof createDossierRegistryService>,
  dossierTransferService: ReturnType<typeof createDossierTransferService>,
  documentService: ReturnType<typeof createDocumentService>,
  fileWatcherService: ReturnType<typeof createFileWatcherService>,
  ordicabDataWatcher: OrdicabDataWatcherLike,
  delegatedIntentProcessor: DelegatedAiActionProcessorLike,
  instructionsGenerator: InstructionsGeneratorLike,
  generateService: ReturnType<typeof createGenerateService>,
  localeService: {
    getLocale(): AppLocale
    setLocale(locale: AppLocale): Promise<void>
  },
  credentialStore: CredentialStore,
  stateFilePath: string,
  getDelegatedEnabled: () => boolean,
  onAiModeChanged: (settings: AiSettingsSaveInput) => void,
  getActiveAiMode: () => AiMode,
  options: RegisterIpcHandlersOptions
): void {
  ipcMain.handle(IPC_CHANNELS.app.version, async (): Promise<IpcResult<AppVersionInfo>> => {
    return {
      success: true,
      data: {
        name: app.getName(),
        version: app.getVersion()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.app.getLocale, async (): Promise<IpcResult<AppLocaleInfo>> => {
    return {
      success: true,
      data: {
        locale: localeService.getLocale()
      }
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.app.setLocale,
    async (_event, input: { locale: string }): Promise<IpcResult<AppLocaleInfo>> => {
      if (!input || !isSupportedLocale(input.locale)) {
        return {
          success: false,
          error: 'Unsupported locale.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }

      try {
        await localeService.setLocale(input.locale)
        return {
          success: true,
          data: {
            locale: localeService.getLocale()
          }
        }
      } catch (error) {
        return mapUnknownError(
          error,
          'Unable to save app language.',
          IpcErrorCode.FILE_SYSTEM_ERROR
        )
      }
    }
  )

  // Security: only http/https URLs are forwarded to the OS browser — prevents
  // arbitrary protocol handlers (e.g. file://) from being invoked by the renderer.
  ipcMain.handle(
    IPC_CHANNELS.app.openExternal,
    async (_event, input: { url: string }): Promise<IpcResult<null>> => {
      let parsed: URL
      try {
        parsed = new URL(input.url)
      } catch {
        return { success: false, error: 'Invalid URL.', code: IpcErrorCode.INVALID_INPUT }
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return {
          success: false,
          error: 'Only http and https URLs are allowed.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }
      await shell.openExternal(input.url)
      return { success: true, data: null }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.openFolder,
    async (_event, input: { path: string }): Promise<IpcResult<null>> => {
      const error = await shell.openPath(input.path)

      if (error) {
        return {
          success: false,
          error,
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        }
      }

      return { success: true, data: null }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.eulaStatus,
    async (
      _event,
      input: { locale: string }
    ): Promise<IpcResult<{ required: boolean; version: string; content: string }>> => {
      if (!input || !isSupportedLocale(input.locale)) {
        return {
          success: false,
          error: 'Unsupported locale.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }

      try {
        return {
          success: true,
          data: await options.eulaStore.getStatus(input.locale)
        }
      } catch (error) {
        return mapUnknownError(error, 'Unable to load EULA status.', IpcErrorCode.FILE_SYSTEM_ERROR)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.eulaAccept,
    async (
      _event,
      input: { version: string; locale?: string }
    ): Promise<IpcResult<{ required: boolean; version: string; content: string }>> => {
      if (!input || typeof input.version !== 'string' || input.version.trim().length === 0) {
        return {
          success: false,
          error: 'Missing EULA version.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }

      const locale =
        typeof input.locale === 'string' && isSupportedLocale(input.locale) ? input.locale : 'en'

      try {
        return {
          success: true,
          data: await options.eulaStore.accept(input.version.trim(), locale)
        }
      } catch (error) {
        return mapUnknownError(
          error,
          'Unable to persist EULA acceptance.',
          IpcErrorCode.FILE_SYSTEM_ERROR
        )
      }
    }
  )

  // After a domain is selected, both the file watcher and the CLAUDE.md generator
  // are kicked off asynchronously so the renderer receives its response immediately.
  ipcMain.handle(
    IPC_CHANNELS.domain.select,
    async (): Promise<IpcResult<{ selectedPath: string | null }>> => {
      try {
        const result = await domainService.selectDomain()
        void ordicabDataWatcher.watchActiveDomain().catch((error) => {
          console.error(
            '[Main] Failed to start Ordicab data watcher after domain selection.',
            error
          )
        })
        if (getDelegatedEnabled()) {
          void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
            console.error(
              '[Main] Failed to start delegated intent processor after domain selection.',
              error
            )
          })
        }
        if (result.selectedPath) {
          void instructionsGenerator
            .generateForMode(result.selectedPath, getActiveAiMode())
            .catch((error) => {
              console.error(
                '[Main] Failed to generate instructions file after domain selection.',
                error
              )
            })
        }
        return { success: true, data: result }
      } catch (error) {
        return mapUnknownError(
          error,
          'Unable to initialize selected domain folder.',
          IpcErrorCode.FILE_SYSTEM_ERROR
        )
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.domain.status,
    async (): Promise<
      IpcResult<{ registeredDomainPath: string | null; isAvailable: boolean; dossierCount: number }>
    > => {
      try {
        const snapshot = await domainService.getStatus()
        void ordicabDataWatcher.watchActiveDomain().catch((error) => {
          console.error('[Main] Failed to sync Ordicab data watcher with domain status.', error)
        })
        if (getDelegatedEnabled()) {
          void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
            console.error(
              '[Main] Failed to sync delegated intent processor with domain status.',
              error
            )
          })
        }
        return { success: true, data: snapshot }
      } catch (error) {
        return mapUnknownError(
          error,
          'Unable to read domain status.',
          IpcErrorCode.FILE_SYSTEM_ERROR
        )
      }
    }
  )

  registerDossierHandlers({
    ipcMain,
    dossierService
  })

  registerDossierTransferHandlers({
    ipcMain,
    dossierTransferService
  })

  registerDocumentHandlers({
    ipcMain,
    documentService,
    fileWatcherService,
    openPath: (path) => shell.openPath(path)
  })

  registerContactHandlers({
    ipcMain,
    documentService
  })

  registerEntityHandlers({
    ipcMain,
    domainService
  })

  registerTemplateHandlers({
    ipcMain,
    domainService,
    showOpenDialog: dialog.showOpenDialog,
    openPath: (path) => shell.openPath(path)
  })

  registerGenerateHandlers({
    ipcMain,
    generateService
  })

  registerInstructionsHandlers({
    ipcMain,
    instructionsGenerator,
    documentService
  })

  registerAiHandlers({
    ipcMain,
    credentialStore,
    stateFilePath,
    onModeChanged: onAiModeChanged,
    aiService: options.aiService ?? undefined,
    webContents: options.webContents ?? undefined
  })
}

/**
 * Application startup — runs once after Electron signals the platform is ready.
 *
 * Sequence:
 *  1. Resolve tray icon path (platform-specific)
 *  2. Initialise i18n (reads persisted locale from userData/app-preferences.json)
 *  3. Create the auto-updater and file-watcher service (shared across the session)
 *  4. Call bootstrapApplication() which coordinates window, domain service, tray,
 *     IPC handlers, and update checks (see bootstrap.ts for the exact ordering)
 *  5. On startup, regenerate the domain-root CLAUDE.md so AI tooling always has
 *     an up-to-date project context file
 */
app
  .whenReady()
  .then(async () => {
    const iconPath = resolveTrayIconPath({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    })

    // On macOS, set the Dock icon explicitly so the custom icon appears in dev
    // mode (where the process runs inside the Electron binary).
    app.dock?.setIcon(iconPath)

    let mainWindowLifecycle: MainWindowLifecycle<BrowserWindow> | null = null
    const mainI18n = await createMainI18n({
      stateFilePath: join(app.getPath('userData'), 'app-preferences.json'),
      preferredSystemLanguages:
        typeof app.getPreferredSystemLanguages === 'function'
          ? app.getPreferredSystemLanguages()
          : [app.getLocale()]
    })
    buildApplicationMenu(mainI18n, isDev)
    let trayController: ReturnType<typeof createTrayController<Tray, Menu>> | null = null
    const stateFilePath = join(app.getPath('userData'), 'app-state.json')

    const updater = createUpdaterService({
      updater: autoUpdater,
      pendingUpdateStore: createPendingUpdateStore(
        join(app.getPath('userData'), 'pending-update.json')
      ),
      isPackaged: app.isPackaged
    })
    const fileWatcherService = createFileWatcherService()
    let ordicabDataWatcher: OrdicabDataWatcherLike | null = null
    let delegatedIntentProcessor: DelegatedAiActionProcessorLike | null = null
    let aiAgentRuntimeRef: ReturnType<typeof createAiSdkAgentRuntime> | null = null
    let ollamaProcessManager: OllamaProcessManager | null = null
    let ollamaLifecycleTask = Promise.resolve()

    // Tear down file watchers on quit to avoid dangling handles that could
    // prevent the process from exiting cleanly.
    app.on('before-quit', () => {
      void fileWatcherService.disposeAll()
      void ordicabDataWatcher?.dispose()
      void delegatedIntentProcessor?.dispose()
      aiAgentRuntimeRef?.dispose()
      ollamaProcessManager?.shutdown()
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
              }
            }),
          onBeforeQuit: (listener) => {
            app.on('before-quit', listener)
          }
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
        const credentialStore = createCredentialStore(safeStorage, stateFilePath)
        const dossierService = createDossierRegistryService({
          stateFilePath,
          now: () => new Date()
        })
        const tessDataPath = resolveTessDataPath()
        const documentService = createDocumentService({
          stateFilePath,
          tessDataPath
        })
        const generateService = createGenerateService({
          domainService,
          documentService
        })
        const delegatedOriginDeviceStore = createDelegatedOriginDeviceStore(stateFilePath)
        const instructionsGenerator = createInstructionsGenerator({
          domainService,
          documentService,
          delegatedOriginDeviceStore
        })
        const contactService = createContactService({ documentService })
        const dossierTransferService = createDossierTransferService({
          contactService,
          documentService,
          dossierService,
          getActiveLocale: () => mainI18n.getLocale(),
          getDomainPath: async () => {
            const status = await domainService.getStatus()
            if (!status.registeredDomainPath || !status.isAvailable) {
              throw new Error('Active domain is not configured.')
            }
            return status.registeredDomainPath
          }
        })
        const templateService = createTemplateService({ domainService })
        delegatedIntentProcessor = createDelegatedAiActionProcessor({
          domainService,
          dossierService,
          documentService,
          generateService,
          tessDataPath
        })

        // Keep delegated activation aligned with the shared delegated-mode list.
        // Reason: instructions already exist for Claude/Codex/Copilot, so the
        // queue processor must not silently stay disabled for some of them.
        let delegatedEnabled = false
        let currentAiMode: AiMode = 'claude-code'
        let ollamaEndpoint = 'http://localhost:11434'
        let remoteProvider: string | undefined
        let remoteProviderKind: RemoteProviderKind | undefined
        try {
          const raw = readFileSync(stateFilePath, 'utf8')
          const state = JSON.parse(raw) as {
            ai?: {
              mode?: string
              ollamaEndpoint?: string
              remoteProviderKind?: RemoteProviderKind
              remoteProvider?: string
            }
          }
          delegatedEnabled =
            typeof state?.ai?.mode === 'string' &&
            AI_DELEGATED_MODES.includes(state.ai.mode as AiMode)
          currentAiMode = (state?.ai?.mode as AiMode | undefined) ?? 'claude-code'
          if (typeof state?.ai?.ollamaEndpoint === 'string') {
            ollamaEndpoint = state.ai.ollamaEndpoint
          }
          if (typeof state?.ai?.remoteProvider === 'string') {
            remoteProvider = state.ai.remoteProvider
          }
          if (typeof state?.ai?.remoteProviderKind === 'string') {
            remoteProviderKind = state.ai.remoteProviderKind
          }
        } catch {
          // No state file yet -> default mode is 'local', delegated disabled
        }

        function syncOllamaProcess(
          previousMode: AiMode,
          previousEndpoint: string,
          nextMode: AiMode,
          nextEndpoint: string
        ): Promise<void> {
          ollamaLifecycleTask = ollamaLifecycleTask
            .catch(() => undefined)
            .then(async () => {
              const shouldRun = nextMode === 'local'
              const mustRestart = previousMode === 'local' && previousEndpoint !== nextEndpoint

              if (!shouldRun || mustRestart) {
                ollamaProcessManager?.shutdown()
                ollamaProcessManager = null
              }

              ollamaEndpoint = nextEndpoint

              if (!shouldRun) {
                return
              }

              ollamaProcessManager = await ensureOllamaRunning(ollamaEndpoint)
            })

          return ollamaLifecycleTask
        }

        // Auto-launch Ollama when the user has selected local mode, so
        // non-technical users don't have to start it manually.
        if (currentAiMode === 'local') {
          void syncOllamaProcess(currentAiMode, ollamaEndpoint, currentAiMode, ollamaEndpoint)
        }

        // Create AI runtime services
        const aiAgentRuntime = createAiSdkAgentRuntime({
          localLanguageModel: createOllamaSdkModel({
            baseUrl: ollamaEndpoint,
            model: 'mistral-nemo'
          })
        })

        const configureRemoteLanguageModel = async (requestedModel?: string): Promise<void> => {
          if (currentAiMode !== 'remote' || !remoteProvider) {
            aiAgentRuntime.setRemoteLanguageModel(null)
            return
          }

          const apiKey = await credentialStore.getApiKey('default')
          const model = requestedModel?.trim()
            ? requestedModel.trim()
            : resolveDefaultRemoteModel(remoteProvider, remoteProviderKind)
          aiAgentRuntime.setRemoteLanguageModel(
            createOpenAiCompatibleSdkModel({
              baseUrl: remoteProvider,
              apiKey: apiKey ?? '',
              model
            })
          )
        }

        // Initialise remote client asynchronously so we can decrypt the stored API key.
        if (currentAiMode === 'remote' && remoteProvider) {
          void configureRemoteLanguageModel().catch((error) => {
            console.error('[Main] Failed to initialize remote language model.', error)
          })
        }
        aiAgentRuntimeRef = aiAgentRuntime
        const intentDispatcher = createInternalAICommandDispatcher({
          contactService,
          templateService,
          generateService,
          dossierService,
          documentService
        })
        const aiService = createAiService({
          aiAgentRuntime,
          configureRemoteLanguageModel,
          intentDispatcher,
          contactService,
          templateService,
          dossierService,
          documentService,
          domainService,
          localeService: mainI18n,
          stateFilePath,
          tessDataPath
        })
        // OrdicabDataWatcher monitors the domain folder for file-system changes
        // and pushes IPC_CHANNELS.ordicab.dataChanged events to the renderer so
        // stores can refresh without polling.
        ordicabDataWatcher = createOrdicabDataWatcher({
          domainService,
          instructionsGenerator,
          listRegisteredDossiers: () => dossierService.listRegisteredDossiers(),
          getActiveAiMode: () => currentAiMode,
          onDataChanged: (event) => {
            const window = mainWindowLifecycle?.getWindow()

            if (window && !window.isDestroyed()) {
              window.webContents.send(IPC_CHANNELS.ordicab.dataChanged, event)
            }
          },
          onDocxTemplateChanged: (templateId) => {
            void (async () => {
              try {
                const domainStatus = await domainService.getStatus()

                if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
                  return
                }

                const result = await syncDocxTemplate(domainStatus.registeredDomainPath, templateId)

                if (!result) {
                  return
                }

                const window = mainWindowLifecycle?.getWindow()

                if (!window || window.isDestroyed()) {
                  return
                }

                window.webContents.send(IPC_CHANNELS.template.docxSynced, {
                  templateId,
                  html: result.html
                })
                window.webContents.send(IPC_CHANNELS.ordicab.dataChanged, {
                  dossierId: null,
                  type: 'templates',
                  changedAt: new Date().toISOString()
                })
              } catch (error) {
                console.error('[Main] Failed to sync docx template.', error)
              }
            })()
          }
        })

        void ordicabDataWatcher.watchActiveDomain().catch((error) => {
          console.error('[Main] Failed to initialize Ordicab data watcher.', error)
        })
        if (delegatedEnabled) {
          void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
            console.error('[Main] Failed to initialize delegated intent processor.', error)
          })
        }
        void (async () => {
          const domainStatus = await domainService.getStatus()

          if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
            return
          }

          const domainPath = domainStatus.registeredDomainPath
          await instructionsGenerator.generateForMode(domainPath, currentAiMode)
        })().catch((error) => {
          console.error('[Main] Failed to generate the domain instructions file on startup.', error)
        })

        registerIpcHandlers(
          domainService,
          dossierService,
          dossierTransferService,
          documentService,
          fileWatcherService,
          ordicabDataWatcher,
          delegatedIntentProcessor,
          instructionsGenerator,
          generateService,
          {
            getLocale: () => mainI18n.getLocale(),
            setLocale: async (locale) => {
              await mainI18n.setLocale(locale)
              trayController?.updateLabels(mainI18n.getTrayLabels())
            }
          },
          credentialStore,
          stateFilePath,
          () => delegatedEnabled,
          (settings: AiSettingsSaveInput) => {
            const nextMode = settings.mode
            const nextOllamaEndpoint = settings.ollamaEndpoint ?? 'http://localhost:11434'
            const previousMode = currentAiMode
            const previousOllamaEndpoint = ollamaEndpoint
            currentAiMode = nextMode
            ollamaEndpoint = nextOllamaEndpoint
            remoteProvider = settings.remoteProvider
            remoteProviderKind = settings.remoteProviderKind
            aiAgentRuntime.setLocalLanguageModel(
              createOllamaSdkModel({
                baseUrl: nextOllamaEndpoint,
                model: 'mistral-nemo'
              })
            )
            if (nextMode === 'remote' && settings.remoteProvider) {
              void configureRemoteLanguageModel().catch((error) => {
                console.error('[Main] Failed to configure remote language model.', error)
              })
            } else {
              aiAgentRuntime.setRemoteLanguageModel(null)
            }
            // Use the same delegated-mode check on runtime settings changes so
            // startup behavior and mode-switch behavior cannot drift apart.
            const shouldEnable = AI_DELEGATED_MODES.includes(nextMode)
            if (shouldEnable && !delegatedEnabled) {
              delegatedEnabled = true
              void delegatedIntentProcessor!.watchActiveDomain().catch((error) => {
                console.error(
                  '[Main] Failed to start delegated intent processor on mode change.',
                  error
                )
              })
            } else if (!shouldEnable && delegatedEnabled) {
              delegatedEnabled = false
              void delegatedIntentProcessor!.dispose().catch((error) => {
                console.error(
                  '[Main] Failed to stop delegated intent processor on mode change.',
                  error
                )
              })
            }
            void syncOllamaProcess(
              previousMode,
              previousOllamaEndpoint,
              nextMode,
              nextOllamaEndpoint
            ).catch((error) => {
              console.error('[Main] Failed to synchronize Ollama process on mode change.', error)
            })
            void instructionsGenerator.generateForMode(undefined, currentAiMode).catch((error) => {
              console.error('[Main] Failed to generate instructions file on mode change.', error)
            })
          },
          () => currentAiMode,
          {
            aiService,
            webContents: mainWindowLifecycle?.getWindow()?.webContents ?? null,
            eulaStore: createEulaStore(stateFilePath)
          }
        )
      },
      initTray: ({ openWindow, quit }) => {
        const trayIconFileName =
          process.platform === 'darwin' ? 'ordicab-logoTemplate.png' : 'icon.png'

        trayController = createTrayController({
          createTray: (trayIconPath) => {
            if (process.platform !== 'darwin') {
              return new Tray(trayIconPath)
            }

            const trayImage = nativeImage.createFromPath(trayIconPath)
            trayImage.setTemplateImage(true)
            return new Tray(trayImage)
          },
          buildMenu: (template) => Menu.buildFromTemplate(template as MenuItemConstructorOptions[]),
          isPackaged: app.isPackaged,
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          iconFileName: trayIconFileName,
          labels: mainI18n.getTrayLabels(),
          onOpenWindow: openWindow,
          onQuit: quit
        })

        return trayController.initTray()
      },
      onActivate: (listener) => {
        app.on('activate', listener)
      },
      onBeforeQuit: (listener) => {
        app.on('before-quit', listener)
      },
      quitApplication: () => {
        void fileWatcherService.disposeAll()
        void ordicabDataWatcher?.dispose()
        void delegatedIntentProcessor?.dispose()
        app.quit()
      },
      updater
    })
  })
  .catch((error) => {
    console.error('[Main] Failed to bootstrap the Electron main process.', error)
    app.quit()
  })
