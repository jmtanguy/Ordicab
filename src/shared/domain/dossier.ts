import type { StoredDocumentMetadata } from './document'

export const DOSSIER_STATUS_VALUES = ['active', 'pending', 'completed', 'archived'] as const

export type DossierStatus = (typeof DOSSIER_STATUS_VALUES)[number]

export interface KeyDate {
  id: string
  dossierId: string
  label: string
  date: string
  note?: string
}

export interface DossierKeyDateUpsertInput {
  id?: string
  dossierId: string
  label: string
  date: string
  note?: string
}

export interface DossierKeyDateDeleteInput {
  dossierId: string
  keyDateId: string
}

export interface KeyReference {
  id: string
  dossierId: string
  label: string
  value: string
  note?: string
}

export interface DossierKeyReferenceUpsertInput {
  id?: string
  dossierId: string
  label: string
  value: string
  note?: string
}

export interface DossierKeyReferenceDeleteInput {
  dossierId: string
  keyReferenceId: string
}

export interface DossierRegistrationInput {
  id: string
}

export interface DossierUnregisterInput {
  id: string
}

export interface DossierEligibleFolder {
  id: string
  name: string
  path: string
}

export interface DossierScopedQuery {
  dossierId: string
}

export type DossierAiDirectoryLanguage = 'fr' | 'en'

export interface DossierAiLocalePaths {
  aiRootName: string
  templatesName: string
  productionName: string
  confidentialName: string
}

export interface DossierAiExportDocumentEntry {
  documentId: string
  sourceRelativePath: string
  filename: string
  exportedTextPath: string
  modifiedAt: string
  description?: string
  tags: string[]
}

export interface DossierAiExportAnalyzeResult {
  dossierId: string
  dossierName: string
  locale: DossierAiDirectoryLanguage
  paths: DossierAiLocalePaths
  totalDocumentCount: number
  extractableDocumentCount: number
  extractedDocumentCount: number
  missingExtractionCount: number
  missingExtractionDocuments: Array<{
    documentId: string
    filename: string
    relativePath: string
  }>
  canExport: boolean
}

export interface DossierAiExportInput {
  dossierId: string
  rootPath: string
  anonymize: boolean
}

export interface DossierAiExportResult {
  dossierId: string
  rootPath: string
  aiPath: string
  confidentialPath: string | null
  locale: DossierAiDirectoryLanguage
  exportedDocumentCount: number
  exportedTemplateCount: number
  anonymized: boolean
}

export interface DossierAiImportAnalyzeInput {
  dossierId: string
  sourcePath: string
}

export interface DossierAiImportSourceFile {
  relativePath: string
  absolutePath: string
}

export interface DossierAiImportAnalyzeResult {
  dossierId: string
  locale: DossierAiDirectoryLanguage
  paths: DossierAiLocalePaths
  sourcePath: string
  resolvedAiPath: string | null
  resolvedProductionPath: string
  resolvedConfidentialPath: string | null
  hasPiiMapping: boolean
  fileCount: number
  files: DossierAiImportSourceFile[]
}

export interface ImportedProductionFileReport {
  sourceRelativePath: string
  savedRelativePath: string
  restoredPii: boolean
  extractedText: boolean
  indexed: boolean
  status: 'imported' | 'skipped' | 'failed'
  message: string | null
}

export interface DossierAiImportInput {
  dossierId: string
  sourcePath: string
  selectedRelativePaths?: string[]
}

export interface DossierAiImportResult {
  dossierId: string
  resolvedProductionPath: string
  importedCount: number
  skippedCount: number
  failedCount: number
  files: ImportedProductionFileReport[]
}

export interface DossierUpdateInput {
  id: string
  status: DossierStatus
  type: string
  information?: string
}

export interface DossierSummary {
  id: string
  uuid?: string
  name: string
  type: string
  status: DossierStatus
  updatedAt: string
  lastOpenedAt: string | null
  nextUpcomingKeyDate: string | null
  nextUpcomingKeyDateLabel: string | null
}

export interface DossierDetail extends DossierSummary {
  registeredAt: string
  createdAt?: string
  description?: string
  information?: string
  keyDates: KeyDate[]
  keyReferences: KeyReference[]
}

export interface DossierMetadataFile extends DossierDetail {
  documents: StoredDocumentMetadata[]
}
