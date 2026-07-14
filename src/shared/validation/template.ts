import { z } from 'zod'

import {
  TEMPLATE_DOCUMENT_KIND_VALUES,
  type TemplateDeleteInput,
  type TemplateDocxInput,
  type TemplateDraft,
  type TemplateRecord,
  type TemplateUpdate
} from '@shared/domain/template'

export const templateFormatSchema = z.enum(['txt', 'docx'])
const requiredTemplateNameSchema = z.string().trim().min(1)
const templateContentSchema = z.string().default('')
const templateDocumentKindSchema = z.enum(TEMPLATE_DOCUMENT_KIND_VALUES).default('document')

export const templateRecordSchema = z.object({
  uuid: z.string().min(1),
  name: requiredTemplateNameSchema,
  description: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  macros: z.array(z.string()).default([]),
  hasDocxSource: z.boolean().default(false),
  documentKind: templateDocumentKindSchema.optional(),
  category: z.string().trim().min(1).optional(),
  updatedAt: z.string().min(1)
})

export const templateDraftSchema = z.object({
  name: requiredTemplateNameSchema,
  content: templateContentSchema,
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  documentKind: templateDocumentKindSchema.optional(),
  category: z.string().trim().optional()
})

export const templateUpdateSchema = templateDraftSchema.extend({
  uuid: z.string().min(1),
  // Omitted content = keep the stored content (e.g. a drag-and-drop category move)
  content: z.string().optional()
})

export const templateDeleteInputSchema = z.object({
  uuid: z.string().min(1)
})

export const templateDocxInputSchema = z.object({
  uuid: z.string().min(1),
  pickToken: z.string().min(1).optional()
})

export const templateTagifyAnalyzeInputSchema = z.object({
  templateUuid: z.string().min(1),
  model: z.string().min(1).optional(),
  piiEnabled: z.boolean().optional()
})

export const templateTagifyApplyInputSchema = z.object({
  templateUuid: z.string().min(1),
  replacements: z
    .array(
      z.object({
        originalText: z.string().min(1),
        tagPath: z.string().min(1)
      })
    )
    .min(1)
})

export type {
  TemplateDeleteInput,
  TemplateDocxInput,
  TemplateDraft,
  TemplateRecord,
  TemplateUpdate
}

export type {
  TemplateTagifyAnalyzeInput,
  TemplateTagifyAnalyzeResult,
  TemplateTagifyApplyInput,
  TemplateTagifyApplyResult,
  TemplateTagifyProposal
} from '@shared/domain/template'
