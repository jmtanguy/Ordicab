import type { StoredDocumentMetadata } from './document'
import type { DossierBillingItem, DossierFeeAgreement } from './billing'

export const DOSSIER_STATUS_VALUES = ['active', 'pending', 'completed', 'archived'] as const

export type DossierStatus = (typeof DOSSIER_STATUS_VALUES)[number]

/** Statut de l'aide juridictionnelle (AJ) sur le dossier. */
export const LEGAL_AID_STATUS_VALUES = ['none', 'requested', 'granted', 'rejected'] as const
export type LegalAidStatus = (typeof LEGAL_AID_STATUS_VALUES)[number]

/** Type d'AJ une fois accordée : totale (prise en charge intégrale par l'État) ou partielle. */
export const LEGAL_AID_TYPE_VALUES = ['total', 'partial'] as const
export type LegalAidType = (typeof LEGAL_AID_TYPE_VALUES)[number]

/**
 * Métadonnées d'aide juridictionnelle attachées à un dossier.
 *
 * Saisie 100 % libre par l'avocat : il renseigne lui-même le statut, le type,
 * le taux (AJ partielle), les références BAJ et les montants (rétribution État
 * et complément). Aucun barème ni auto-calcul.
 */
export interface DossierLegalAid {
  status: LegalAidStatus
  /** Requis lorsque `status === 'granted'`. */
  type?: LegalAidType
  /** Taux d'AJ partielle en points de base (ex. 5500 = 55 %). Requis lorsque `type === 'partial'`. */
  shareBasisPoints?: number
  /** Numéro de la décision du BAJ (bureau d'aide juridictionnelle). */
  bajDecisionNumber?: string
  /** Date de la décision du BAJ (ISO YYYY-MM-DD). */
  bajDecisionDate?: string
  /** BAJ / juridiction de rattachement. */
  bajOffice?: string
  /** Numéro d'AJ / référence CARPA. */
  aidNumber?: string
  /** Rétribution versée par l'État, saisie par l'avocat, en centimes HT. */
  stateRetributionHtCents?: number
  /** Complément d'honoraires (AJ partielle), saisi par l'avocat, en centimes HT. */
  complementHtCents?: number
  /** Garde-fou : passe à true une fois l'orchestration automatique exécutée pour éviter les doublons. */
  autoSetupDone?: boolean
  notes?: string
}

export const KEY_DATE_TAG_VALUES = [
  'cancelled',
  'postponed',
  'urgent',
  'imperative',
  'important',
  'to_confirm',
  'confidential',
  'to_do'
] as const
export type KeyDateTag = (typeof KEY_DATE_TAG_VALUES)[number]

export interface KeyDate {
  id: string
  dossierId: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface DossierKeyDateUpsertInput {
  id?: string
  dossierId: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
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

/**
 * Reserved label for the auto-injected key reference that holds the dossier name.
 * Editing this entry via the references UI updates `metadata.name`.
 */
export const DOSSIER_NAME_REFERENCE_LABEL = 'Nom du dossier'

/**
 * Case-insensitive match used by services and UI to detect the reserved name entry.
 */
export function isDossierNameReferenceLabel(label: string): boolean {
  return (
    label.trim().toLocaleLowerCase('fr-FR') ===
    DOSSIER_NAME_REFERENCE_LABEL.toLocaleLowerCase('fr-FR')
  )
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

export interface DossierCreateInput {
  name: string
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
  juridiction?: string
  tribunal?: string
  legalAid?: DossierLegalAid
}

export interface DossierUpdateLegalAidInput {
  dossierId: string
  legalAid: DossierLegalAid
}

export interface DossierSetupLegalAidInput {
  dossierId: string
  /** Force la régénération même si l'AJ a déjà été configurée. */
  force?: boolean
}

export interface DossierSetupLegalAidResult {
  feeAgreementId: string
  billingItemIds: string[]
  invoiceIds: string[]
  invoiceNumbers: string[]
  documentUuids: string[]
  keyDateIds: string[]
  warnings: string[]
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
  juridiction?: string
  tribunal?: string
  legalAid?: DossierLegalAid
  feeAgreements: DossierFeeAgreement[]
  billingItems: DossierBillingItem[]
  keyDates: KeyDate[]
  keyReferences: KeyReference[]
}

export interface DossierMetadataFile extends DossierDetail {
  documents: StoredDocumentMetadata[]
}
