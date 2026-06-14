import { z } from 'zod'

import type {
  GenerateDocumentInput,
  GeneratePreviewInput,
  GeneratePreviewInvoiceDocxInput,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput
} from '@shared/domain/generate'

import { isBlankTemplateContent } from '@shared/templateContent'

import { dossierIdSchema } from './dossier'
import { templateFormatSchema } from './template'

export const generateDocumentInputSchema = z.object({
  dossierId: dossierIdSchema,
  templateUuid: z.string().min(1),
  primaryContactUuid: z.string().min(1).optional(),
  contactRoleOverrides: z.record(z.string(), z.string()).optional(),
  tagOverrides: z.record(z.string(), z.string()).optional(),
  outputPath: z.string().min(1).optional(),
  filename: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional()
})

export const generatePreviewInputSchema = generateDocumentInputSchema.extend({
  tagOverrides: z.record(z.string(), z.string()).optional()
})

export const saveGeneratedDocumentInputSchema = z.object({
  dossierId: dossierIdSchema,
  filename: z.string().trim().min(1),
  format: templateFormatSchema,
  html: z.string().refine((value) => !isBlankTemplateContent(value), 'Draft content is required.'),
  outputPath: z.string().min(1).optional(),
  templateUuid: z.string().min(1).optional(),
  tagOverrides: z.record(z.string(), z.string()).optional(),
  primaryContactUuid: z.string().min(1).optional(),
  contactRoleOverrides: z.record(z.string(), z.string()).optional()
})

export const selectOutputPathInputSchema = z.object({
  defaultFilename: z.string().optional()
})

/** Per-(template, dossier) memorized manual values — `{dossier}/.ordicab/generation-prefill.json`. */
const generationPrefillEntrySchema = z.object({
  tagOverrides: z.record(z.string(), z.string()),
  primaryContactUuid: z.string().optional(),
  roleContactUuids: z.record(z.string(), z.string()).optional(),
  updatedAt: z.string()
})

export const generationPrefillFileSchema = z.record(z.string(), generationPrefillEntrySchema)

export type GenerationPrefillEntry = z.infer<typeof generationPrefillEntrySchema>
export type GenerationPrefillFile = z.infer<typeof generationPrefillFileSchema>

export const generatePreviewInvoiceDocxInputSchema = z.object({
  dossierId: dossierIdSchema,
  templateUuid: z.string().min(1),
  billingItemUuids: z.array(z.string().uuid()).min(1),
  issuedAt: z.string().min(1).optional(),
  dueAt: z.string().min(1).optional(),
  notes: z.string().optional(),
  tagOverrides: z.record(z.string(), z.string()).optional(),
  primaryContactUuid: z.string().min(1).optional(),
  contactRoleOverrides: z.record(z.string(), z.string()).optional()
})

export type {
  GenerateDocumentInput,
  GeneratePreviewInput,
  GeneratePreviewInvoiceDocxInput,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput
}
