import { z } from 'zod'

import type {
  DocumentFileMoveInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderMoveInput,
  DocumentFolderRenameInput,
  DocumentImportInput,
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  DocumentTrashInput,
  DocumentTrashRestoreInput,
  StoredDocumentMetadata
} from '@shared/domain/document'
import type { GlobalSearchQuery, SemanticSearchQuery } from '@shared/contracts/documents'

import { dossierIdSchema } from './dossierId'

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, '/')
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return false
  }
  return !value.split('/').includes('..')
}

const SAFE_RELATIVE_PATH_MESSAGE = 'Path must be relative and must not contain traversal segments.'

export const safeRelativePathSchema = z
  .string()
  .min(1)
  .transform(normalizeRelativePath)
  .refine(isSafeRelativePath, { message: SAFE_RELATIVE_PATH_MESSAGE })

function normalizeDescription(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function normalizeTags(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const tag = value.trim()

    if (!tag || seen.has(tag)) {
      continue
    }

    seen.add(tag)
    normalized.push(tag)
  }

  return normalized
}

const documentRelativePathSchema = safeRelativePathSchema
const documentDescriptionSchema = z.string().optional().transform(normalizeDescription)
const documentTagsSchema = z.array(z.string()).transform(normalizeTags)
const documentByteLengthSchema = z.number().int().nonnegative()
const documentModifiedAtSchema = z.string().min(1)

export const storedDocumentMetadataSchema = z.object({
  uuid: z.string().min(1),
  relativePath: documentRelativePathSchema,
  filename: z.string().min(1).optional(),
  byteLength: documentByteLengthSchema.optional(),
  modifiedAt: documentModifiedAtSchema.optional(),
  description: documentDescriptionSchema,
  tags: documentTagsSchema
})

export const documentMetadataUpdateSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: z.string().min(1),
  description: documentDescriptionSchema,
  tags: documentTagsSchema
})

export const documentPreviewInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: safeRelativePathSchema,
  forceRefresh: z.boolean().optional(),
  readCacheOnly: z.boolean().optional()
})

export const documentRelocationInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentUuid: z.string().min(1),
  toDocumentPath: safeRelativePathSchema,
  fromDocumentPath: safeRelativePathSchema.optional()
})

const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|]/

function isSafeFsName(value: string): boolean {
  if (!value || value === '.' || value === '..') return false
  if (value.startsWith('.')) return false
  if (FORBIDDEN_NAME_CHARS.test(value)) return false
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return false
  if (value.trim() !== value) return false
  return true
}

const SAFE_FS_NAME_MESSAGE =
  'Name cannot start with a dot, end with whitespace, or contain / \\ : * ? " < > |'

const safeFsNameSchema = z.string().min(1).max(255).refine(isSafeFsName, {
  message: SAFE_FS_NAME_MESSAGE
})

export const documentFolderCreateInputSchema = z.object({
  dossierId: dossierIdSchema,
  parentPath: z
    .string()
    .optional()
    .transform((value) => (value ? normalizeRelativePath(value) : ''))
    .refine((value) => value === '' || isSafeRelativePath(value), {
      message: SAFE_RELATIVE_PATH_MESSAGE
    }),
  name: safeFsNameSchema
})

export const documentFolderRenameInputSchema = z.object({
  dossierId: dossierIdSchema,
  fromPath: safeRelativePathSchema,
  newName: safeFsNameSchema
})

export const documentFolderDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  path: safeRelativePathSchema
})

export const documentFileRenameInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: safeRelativePathSchema,
  newFilename: safeFsNameSchema
})

export const documentTrashInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPaths: z.array(safeRelativePathSchema).min(1).max(500)
})

export const documentTrashRestoreInputSchema = z.object({
  dossierId: dossierIdSchema,
  deletionId: z.string().uuid()
})

// Destination folder for move operations; the empty string addresses the dossier root.
const targetFolderPathSchema = z
  .string()
  .transform((value) => (value ? normalizeRelativePath(value) : ''))
  .refine((value) => value === '' || isSafeRelativePath(value), {
    message: SAFE_RELATIVE_PATH_MESSAGE
  })

export const emailAttachmentSaveInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: safeRelativePathSchema,
  attachmentIndexes: z.array(z.number().int().nonnegative()).min(1).max(200).optional(),
  targetFolderPath: targetFolderPathSchema.optional()
})

const pdfPageRangeSchema = z
  .object({
    from: z.number().int().positive(),
    to: z.number().int().positive()
  })
  .refine((range) => range.from <= range.to, {
    message: 'Page range start must not exceed its end.'
  })

const pdfSourceSchema = safeRelativePathSchema.refine(
  (value) => value.toLowerCase().endsWith('.pdf'),
  { message: 'Only PDF documents are supported.' }
)

export const pdfExtractPagesInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: pdfSourceSchema,
  ranges: z.array(pdfPageRangeSchema).min(1).max(100),
  outputFilename: safeFsNameSchema.optional()
})

export const pdfMergeInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPaths: z.array(pdfSourceSchema).min(2).max(100),
  outputFilename: safeFsNameSchema,
  targetFolderPath: targetFolderPathSchema.optional()
})

export const pdfSplitInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPath: pdfSourceSchema,
  mode: z.union([
    z.literal('each-page'),
    z.object({ ranges: z.array(pdfPageRangeSchema).min(1).max(100) })
  ])
})

export const documentFileMoveInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentPaths: z.array(safeRelativePathSchema).min(1).max(500),
  targetFolderPath: targetFolderPathSchema
})

export const documentFolderMoveInputSchema = z.object({
  dossierId: dossierIdSchema,
  fromPath: safeRelativePathSchema,
  targetFolderPath: targetFolderPathSchema
})

// Import is the one document API that accepts absolute paths: sources live
// outside the dossier by definition. The service still rejects sources that
// resolve inside the dossier root.
export const documentImportInputSchema = z.object({
  dossierId: dossierIdSchema,
  targetFolderPath: targetFolderPathSchema,
  sourcePaths: z.array(z.string().min(1)).min(1).max(200)
})

export const semanticSearchQuerySchema: z.ZodType<SemanticSearchQuery> = z.object({
  dossierId: dossierIdSchema,
  query: z.string().trim().min(1),
  topK: z.number().int().positive().max(100).optional()
})

export const globalSearchQuerySchema: z.ZodType<GlobalSearchQuery> = z.object({
  query: z.string().trim().min(1),
  topK: z.number().int().positive().max(100).optional()
})

export const documentMetadataDraftSchema = z
  .object({
    description: z.string().default(''),
    tagsInput: z.string().default('')
  })
  .transform(({ description, tagsInput }) => ({
    description: normalizeDescription(description),
    tags: normalizeTags(tagsInput.split(','))
  }))

export type {
  DocumentFileMoveInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderMoveInput,
  DocumentFolderRenameInput,
  DocumentImportInput,
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  DocumentTrashInput,
  DocumentTrashRestoreInput,
  StoredDocumentMetadata
}
