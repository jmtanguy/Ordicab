import { z } from 'zod'

import type {
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  KeyReference
} from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'

export const keyReferenceSchema = z.object({
  id: z.string().min(1),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  value: z.string().min(1),
  note: z.string().optional()
})

// `value` accepts empty so that the dossier-name reference can be reset to the
// folder basename (see DOSSIER_NAME_REFERENCE_LABEL handling in the service).
// For other labels the service enforces non-empty before persisting.
export const dossierKeyReferenceUpsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  value: z.string(),
  note: z.string().optional()
})

export const dossierKeyReferenceDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  keyReferenceId: z.string().min(1)
})

export type { DossierKeyReferenceDeleteInput, DossierKeyReferenceUpsertInput, KeyReference }
