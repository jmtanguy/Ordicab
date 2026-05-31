import { z } from 'zod'

import type {
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  KeyDate
} from '@shared/domain/dossier'
import { KEY_DATE_TAG_VALUES } from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Expected a time in HH:MM format')

const tagsArray = z.array(z.enum(KEY_DATE_TAG_VALUES)).optional()

export const keyDateSchema = z.object({
  id: z.string().min(1),
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
  id: z.string().min(1).optional(),
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
  keyDateId: z.string().min(1)
})

export const keyDateIndexEntrySchema = z.object({
  id: z.string().min(1),
  dossierId: dossierIdSchema,
  label: z.string().min(1),
  date: isoDateString,
  isClosed: z.boolean().optional(),
  updatedAt: z.string().min(1)
})

export const keyDateIndexSchema = z.object({
  keyDates: z.array(keyDateIndexEntrySchema).default([]),
  updatedAt: z.string().min(1),
  migrated: z.boolean().optional()
})

export type KeyDateIndexEntry = z.infer<typeof keyDateIndexEntrySchema>
export type KeyDateIndex = z.infer<typeof keyDateIndexSchema>

export type { DossierKeyDateDeleteInput, DossierKeyDateUpsertInput, KeyDate }
