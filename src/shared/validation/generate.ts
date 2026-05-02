import { z } from 'zod'

import type {
  GenerateDocumentInput,
  GeneratePreviewInput,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput
} from '@shared/domain/generate'

import { isBlankTemplateContent } from '@shared/templateContent'

import { dossierIdSchema } from './dossier'
import { templateFormatSchema } from './template'

export const generateDocumentInputSchema = z.object({
  dossierId: dossierIdSchema,
  templateId: z.string().min(1),
  primaryContactId: z.string().min(1).optional(),
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
  outputPath: z.string().min(1).optional()
})

export const selectOutputPathInputSchema = z.object({
  defaultFilename: z.string().optional()
})

export type {
  GenerateDocumentInput,
  GeneratePreviewInput,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput
}
