import { z } from 'zod'

import type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  GeneralKeyDate,
  GeneralKeyDateDeleteInput,
  GeneralKeyDateUpsertInput,
  KeyDate,
  KeyDateMoveInput
} from '@shared/domain/dossier'
import { KEY_DATE_TAG_VALUES } from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Expected a time in HH:MM format')

const tagsArray = z.array(z.enum(KEY_DATE_TAG_VALUES)).optional()

export const keyDateSchema = z.object({
  uuid: z.string().min(1),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  date: isoDateString,
  time: timeString.optional(),
  duration: z.number().int().min(1).optional(),
  tags: tagsArray,
  isClosed: z.boolean().optional(),
  note: z.string().optional()
})

export const dossierKeyDateUpsertInputSchema = z.object({
  uuid: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  date: isoDateString,
  time: timeString.optional(),
  duration: z.number().int().min(1).optional(),
  tags: tagsArray,
  isClosed: z.boolean().optional(),
  note: z.string().optional()
})

export const dossierKeyDateDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  keyDateUuid: z.string().min(1)
})

// Déplacement d'un événement : `null` = « hors dossier ». Porte les champs
// édités, qui seront réécrits à la cible.
export const keyDateMoveInputSchema = z.object({
  keyDateUuid: z.string().min(1),
  fromDossierId: dossierIdSchema.nullable(),
  toDossierId: dossierIdSchema.nullable(),
  label: z.string().min(1),
  date: isoDateString,
  time: timeString.optional(),
  duration: z.number().int().min(1).optional(),
  tags: tagsArray,
  isClosed: z.boolean().optional(),
  note: z.string().optional()
})

// Événements « hors dossier » : même forme qu'un key date sans `dossierId`.
export const generalKeyDateSchema = z.object({
  uuid: z.string().min(1),
  label: z.string().min(1),
  date: isoDateString,
  time: timeString.optional(),
  duration: z.number().int().min(1).optional(),
  tags: tagsArray,
  isClosed: z.boolean().optional(),
  note: z.string().optional()
})

export const generalKeyDateUpsertInputSchema = z.object({
  uuid: z.string().min(1).optional(),
  label: z.string().min(1),
  date: isoDateString,
  time: timeString.optional(),
  duration: z.number().int().min(1).optional(),
  tags: tagsArray,
  isClosed: z.boolean().optional(),
  note: z.string().optional()
})

export const generalKeyDateDeleteInputSchema = z.object({
  keyDateUuid: z.string().min(1)
})

export type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  GeneralKeyDate,
  GeneralKeyDateDeleteInput,
  GeneralKeyDateUpsertInput,
  KeyDate,
  KeyDateMoveInput
}
