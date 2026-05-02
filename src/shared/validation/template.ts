import { z } from 'zod'

import type {
  TemplateDeleteInput,
  TemplateDocxInput,
  TemplateDraft,
  TemplateRecord,
  TemplateUpdate
} from '@shared/domain/template'

export const templateFormatSchema = z.enum(['txt', 'docx'])
const requiredTemplateNameSchema = z.string().trim().min(1)
const templateContentSchema = z.string().default('')

export const templateRecordSchema = z.object({
  id: z.string().min(1),
  name: requiredTemplateNameSchema,
  description: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  macros: z.array(z.string()).default([]),
  hasDocxSource: z.boolean().default(false),
  updatedAt: z.string().min(1)
})

export const templateDraftSchema = z.object({
  name: requiredTemplateNameSchema,
  content: templateContentSchema,
  description: z.string().optional(),
  tags: z.array(z.string()).optional()
})

export const templateUpdateSchema = templateDraftSchema.extend({
  id: z.string().min(1)
})

export const templateDeleteInputSchema = z.object({
  id: z.string().min(1)
})

export const templateDocxInputSchema = z.object({
  id: z.string().min(1),
  pickToken: z.string().min(1).optional()
})

export type {
  TemplateDeleteInput,
  TemplateDocxInput,
  TemplateDraft,
  TemplateRecord,
  TemplateUpdate
}
