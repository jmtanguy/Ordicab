/**
 * Composition root — wires every domain service together and exposes a single
 * registration entry-point for the IPC handlers. Keeps `index.ts` focused on
 * the Electron lifecycle and dependency-resolution concerns that legitimately
 * need access to the `electron` module (BrowserWindow, app, autoUpdater…).
 *
 * Boundaries enforced by this module:
 *  - Services receive every external dependency through their `options` argument
 *    (no module-level singletons, no hidden state).
 *  - The AI mode lifecycle (mode, remote provider, delegated enabled) lives
 *    inside `buildContainer` as a closure so swapping the mode cannot leak
 *    through a top-level `let`.
 *  - Handlers are registered in one place via `registerAllHandlers` so the
 *    `IPC_CHANNELS` surface is fully visible in a single grep.
 *
 * Consumed by: `src/main/index.ts` only.
 */

import { readFileSync } from 'node:fs'

import {
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
import {
  createTemplateTagifyService,
  type TemplateTagifyService
} from './services/aiEmbedded/templateTagifyService'
import {
  createIndexingQueueService,
  walkExtractableDocuments,
  type IndexingQueueService
} from './services/aiEmbedded/indexingQueueService'
import { awaitInferenceDrain } from './lib/aiEmbedded/modelRegistry'
import {
  createEmbeddingWorkerClient,
  type EmbeddingWorkerClient
} from './lib/aiEmbedded/embeddings/embeddingWorkerClient'
import type { EmbeddingServiceConfig } from './lib/aiEmbedded/embeddings/embeddingService'
import { isModelPresent, EMBEDDING_MODEL } from './lib/aiEmbedded/modelDownloadService'
import { createDocumentService, type DocumentService } from './services/domain/documentService'
import { indexNoteEmbeddings, searchNotes } from './services/aiEmbedded/noteSearchService'
import {
  createCabinetBillingService,
  type CabinetBillingService
} from './services/domain/cabinetBillingService'
import {
  createDossierRegistryService,
  type DossierRegistryService
} from './services/domain/dossierRegistryService'
import { createGenerateService, type GenerateService } from './services/domain/generateService'
import { createInvoiceService, type InvoiceService } from './services/domain/invoiceService'
import {
  createRedactionSessionService,
  parseRedactionConversationId,
  type RedactionSessionService
} from './services/domain/redactionSessionService'
import { registerRedactionHandlers } from './handlers/redactionHandler'
import {
  createAjOrchestrationService,
  type AjOrchestrationService
} from './services/domain/ajOrchestrationService'
import {
  createConflictCheckService,
  type ConflictCheckService
} from './services/domain/conflictCheckService'
import { createContactService, type ContactService } from './services/domain/contactService'
import { createEntityService, type EntityService } from './services/domain/entityService'
import { createPiecesService, type PiecesService } from './services/domain/pieces/piecesService'
import {
  createComparisonService,
  type ComparisonService
} from './services/domain/compare/comparisonService'
import { createTemplateService, type TemplateService } from './services/domain/templateService'
import { AI_REMOTE_API_KEY_SECRET, registerAiHandlers } from './handlers/aiHandler'
import { registerCoworkHandlers } from './handlers/coworkHandler'
import {
  createCoworkExportService,
  type CoworkExportService
} from './services/domain/coworkExportService'
import { registerCabinetBillingHandlers } from './handlers/cabinetBillingHandler'
import { registerCalendarSyncHandlers } from './handlers/calendarSyncHandler'
import {
  createCalendarSyncService,
  type CalendarSyncService
} from './services/domain/calendarSyncService'
import { registerInvoiceHandlers } from './handlers/invoiceHandler'
import { registerInstructionsHandlers } from './handlers/instructionsHandler'
import { registerContactHandlers } from './handlers/contactHandler'
import { registerDossierHandlers } from './handlers/dossierHandler'
import { registerDocumentHandlers } from './handlers/documentHandler'
import { registerEntityHandlers } from './handlers/entityHandler'
import { registerGenerateHandlers } from './handlers/generateHandler'
import { registerIndexingHandlers } from './handlers/indexingHandler'
import { registerLegalHandlers } from './handlers/legalHandler'
import { registerPiecesHandlers } from './handlers/piecesHandler'
import { registerCompareHandlers } from './handlers/compareHandler'
import { registerTemplateHandlers } from './handlers/templateHandler'
import { createAppStateStore, type AppStateStore } from './lib/system/appStateStore'
import { createCredentialStore, type CredentialStore } from './lib/system/credentialStore'
import { createDelegatedOriginDeviceStore } from './lib/system/delegatedOriginDeviceStore'
import { type EulaStore } from './lib/system/eulaStore'
import { createFileWatcherService, type FileWatcherService } from './lib/ordicab/FileWatcherService'
import {
  createOrdicabDataWatcher,
  type OrdicabDataWatcherLike
} from './lib/ordicab/OrdicabDataWatcher'
import { type DomainService } from './services/domain/domainService'
import { createLegalService, type LegalService } from './services/legal/legalService'
import {
  createInstructionsGenerator,
  type InstructionsGeneratorLike
} from './lib/aiDelegated/aiDelegatedInstructionsGenerator'
import {
  createDelegatedAiActionProcessor,
  type DelegatedAiActionProcessorLike
} from './lib/aiDelegated/aiDelegatedActionProcessor'
import { createAiSdkAgentRuntime } from './lib/aiEmbedded/aiSdkAgentRuntime'
import { createOpenAiCompatibleSdkModel } from './lib/aiEmbedded/openAiCompatibleSdkProvider'
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
  /**
   * Renders an HTML string to PDF written at `outputPath`. Implemented by the
   * host (`index.ts`) via Electron's BrowserWindow + webContents.printToPDF.
   * Optional — when absent, on-demand PDF generation throws.
   */
  printHtmlToPdf?: (html: string, outputPath: string) => Promise<void>
  /**
   * Converts a DOCX file to a layout-faithful PDF written at `outputPath`.
   * Implemented by the host via the hidden docx-preview window
   * (lib/printing/docx2pdfWindow.ts). Optional — when absent, DOCX→PDF
   * conversion throws.
   */
  docxToPdf?: (docxAbsolutePath: string, outputPath: string) => Promise<void>
  /**
   * Absolute path to the compiled embedding worker bundle emitted by
   * electron-vite alongside the main entry. The indexing queue posts batches
   * to this worker so ONNX inference doesn't block the main thread. When
   * omitted (or unreadable), indexing falls back to the in-process embedder
   * which DOES freeze the UI during long catch-ups — set this in production.
   */
  embeddingWorkerPath?: string
}

/**
 * Container hook that allows the host (`index.ts`) to react to AI-mode
 * changes without keeping its own copy of the mode state. The handler invokes
 * `applyModeChange` from inside the IPC settings-save listener.
 */
interface AiLifecycle {
  getActiveMode(): AiMode
  getDelegatedEnabled(): boolean
  applyModeChange(settings: AiSettingsSaveInput): void
}

export interface AppContainer {
  domainService: DomainService
  dossierService: DossierRegistryService
  documentService: DocumentService
  contactService: ContactService
  conflictCheckService: ConflictCheckService
  entityService: EntityService
  cabinetBillingService: CabinetBillingService
  invoiceService: InvoiceService
  piecesService: PiecesService
  comparisonService: ComparisonService
  ajOrchestrationService: AjOrchestrationService
  templateService: TemplateService
  generateService: GenerateService
  redactionSessionService: RedactionSessionService
  legalService: LegalService
  calendarSyncService: CalendarSyncService
  fileWatcherService: FileWatcherService
  indexingQueueService: IndexingQueueService
  ordicabDataWatcher: OrdicabDataWatcherLike
  delegatedIntentProcessor: DelegatedAiActionProcessorLike
  instructionsGenerator: InstructionsGeneratorLike
  credentialStore: CredentialStore
  aiService: AiService
  coworkExportService: CoworkExportService
  templateTagifyService: TemplateTagifyService
  aiLifecycle: AiLifecycle
  /** Shared owner of app-state.json; reused by host-constructed stores (e.g. eulaStore). */
  appState: AppStateStore
  /**
   * Reload the embedding worker (e.g. after bge-m3 finishes downloading) then
   * re-run startup catch-up so documents get re-embedded with the new model.
   * No-op when no embedding worker is configured.
   */
  reloadEmbeddingsAndReindex(): Promise<void>
  /** Tear down all watchers. */
  dispose(): Promise<void>
}

interface PersistedAiState {
  mode: AiMode
  remoteProvider: string | undefined
  remoteProviderKind: RemoteProviderKind | undefined
  delegatedEnabled: boolean
}

function readPersistedAiState(stateFilePath: string): PersistedAiState {
  let mode: AiMode = 'none'
  let remoteProvider: string | undefined
  let remoteProviderKind: RemoteProviderKind | undefined
  let delegatedEnabled = false

  try {
    const raw = readFileSync(stateFilePath, 'utf8')
    const state = JSON.parse(raw) as {
      ai?: {
        mode?: string
        remoteProviderKind?: RemoteProviderKind
        remoteProvider?: string
        claudeCoworkEnabled?: boolean
      }
    }
    if (typeof state?.ai?.mode === 'string') {
      mode = state.ai.mode as AiMode
    }
    // Cowork (delegated) activation is independent of the embedded-assistant
    // `mode`. Fall back to the legacy `mode === 'claude-code'` encoding for
    // state written before the two were decoupled.
    delegatedEnabled =
      typeof state?.ai?.claudeCoworkEnabled === 'boolean'
        ? state.ai.claudeCoworkEnabled
        : mode === 'claude-code'
    if (typeof state?.ai?.remoteProvider === 'string') {
      remoteProvider = state.ai.remoteProvider
    }
    if (typeof state?.ai?.remoteProviderKind === 'string') {
      remoteProviderKind = state.ai.remoteProviderKind
    }
  } catch {
    // No state file yet -> defaults above remain.
  }

  return { mode, remoteProvider, remoteProviderKind, delegatedEnabled }
}

export function buildContainer(opts: BuildContainerOptions): AppContainer {
  // Single owner of app-state.json, shared by every consumer so concurrent
  // namespace writes are serialised instead of clobbering each other.
  const appState = createAppStateStore(opts.stateFilePath)

  const credentialStore = createCredentialStore(opts.safeStorage, appState)
  const legalService = createLegalService({ credentialStore })

  // Spin up the embedding worker before any service that may need to embed
  // (note indexing, document search, …). Without a worker, embedding inference
  // falls back to the in-process embedBatch which is prone to HandleScope
  // crashes in Electron's CFRunLoop integration on macOS arm64.
  let embeddingWorkerClient: EmbeddingWorkerClient | null = null
  if (opts.embeddingWorkerPath) {
    embeddingWorkerClient = createEmbeddingWorkerClient({
      workerPath: opts.embeddingWorkerPath,
      defaultConfig: opts.modelsPath ? { modelPath: opts.modelsPath } : undefined
    })
  } else {
    console.warn(
      '[Container] No embeddingWorkerPath provided — embedding inference will run on the main thread and may freeze the UI during indexing.'
    )
  }

  const workerEmbedder = embeddingWorkerClient
    ? (texts: string[], config?: EmbeddingServiceConfig) =>
        embeddingWorkerClient!.embedBatch(texts, config)
    : undefined

  const noteEmbeddingConfig = opts.modelsPath ? { modelPath: opts.modelsPath } : undefined

  const dossierService = createDossierRegistryService({
    stateFilePath: opts.stateFilePath,
    now: () => new Date(),
    indexNote: (dossierPath, note) =>
      indexNoteEmbeddings({
        dossierPath,
        note,
        embeddingConfig: noteEmbeddingConfig,
        embedder: workerEmbedder
      }),
    searchNotesInDossier: ({ dossierPath, notes, query, topK }) =>
      searchNotes({
        dossierPath,
        notes,
        query,
        topK,
        embeddingConfig: noteEmbeddingConfig,
        embedder: workerEmbedder
      }),
    onDossierRegistered: (dossierId, dossierPath) => {
      void subscribeQueueToFileEvents(dossierId, dossierPath).catch((error) => {
        console.error('[Container] Failed to subscribe file events for registered dossier.', error)
      })
      void indexingQueueService
        .enqueueDossierBatch(dossierId, {
          reason: 'initial-registration',
          trackInitialComplete: true
        })
        .catch((error) => {
          console.error(
            '[Container] Failed to enqueue initial batch for registered dossier.',
            error
          )
        })
    },
    onDossierUnregistered: (dossierId) => {
      indexingQueueService.cancelDossier(dossierId)
      void unsubscribeQueueFromFileEvents(dossierId).catch((error) => {
        console.error(
          '[Container] Failed to unsubscribe file events for unregistered dossier.',
          error
        )
      })
    }
  })

  // Model warmup intentionally removed: loading @huggingface/transformers
  // pipelines runs an internal ONNX warmup inference whose callback is
  // delivered via libuv from CFRunLoop on macOS, outside a V8 HandleScope →
  // fatal crash. Accept the cold-start cost on first AI command / search
  // instead. NER and embeddings remain available; only the 2-3 s first-call
  // latency increases.
  const modelWarmupPromise = Promise.resolve()

  const documentService = createDocumentService({
    stateFilePath: opts.stateFilePath,
    tessDataPath: opts.tessDataPath,
    embeddingConfig: opts.modelsPath ? { modelPath: opts.modelsPath } : undefined,
    embedder: workerEmbedder
  })

  const generateService = createGenerateService({
    domainService: opts.domainService,
    documentService
  })

  const delegatedOriginDeviceStore = createDelegatedOriginDeviceStore(appState)
  const instructionsGenerator = createInstructionsGenerator({
    domainService: opts.domainService,
    documentService,
    delegatedOriginDeviceStore
  })

  const contactService = createContactService({ documentService })
  const conflictCheckService = createConflictCheckService({
    dossierRegistryService: dossierService,
    documentService
  })
  const entityService = createEntityService({ domainService: opts.domainService })
  const cabinetBillingService = createCabinetBillingService({ domainService: opts.domainService })

  const invoiceService = createInvoiceService({
    domainService: opts.domainService,
    dossierRegistryService: dossierService,
    generateService,
    contactService,
    entityService,
    printHtmlToPdf: opts.printHtmlToPdf,
    docxToPdf: opts.docxToPdf
  })

  const piecesService = createPiecesService({
    documentService,
    entityService,
    printHtmlToPdf: opts.printHtmlToPdf,
    docxToPdf: opts.docxToPdf
  })

  const comparisonService = createComparisonService({ documentService, legalService })

  const templateService = createTemplateService({ domainService: opts.domainService })

  const ajOrchestrationService = createAjOrchestrationService({
    dossierService,
    invoiceService,
    generateService,
    templateService
  })

  const delegatedIntentProcessor = createDelegatedAiActionProcessor({
    domainService: opts.domainService,
    dossierService,
    documentService,
    generateService,
    tessDataPath: opts.tessDataPath
  })

  const fileWatcherService = createFileWatcherService()

  // ---- Background indexing queue ----
  // Unsubscribe callbacks keyed by dossierId — used to clean up the boot-level
  // file event subscriptions when a dossier is unregistered.
  const fileEventUnsubs = new Map<string, () => Promise<void>>()

  const indexingQueueService = createIndexingQueueService({
    // One worker by default — see DEFAULT_CONCURRENCY in indexingQueueService.
    // Even with the embedding off-loaded to a worker thread, extract still does
    // OCR/PDF orchestration on the main thread, so parallel jobs would compete.
    concurrency: 1,
    statusDebounceMs: 250,
    embeddingConfig: opts.modelsPath ? { modelPath: opts.modelsPath } : undefined,
    embedder: workerEmbedder,
    // Skip embedding until bge-m3 is downloaded. Without this gate the queue
    // hammers the worker with doomed inference calls (log spam) for every doc.
    isEmbeddingModelReady: async () =>
      opts.modelsPath ? isModelPresent(opts.modelsPath, EMBEDDING_MODEL).catch(() => false) : false,
    extractContent: ({ dossierId, documentPath }) =>
      documentService.extractContent({ dossierId, documentPath }).then(() => undefined),
    resolveDossierPath: async (dossierId) => {
      try {
        return await documentService.resolveRegisteredDossierRoot({ dossierId })
      } catch {
        return null
      }
    },
    listIndexableDocuments: async (dossierId) => {
      try {
        const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
        return await walkExtractableDocuments(dossierPath)
      } catch {
        return null
      }
    },
    emit: (event) => {
      const window = opts.getWebContents()
      if (!window || (window.isDestroyed?.() ?? false)) return
      if (event.kind === 'status') {
        window.send(IPC_CHANNELS.indexing.status, event.snapshot)
      } else if (event.kind === 'dossier-initial-complete') {
        window.send(IPC_CHANNELS.indexing.dossierInitialComplete, event.payload)
      }
    },
    isEnabled: () => true
  })

  async function subscribeQueueToFileEvents(dossierId: string, dossierPath: string): Promise<void> {
    if (fileEventUnsubs.has(dossierId)) return
    const { unsubscribe } = await fileWatcherService.subscribeFileEvents({
      dossierId,
      dossierPath,
      listener: (event) => {
        if (event.kind === 'unlink') return
        indexingQueueService.enqueueOne({
          dossierId: event.dossierId,
          relativePath: event.relativePath,
          absolutePath: event.absolutePath,
          reason: event.kind === 'add' ? 'file-add' : 'file-change'
        })
      }
    })
    fileEventUnsubs.set(dossierId, unsubscribe)
  }

  async function unsubscribeQueueFromFileEvents(dossierId: string): Promise<void> {
    const unsub = fileEventUnsubs.get(dossierId)
    if (!unsub) return
    fileEventUnsubs.delete(dossierId)
    await unsub()
  }

  // ---- AI mode lifecycle (closure-encapsulated mutable state) ----
  const persisted = readPersistedAiState(opts.stateFilePath)
  let currentAiMode: AiMode = persisted.mode
  let remoteProvider: string | undefined = persisted.remoteProvider
  let remoteProviderKind: RemoteProviderKind | undefined = persisted.remoteProviderKind
  let delegatedEnabled = persisted.delegatedEnabled

  // The delegated CLAUDE.md is generated whenever Cowork is enabled, regardless
  // of the embedded-assistant `mode`. When Cowork is off this resolves to the
  // current mode, which has no delegated instructions path, so generation no-ops.
  const delegatedInstructionsMode = (): AiMode => (delegatedEnabled ? 'claude-code' : currentAiMode)

  const aiAgentRuntime = createAiSdkAgentRuntime({})

  const configureRemoteLanguageModel = async (requestedModel?: string): Promise<void> => {
    if (currentAiMode !== 'remote' || !remoteProvider) {
      aiAgentRuntime.setRemoteLanguageModel(null)
      return
    }

    const apiKey = await credentialStore.getSecret(AI_REMOTE_API_KEY_SECRET)
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

  const redactionSessionService = createRedactionSessionService({
    documentService,
    generateService,
    entityService
  })

  const intentDispatcher = createInternalAICommandDispatcher({
    contactService,
    templateService,
    generateService,
    dossierService,
    documentService,
    redactionSessionService,
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
    invoiceService,
    legalService,
    domainService: opts.domainService,
    localeService: opts.mainI18n,
    stateFilePath: opts.stateFilePath,
    tessDataPath: opts.tessDataPath,
    nerModelPath: opts.modelsPath,
    redactionSessionService: {
      getIndexedText: (dossierId, sessionId) =>
        redactionSessionService.getIndexedText(dossierId, sessionId)
    },
    loadConversationState: async (conversationId) => {
      const scope = parseRedactionConversationId(conversationId)
      if (!scope) return null
      const state = await redactionSessionService.getConversationState(
        scope.dossierId,
        scope.sessionId
      )
      if (!state) return null
      return {
        history: state.runtimeHistory as Parameters<typeof aiAgentRuntime.seedConversation>[1],
        piiLedger: state.piiLedger as never[]
      }
    },
    onConversationCommitted: (conversationId, history, piiLedger) => {
      const scope = parseRedactionConversationId(conversationId)
      if (!scope) return
      void redactionSessionService.persistConversation(
        scope.dossierId,
        scope.sessionId,
        history,
        piiLedger
      )
    }
  })

  const templateTagifyService = createTemplateTagifyService({
    aiAgentRuntime,
    templateService,
    domainService: opts.domainService,
    localeService: opts.mainI18n,
    stateFilePath: opts.stateFilePath,
    configureRemoteLanguageModel,
    nerModelPath: opts.modelsPath,
    loadEntityProfile: async () => entityService.get()
  })

  const coworkExportService = createCoworkExportService({
    documentService,
    contactService,
    dossierService,
    templateService,
    loadEntityProfile: async () => entityService.get(),
    localeService: opts.mainI18n,
    stateFilePath: opts.stateFilePath,
    nerModelPath: opts.modelsPath
  })

  const calendarSyncService = createCalendarSyncService({
    appState,
    credentialStore,
    domainService: opts.domainService,
    listRegisteredDossiers: () => dossierService.listRegisteredDossiers(),
    onStatusChanged: (status) => {
      const window = opts.getWebContents()
      if (window && !(window.isDestroyed?.() ?? false)) {
        window.send(IPC_CHANNELS.calendarSync.statusChanged, status)
      }
    }
  })
  calendarSyncService.start()

  const ordicabDataWatcher = createOrdicabDataWatcher({
    domainService: opts.domainService,
    instructionsGenerator,
    listRegisteredDossiers: () => dossierService.listRegisteredDossiers(),
    getActiveAiMode: delegatedInstructionsMode,
    onDataChanged: (event) => {
      const window = opts.getWebContents()
      if (window && !(window.isDestroyed?.() ?? false)) {
        window.send(IPC_CHANNELS.ordicab.dataChanged, event)
      }
      // Key dates live in dossier folders ('dossier' covers key-dates/*.json)
      // and in the domain-level general-key-dates folder; any change there may
      // affect the pushed calendar mirror.
      if (event.type === 'dossier' || event.type === 'general-key-dates') {
        calendarSyncService.requestSync('change')
      }
    },
    onDocxTemplateChanged: (templateUuid) => {
      void (async () => {
        try {
          const domainStatus = await opts.domainService.getStatus()
          if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
            return
          }

          const result = await templateService.syncDocx(templateUuid)
          if (!result) {
            return
          }

          const window = opts.getWebContents()
          if (!window || (window.isDestroyed?.() ?? false)) {
            return
          }

          window.send(IPC_CHANNELS.template.docxSynced, {
            templateUuid,
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

  // Subscribe the indexing queue to file events for all already-registered
  // dossiers, then run a startup catch-up pass (silent — no toast).
  //
  // The catch-up is deferred so the renderer finishes its initial paint
  // before we start chewing on documents. Without this delay the user's
  // first interactions can feel sluggish on cold start while the
  // embedding worker is still warming up. 5s is empirical: long enough
  // for the splash/onboarding to settle, short enough that newly added
  // documents still get indexed promptly on relaunch.
  const STARTUP_CATCHUP_DELAY_MS = 5_000
  setTimeout(() => {
    void (async () => {
      try {
        const registered = await dossierService.listRegisteredDossiers()
        const dossierIds: string[] = []
        await Promise.all(
          registered.map(async (summary) => {
            dossierIds.push(summary.slug)
            try {
              const dossierPath = await documentService.resolveRegisteredDossierRoot({
                dossierId: summary.slug
              })
              await subscribeQueueToFileEvents(summary.slug, dossierPath)
            } catch {
              // Dossier root unavailable at boot — the watcher will handle recovery.
            }
          })
        )
        await indexingQueueService.runStartupCatchUp(dossierIds)
      } catch (error) {
        console.error('[Container] Failed during indexing boot catch-up.', error)
      }
    })()
  }, STARTUP_CATCHUP_DELAY_MS)
  // Catch up the CalDAV mirror with whatever changed while the app was closed.
  const CALENDAR_SYNC_STARTUP_DELAY_MS = 8_000
  setTimeout(() => {
    calendarSyncService.requestSync('startup')
  }, CALENDAR_SYNC_STARTUP_DELAY_MS).unref?.()
  if (delegatedEnabled) {
    void delegatedIntentProcessor.watchActiveDomain().catch((error) => {
      console.error('[Container] Failed to initialize delegated intent processor.', error)
    })
  }
  // Seed the essential default templates if the domain is empty (idempotent).
  // Deliberately fire-and-forget: the IPC list path stays a pure read.
  void (async () => {
    try {
      await templateService.seedDefaultTemplatesIfEmpty()
    } catch (error) {
      console.error('[Container] Failed to seed default templates on startup.', error)
    }
  })()
  void (async () => {
    const domainStatus = await opts.domainService.getStatus()
    if (!domainStatus.registeredDomainPath || !domainStatus.isAvailable) {
      return
    }
    await instructionsGenerator.generateForMode(
      domainStatus.registeredDomainPath,
      delegatedInstructionsMode()
    )
  })().catch((error) => {
    console.error('[Container] Failed to generate the domain instructions file on startup.', error)
  })

  const aiLifecycle: AiLifecycle = {
    getActiveMode: () => currentAiMode,
    getDelegatedEnabled: () => delegatedEnabled,
    applyModeChange: (settings) => {
      const nextMode = settings.mode
      currentAiMode = nextMode
      remoteProvider = settings.remoteProvider
      remoteProviderKind = settings.remoteProviderKind
      if (nextMode === 'remote' && settings.remoteProvider) {
        void configureRemoteLanguageModel().catch((error) => {
          console.error('[Container] Failed to configure remote language model.', error)
        })
      } else {
        aiAgentRuntime.setRemoteLanguageModel(null)
      }
      // Cowork (delegated) activation is independent of the embedded-assistant
      // mode: it is driven solely by `claudeCoworkEnabled`, so the API provider
      // and Cowork can be enabled at the same time.
      const shouldEnable = settings.claudeCoworkEnabled === true
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
      void instructionsGenerator
        .generateForMode(undefined, delegatedInstructionsMode())
        .catch((error) => {
          console.error('[Container] Failed to generate instructions file on mode change.', error)
        })
    }
  }

  return {
    domainService: opts.domainService,
    dossierService,
    documentService,
    contactService,
    conflictCheckService,
    entityService,
    cabinetBillingService,
    invoiceService,
    piecesService,
    comparisonService,
    ajOrchestrationService,
    templateService,
    generateService,
    redactionSessionService,
    legalService,
    calendarSyncService,
    fileWatcherService,
    indexingQueueService,
    ordicabDataWatcher,
    delegatedIntentProcessor,
    instructionsGenerator,
    credentialStore,
    aiService,
    coworkExportService,
    templateTagifyService,
    aiLifecycle,
    appState,
    reloadEmbeddingsAndReindex: async () => {
      // Reload the worker so it picks up the freshly-downloaded model from the
      // (now-populated) models path, then re-run catch-up. The indexing gate
      // re-embeds any document whose embeddings don't match the active
      // model/dim, so previously text-only documents get bge-m3 vectors.
      await embeddingWorkerClient?.rebind()
      try {
        const registered = await dossierService.listRegisteredDossiers()
        await indexingQueueService.runStartupCatchUp(registered.map((d) => d.slug))
      } catch (error) {
        console.warn(
          '[Container] reindex after embedding-model download failed:',
          error instanceof Error ? error.message : error
        )
      }
    },
    dispose: async () => {
      // Drain all in-process ONNX operations before tearing down the
      // environment. @huggingface/transformers runs an internal warmup
      // inference inside pipeline(), and any pending callback fires into a
      // dead V8 isolate during Node.js shutdown → SIGSEGV / HandleScope crash.
      await modelWarmupPromise
      await awaitInferenceDrain()
      await Promise.allSettled([
        indexingQueueService.dispose(),
        embeddingWorkerClient?.dispose(),
        fileWatcherService.disposeAll(),
        ordicabDataWatcher.dispose(),
        delegatedIntentProcessor.dispose(),
        calendarSyncService.dispose()
      ])
      aiAgentRuntime.dispose()
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
  /** Tesseract language data dir, forwarded to the template PDF→DOCX OCR fallback. */
  tessDataPath: string
  /** Resolves the active renderer WebContents for AI streaming events. */
  getWebContents: () => WebContentsLike | null | undefined
  /** Brings the main window to the foreground (used on notification click). */
  focusMainWindow?: () => void
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
    IPC_CHANNELS.app.writeClipboard,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      const value = (input ?? {}) as { text?: unknown; html?: unknown }
      const text = typeof value.text === 'string' ? value.text : undefined
      const html = typeof value.html === 'string' ? value.html : undefined
      if (text === undefined && html === undefined) {
        return {
          success: false,
          error: 'Empty clipboard payload.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }
      const { clipboard } = await import('electron')
      clipboard.write({ text: text ?? '', html: html ?? text ?? '' })
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

  // Surfaces a native OS notification (deadline reminders). On click we focus the
  // main window and echo the dossierId back so the renderer can navigate to it.
  ipcMain.handle(
    IPC_CHANNELS.app.notify,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      const value = (input ?? {}) as { title?: unknown; body?: unknown; dossierId?: unknown }
      const title = typeof value.title === 'string' ? value.title : ''
      const body = typeof value.body === 'string' ? value.body : ''
      if (title.length === 0) {
        return {
          success: false,
          error: 'Notification title is required.',
          code: IpcErrorCode.INVALID_INPUT
        }
      }
      const dossierId = typeof value.dossierId === 'string' ? value.dossierId : undefined

      const { Notification } = await import('electron')
      if (!Notification.isSupported()) {
        // No native notification centre on this platform — treat as a no-op
        // success so the renderer's dedupe logic still marks the date notified.
        return { success: true, data: null }
      }

      const notification = new Notification({ title, body, silent: false })
      notification.on('click', () => {
        opts.focusMainWindow?.()
        const webContents = opts.getWebContents()
        if (webContents && !(webContents as { isDestroyed?: () => boolean }).isDestroyed?.()) {
          webContents.send(IPC_CHANNELS.app.notificationClicked, { dossierId })
        }
      })
      notification.show()
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
          const instructionsMode: AiMode = container.aiLifecycle.getDelegatedEnabled()
            ? 'claude-code'
            : container.aiLifecycle.getActiveMode()
          void container.instructionsGenerator
            .generateForMode(result.selectedPath, instructionsMode)
            .catch((error) => {
              console.error(
                '[Main] Failed to generate instructions file after domain selection.',
                error
              )
            })
          void container.templateService.seedDefaultTemplatesIfEmpty().catch((error) => {
            console.error('[Main] Failed to seed default templates after domain selection.', error)
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

  registerDossierHandlers({
    ipcMain,
    dossierService: container.dossierService,
    ajOrchestrationService: container.ajOrchestrationService
  })

  registerDocumentHandlers({
    ipcMain,
    documentService: container.documentService,
    fileWatcherService: container.fileWatcherService,
    openPath: opts.openPath
  })

  registerContactHandlers({
    ipcMain,
    contactService: container.contactService,
    conflictCheckService: container.conflictCheckService
  })

  registerEntityHandlers({ ipcMain, entityService: container.entityService })

  registerPiecesHandlers({ ipcMain, piecesService: container.piecesService })

  registerCompareHandlers({ ipcMain, comparisonService: container.comparisonService })

  registerCabinetBillingHandlers({
    ipcMain,
    cabinetBillingService: container.cabinetBillingService
  })

  registerInvoiceHandlers({
    ipcMain,
    invoiceService: container.invoiceService,
    openPath: opts.openPath,
    showSaveDialog: opts.showSaveDialog
  })

  registerTemplateHandlers({
    ipcMain,
    templateService: container.templateService,
    tagifyService: container.templateTagifyService,
    showOpenDialog: opts.showOpenDialog,
    openPath: opts.openPath,
    tessDataPath: opts.tessDataPath
  })

  registerGenerateHandlers({
    ipcMain,
    generateService: container.generateService,
    dossierRegistryService: container.dossierService,
    invoiceService: container.invoiceService,
    contactService: container.contactService,
    entityService: container.entityService
  })

  registerInstructionsHandlers({
    ipcMain,
    instructionsGenerator: container.instructionsGenerator,
    documentService: container.documentService
  })

  registerIndexingHandlers({
    ipcMain,
    indexingQueueService: container.indexingQueueService
  })

  registerLegalHandlers({
    ipcMain,
    legalService: container.legalService
  })

  registerAiHandlers({
    ipcMain,
    credentialStore: container.credentialStore,
    appState: container.appState,
    onModeChanged: (settings) => container.aiLifecycle.applyModeChange(settings),
    aiService: container.aiService,
    getWebContents: () => opts.getWebContents() ?? null
  })

  registerRedactionHandlers({
    ipcMain,
    redactionSessionService: container.redactionSessionService
  })

  registerCoworkHandlers({
    ipcMain,
    coworkExportService: container.coworkExportService
  })

  registerCalendarSyncHandlers({
    ipcMain,
    calendarSyncService: container.calendarSyncService
  })
}
