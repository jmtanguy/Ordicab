import { z } from 'zod'

import type {
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  KeyReference
} from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'

export const keyReferenceSchema = z.object({
  uuid: z.string().min(1),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  value: z.string(),
  note: z.string().optional()
})

// `value` accepts empty because required dossier-parameter references must exist
// even before the user has filled every value. Free-form references still enforce
// non-empty values in the service before persisting.
export const dossierKeyReferenceUpsertInputSchema = z.object({
  uuid: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  value: z.string(),
  note: z.string().optional()
})

export const dossierKeyReferenceDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  keyReferenceUuid: z.string().min(1)
})

export type { DossierKeyReferenceDeleteInput, DossierKeyReferenceUpsertInput, KeyReference }
