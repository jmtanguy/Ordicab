import { z } from 'zod'

import type {
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  StoredDocumentMetadata
} from '@shared/domain/document'

import { dossierIdSchema } from './dossierId'

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, '/')
}

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

const documentRelativePathSchema = z.string().min(1).transform(normalizeRelativePath)
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
  documentId: z.string().min(1).transform(normalizeRelativePath),
  forceRefresh: z.boolean().optional()
})

export const documentRelocationInputSchema = z.object({
  dossierId: dossierIdSchema,
  documentUuid: z.string().min(1),
  toDocumentId: z.string().min(1).transform(normalizeRelativePath),
  fromDocumentId: z.string().min(1).transform(normalizeRelativePath).optional()
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
  DocumentMetadataDraft,
  DocumentMetadataUpdate,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentRelocationInput,
  StoredDocumentMetadata
}
