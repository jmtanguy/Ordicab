export const APP_LOCALES = ['en', 'fr'] as const

export type AppLocale = (typeof APP_LOCALES)[number]

export interface AppVersionInfo {
  name: string
  version: string
}

export interface AppLocaleInfo {
  locale: AppLocale
}

export interface SetLocaleInput {
  locale: AppLocale
}

export interface OpenExternalInput {
  url: string
}

export interface OpenFolderInput {
  path: string
}

/**
 * Request to surface a native OS notification (reminders for upcoming key dates).
 * `dossierId` is echoed back to the renderer on click so the app can navigate
 * straight to the relevant dossier.
 */
export interface NotifyInput {
  title: string
  body: string
  dossierId?: string
}

/** Pushed to the renderer when the user clicks a native notification. */
export interface NotificationClickedEvent {
  dossierId?: string
}

export interface EulaStatus {
  required: boolean
  version: string
  content: string
}

export interface EulaStatusInput {
  locale: AppLocale
}

export interface EulaAcceptInput {
  version: string
  locale?: AppLocale
}

export interface DomainSelectionResult {
  selectedPath: string | null
}

export interface DomainStatusSnapshot {
  registeredDomainPath: string | null
  isAvailable: boolean
  dossierCount: number
}

export type ModelReadiness = 'missing' | 'downloading' | 'ready' | 'error'

/** Download state of the runtime ONNX models, surfaced in AI settings. */
export interface ModelDownloadStatus {
  /** NER model — gate for remote AI (PII pseudonymisation). */
  ner: ModelReadiness
  /** bge-m3 embedding model — gate for semantic search. */
  embedding: ModelReadiness
  /** Current file/byte progress, when a download is running. */
  progress: {
    modelId: string
    file: string
    fileIndex: number
    fileCount: number
    receivedBytes: number
    totalBytes: number | null
  } | null
  /** Last error message, if any. */
  error: string | null
}
