import { z } from 'zod'

import {
  contactDeleteInputSchema,
  contactUpsertInputSchema,
  documentMetadataUpdateSchema,
  documentRelocationInputSchema,
  dossierIdSchema,
  dossierStatusSchema,
  dossierTypeSchema,
  entityProfileDraftSchema,
  generateDocumentInputSchema,
  safeRelativePathSchema,
  templateDeleteInputSchema,
  templateDraftSchema,
  templateUpdateSchema
} from '@shared/validation'

export const delegatedAiActionPayloadSchemas = {
  'contact.upsert': contactUpsertInputSchema,
  'contact.delete': contactDeleteInputSchema,
  'dossier.create': z.object({
    id: dossierIdSchema
  }),
  'dossier.update': z
    .object({
      id: dossierIdSchema,
      status: dossierStatusSchema.optional(),
      type: dossierTypeSchema.optional(),
      information: z.string().optional()
    })
    .refine(
      (value) =>
        typeof value.status !== 'undefined' ||
        typeof value.type !== 'undefined' ||
        typeof value.information !== 'undefined',
      {
        message: 'At least one dossier field must be provided.'
      }
    ),
  'dossier.upsertKeyDate': z.object({
    uuid: z.string().min(1).optional(),
    dossierId: dossierIdSchema,
    label: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().optional()
  }),
  'dossier.deleteKeyDate': z.object({
    dossierId: dossierIdSchema,
    keyDateUuid: z.string().min(1)
  }),
  'dossier.upsertKeyReference': z.object({
    uuid: z.string().min(1).optional(),
    dossierId: dossierIdSchema,
    label: z.string().min(1),
    value: z.string().min(1),
    note: z.string().optional()
  }),
  'dossier.deleteKeyReference': z.object({
    dossierId: dossierIdSchema,
    keyReferenceUuid: z.string().min(1)
  }),
  'entity.update': entityProfileDraftSchema,
  'document.saveMetadata': documentMetadataUpdateSchema,
  'document.relocate': documentRelocationInputSchema,
  'document.analyze': z.object({
    dossierId: dossierIdSchema,
    documentPath: safeRelativePathSchema
  }),
  'template.create': templateDraftSchema,
  'template.update': templateUpdateSchema,
  'template.delete': templateDeleteInputSchema,
  'generate.document': generateDocumentInputSchema
} as const

const DELEGATED_AI_ACTIONS = Object.keys(delegatedAiActionPayloadSchemas) as Array<
  keyof typeof delegatedAiActionPayloadSchemas
>

export const delegatedAiActionSchema = z.enum(DELEGATED_AI_ACTIONS)

export type DelegatedAiAction = keyof typeof delegatedAiActionPayloadSchemas
