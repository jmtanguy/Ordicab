/**
 * Typed IPC bridge — translates the raw ipcRenderer primitives into the
 * strongly-typed OrdicabAPI object that the renderer uses.
 *
 * This module has no Electron imports on purpose: it receives `ipcInvoke`,
 * `ipcOn`, and `ipcOff` as function arguments so it can be tested in isolation
 * without a real Electron environment.
 *
 * Two IPC patterns are used:
 *
 *  `invoke(channel, payload?)` — Request/response (ipcRenderer.invoke).
 *    Used for all queries and mutations. Returns a Promise<IpcResult<T>>.
 *    Handlers on the main side are registered with ipcMain.handle().
 *
 *  `subscribeToEvent(channel, listener)` — Push events (ipcRenderer.on/off).
 *    Used for data-change notifications pushed by the main process.
 *    Returns an unsubscribe function so React components can clean up in
 *    useEffect return callbacks.
 *    The `_event` Electron wrapper is stripped; listeners receive only the
 *    typed payload.
 *
 * The full list of channels and their payload types lives in
 * shared/types/api.ts (IPC_CHANNELS + OrdicabAPI).
 */
import type {
  AiCommandInput,
  DocumentAvailabilityEvent,
  DocumentChangeEvent,
  DocumentExtractProgressEvent,
  IndexingDossierInitialCompleteEvent,
  IndexingStatusSnapshot,
  ModelDownloadStatus,
  NotificationClickedEvent,
  OrdicabDataChangedEvent,
  TemplateDocxSyncedEvent,
  OrdicabAPI,
  OrdicabEventUnsubscribe,
  UpdaterProgressPayload,
  UpdaterStatus
} from '@shared/types'
import { IPC_CHANNELS } from '@shared/types'

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>
type Subscribe = (channel: string, listener: (_event: unknown, payload: unknown) => void) => void
type Unsubscribe = (channel: string, listener: (_event: unknown, payload: unknown) => void) => void

function invoke<T>(ipcInvoke: Invoke, channel: string, payload?: unknown): Promise<T> {
  if (typeof payload === 'undefined') {
    return ipcInvoke<T>(channel)
  }

  return ipcInvoke<T>(channel, payload)
}

function subscribeToEvent<T>(
  ipcOn: Subscribe,
  ipcOff: Unsubscribe,
  channel: string,
  listener: (payload: T) => void
): OrdicabEventUnsubscribe {
  const wrappedListener = (_event: unknown, payload: unknown): void => {
    listener(payload as T)
  }

  ipcOn(channel, wrappedListener)

  return () => {
    ipcOff(channel, wrappedListener)
  }
}

export function createOrdicabApi(
  ipcInvoke: Invoke,
  ipcOn: Subscribe,
  ipcOff: Unsubscribe
): OrdicabAPI {
  return {
    app: {
      version: () => invoke(ipcInvoke, IPC_CHANNELS.app.version),
      getLocale: () => invoke(ipcInvoke, IPC_CHANNELS.app.getLocale),
      setLocale: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.setLocale, input),
      openExternal: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.openExternal, input),
      writeClipboard: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.writeClipboard, input),
      openFolder: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.openFolder, input),
      eulaStatus: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.eulaStatus, input),
      eulaAccept: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.eulaAccept, input),
      notify: (input) => invoke(ipcInvoke, IPC_CHANNELS.app.notify, input),
      onNotificationClicked: (listener) =>
        subscribeToEvent<NotificationClickedEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.app.notificationClicked,
          listener
        )
    },
    domain: {
      select: () => invoke(ipcInvoke, IPC_CHANNELS.domain.select),
      status: () => invoke(ipcInvoke, IPC_CHANNELS.domain.status)
    },
    dossier: {
      listEligible: () => invoke(ipcInvoke, IPC_CHANNELS.dossier.listEligible),
      list: () => invoke(ipcInvoke, IPC_CHANNELS.dossier.list),
      get: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.get, input),
      open: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.open, input),
      register: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.register, input),
      create: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.create, input),
      unregister: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.unregister, input),
      upsertKeyDate: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.upsertKeyDate, input),
      deleteKeyDate: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.deleteKeyDate, input),
      upsertFeeAgreement: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.upsertFeeAgreement, input),
      deleteFeeAgreement: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.deleteFeeAgreement, input),
      archiveFeeAgreement: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.archiveFeeAgreement, input),
      setActiveFeeAgreement: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.setActiveFeeAgreement, input),
      upsertBillingItem: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.upsertBillingItem, input),
      deleteBillingItem: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.deleteBillingItem, input),
      updateLegalAid: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.updateLegalAid, input),
      setupLegalAid: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.setupLegalAid, input),
      upsertKeyReference: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.upsertKeyReference, input),
      deleteKeyReference: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.deleteKeyReference, input),
      pickExportRoot: () => invoke(ipcInvoke, IPC_CHANNELS.dossier.pickExportRoot),
      analyzeAiExport: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.analyzeAiExport, input),
      exportForAi: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.exportForAi, input),
      pickImportSource: () => invoke(ipcInvoke, IPC_CHANNELS.dossier.pickImportSource),
      analyzeAiImport: (input) => invoke(ipcInvoke, IPC_CHANNELS.dossier.analyzeAiImport, input),
      importAiProduction: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.dossier.importAiProduction, input)
    },
    contact: {
      list: (input) => invoke(ipcInvoke, IPC_CHANNELS.contact.list, input),
      upsert: (input) => invoke(ipcInvoke, IPC_CHANNELS.contact.upsert, input),
      delete: (input) => invoke(ipcInvoke, IPC_CHANNELS.contact.delete, input)
    },
    entity: {
      get: () => invoke(ipcInvoke, IPC_CHANNELS.entity.get),
      update: (input) => invoke(ipcInvoke, IPC_CHANNELS.entity.update, input),
      importDefaultTemplate: () => invoke(ipcInvoke, IPC_CHANNELS.entity.importDefaultTemplate),
      openDefaultTemplate: () => invoke(ipcInvoke, IPC_CHANNELS.entity.openDefaultTemplate),
      removeDefaultTemplate: () => invoke(ipcInvoke, IPC_CHANNELS.entity.removeDefaultTemplate)
    },
    cabinetBilling: {
      get: () => invoke(ipcInvoke, IPC_CHANNELS.cabinetBilling.get),
      upsertService: (input) => invoke(ipcInvoke, IPC_CHANNELS.cabinetBilling.upsertService, input),
      deleteService: (input) => invoke(ipcInvoke, IPC_CHANNELS.cabinetBilling.deleteService, input),
      setDefaultService: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.cabinetBilling.setDefaultService, input)
    },
    invoice: {
      list: () => invoke(ipcInvoke, IPC_CHANNELS.invoice.list),
      get: (invoiceId) => invoke(ipcInvoke, IPC_CHANNELS.invoice.get, invoiceId),
      create: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.create, input),
      cancel: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.cancel, input),
      markPaid: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.markPaid, input),
      createCreditNote: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.createCreditNote, input),
      createCorrectiveInvoice: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.invoice.createCorrectiveInvoice, input),
      addPayment: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.addPayment, input),
      updatePayment: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.updatePayment, input),
      deletePayment: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.deletePayment, input),
      exportCsv: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.exportCsv, input),
      openDocument: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.openDocument, input),
      openPdf: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.openPdf, input),
      getSettings: () => invoke(ipcInvoke, IPC_CHANNELS.invoice.getSettings),
      updateSettings: (input) => invoke(ipcInvoke, IPC_CHANNELS.invoice.updateSettings, input)
    },
    document: {
      list: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.list, input),
      listFolders: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.listFolders, input),
      preview: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.preview, input),
      contentStatus: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.contentStatus, input),
      extractContent: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.extractContent, input),
      clearContentCache: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.document.clearContentCache, input),
      startWatching: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.startWatching, input),
      stopWatching: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.stopWatching, input),
      createFolder: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.createFolder, input),
      renameFolder: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.renameFolder, input),
      deleteFolder: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.deleteFolder, input),
      renameFile: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.renameFile, input),
      deleteFile: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.deleteFile, input),
      onDidChange: (listener) =>
        subscribeToEvent<DocumentChangeEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.document.didChange,
          listener
        ),
      onAvailabilityChanged: (listener) =>
        subscribeToEvent<DocumentAvailabilityEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.document.availabilityChanged,
          listener
        ),
      onExtractProgress: (listener) =>
        subscribeToEvent<DocumentExtractProgressEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.document.extractProgress,
          listener
        ),
      saveMetadata: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.saveMetadata, input),
      openFile: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.openFile, input),
      semanticSearch: (input) => invoke(ipcInvoke, IPC_CHANNELS.document.semanticSearch, input)
    },
    ordicab: {
      onDataChanged: (listener) =>
        subscribeToEvent<OrdicabDataChangedEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.ordicab.dataChanged,
          listener
        )
    },
    indexing: {
      getStatus: () => invoke(ipcInvoke, IPC_CHANNELS.indexing.status),
      reindexDossier: (input) => invoke(ipcInvoke, IPC_CHANNELS.indexing.reindexDossier, input),
      onStatus: (listener) =>
        subscribeToEvent<IndexingStatusSnapshot>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.indexing.status,
          listener
        ),
      onDossierInitialComplete: (listener) =>
        subscribeToEvent<IndexingDossierInitialCompleteEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.indexing.dossierInitialComplete,
          listener
        )
    },
    models: {
      getStatus: () => invoke(ipcInvoke, IPC_CHANNELS.models.status),
      download: () => invoke(ipcInvoke, IPC_CHANNELS.models.download),
      onStatusChanged: (listener) =>
        subscribeToEvent<ModelDownloadStatus>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.models.statusChanged,
          listener
        )
    },
    template: {
      list: () => invoke(ipcInvoke, IPC_CHANNELS.template.list),
      getContent: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.getContent, input),
      create: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.create, input),
      update: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.update, input),
      delete: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.delete, input),
      pickDocxFile: () => invoke(ipcInvoke, IPC_CHANNELS.template.pickDocxFile),
      importDocx: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.importDocx, input),
      openDocx: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.openDocx, input),
      removeDocx: (input) => invoke(ipcInvoke, IPC_CHANNELS.template.removeDocx, input),
      applyCabinetDefaultDocx: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.template.applyCabinetDefaultDocx, input),
      applyCabinetDocxToAllExisting: () =>
        invoke(ipcInvoke, IPC_CHANNELS.template.applyCabinetDocxToAllExisting),
      onDocxSynced: (listener) =>
        subscribeToEvent<TemplateDocxSyncedEvent>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.template.docxSynced,
          listener
        )
    },
    generate: {
      document: (input) => invoke(ipcInvoke, IPC_CHANNELS.generate.document, input),
      preview: (input) => invoke(ipcInvoke, IPC_CHANNELS.generate.preview, input),
      save: (input) => invoke(ipcInvoke, IPC_CHANNELS.generate.save, input),
      previewDocx: (input) => invoke(ipcInvoke, IPC_CHANNELS.generate.previewDocx, input),
      previewInvoiceDocx: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.generate.previewInvoiceDocx, input),
      selectOutputPath: (input) => invoke(ipcInvoke, IPC_CHANNELS.generate.selectOutputPath, input)
    },
    claudeMd: {
      regenerate: (input) => invoke(ipcInvoke, IPC_CHANNELS.claudeMd.regenerate, input),
      status: () => invoke(ipcInvoke, IPC_CHANNELS.claudeMd.status)
    },
    legalSearch: {
      getSettings: () => invoke(ipcInvoke, IPC_CHANNELS.legalSearch.settingsGet),
      saveSettings: (input) => invoke(ipcInvoke, IPC_CHANNELS.legalSearch.settingsSave, input),
      deleteCredentials: () => invoke(ipcInvoke, IPC_CHANNELS.legalSearch.credentialsDelete),
      connectionStatus: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.connectionStatus, input),
      searchLegifrance: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.searchLegifrance, input),
      consultLegifrance: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.consultLegifrance, input),
      searchJudilibre: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.searchJudilibre, input),
      consultJudilibre: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.consultJudilibre, input),
      taxonomyJudilibre: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.taxonomyJudilibre, input),
      verifyReferences: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.legalSearch.verifyReferences, input)
    },
    ai: {
      getSettings: () => invoke(ipcInvoke, IPC_CHANNELS.ai.settingsGet),
      saveSettings: (input) => invoke(ipcInvoke, IPC_CHANNELS.ai.settingsSave, input),
      remoteConnectionStatus: (input) =>
        invoke(ipcInvoke, IPC_CHANNELS.ai.remoteConnectionStatus, input),
      deleteApiKey: (provider) => invoke(ipcInvoke, IPC_CHANNELS.ai.deleteApiKey, provider),
      cloudProviderStatus: (mode) => invoke(ipcInvoke, IPC_CHANNELS.ai.cloudProviderStatus, mode),
      executeCommand: (input: AiCommandInput) =>
        invoke(ipcInvoke, IPC_CHANNELS.ai.executeCommand, input),
      cancelCommand: () => invoke(ipcInvoke, IPC_CHANNELS.ai.cancelCommand),
      resetConversation: () => invoke(ipcInvoke, IPC_CHANNELS.ai.resetConversation),
      onTextToken: (listener: (token: string) => void) =>
        subscribeToEvent<string>(ipcOn, ipcOff, IPC_CHANNELS.ai.textToken, listener),
      onReflection: (listener: (text: string) => void) =>
        subscribeToEvent<string>(ipcOn, ipcOff, IPC_CHANNELS.ai.reflection, listener)
    },
    updater: {
      startDownload: () => invoke(ipcInvoke, IPC_CHANNELS.updater.startDownload),
      installNow: () => invoke(ipcInvoke, IPC_CHANNELS.updater.installNow),
      installOnQuit: () => invoke(ipcInvoke, IPC_CHANNELS.updater.installOnQuit),
      dismiss: () => invoke(ipcInvoke, IPC_CHANNELS.updater.dismiss),
      onState: (listener) =>
        subscribeToEvent<UpdaterStatus>(ipcOn, ipcOff, IPC_CHANNELS.updater.state, listener),
      onProgress: (listener) =>
        subscribeToEvent<UpdaterProgressPayload>(
          ipcOn,
          ipcOff,
          IPC_CHANNELS.updater.progress,
          listener
        )
    }
  }
}
