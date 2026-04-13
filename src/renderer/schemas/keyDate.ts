import { z } from 'zod'

import type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  KeyDate
} from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')

export const keyDateSchema = z.object({
  id: z.string().min(1),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  date: isoDateString,
  note: z.string().optional()
})

export const dossierKeyDateUpsertInputSchema = z.object({
  id: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  date: isoDateString,
  note: z.string().optional()
})

export const dossierKeyDateDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  keyDateId: z.string().min(1)
})

export type { DossierKeyDateDeleteInput, DossierKeyDateUpsertInput, KeyDate }
