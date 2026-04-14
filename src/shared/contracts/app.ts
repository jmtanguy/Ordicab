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
