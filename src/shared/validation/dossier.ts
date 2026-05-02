import { z } from 'zod'

import type {
  DossierAiExportAnalyzeResult,
  DossierAiExportInput,
  DossierAiExportResult,
  DossierAiImportAnalyzeInput,
  DossierAiImportAnalyzeResult,
  DossierAiImportInput,
  DossierAiImportResult,
  DossierDetail,
  DossierEligibleFolder,
  DossierMetadataFile,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierStatus,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput
} from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'
import { storedDocumentMetadataSchema } from './document'
import { keyDateSchema } from './keyDate'
import { keyReferenceSchema } from './keyReference'

export { dossierIdSchema } from './dossierId'
function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const optionalInformationTextSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
)

export const dossierStatusValues = ['active', 'pending', 'completed', 'archived'] as const
export const dossierStatusSchema = z.enum(dossierStatusValues)
export const dossierTypeSchema = z.string()
export const dossierRegistrationInputSchema = z.object({
  id: dossierIdSchema
})
export const dossierUnregisterInputSchema = z.object({
  id: dossierIdSchema
})
export const dossierEligibleFolderSchema = z.object({
  id: dossierIdSchema,
  name: z.string().min(1),
  path: z.string().min(1)
})

export const dossierSchema = z.object({
  id: dossierIdSchema,
  uuid: z.string().min(1).optional(),
  name: z.string().min(1),
  type: dossierTypeSchema,
  status: dossierStatusSchema,
  updatedAt: z.string().min(1),
  lastOpenedAt: z.string().min(1).nullable(),
  nextUpcomingKeyDate: z.string().min(1).nullable(),
  nextUpcomingKeyDateLabel: z.string().min(1).nullable()
})

export const dossierDetailSchema = dossierSchema.extend({
  registeredAt: z.string().min(1),
  information: optionalInformationTextSchema,
  keyDates: z.array(keyDateSchema),
  keyReferences: z.array(keyReferenceSchema)
})

export const dossierMetadataFileSchema = dossierDetailSchema.extend({
  documents: z.array(storedDocumentMetadataSchema).default([])
})

export const dossierDeleteInputSchema = z.object({
  id: dossierIdSchema
})

export const dossierScopedQuerySchema = z.object({
  dossierId: dossierIdSchema
})

const dossierAiDirectoryLanguageSchema = z.enum(['fr', 'en'])

export const dossierAiLocalePathsSchema = z.object({
  aiRootName: z.string().min(1),
  templatesName: z.string().min(1),
  productionName: z.string().min(1),
  confidentialName: z.string().min(1)
})

export const dossierAiExportAnalyzeResultSchema = z.object({
  dossierId: dossierIdSchema,
  dossierName: z.string().min(1),
  locale: dossierAiDirectoryLanguageSchema,
  paths: dossierAiLocalePathsSchema,
  totalDocumentCount: z.number().int().nonnegative(),
  extractableDocumentCount: z.number().int().nonnegative(),
  extractedDocumentCount: z.number().int().nonnegative(),
  missingExtractionCount: z.number().int().nonnegative(),
  missingExtractionDocuments: z.array(
    z.object({
      documentId: z.string().min(1),
      filename: z.string().min(1),
      relativePath: z.string().min(1)
    })
  ),
  canExport: z.boolean()
})

export const dossierAiExportInputSchema = z.object({
  dossierId: dossierIdSchema,
  rootPath: z.string().min(1),
  anonymize: z.boolean()
})

export const dossierAiExportResultSchema = z.object({
  dossierId: dossierIdSchema,
  rootPath: z.string().min(1),
  aiPath: z.string().min(1),
  confidentialPath: z.string().min(1).nullable(),
  locale: dossierAiDirectoryLanguageSchema,
  exportedDocumentCount: z.number().int().nonnegative(),
  exportedTemplateCount: z.number().int().nonnegative(),
  anonymized: z.boolean()
})

export const dossierAiImportAnalyzeInputSchema = z.object({
  dossierId: dossierIdSchema,
  sourcePath: z.string().min(1)
})

export const dossierAiImportAnalyzeResultSchema = z.object({
  dossierId: dossierIdSchema,
  locale: dossierAiDirectoryLanguageSchema,
  paths: dossierAiLocalePathsSchema,
  sourcePath: z.string().min(1),
  resolvedAiPath: z.string().min(1).nullable(),
  resolvedProductionPath: z.string().min(1),
  resolvedConfidentialPath: z.string().min(1).nullable(),
  hasPiiMapping: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(
    z.object({
      relativePath: z.string().min(1),
      absolutePath: z.string().min(1)
    })
  )
})

export const dossierAiImportInputSchema = z.object({
  dossierId: dossierIdSchema,
  sourcePath: z.string().min(1)
})

export const importedProductionFileReportSchema = z.object({
  sourceRelativePath: z.string().min(1),
  savedRelativePath: z.string().min(1),
  restoredPii: z.boolean(),
  extractedText: z.boolean(),
  indexed: z.boolean(),
  status: z.enum(['imported', 'skipped', 'failed']),
  message: z.string().nullable()
})

export const dossierAiImportResultSchema = z.object({
  dossierId: dossierIdSchema,
  resolvedProductionPath: z.string().min(1),
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  files: z.array(importedProductionFileReportSchema)
})

export const dossierUpdateInputSchema = z.object({
  id: dossierIdSchema,
  status: dossierStatusSchema,
  type: dossierTypeSchema,
  information: optionalInformationTextSchema
})

export type {
  DossierAiExportAnalyzeResult,
  DossierAiExportInput,
  DossierAiExportResult,
  DossierAiImportAnalyzeInput,
  DossierAiImportAnalyzeResult,
  DossierAiImportInput,
  DossierAiImportResult,
  DossierDetail,
  DossierEligibleFolder,
  DossierMetadataFile,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierStatus,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput
}
export type DossierDeleteInput = z.infer<typeof dossierDeleteInputSchema>
