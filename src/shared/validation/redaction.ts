import { z } from 'zod'

import type {
  RedactionCommitInput,
  RedactionCreateInput,
  RedactionDecideOpInput,
  RedactionManualEditInput,
  RedactionUpdateMetaInput
} from '@shared/domain/redaction'

import { dossierIdSchema } from './dossierId'

export const redactionDocKindSchema = z.enum([
  'conclusions',
  'courrier',
  'relance',
  'information',
  'autre'
])

export const redactionSaveModeSchema = z.enum(['new_file', 'replace_original'])

export const redactionDecisionSchema = z.enum(['accept', 'reject'])

export const redactionOpTypeSchema = z.enum(['insert_after', 'insert_before', 'replace', 'delete'])

/** Session ids are used as directory names below `.ordicab/redaction`. */
export const redactionSessionIdSchema = z
  .string()
  .regex(/^[a-f0-9]{8}$/i, 'Invalid drafting session id.')

export const redactionCitationSchema = z.object({
  type: z.enum(['document', 'legal']),
  label: z.string().min(1),
  documentUuid: z.string().optional(),
  legalRef: z.string().optional()
})

export const redactionOperationSchema = z
  .object({
    id: z.string().min(1),
    op: redactionOpTypeSchema,
    anchorIndex: z.number().int().min(0).optional(),
    index: z.number().int().min(0).optional(),
    text: z.string().optional(),
    html: z.string().optional(),
    rationale: z.string().optional(),
    legalRefs: z.array(z.string()).optional(),
    citations: z.array(redactionCitationSchema).optional()
  })
  .superRefine((op, ctx) => {
    if ((op.op === 'insert_after' || op.op === 'insert_before') && op.anchorIndex === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'anchorIndex is required for insert operations',
        path: ['anchorIndex']
      })
    }
    if ((op.op === 'replace' || op.op === 'delete') && op.index === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'index is required for replace/delete operations',
        path: ['index']
      })
    }
    if (
      (op.op === 'insert_after' || op.op === 'insert_before' || op.op === 'replace') &&
      !op.text &&
      !op.html
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'text or html is required for insert/replace operations',
        path: ['text']
      })
    }
  })

export const redactionSourceSchema = z
  .object({
    type: z.enum(['blank', 'entity_default', 'template', 'copy', 'edit_existing']),
    templateUuid: z.string().optional(),
    sourceDocumentUuid: z.string().optional(),
    sourceDocumentPath: z.string().optional()
  })
  .superRefine((source, ctx) => {
    if (source.type === 'template' && !source.templateUuid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'templateUuid is required for the template source',
        path: ['templateUuid']
      })
    }
    if (
      (source.type === 'copy' || source.type === 'edit_existing') &&
      !source.sourceDocumentUuid &&
      !source.sourceDocumentPath
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A source document is required for copy/edit_existing',
        path: ['sourceDocumentUuid']
      })
    }
  })

export const redactionListInputSchema = z.object({
  dossierId: dossierIdSchema
})

export const redactionSessionQuerySchema = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema
})

export const redactionCreateInputSchema: z.ZodType<RedactionCreateInput> = z.object({
  dossierId: dossierIdSchema,
  title: z.string().min(1),
  docKind: redactionDocKindSchema,
  source: redactionSourceSchema,
  targetFilename: z.string().optional(),
  tagOverrides: z.record(z.string(), z.string()).optional(),
  primaryContactUuid: z.string().optional(),
  contactRoleOverrides: z.record(z.string(), z.string()).optional()
})

export const redactionManualEditInputSchema: z.ZodType<RedactionManualEditInput> = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema,
  operations: z.array(redactionOperationSchema).min(1)
})

export const redactionDecideOpInputSchema: z.ZodType<RedactionDecideOpInput> = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema,
  opId: z.string().min(1),
  decision: redactionDecisionSchema
})

export const redactionUpdateMetaInputSchema: z.ZodType<RedactionUpdateMetaInput> = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema,
  title: z.string().min(1).optional(),
  targetFilename: z.string().min(1).optional(),
  docKind: redactionDocKindSchema.optional(),
  saveMode: redactionSaveModeSchema.optional()
})

export const redactionChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'error']),
  text: z.string(),
  createdAt: z.string(),
  eventId: z.string().optional()
})

export const redactionSyncChatInputSchema = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema,
  chat: z.array(redactionChatMessageSchema)
})

export const redactionCommitInputSchema: z.ZodType<RedactionCommitInput> = z.object({
  dossierId: dossierIdSchema,
  sessionId: redactionSessionIdSchema,
  finalDecisions: z.record(z.string(), z.enum(['accept', 'reject', 'keep_tracked'])).optional(),
  filename: z.string().optional(),
  forceReplace: z.boolean().optional()
})

export type {
  RedactionCommitInput,
  RedactionCreateInput,
  RedactionDecideOpInput,
  RedactionManualEditInput,
  RedactionUpdateMetaInput
}
