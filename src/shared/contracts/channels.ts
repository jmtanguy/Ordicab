export const IPC_CHANNELS = {
  app: {
    version: 'app:version',
    getLocale: 'app:getLocale',
    setLocale: 'app:setLocale',
    openExternal: 'app:openExternal',
    openFolder: 'app:openFolder'
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
    unregister: 'dossier:unregister',
    update: 'dossier:update',
    upsertKeyDate: 'dossier:upsertKeyDate',
    deleteKeyDate: 'dossier:deleteKeyDate',
    upsertKeyReference: 'dossier:upsertKeyReference',
    deleteKeyReference: 'dossier:deleteKeyReference',
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
    update: 'entity:update'
  },
  document: {
    list: 'document:list',
    preview: 'document:preview',
    contentStatus: 'document:content-status',
    extractContent: 'document:extract-content',
    clearContentCache: 'document:clear-content-cache',
    startWatching: 'document:watch:start',
    stopWatching: 'document:watch:stop',
    didChange: 'document:watch:changed',
    availabilityChanged: 'document:watch:availability',
    saveMetadata: 'document:metadata:save',
    openFile: 'document:open-file'
  },
  ordicab: {
    dataChanged: 'ordicab:data-changed'
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
    docxSynced: 'template:docx-synced'
  },
  generate: {
    document: 'generate:document',
    preview: 'generate:preview',
    save: 'generate:save',
    previewDocx: 'generate:preview-docx',
    selectOutputPath: 'generate:select-output-path'
  },
  claudeMd: {
    regenerate: 'claudeMd:regenerate',
    status: 'claudeMd:status'
  },
  ai: {
    settingsGet: 'ai:settings-get',
    settingsSave: 'ai:settings-save',
    connectionStatus: 'ai:connection-status',
    remoteConnectionStatus: 'ai:remote-connection-status',
    executeCommand: 'ai:execute-command',
    cancelCommand: 'ai:cancel-command',
    resetConversation: 'ai:reset-conversation',
    intentReceived: 'ai:intent-received',
    textToken: 'ai:text-token',
    deleteApiKey: 'ai:delete-api-key',
    cloudProviderStatus: 'ai:cloud-provider-status'
  },
  ocr: {
    progress: 'ocr:progress',
    complete: 'ocr:complete'
  }
} as const
