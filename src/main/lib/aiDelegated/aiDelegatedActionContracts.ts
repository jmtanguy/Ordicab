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
  templateDeleteInputSchema,
  templateDraftSchema,
  templateUpdateSchema
} from '@renderer/schemas'

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
    id: z.string().min(1).optional(),
    dossierId: dossierIdSchema,
    label: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().optional()
  }),
  'dossier.deleteKeyDate': z.object({
    dossierId: dossierIdSchema,
    keyDateId: z.string().min(1)
  }),
  'dossier.upsertKeyReference': z.object({
    id: z.string().min(1).optional(),
    dossierId: dossierIdSchema,
    label: z.string().min(1),
    value: z.string().min(1),
    note: z.string().optional()
  }),
  'dossier.deleteKeyReference': z.object({
    dossierId: dossierIdSchema,
    keyReferenceId: z.string().min(1)
  }),
  'entity.update': entityProfileDraftSchema,
  'document.saveMetadata': documentMetadataUpdateSchema,
  'document.relocate': documentRelocationInputSchema,
  'document.analyze': z.object({
    dossierId: dossierIdSchema,
    documentId: z.string().min(1)
  }),
  'template.create': templateDraftSchema,
  'template.update': templateUpdateSchema,
  'template.delete': templateDeleteInputSchema,
  'generate.document': generateDocumentInputSchema
} as const

export const DELEGATED_AI_ACTIONS = Object.keys(delegatedAiActionPayloadSchemas) as Array<
  keyof typeof delegatedAiActionPayloadSchemas
>

export const delegatedAiActionSchema = z.enum(DELEGATED_AI_ACTIONS)

export type DelegatedAiAction = keyof typeof delegatedAiActionPayloadSchemas

export type DelegatedAiActionPayload<A extends DelegatedAiAction> = z.input<
  (typeof delegatedAiActionPayloadSchemas)[A]
>

export type ParsedDelegatedAiActionPayload<A extends DelegatedAiAction> = z.output<
  (typeof delegatedAiActionPayloadSchemas)[A]
>

export const ordicabActionPayloadSchemas = delegatedAiActionPayloadSchemas
export const ORDICAB_ACTIONS = DELEGATED_AI_ACTIONS
export const ordicabActionSchema = delegatedAiActionSchema
export type OrdicabAction = DelegatedAiAction
export type OrdicabActionPayload<A extends OrdicabAction> = DelegatedAiActionPayload<A>
export type ParsedOrdicabActionPayload<A extends OrdicabAction> = ParsedDelegatedAiActionPayload<A>
