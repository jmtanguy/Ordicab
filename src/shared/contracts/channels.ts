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
    update: 'dossier:update',
    unregister: 'dossier:unregister',
    upsertKeyDate: 'dossier:upsertKeyDate',
    deleteKeyDate: 'dossier:deleteKeyDate',
    moveKeyDate: 'dossier:moveKeyDate',
    listGeneralKeyDates: 'dossier:listGeneralKeyDates',
    upsertGeneralKeyDate: 'dossier:upsertGeneralKeyDate',
    deleteGeneralKeyDate: 'dossier:deleteGeneralKeyDate',
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
    setupLegalAid: 'dossier:setupLegalAid'
  },
  contact: {
    list: 'contact:list',
    upsert: 'contact:upsert',
    delete: 'contact:delete',
    checkConflicts: 'contact:check-conflicts'
  },
  entity: {
    get: 'entity:get',
    update: 'entity:update',
    importDefaultTemplate: 'entity:default-template:import',
    openDefaultTemplate: 'entity:default-template:open',
    removeDefaultTemplate: 'entity:default-template:remove',
    importStamp: 'entity:stamp:import',
    removeStamp: 'entity:stamp:remove',
    getStampDataUrl: 'entity:stamp:data-url'
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
    exportFec: 'invoice:export-fec',
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
    searchAll: 'document:search-all',
    createFolder: 'document:folder:create',
    renameFolder: 'document:folder:rename',
    deleteFolder: 'document:folder:delete',
    renameFile: 'document:file:rename',
    trashFiles: 'document:file:trash',
    restoreTrash: 'document:trash:restore',
    listTrash: 'document:trash:list',
    deleteTrashEntry: 'document:trash:delete',
    moveFiles: 'document:file:move',
    moveFolder: 'document:folder:move',
    importFiles: 'document:file:import',
    saveEmailAttachments: 'document:email:save-attachments',
    pdfExtractPages: 'document:pdf:extract-pages',
    pdfMerge: 'document:pdf:merge',
    pdfSplit: 'document:pdf:split'
  },
  pieces: {
    list: 'pieces:list',
    add: 'pieces:add',
    update: 'pieces:update',
    remove: 'pieces:remove',
    generate: 'pieces:generate',
    generateProgress: 'pieces:generate-progress'
  },
  compare: {
    run: 'compare:run',
    progress: 'compare:progress'
  },
  redaction: {
    list: 'redaction:list',
    create: 'redaction:create',
    get: 'redaction:get',
    manualEdit: 'redaction:manual-edit',
    decideOp: 'redaction:decide-op',
    undo: 'redaction:undo',
    redo: 'redaction:redo',
    updateMeta: 'redaction:update-meta',
    syncChat: 'redaction:sync-chat',
    resetChat: 'redaction:reset-chat',
    commit: 'redaction:commit',
    discard: 'redaction:discard'
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
    docxSynced: 'template:docx-synced',
    tagifyAnalyze: 'template:tagify-analyze',
    tagifyApply: 'template:tagify-apply'
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
  calendarSync: {
    statusGet: 'calendar-sync:status-get',
    settingsSave: 'calendar-sync:settings-save',
    credentialsDelete: 'calendar-sync:credentials-delete',
    setOptions: 'calendar-sync:set-options',
    syncNow: 'calendar-sync:sync-now',
    /** Push: sync status changed (in progress / done / error). */
    statusChanged: 'calendar-sync:status-changed'
  },
  cowork: {
    export: 'cowork:export',
    reimport: 'cowork:reimport',
    status: 'cowork:status',
    exportProgress: 'cowork:export-progress'
  },
  ai: {
    settingsGet: 'ai:settings-get',
    settingsSave: 'ai:settings-save',
    personasGet: 'ai:personas-get',
    personasSave: 'ai:personas-save',
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
