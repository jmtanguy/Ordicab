import type {
  AiCommandInput,
  AiCommandResult,
  AiDelegatedProviderStatus,
  AiMode,
  RemoteConnectionResult,
  AiSettingsResponse,
  AiSettingsSaveInput,
  OllamaConnectionResult
} from '../types/ai'
import type {
  AppLocaleInfo,
  AppVersionInfo,
  DomainSelectionResult,
  DomainStatusSnapshot,
  EulaAcceptInput,
  EulaStatus,
  EulaStatusInput,
  OpenExternalInput,
  OpenFolderInput,
  SetLocaleInput
} from './app'
import type {
  ClaudeMdRegenerateInput,
  ClaudeMdStatus,
  DocumentContentStatus,
  DocxPreviewResult,
  DocumentAvailabilityEvent,
  DocumentChangeEvent,
  DocumentExtractProgressEvent,
  DocumentPreview,
  DocumentWatchStatus,
  GeneratedDocumentResult,
  GeneratedDraftResult,
  OrdicabDataChangedEvent,
  SemanticSearchQuery,
  SemanticSearchResult,
  TemplateDocxSyncedEvent
} from './documents'
import type { IpcResult } from '../types/ipc'
import type {
  IndexingDossierInitialCompleteEvent,
  IndexingReindexDossierInput,
  IndexingStatusSnapshot
} from '../types/indexing'
import type { UpdaterProgressPayload, UpdaterStatus } from './updater'
import type {
  CabinetBillingCatalog,
  CabinetBillingDefaultInput,
  CabinetServicePresetDeleteInput,
  CabinetServicePresetUpsertInput,
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DocumentFileDeleteInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderRenameInput,
  DocumentMetadataUpdate,
  DocumentExtractedContent,
  DocumentPreviewInput,
  DocumentRecord,
  DossierDetail,
  DossierEligibleFolder,
  DossierAiExportAnalyzeResult,
  DossierAiExportInput,
  DossierAiExportResult,
  DossierAiImportAnalyzeInput,
  DossierAiImportAnalyzeResult,
  DossierAiImportInput,
  DossierAiImportResult,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierSummary,
  DossierUnregisterInput,
  EntityProfile,
  EntityProfileDraft,
  GenerateDocumentInput,
  InvoiceArtifactIntegrity,
  InvoiceCancelInput,
  InvoiceCreateCorrectiveInput,
  InvoiceCreateCreditNoteInput,
  InvoiceCreateInput,
  InvoiceExportCsvInput,
  InvoiceExportCsvResult,
  InvoiceMarkPaidInput,
  InvoicePaymentDeleteInput,
  InvoicePaymentInput,
  InvoicePaymentUpdateInput,
  InvoiceRecord,
  InvoiceSettings,
  InvoiceSettingsUpdateInput,
  GeneratePreviewInput,
  GeneratePreviewInvoiceDocxInput,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput,
  TemplateDeleteInput,
  TemplateDocxInput,
  TemplateDraft,
  TemplateRecord,
  TemplateUpdate
} from '../domain'

export type OrdicabEventUnsubscribe = () => void

export interface OrdicabAPI {
  app: {
    version: () => Promise<IpcResult<AppVersionInfo>>
    getLocale: () => Promise<IpcResult<AppLocaleInfo>>
    setLocale: (input: SetLocaleInput) => Promise<IpcResult<AppLocaleInfo>>
    openExternal: (input: OpenExternalInput) => Promise<IpcResult<null>>
    writeClipboard: (input: { text?: string; html?: string }) => Promise<IpcResult<null>>
    openFolder: (input: OpenFolderInput) => Promise<IpcResult<null>>
    eulaStatus: (input: EulaStatusInput) => Promise<IpcResult<EulaStatus>>
    eulaAccept: (input: EulaAcceptInput) => Promise<IpcResult<EulaStatus>>
  }
  domain: {
    select: () => Promise<IpcResult<DomainSelectionResult>>
    status: () => Promise<IpcResult<DomainStatusSnapshot>>
  }
  dossier: {
    listEligible: () => Promise<IpcResult<DossierEligibleFolder[]>>
    list: () => Promise<IpcResult<DossierSummary[]>>
    get: (input: DossierScopedQuery) => Promise<IpcResult<DossierDetail>>
    open: (input: DossierScopedQuery) => Promise<IpcResult<DossierDetail>>
    register: (input: DossierRegistrationInput) => Promise<IpcResult<DossierSummary>>
    unregister: (input: DossierUnregisterInput) => Promise<IpcResult<null>>
    upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<IpcResult<DossierDetail>>
    upsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<IpcResult<DossierDetail>>
    archiveFeeAgreement: (
      input: DossierFeeAgreementArchiveInput
    ) => Promise<IpcResult<DossierDetail>>
    setActiveFeeAgreement: (
      input: DossierFeeAgreementSetActiveInput
    ) => Promise<IpcResult<DossierDetail>>
    upsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<IpcResult<DossierDetail>>
    upsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<IpcResult<DossierDetail>>
    pickExportRoot: () => Promise<IpcResult<string | null>>
    analyzeAiExport: (input: DossierScopedQuery) => Promise<IpcResult<DossierAiExportAnalyzeResult>>
    exportForAi: (input: DossierAiExportInput) => Promise<IpcResult<DossierAiExportResult>>
    pickImportSource: () => Promise<IpcResult<string | null>>
    analyzeAiImport: (
      input: DossierAiImportAnalyzeInput
    ) => Promise<IpcResult<DossierAiImportAnalyzeResult>>
    importAiProduction: (input: DossierAiImportInput) => Promise<IpcResult<DossierAiImportResult>>
  }
  contact: {
    list: (input: DossierScopedQuery) => Promise<IpcResult<ContactRecord[]>>
    upsert: (input: ContactUpsertInput) => Promise<IpcResult<ContactRecord>>
    delete: (input: ContactDeleteInput) => Promise<IpcResult<null>>
  }
  entity: {
    get: () => Promise<IpcResult<EntityProfile | null>>
    update: (input: EntityProfileDraft) => Promise<IpcResult<EntityProfile>>
    importDefaultTemplate: () => Promise<IpcResult<EntityProfile | null>>
    openDefaultTemplate: () => Promise<IpcResult<null>>
    removeDefaultTemplate: () => Promise<IpcResult<EntityProfile>>
  }
  cabinetBilling: {
    get: () => Promise<IpcResult<CabinetBillingCatalog>>
    upsertService: (
      input: CabinetServicePresetUpsertInput
    ) => Promise<IpcResult<CabinetBillingCatalog>>
    deleteService: (
      input: CabinetServicePresetDeleteInput
    ) => Promise<IpcResult<CabinetBillingCatalog>>
    setDefaultService: (
      input: CabinetBillingDefaultInput
    ) => Promise<IpcResult<CabinetBillingCatalog>>
  }
  invoice: {
    list: () => Promise<IpcResult<InvoiceRecord[]>>
    get: (invoiceId: string) => Promise<IpcResult<InvoiceRecord>>
    create: (input: InvoiceCreateInput) => Promise<IpcResult<InvoiceRecord>>
    cancel: (input: InvoiceCancelInput) => Promise<IpcResult<InvoiceRecord>>
    markPaid: (input: InvoiceMarkPaidInput) => Promise<IpcResult<InvoiceRecord>>
    createCreditNote: (input: InvoiceCreateCreditNoteInput) => Promise<IpcResult<InvoiceRecord>>
    createCorrectiveInvoice: (
      input: InvoiceCreateCorrectiveInput
    ) => Promise<IpcResult<InvoiceRecord>>
    addPayment: (input: InvoicePaymentInput) => Promise<IpcResult<InvoiceRecord>>
    updatePayment: (input: InvoicePaymentUpdateInput) => Promise<IpcResult<InvoiceRecord>>
    deletePayment: (input: InvoicePaymentDeleteInput) => Promise<IpcResult<InvoiceRecord>>
    exportCsv: (input: InvoiceExportCsvInput) => Promise<IpcResult<InvoiceExportCsvResult>>
    openDocument: (input: {
      invoiceId: string
    }) => Promise<IpcResult<{ integrity: InvoiceArtifactIntegrity }>>
    openPdf: (input: {
      invoiceId: string
    }) => Promise<IpcResult<{ integrity: InvoiceArtifactIntegrity }>>
    getSettings: () => Promise<IpcResult<InvoiceSettings>>
    updateSettings: (input: InvoiceSettingsUpdateInput) => Promise<IpcResult<InvoiceSettings>>
  }
  document: {
    list: (input: DossierScopedQuery) => Promise<IpcResult<DocumentRecord[]>>
    listFolders: (input: DossierScopedQuery) => Promise<IpcResult<string[]>>
    preview: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentPreview>>
    contentStatus: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentContentStatus>>
    extractContent: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentExtractedContent>>
    startWatching: (input: DossierScopedQuery) => Promise<IpcResult<DocumentWatchStatus>>
    stopWatching: (input: DossierScopedQuery) => Promise<IpcResult<null>>
    onDidChange: (listener: (event: DocumentChangeEvent) => void) => OrdicabEventUnsubscribe
    onAvailabilityChanged: (
      listener: (event: DocumentAvailabilityEvent) => void
    ) => OrdicabEventUnsubscribe
    onExtractProgress: (
      listener: (event: DocumentExtractProgressEvent) => void
    ) => OrdicabEventUnsubscribe
    saveMetadata: (input: DocumentMetadataUpdate) => Promise<IpcResult<DocumentRecord>>
    openFile: (input: DocumentPreviewInput) => Promise<IpcResult<null>>
    clearContentCache: (input: DossierScopedQuery) => Promise<IpcResult<null>>
    semanticSearch: (input: SemanticSearchQuery) => Promise<IpcResult<SemanticSearchResult>>
    createFolder: (input: DocumentFolderCreateInput) => Promise<IpcResult<{ path: string }>>
    renameFolder: (input: DocumentFolderRenameInput) => Promise<IpcResult<{ path: string }>>
    deleteFolder: (input: DocumentFolderDeleteInput) => Promise<IpcResult<null>>
    renameFile: (input: DocumentFileRenameInput) => Promise<IpcResult<DocumentRecord>>
    deleteFile: (input: DocumentFileDeleteInput) => Promise<IpcResult<null>>
  }
  ordicab: {
    onDataChanged: (listener: (event: OrdicabDataChangedEvent) => void) => OrdicabEventUnsubscribe
  }
  template: {
    list: () => Promise<IpcResult<TemplateRecord[]>>
    getContent: (input: TemplateDeleteInput) => Promise<IpcResult<string>>
    create: (input: TemplateDraft) => Promise<IpcResult<TemplateRecord>>
    update: (input: TemplateUpdate) => Promise<IpcResult<TemplateRecord>>
    delete: (input: TemplateDeleteInput) => Promise<IpcResult<null>>
    pickDocxFile: () => Promise<
      IpcResult<{ pickToken: string; fileName: string; html: string } | null>
    >
    importDocx: (input: TemplateDocxInput) => Promise<IpcResult<TemplateRecord>>
    openDocx: (input: TemplateDocxInput) => Promise<IpcResult<null>>
    removeDocx: (input: TemplateDocxInput) => Promise<IpcResult<TemplateRecord>>
    applyCabinetDefaultDocx: (input: TemplateDocxInput) => Promise<IpcResult<TemplateRecord>>
    applyCabinetDocxToAllExisting: () => Promise<
      IpcResult<{ updated: number; skipped: number; failed: string[] }>
    >
    onDocxSynced: (listener: (event: TemplateDocxSyncedEvent) => void) => OrdicabEventUnsubscribe
  }
  generate: {
    document: (input: GenerateDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
    preview: (input: GeneratePreviewInput) => Promise<IpcResult<GeneratedDraftResult>>
    save: (input: SaveGeneratedDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
    previewDocx: (input: GeneratePreviewInput) => Promise<IpcResult<DocxPreviewResult>>
    previewInvoiceDocx: (
      input: GeneratePreviewInvoiceDocxInput
    ) => Promise<IpcResult<DocxPreviewResult>>
    selectOutputPath: (input: SelectOutputPathInput) => Promise<IpcResult<string | null>>
  }
  claudeMd: {
    regenerate: (input: ClaudeMdRegenerateInput) => Promise<IpcResult<null>>
    status: () => Promise<IpcResult<ClaudeMdStatus>>
  }
  ai: {
    getSettings: () => Promise<IpcResult<AiSettingsResponse>>
    saveSettings: (input: AiSettingsSaveInput) => Promise<IpcResult<null>>
    connectionStatus: () => Promise<IpcResult<OllamaConnectionResult>>
    remoteConnectionStatus: (input: {
      remoteProvider?: string
      apiKey?: string
    }) => Promise<IpcResult<RemoteConnectionResult>>
    deleteApiKey: (provider: string) => Promise<IpcResult<null>>
    cloudProviderStatus: (mode: AiMode) => Promise<IpcResult<AiDelegatedProviderStatus>>
    executeCommand: (input: AiCommandInput) => Promise<IpcResult<AiCommandResult>>
    cancelCommand: () => Promise<IpcResult<null>>
    resetConversation: () => Promise<IpcResult<null>>
    onTextToken: (listener: (token: string) => void) => OrdicabEventUnsubscribe
    onReflection: (listener: (text: string) => void) => OrdicabEventUnsubscribe
  }
  indexing: {
    getStatus: () => Promise<IpcResult<IndexingStatusSnapshot>>
    reindexDossier: (input: IndexingReindexDossierInput) => Promise<IpcResult<null>>
    onStatus: (listener: (snapshot: IndexingStatusSnapshot) => void) => OrdicabEventUnsubscribe
    onDossierInitialComplete: (
      listener: (event: IndexingDossierInitialCompleteEvent) => void
    ) => OrdicabEventUnsubscribe
  }
  updater: {
    startDownload: () => Promise<IpcResult<null>>
    installNow: () => Promise<IpcResult<null>>
    installOnQuit: () => Promise<IpcResult<null>>
    dismiss: () => Promise<IpcResult<null>>
    onState: (listener: (status: UpdaterStatus) => void) => OrdicabEventUnsubscribe
    onProgress: (listener: (progress: UpdaterProgressPayload) => void) => OrdicabEventUnsubscribe
  }
}
