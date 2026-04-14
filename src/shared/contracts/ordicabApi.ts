import type {
  AiCommandInput,
  AiCommandResult,
  AiDelegatedProviderStatus,
  AiMode,
  RemoteConnectionResult,
  AiSettingsResponse,
  AiSettingsSaveInput,
  InternalAiCommand,
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
  DocumentPreview,
  DocumentWatchStatus,
  GeneratedDocumentResult,
  GeneratedDraftResult,
  OrdicabDataChangedEvent,
  TemplateDocxSyncedEvent
} from './documents'
import type { IpcResult } from '../types/ipc'
import type {
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
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
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput,
  EntityProfile,
  EntityProfileDraft,
  GenerateDocumentInput,
  GeneratePreviewInput,
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
    update: (input: DossierUpdateInput) => Promise<IpcResult<DossierDetail>>
    upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<IpcResult<DossierDetail>>
    deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<IpcResult<DossierDetail>>
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
  }
  document: {
    list: (input: DossierScopedQuery) => Promise<IpcResult<DocumentRecord[]>>
    preview: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentPreview>>
    contentStatus: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentContentStatus>>
    extractContent: (input: DocumentPreviewInput) => Promise<IpcResult<DocumentExtractedContent>>
    startWatching: (input: DossierScopedQuery) => Promise<IpcResult<DocumentWatchStatus>>
    stopWatching: (input: DossierScopedQuery) => Promise<IpcResult<null>>
    onDidChange: (listener: (event: DocumentChangeEvent) => void) => OrdicabEventUnsubscribe
    onAvailabilityChanged: (
      listener: (event: DocumentAvailabilityEvent) => void
    ) => OrdicabEventUnsubscribe
    saveMetadata: (input: DocumentMetadataUpdate) => Promise<IpcResult<DocumentRecord>>
    openFile: (input: DocumentPreviewInput) => Promise<IpcResult<null>>
    clearContentCache: (input: DossierScopedQuery) => Promise<IpcResult<null>>
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
    pickDocxFile: () => Promise<IpcResult<{ filePath: string; html: string } | null>>
    importDocx: (
      input: TemplateDocxInput & { filePath?: string }
    ) => Promise<IpcResult<TemplateRecord>>
    openDocx: (input: TemplateDocxInput) => Promise<IpcResult<null>>
    removeDocx: (input: TemplateDocxInput) => Promise<IpcResult<TemplateRecord>>
    onDocxSynced: (listener: (event: TemplateDocxSyncedEvent) => void) => OrdicabEventUnsubscribe
  }
  generate: {
    document: (input: GenerateDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
    preview: (input: GeneratePreviewInput) => Promise<IpcResult<GeneratedDraftResult>>
    save: (input: SaveGeneratedDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
    previewDocx: (input: GeneratePreviewInput) => Promise<IpcResult<DocxPreviewResult>>
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
    onIntentReceived: (listener: (event: InternalAiCommand) => void) => OrdicabEventUnsubscribe
    onTextToken: (listener: (token: string) => void) => OrdicabEventUnsubscribe
  }
}
