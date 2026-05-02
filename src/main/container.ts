/**
 * Composition root — wires every domain service together and exposes a single
 * registration entry-point for the IPC handlers. Keeps `index.ts` focused on
 * the Electron lifecycle and dependency-resolution concerns that legitimately
 * need access to the `electron` module (BrowserWindow, app, autoUpdater…).
 *
 * Boundaries enforced by this module:
 *  - Services receive every external dependency through their `options` argument
 *    (no module-level singletons, no hidden state).
 *  - The AI mode lifecycle (mode, ollama endpoint, remote provider, delegated
 *    enabled) lives inside `buildContainer` as a closure so swapping the mode
 *    cannot leak through a top-level `let`.
 *  - Handlers are registered in one place via `registerAllHandlers` so the
 *    `IPC_CHANNELS` surface is fully visible in a single grep.
 *
 * Consumed by: `src/main/index.ts` only.
 */

import { readFileSync } from 'node:fs'

import {
  AI_DELEGATED_MODES,
  APP_LOCALES,
  IPC_CHANNELS,
  IpcErrorCode,
  type AiMode,
  type AiSettingsSaveInput,
  type AppLocale,
  type AppLocaleInfo,
  type AppVersionInfo,
  type IpcError,
  type IpcResult
} from '@shared/types'
import { resolveDefaultRemoteModel, type RemoteProviderKind } from '@shared/ai/remoteProviders'

import { createAiService, type AiService } from './services/aiEmbedded/aiService'
import { warmupNer } from './lib/aiEmbedded/pii/nerDetection'
import { warmupEmbeddings } from './lib/aiEmbedded/embeddings/embeddingService'
import { createDocumentService, type DocumentService } from './services/domain/documentService'
import {
  createDossierRegistryService,
  type DossierRegistryService
} from './services/domain/dossierRegistryService'
import { createGenerateService, type GenerateService } from './services/domain/generateService'
import { createContactService, type ContactService } from './services/domain/contactService'
import { createEntityService, type EntityService } from './services/domain/entityService'
import { createTemplateService, type TemplateService } from './services/domain/templateService'
import {
  createDossierTransferService,
  type DossierTransferService
} from './services/domain/dossierTransferService'
import { registerAiHandlers } from './handlers/aiHandler'
import { registerInstructionsHandlers } from './handlers/instructionsHandler'
import { registerContactHandlers } from './handlers/contactHandler'
import { registerDossierHandlers } from './handlers/dossierHandler'
import { registerDossierTransferHandlers } from './handlers/dossierTransferHandler'
import { registerDocumentHandlers } from './handlers/documentHandler'
import { registerEntityHandlers } from './handlers/entityHandler'
import { registerGenerateHandlers } from './handlers/generateHandler'
import { registerTemplateHandlers } from './handlers/templateHandler'
import { createCredentialStore, type CredentialStore } from './lib/system/credentialStore'
import { createDelegatedOriginDeviceStore } from './lib/system/delegatedOriginDeviceStore'
import { type EulaStore } from './lib/system/eulaStore'
import { createFileWatcherService, type FileWatcherService } from './lib/ordicab/FileWatcherService'
import {
  createOrdicabDataWatcher,
  type OrdicabDataWatcherLike
} from './lib/ordicab/OrdicabDataWatcher'
import { type DomainService } from './services/domain/domainService'
import {
  createInstructionsGenerator,
  type InstructionsGeneratorLike
} from './lib/aiDelegated/aiDelegatedInstructionsGenerator'
import {
  createDelegatedAiActionProcessor,
  type DelegatedAiActionProcessorLike
} from './lib/aiDelegated/aiDelegatedActionProcessor'
import { createAiSdkAgentRuntime } from './lib/aiEmbedded/aiSdkAgentRuntime'
import { createOllamaSdkModel } from './lib/aiEmbedded/ollamaSdkProvider'
import { createOpenAiCompatibleSdkModel } from './lib/aiEmbedded/openAiCompatibleSdkProvider'
import { ensureOllamaRunning, type OllamaProcessManager } from './lib/aiEmbedded/ollamaProcess'
import { createInternalAICommandDispatcher } from './lib/aiEmbedded/aiCommandDispatcher'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(buffer: Buffer): string
}

interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void
  isDestroyed?(): boolean
}

interface IpcSenderLike {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

interface MainI18nLike {
  getLocale(): AppLocale
  setLocale(locale: AppLocale): Promise<void>
  t(key: string): string
}

export interface BuildContainerOptions {
  stateFilePath: string
  tessDataPath: string
  modelsPath: string | null
  domainService: DomainService
  mainI18n: MainI18nLike
  safeStorage: SafeStorageLike
  /**
   * Resolves the active renderer WebContents. Returns null when no window is
   * attached (e.g. during shutdown). Used to push events for ordicab data
   * changes, docx template syncs and AI streaming tokens.
   */
  getWebContents: () => WebContentsLike | null | undefined
}

/**
 * Container hook that allows the host (`index.ts`) to react to AI-mode
 * changes without keeping its own copy of the mode state. The handler invokes
 * `applyModeChange` from inside the IPC settings-save listener.
 */
export interface AiLifecycle {
  getActiveMode(): AiMode
  getDelegatedEnabled(): boolean
  applyModeChange(settings: AiSettingsSaveInput): void
}

export interface AppContainer {
  domainService: DomainService
  dossierService: DossierRegistryService
  documentService: DocumentService
  contactService: ContactService
  entityService: EntityService
  templateService: TemplateService
  generateService: GenerateService
  dossierTransferService: DossierTransferService
  fileWatcherService: FileWatcherService
  ordicabDataWatcher: OrdicabDataWatcherLike
  delegatedIntentProcessor: DelegatedAiActionProcessorLike
  instructionsGenerator: InstructionsGeneratorLike
  credentialStore: CredentialStore
  aiService: AiService
  aiLifecycle: AiLifecycle
  /** Tear down all watchers and shut down the Ollama process if it was launched. */
  dispose(): void
}

interface PersistedAiState {
  mode: AiMode
  ollamaEndpoint: string
  remoteProvider: string | undefined
  remoteProviderKind: RemoteProviderKind | undefined
  delegatedEnabled: boolean
}

function readPersistedAiState(stateFilePath: string): PersistedAiState {
  let mode: AiMode = 'claude-code'
  let ollamaEndpoint = 'http://localhost:11434'
  let remoteProvider: string | undefined
  let remoteProviderKind: RemoteProviderKind | undefined
  let delegatedEnabled = false

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
    if (typeof state?.ai?.mode === 'string') {
      mode = state.ai.mode as AiMode
      delegatedEnabled = AI_DELEGATED_MODES.includes(mode)
    }
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
    // No state file yet -> defaults above remain.
  }

  return { mode, ollamaEndpoint, remoteProvider, remoteProviderKind, delegatedEnabled }
}

export function buildContainer(opts: BuildContainerOptions): AppContainer {
  const credentialStore = createCredentialStore(opts.safeStorage, opts.stateFilePath)

  const dossierService = createDossierRegistryService({
    stateFilePath: opts.stateFilePath,
    now: () => new Date()
  })

  // Kick off model load in the background so the first user prompt that
  // triggers pseudonymizeAsync() doesn't pay the cold-start cost. Failures
  // degrade silently to regex-only detection.
  if (opts.modelsPath) {
    void warmupNer({ enabled: true, modelPath: opts.modelsPath })
    void warmupEmbeddings({ modelPath: opts.modelsPath })
  }

  const documentService = createDocumentService({
    stateFilePath: opts.stateFilePath,
    tessDataPath: opts.tessDataPath,
    embeddingConfig: opts.modelsPath ? { modelPath: opts.modelsPath } : undefined
  })

  const generateService = createGenerateService({
    domainService: opts.domainService,
    documentService
  })

  const delegatedOriginDeviceStore = createDelegatedOriginDeviceStore(opts.stateFilePath)
  const instructionsGenerator = createInstructionsGenerator({
    domainService: opts.domainService,
    documentService,
    delegatedOriginDeviceStore
  })

  const contactService = createContactService({ documentService })
  const entityService = createEntityService({ domainService: opts.domainService })

  const dossierTransferService = createDossierTransferService({
    contactService,
    documentService,
    dossierService,
    getActiveLocale: () => opts.mainI18n.getLocale(),
    getDomainPath: async () => {
      const status = await opts.domainService.getStatus()
      if (!status.registeredDomainPath || !status.isAvailable) {
        throw new Error('Active domain is not configured.')
      }
      return status.registeredDomainPath
    },
    // Mirror the embedded assistant's PII configuration so an export
    // pseudonymizes the same tokens chats would. `ai.piiWordlist` lives in
    // the same state file aiService reads.
    getPiiWordlist: async () => {
      try {
        const raw = readFileSync(opts.stateFilePath, 'utf8')
        const parsed = JSON.parse(raw) as { ai?: { piiWordlist?: unknown } }
        const list = parsed?.ai?.piiWordlist
        return Array.isArray(list)
          ? list.filter((value): value is string => typeof value === 'string')
          : []
      } catch {
        return []
      }
    },
    nerModelPath: opts.modelsPath
  })

  const templateService = createTemplateService({ domainService: opts.domainService })

  const delegatedIntentProcessor = createDelegatedAiActionProcessor({
    domainService: opts.domainService,
    dossierService,
    documentService,
    generateService,
    tessDataPath: opts.tessDataPath
  })

  const fileWatcherService = createFileWatcherService()

  // ---- AI mode lifecycle (closure-encapsulated mutable state) ----
  const persisted = readPersistedAiState(opts.stateFilePath)
  let currentAiMode: AiMode = persisted.mode
  let ollamaEndpoint = persisted.ollamaEndpoint
  let remoteProvider: string | undefined = persisted.remoteProvider
  let remoteProviderKind: RemoteProviderKind | undefined = persisted.remoteProviderKind
  let delegatedEnabled = persisted.delegatedEnabled
  let ollamaProcessManager: OllamaProcessManager | null = null
  let ollamaLifecycleTask: Promise<void> = Promise.resolve()

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

  // Auto-launch Ollama when the user has selected local mode at startup.
  if (currentAiMode === 'local') {
    void syncOllamaProcess(currentAiMode, ollamaEndpoint, currentAiMode, ollamaEndpoint)
  }

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

  if (currentAiMode === 'remote' && remoteProvider) {
    void configureRemoteLanguageModel().catch((error) => {
      console.error('[Container] Failed to initialize remote language model.', error)
    })
  }

  const intentDispatcher = createInternalAICommandDispatcher({
    contactService,
    templateService,
    generateService,
    dossierService,
    documentService,
    getLocale: () => opts.mainI18n.getLocale()
  })

  const aiService = createAiService({
    aiAgentRuntime,
    configureRemoteLanguageModel,
    intentDispatcher,
    contactService,
    templateService,
    dossierService,
    documentService,
    domainService: opts.domainService,
    localeService: opts.mainI18n,
    stateFilePath: opts.stateFilePath,
    tessDataPath: opts.tessDataPath,
    nerModelPath: opts.modelsPath
  })

  const ordicabDataWatcher = createOrdicabDataWatcher({
    domainService: opts.domainService,
    instructionsGenerator,
    listRegisteredDossiers: () => dossierService.listRegisteredDossiers(),
    getActiveAiMode: () => currentAiMode,
    onDataChanged: (event) => {
      const window = opts.getWebContents()
      if (window && !(window.isDestroyed?.() ?? false)) {
        window.send(IPC_CHANNELS.ordicab.dataChanged, event)
      }
    },
    onDocxTemplateChanged: (templateId) => {
      void (async () => {
        try {
          const domainStatus = await opts.domainService.getStatus()
          if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
            return
          }

          const result = await templateService.syncDocx(templateId)
          if (!result) {
            return
          }

          const window = opts.getWebContents()
          if (!window || (window.isDestroyed?.() ?? false)) {
            return
          }

          window.send(IPC_CHANNELS.template.docxSynced, {
            templateId,
            html: result.html
          })
          window.send(IPC_CHANNELS.ordicab.dataChanged, {
            dossierId: null,
            type: 'templates',
            changedAt: new Date().toISOString()
          })
        } catch (error) {
          console.error('[Container] Failed to sync docx template.', error)
        }
      })()
    }
  })

  void ordicabDataWatcher.watchActiveDomain().catch((error) => {
    console.error('[Container] Failed to initialize Ordicab data watcher.', error)
  })
  if (delegatedEnabled) {
    void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
      console.error('[Container] Failed to initialize delegated intent processor.', error)
    })
  }
  // One-shot boot migration of legacy templates.json (inline content) — see
  // templateService.migrateLegacyTemplatesIfNeeded for shape and idempotency.
  // Deliberately fire-and-forget: the IPC list path stays a pure read.
  void templateService.migrateLegacyTemplatesIfNeeded().catch((error) => {
    console.error('[Container] Failed to migrate legacy templates on startup.', error)
  })
  void (async () => {
    const domainStatus = await opts.domainService.getStatus()
    if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
      return
    }
    await instructionsGenerator.generateForMode(domainStatus.registeredDomainPath, currentAiMode)
  })().catch((error) => {
    console.error('[Container] Failed to generate the domain instructions file on startup.', error)
  })

  const aiLifecycle: AiLifecycle = {
    getActiveMode: () => currentAiMode,
    getDelegatedEnabled: () => delegatedEnabled,
    applyModeChange: (settings) => {
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
          console.error('[Container] Failed to configure remote language model.', error)
        })
      } else {
        aiAgentRuntime.setRemoteLanguageModel(null)
      }
      // Use the same delegated-mode check on runtime settings changes so
      // startup behavior and mode-switch behavior cannot drift apart.
      const shouldEnable = AI_DELEGATED_MODES.includes(nextMode)
      if (shouldEnable && !delegatedEnabled) {
        delegatedEnabled = true
        void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
          console.error(
            '[Container] Failed to start delegated intent processor on mode change.',
            error
          )
        })
      } else if (!shouldEnable && delegatedEnabled) {
        delegatedEnabled = false
        void delegatedIntentProcessor.dispose().catch((error) => {
          console.error(
            '[Container] Failed to stop delegated intent processor on mode change.',
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
        console.error('[Container] Failed to synchronize Ollama process on mode change.', error)
      })
      void instructionsGenerator.generateForMode(undefined, currentAiMode).catch((error) => {
        console.error('[Container] Failed to generate instructions file on mode change.', error)
      })
    }
  }

  return {
    domainService: opts.domainService,
    dossierService,
    documentService,
    contactService,
    entityService,
    templateService,
    generateService,
    dossierTransferService,
    fileWatcherService,
    ordicabDataWatcher,
    delegatedIntentProcessor,
    instructionsGenerator,
    credentialStore,
    aiService,
    aiLifecycle,
    dispose: () => {
      void fileWatcherService.disposeAll()
      void ordicabDataWatcher.dispose()
      void delegatedIntentProcessor.dispose()
      aiAgentRuntime.dispose()
      ollamaProcessManager?.shutdown()
    }
  }
}

// ── Handler registration ────────────────────────────────────────────────────

function isSupportedLocale(locale: string): locale is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(locale)
}

function mapUnknownError(
  error: unknown,
  fallbackMessage: string,
  code: IpcErrorCode = IpcErrorCode.UNKNOWN
): IpcError {
  // Typed service errors carry their own IpcErrorCode — surface it instead of
  // collapsing every failure to the fallback code.
  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    Object.values(IpcErrorCode).includes((error as { code: string }).code as IpcErrorCode)
  ) {
    return {
      success: false,
      error: error.message,
      code: (error as { code: string }).code as IpcErrorCode
    }
  }
  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    code
  }
}

export interface RegisterAllHandlersOptions {
  container: AppContainer
  ipcMain: IpcMainLike
  appName: string
  appVersion: string
  mainI18n: MainI18nLike
  /** Called after a locale change so the native menu picks up the new strings. */
  rebuildApplicationMenu: () => void
  eulaStore: EulaStore
  showOpenDialog: typeof Electron.dialog.showOpenDialog
  showSaveDialog: typeof Electron.dialog.showSaveDialog
  openExternal: (url: string) => Promise<void>
  openPath: (path: string) => Promise<string>
  stateFilePath: string
  /** Resolves the active renderer WebContents for AI streaming events. */
  getWebContents: () => WebContentsLike | null | undefined
}

export function registerAllHandlers(opts: RegisterAllHandlersOptions): void {
  const { container, ipcMain, mainI18n } = opts

  ipcMain.handle(IPC_CHANNELS.app.version, async (): Promise<IpcResult<AppVersionInfo>> => {
    return {
      success: true,
      data: { name: opts.appName, version: opts.appVersion }
    }
  })

  ipcMain.handle(IPC_CHANNELS.app.getLocale, async (): Promise<IpcResult<AppLocaleInfo>> => {
    return { success: true, data: { locale: mainI18n.getLocale() } }
  })

  ipcMain.handle(
    IPC_CHANNELS.app.setLocale,
    async (_event, input: unknown): Promise<IpcResult<AppLocaleInfo>> => {
      const value = input as { locale?: unknown } | null | undefined
      if (!value || typeof value.locale !== 'string' || !isSupportedLocale(value.locale)) {
        return { success: false, error: 'Unsupported locale.', code: IpcErrorCode.INVALID_INPUT }
      }
      try {
        await mainI18n.setLocale(value.locale)
        opts.rebuildApplicationMenu()
        return { success: true, data: { locale: mainI18n.getLocale() } }
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
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      const value = input as { url?: unknown } | null | undefined
      if (!value || typeof value.url !== 'string') {
        return { success: false, error: 'Invalid URL.', code: IpcErrorCode.INVALID_INPUT }
      }
      let parsed: URL
      try {
        parsed = new URL(value.url)
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
      await opts.openExternal(value.url)
      return { success: true, data: null }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.openFolder,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      const value = input as { path?: unknown } | null | undefined
      if (!value || typeof value.path !== 'string' || value.path.length === 0) {
        return { success: false, error: 'Invalid path.', code: IpcErrorCode.INVALID_INPUT }
      }
      const { resolve, isAbsolute, extname } = await import('node:path')
      const { stat } = await import('node:fs/promises')
      if (!isAbsolute(value.path)) {
        return { success: false, error: 'Path must be absolute.', code: IpcErrorCode.INVALID_INPUT }
      }
      const resolvedTarget = resolve(value.path)
      let stats: Awaited<ReturnType<typeof stat>>
      try {
        stats = await stat(resolvedTarget)
      } catch {
        return { success: false, error: 'Path does not exist.', code: IpcErrorCode.NOT_FOUND }
      }
      if (!stats.isDirectory()) {
        // Files are restricted to a small allowlist of document formats so the
        // renderer cannot ask the OS to launch arbitrary executables/scripts.
        const SAFE_FILE_EXTENSIONS = new Set([
          '.docx',
          '.doc',
          '.dotx',
          '.pdf',
          '.txt',
          '.md',
          '.html',
          '.htm',
          '.rtf',
          '.odt',
          '.xlsx',
          '.xls',
          '.pptx',
          '.ppt',
          '.csv'
        ])
        const ext = extname(resolvedTarget).toLowerCase()
        if (!SAFE_FILE_EXTENSIONS.has(ext)) {
          return {
            success: false,
            error: 'File type is not allowed.',
            code: IpcErrorCode.INVALID_INPUT
          }
        }
      }
      const error = await opts.openPath(resolvedTarget)
      if (error) {
        return { success: false, error, code: IpcErrorCode.FILE_SYSTEM_ERROR }
      }
      return { success: true, data: null }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.eulaStatus,
    async (
      _event,
      input: unknown
    ): Promise<IpcResult<{ required: boolean; version: string; content: string }>> => {
      const value = input as { locale?: unknown } | null | undefined
      if (!value || typeof value.locale !== 'string' || !isSupportedLocale(value.locale)) {
        return { success: false, error: 'Unsupported locale.', code: IpcErrorCode.INVALID_INPUT }
      }
      try {
        return { success: true, data: await opts.eulaStore.getStatus(value.locale) }
      } catch (error) {
        return mapUnknownError(error, 'Unable to load EULA status.', IpcErrorCode.FILE_SYSTEM_ERROR)
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.app.eulaAccept,
    async (
      _event,
      input: unknown
    ): Promise<IpcResult<{ required: boolean; version: string; content: string }>> => {
      const value = input as { version?: unknown; locale?: unknown } | null | undefined
      if (!value || typeof value.version !== 'string' || value.version.trim().length === 0) {
        return { success: false, error: 'Missing EULA version.', code: IpcErrorCode.INVALID_INPUT }
      }
      const locale =
        typeof value.locale === 'string' && isSupportedLocale(value.locale) ? value.locale : 'en'
      try {
        return { success: true, data: await opts.eulaStore.accept(value.version.trim(), locale) }
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
        const result = await container.domainService.selectDomain()
        void container.ordicabDataWatcher.watchActiveDomain().catch((error) => {
          console.error(
            '[Main] Failed to start Ordicab data watcher after domain selection.',
            error
          )
        })
        if (container.aiLifecycle.getDelegatedEnabled()) {
          void container.delegatedIntentProcessor.watchActiveDomain().catch((error) => {
            console.error(
              '[Main] Failed to start delegated intent processor after domain selection.',
              error
            )
          })
        }
        if (result.selectedPath) {
          void container.instructionsGenerator
            .generateForMode(result.selectedPath, container.aiLifecycle.getActiveMode())
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
        const snapshot = await container.domainService.getStatus()
        void container.ordicabDataWatcher.watchActiveDomain().catch((error) => {
          console.error('[Main] Failed to sync Ordicab data watcher with domain status.', error)
        })
        if (container.aiLifecycle.getDelegatedEnabled()) {
          void container.delegatedIntentProcessor.watchActiveDomain().catch((error) => {
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

  registerDossierHandlers({ ipcMain, dossierService: container.dossierService })

  registerDossierTransferHandlers({
    ipcMain,
    dossierTransferService: container.dossierTransferService
  })

  registerDocumentHandlers({
    ipcMain,
    documentService: container.documentService,
    fileWatcherService: container.fileWatcherService,
    openPath: opts.openPath
  })

  registerContactHandlers({ ipcMain, contactService: container.contactService })

  registerEntityHandlers({ ipcMain, entityService: container.entityService })

  registerTemplateHandlers({
    ipcMain,
    templateService: container.templateService,
    showOpenDialog: opts.showOpenDialog,
    openPath: opts.openPath
  })

  registerGenerateHandlers({ ipcMain, generateService: container.generateService })

  registerInstructionsHandlers({
    ipcMain,
    instructionsGenerator: container.instructionsGenerator,
    documentService: container.documentService
  })

  registerAiHandlers({
    ipcMain,
    credentialStore: container.credentialStore,
    stateFilePath: opts.stateFilePath,
    onModeChanged: (settings) => container.aiLifecycle.applyModeChange(settings),
    aiService: container.aiService,
    getWebContents: () => opts.getWebContents() ?? null
  })
}
