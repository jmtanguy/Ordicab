export const IPC_CHANNELS = {
  app: {
    version: 'app:version',
    getLocale: 'app:getLocale',
    setLocale: 'app:setLocale',
    openExternal: 'app:openExternal',
    writeClipboard: 'app:writeClipboard',
    openFolder: 'app:openFolder',
    eulaStatus: 'app:eula-status',
    eulaAccept: 'app:eula-accept',
    notify: 'app:notify',
    notificationClicked: 'app:notification-clicked'
  },
  domain: {
    select: 'domain:select',
    status: 'domain:status'
  },
  dossier: {
    listEligible: 'dossier:listEligible',
    list: 'dossier:list',
    get: 'dossier:get',
    open: 'dossier:open',
    register: 'dossier:register',
    create: 'dossier:create',
    unregister: 'dossier:unregister',
    upsertKeyDate: 'dossier:upsertKeyDate',
    deleteKeyDate: 'dossier:deleteKeyDate',
    upsertKeyReference: 'dossier:upsertKeyReference',
    deleteKeyReference: 'dossier:deleteKeyReference',
    upsertNote: 'dossier:upsertNote',
    deleteNote: 'dossier:deleteNote',
    upsertFeeAgreement: 'dossier:upsertFeeAgreement',
    deleteFeeAgreement: 'dossier:deleteFeeAgreement',
    archiveFeeAgreement: 'dossier:archiveFeeAgreement',
    setActiveFeeAgreement: 'dossier:setActiveFeeAgreement',
    upsertBillingItem: 'dossier:upsertBillingItem',
    deleteBillingItem: 'dossier:deleteBillingItem',
    updateLegalAid: 'dossier:updateLegalAid',
    setupLegalAid: 'dossier:setupLegalAid',
    pickExportRoot: 'dossier:export:pick-root',
    analyzeAiExport: 'dossier:export:analyze',
    exportForAi: 'dossier:export:run',
    pickImportSource: 'dossier:import:pick-source',
    analyzeAiImport: 'dossier:import:analyze',
    importAiProduction: 'dossier:import:run'
  },
  contact: {
    list: 'contact:list',
    upsert: 'contact:upsert',
    delete: 'contact:delete'
  },
  entity: {
    get: 'entity:get',
    update: 'entity:update',
    importDefaultTemplate: 'entity:default-template:import',
    openDefaultTemplate: 'entity:default-template:open',
    removeDefaultTemplate: 'entity:default-template:remove'
  },
  cabinetBilling: {
    get: 'cabinet-billing:get',
    upsertService: 'cabinet-billing:service:upsert',
    deleteService: 'cabinet-billing:service:delete',
    setDefaultService: 'cabinet-billing:service:set-default'
  },
  invoice: {
    list: 'invoice:list',
    get: 'invoice:get',
    create: 'invoice:create',
    cancel: 'invoice:cancel',
    markPaid: 'invoice:mark-paid',
    createCreditNote: 'invoice:credit-note:create',
    createCorrectiveInvoice: 'invoice:corrective:create',
    addPayment: 'invoice:payment:add',
    updatePayment: 'invoice:payment:update',
    deletePayment: 'invoice:payment:delete',
    exportCsv: 'invoice:export-csv',
    openDocument: 'invoice:open-document',
    openPdf: 'invoice:open-pdf',
    getSettings: 'invoice:settings:get',
    updateSettings: 'invoice:settings:update'
  },
  document: {
    list: 'document:list',
    listFolders: 'document:list-folders',
    preview: 'document:preview',
    contentStatus: 'document:content-status',
    extractContent: 'document:extract-content',
    extractProgress: 'document:extract-progress',
    clearContentCache: 'document:clear-content-cache',
    startWatching: 'document:watch:start',
    stopWatching: 'document:watch:stop',
    didChange: 'document:watch:changed',
    availabilityChanged: 'document:watch:availability',
    saveMetadata: 'document:metadata:save',
    openFile: 'document:open-file',
    semanticSearch: 'document:semantic-search',
    createFolder: 'document:folder:create',
    renameFolder: 'document:folder:rename',
    deleteFolder: 'document:folder:delete',
    renameFile: 'document:file:rename',
    deleteFile: 'document:file:delete'
  },
  ordicab: {
    dataChanged: 'ordicab:data-changed'
  },
  indexing: {
    status: 'indexing:status',
    dossierInitialComplete: 'indexing:dossier-initial-complete',
    reindexDossier: 'indexing:reindex-dossier'
  },
  template: {
    list: 'template:list',
    getContent: 'template:get-content',
    create: 'template:create',
    update: 'template:update',
    delete: 'template:delete',
    pickDocxFile: 'template:pick-docx-file',
    importDocx: 'template:import-docx',
    openDocx: 'template:open-docx',
    removeDocx: 'template:remove-docx',
    applyCabinetDefaultDocx: 'template:apply-cabinet-default-docx',
    applyCabinetDocxToAllExisting: 'template:apply-cabinet-docx-to-all-existing',
    docxSynced: 'template:docx-synced'
  },
  generate: {
    document: 'generate:document',
    preview: 'generate:preview',
    save: 'generate:save',
    previewDocx: 'generate:preview-docx',
    previewInvoiceDocx: 'generate:preview-invoice-docx',
    selectOutputPath: 'generate:select-output-path'
  },
  claudeMd: {
    regenerate: 'claudeMd:regenerate',
    status: 'claudeMd:status'
  },
  legalSearch: {
    settingsGet: 'legal:settings-get',
    settingsSave: 'legal:settings-save',
    credentialsDelete: 'legal:credentials-delete',
    connectionStatus: 'legal:connection-status',
    searchLegifrance: 'legal:legifrance:search',
    consultLegifrance: 'legal:legifrance:consult',
    searchJudilibre: 'legal:judilibre:search',
    consultJudilibre: 'legal:judilibre:consult',
    taxonomyJudilibre: 'legal:judilibre:taxonomy',
    verifyReferences: 'legal:references:verify'
  },
  ai: {
    settingsGet: 'ai:settings-get',
    settingsSave: 'ai:settings-save',
    remoteConnectionStatus: 'ai:remote-connection-status',
    executeCommand: 'ai:execute-command',
    cancelCommand: 'ai:cancel-command',
    resetConversation: 'ai:reset-conversation',
    textToken: 'ai:text-token',
    reflection: 'ai:reflection',
    deleteApiKey: 'ai:delete-api-key',
    cloudProviderStatus: 'ai:cloud-provider-status'
  },
  models: {
    /** Get the current download status of the runtime ONNX models. */
    status: 'models:status',
    /** Trigger download of any missing models (NER first, then bge-m3). */
    download: 'models:download',
    /** Push: model download status changed (for the settings UI progress bar). */
    statusChanged: 'models:status-changed'
  },
  ocr: {
    progress: 'ocr:progress',
    complete: 'ocr:complete'
  },
  updater: {
    startDownload: 'updater:start-download',
    installNow: 'updater:install-now',
    installOnQuit: 'updater:install-on-quit',
    dismiss: 'updater:dismiss',
    state: 'updater:state',
    progress: 'updater:progress'
  }
} as const
