import { z } from 'zod'

import type {
  DocumentFileDeleteInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderRenameInput,
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  StoredDocumentMetadata
} from '@shared/domain/document'
import type { SemanticSearchQuery } from '@shared/contracts/documents'

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

const safeRelativePathSchema = z
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
const documentTextExtractionSchema = z.object({
  state: z.enum(['not-extractable', 'extractable', 'extracted']),
  isExtractable: z.boolean()
})

export const documentMetadataSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  filename: z.string().min(1),
  byteLength: documentByteLengthSchema,
  relativePath: documentRelativePathSchema,
  modifiedAt: z.string().min(1),
  description: documentDescriptionSchema,
  tags: documentTagsSchema,
  textExtraction: documentTextExtractionSchema
})

export const storedDocumentMetadataSchema = z.object({
  uuid: z.string().min(1).optional(),
  relativePath: documentRelativePathSchema,
  filename: z.string().min(1).optional(),
  byteLength: documentByteLengthSchema.optional(),
  modifiedAt: documentModifiedAtSchema.optional(),
  description: documentDescriptionSchema,
  tags: documentTagsSchema
})

export const documentMetadataUpdateSchema = z.object({
  dossierId: dossierIdSchema,
  documentId: z.string().min(1),
  description: documentDescriptionSchema,
  tags: documentTagsSchema
})

export const documentPreviewInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentId: safeRelativePathSchema,
  forceRefresh: z.boolean().optional(),
  readCacheOnly: z.boolean().optional()
})

export const documentRelocationInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentUuid: z.string().min(1),
  toDocumentId: safeRelativePathSchema,
  fromDocumentId: safeRelativePathSchema.optional()
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
  documentId: safeRelativePathSchema,
  newFilename: safeFsNameSchema
})

export const documentFileDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentId: safeRelativePathSchema
})

export const semanticSearchQuerySchema: z.ZodType<SemanticSearchQuery> = z.object({
  dossierId: dossierIdSchema,
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
  DocumentFileDeleteInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderRenameInput,
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  StoredDocumentMetadata
}
