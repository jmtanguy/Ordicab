import type {
  AiCommandInput,
  AiCommandResult,
  AiDelegatedProviderStatus,
  AiMode,
  RemoteConnectionResult,
  AiSettingsResponse,
  AiSettingsSaveInput
} from '../types/ai'
import type { PiiPersonaSettings } from '../types/piiPersonas'
import type {
  CalendarSyncOptionsInput,
  CalendarSyncRunResult,
  CalendarSyncSettingsSaveInput,
  CalendarSyncStatus
} from '../domain/calendarSync'
import type {
  CoworkExportProgress,
  CoworkExportResult,
  CoworkReimportResult,
  CoworkStatus
} from '../domain/cowork'
import type {
  JudilibreConsultInput,
  JudilibreSearchInput,
  JudilibreTaxonomyInput,
  LegalConnectionStatus,
  LegalConnectionStatusInput,
  LegalConsultResponse,
  LegalReferenceCheckInput,
  LegalReferenceCheckResult,
  LegalSearchResponse,
  LegalSettingsResponse,
  LegalSettingsSaveInput,
  LegifranceConsultInput,
  LegifranceSearchInput
} from '../domain/legal'
import type {
  AppLocaleInfo,
  AppVersionInfo,
  DomainSelectionResult,
  DomainStatusSnapshot,
  EulaAcceptInput,
  EulaStatus,
  EulaStatusInput,
  ModelDownloadStatus,
  NotificationClickedEvent,
  NotifyInput,
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
  GlobalSearchQuery,
  GlobalSearchResult,
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
  ConflictCheckInput,
  ConflictMatch,
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DocumentFileMoveInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderDeleteResult,
  DocumentFolderMoveInput,
  DocumentFolderRenameInput,
  DocumentImportInput,
  DocumentImportResult,
  DocumentMetadataUpdate,
  DocumentMoveResult,
  DocumentTrashEntry,
  DocumentTrashInput,
  DocumentTrashResult,
  DocumentTrashRestoreInput,
  DocumentTrashRestoreResult,
  EmailAttachmentSaveInput,
  EmailAttachmentSaveResult,
  PdfExtractPagesInput,
  PdfMergeInput,
  PdfOperationResult,
  PdfSplitInput,
  PieceAddInput,
  PieceGenerateInput,
  PieceGenerateProgressEvent,
  PieceGenerateResult,
  PieceRecord,
  PieceRemoveInput,
  PieceUpdateInput,
  CompareProgressEvent,
  CompareRunInput,
  ComparisonResult,
  DocumentExtractedContent,
  DocumentPreviewInput,
  DocumentRecord,
  DossierDetail,
  DossierEligibleFolder,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  DossierKeyDateDeleteInput,
  DossierCreateInput,
  DossierKeyDateUpsertInput,
  KeyDateMoveInput,
  GeneralKeyDate,
  GeneralKeyDateDeleteInput,
  GeneralKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierNoteDeleteInput,
  DossierNoteUpsertInput,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierSetupLegalAidInput,
  DossierSetupLegalAidResult,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput,
  DossierUpdateLegalAidInput,
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
  InvoiceExportFecInput,
  InvoiceExportFecResult,
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
  TemplateTagifyAnalyzeInput,
  TemplateTagifyAnalyzeResult,
  TemplateTagifyApplyInput,
  TemplateTagifyApplyResult,
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
    notify: (input: NotifyInput) => Promise<IpcResult<null>>
    onNotificationClicked: (
      listener: (event: NotificationClickedEvent) => void
    ) => OrdicabEventUnsubscribe
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
    create: (input: DossierCreateInput) => Promise<IpcResult<DossierSummary>>
    update: (input: DossierUpdateInput) => Promise<IpcResult<DossierDetail>>
    unregister: (input: DossierUnregisterInput) => Promise<IpcResult<null>>
    upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<IpcResult<DossierDetail>>
    moveKeyDate: (input: KeyDateMoveInput) => Promise<IpcResult<null>>
    listGeneralKeyDates: () => Promise<IpcResult<GeneralKeyDate[]>>
    upsertGeneralKeyDate: (input: GeneralKeyDateUpsertInput) => Promise<IpcResult<GeneralKeyDate[]>>
    deleteGeneralKeyDate: (input: GeneralKeyDateDeleteInput) => Promise<IpcResult<GeneralKeyDate[]>>
    upsertNote: (input: DossierNoteUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteNote: (input: DossierNoteDeleteInput) => Promise<IpcResult<DossierDetail>>
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
    updateLegalAid: (input: DossierUpdateLegalAidInput) => Promise<IpcResult<DossierDetail>>
    setupLegalAid: (
      input: DossierSetupLegalAidInput
    ) => Promise<IpcResult<DossierSetupLegalAidResult>>
    upsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<IpcResult<DossierDetail>>
  }
  contact: {
    list: (input: DossierScopedQuery) => Promise<IpcResult<ContactRecord[]>>
    upsert: (input: ContactUpsertInput) => Promise<IpcResult<ContactRecord>>
    delete: (input: ContactDeleteInput) => Promise<IpcResult<null>>
    checkConflicts: (input: ConflictCheckInput) => Promise<IpcResult<ConflictMatch[]>>
  }
  entity: {
    get: () => Promise<IpcResult<EntityProfile | null>>
    update: (input: EntityProfileDraft) => Promise<IpcResult<EntityProfile>>
    importDefaultTemplate: () => Promise<IpcResult<EntityProfile | null>>
    openDefaultTemplate: () => Promise<IpcResult<null>>
    removeDefaultTemplate: () => Promise<IpcResult<EntityProfile>>
    /** Opens a file picker; resolves null when the user cancels. */
    importStamp: () => Promise<IpcResult<EntityProfile | null>>
    removeStamp: () => Promise<IpcResult<EntityProfile>>
    /** Data URL of the imported stamp image for settings preview; null when none. */
    getStampDataUrl: () => Promise<IpcResult<string | null>>
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
    get: (invoiceUuid: string) => Promise<IpcResult<InvoiceRecord>>
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
    exportFec: (input: InvoiceExportFecInput) => Promise<IpcResult<InvoiceExportFecResult>>
    openDocument: (input: {
      invoiceUuid: string
    }) => Promise<IpcResult<{ integrity: InvoiceArtifactIntegrity }>>
    openPdf: (input: {
      invoiceUuid: string
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
    searchAll: (input: GlobalSearchQuery) => Promise<IpcResult<GlobalSearchResult>>
    createFolder: (input: DocumentFolderCreateInput) => Promise<IpcResult<{ path: string }>>
    renameFolder: (input: DocumentFolderRenameInput) => Promise<IpcResult<{ path: string }>>
    deleteFolder: (
      input: DocumentFolderDeleteInput
    ) => Promise<IpcResult<DocumentFolderDeleteResult>>
    renameFile: (input: DocumentFileRenameInput) => Promise<IpcResult<DocumentRecord>>
    trashFiles: (input: DocumentTrashInput) => Promise<IpcResult<DocumentTrashResult>>
    restoreTrash: (
      input: DocumentTrashRestoreInput
    ) => Promise<IpcResult<DocumentTrashRestoreResult>>
    listTrash: (input: DossierScopedQuery) => Promise<IpcResult<DocumentTrashEntry[]>>
    deleteTrashEntry: (input: DocumentTrashRestoreInput) => Promise<IpcResult<null>>
    moveFiles: (input: DocumentFileMoveInput) => Promise<IpcResult<DocumentMoveResult>>
    moveFolder: (input: DocumentFolderMoveInput) => Promise<IpcResult<{ path: string }>>
    importFiles: (input: DocumentImportInput) => Promise<IpcResult<DocumentImportResult>>
    saveEmailAttachments: (
      input: EmailAttachmentSaveInput
    ) => Promise<IpcResult<EmailAttachmentSaveResult>>
    pdfExtractPages: (input: PdfExtractPagesInput) => Promise<IpcResult<PdfOperationResult>>
    pdfMerge: (input: PdfMergeInput) => Promise<IpcResult<PdfOperationResult>>
    pdfSplit: (input: PdfSplitInput) => Promise<IpcResult<PdfOperationResult>>
  }
  pieces: {
    list: (input: DossierScopedQuery) => Promise<IpcResult<PieceRecord[]>>
    add: (input: PieceAddInput) => Promise<IpcResult<PieceRecord[]>>
    update: (input: PieceUpdateInput) => Promise<IpcResult<PieceRecord[]>>
    remove: (input: PieceRemoveInput) => Promise<IpcResult<PieceRecord[]>>
    generate: (input: PieceGenerateInput) => Promise<IpcResult<PieceGenerateResult>>
    onGenerateProgress: (
      listener: (event: PieceGenerateProgressEvent) => void
    ) => OrdicabEventUnsubscribe
  }
  compare: {
    run: (input: CompareRunInput) => Promise<IpcResult<ComparisonResult>>
    onProgress: (listener: (event: CompareProgressEvent) => void) => OrdicabEventUnsubscribe
  }
  webUtils: {
    /**
     * Resolve the OS path of a DOM File received from a drag-drop event
     * (Electron webUtils.getPathForFile). Returns '' when the file has no
     * filesystem path (e.g. dragged from another application's memory).
     * Structural parameter type so this contract compiles without the DOM lib.
     */
    getPathForFile: (file: { readonly name: string; readonly size: number }) => string
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
    tagifyAnalyze: (
      input: TemplateTagifyAnalyzeInput
    ) => Promise<IpcResult<TemplateTagifyAnalyzeResult>>
    tagifyApply: (input: TemplateTagifyApplyInput) => Promise<IpcResult<TemplateTagifyApplyResult>>
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
  legalSearch: {
    getSettings: () => Promise<IpcResult<LegalSettingsResponse>>
    saveSettings: (input: LegalSettingsSaveInput) => Promise<IpcResult<null>>
    deleteCredentials: () => Promise<IpcResult<null>>
    connectionStatus: (
      input?: LegalConnectionStatusInput
    ) => Promise<IpcResult<LegalConnectionStatus>>
    searchLegifrance: (input: LegifranceSearchInput) => Promise<IpcResult<LegalSearchResponse>>
    consultLegifrance: (input: LegifranceConsultInput) => Promise<IpcResult<LegalConsultResponse>>
    searchJudilibre: (input: JudilibreSearchInput) => Promise<IpcResult<LegalSearchResponse>>
    consultJudilibre: (input: JudilibreConsultInput) => Promise<IpcResult<LegalConsultResponse>>
    taxonomyJudilibre: (input: JudilibreTaxonomyInput) => Promise<IpcResult<unknown>>
    verifyReferences: (
      input: LegalReferenceCheckInput
    ) => Promise<IpcResult<LegalReferenceCheckResult>>
  }
  ai: {
    getSettings: () => Promise<IpcResult<AiSettingsResponse>>
    saveSettings: (input: AiSettingsSaveInput) => Promise<IpcResult<null>>
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
    getPersonas: () => Promise<IpcResult<PiiPersonaSettings>>
    savePersonas: (input: PiiPersonaSettings) => Promise<IpcResult<PiiPersonaSettings>>
  }
  calendarSync: {
    getStatus: () => Promise<IpcResult<CalendarSyncStatus>>
    /** Verifies the credentials and find-or-creates the remote "Ordicab" calendar. */
    saveSettings: (input: CalendarSyncSettingsSaveInput) => Promise<IpcResult<CalendarSyncStatus>>
    deleteCredentials: () => Promise<IpcResult<CalendarSyncStatus>>
    setOptions: (input: CalendarSyncOptionsInput) => Promise<IpcResult<CalendarSyncStatus>>
    syncNow: () => Promise<IpcResult<CalendarSyncRunResult>>
    onStatusChanged: (listener: (status: CalendarSyncStatus) => void) => OrdicabEventUnsubscribe
  }
  cowork: {
    export: (input: { dossierId: string }) => Promise<IpcResult<CoworkExportResult>>
    reimport: (input: { dossierId: string }) => Promise<IpcResult<CoworkReimportResult>>
    status: (input: { dossierId: string }) => Promise<IpcResult<CoworkStatus>>
    onExportProgress: (listener: (event: CoworkExportProgress) => void) => OrdicabEventUnsubscribe
  }
  indexing: {
    getStatus: () => Promise<IpcResult<IndexingStatusSnapshot>>
    reindexDossier: (input: IndexingReindexDossierInput) => Promise<IpcResult<null>>
    onStatus: (listener: (snapshot: IndexingStatusSnapshot) => void) => OrdicabEventUnsubscribe
    onDossierInitialComplete: (
      listener: (event: IndexingDossierInitialCompleteEvent) => void
    ) => OrdicabEventUnsubscribe
  }
  models: {
    /** Current download status of the runtime ONNX models. */
    getStatus: () => Promise<IpcResult<ModelDownloadStatus>>
    /** Trigger download of any missing models (NER first, then bge-m3). */
    download: () => Promise<IpcResult<null>>
    /** Push: status changed (progress / readiness), for the settings UI. */
    onStatusChanged: (listener: (status: ModelDownloadStatus) => void) => OrdicabEventUnsubscribe
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
