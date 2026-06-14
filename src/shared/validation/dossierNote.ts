import { z } from 'zod'

import type {
  DossierNote,
  DossierNoteDeleteInput,
  DossierNoteUpsertInput
} from '@shared/domain/dossierNote'
import {
  NOTE_KIND_VALUES,
  NOTE_SOURCE_VALUES,
  NOTE_STATUS_VALUES
} from '@shared/domain/dossierNote'

import { dossierIdSchema } from './dossierId'

const kindSchema = z.enum(NOTE_KIND_VALUES)
const statusSchema = z.enum(NOTE_STATUS_VALUES)
const sourceSchema = z.enum(NOTE_SOURCE_VALUES)
const tagsArray = z.array(z.string().min(1)).optional()

export const dossierNoteSchema = z.object({
  uuid: z.string().min(1),
  dossierId: dossierIdSchema,
  title: z.string().min(1),
  content: z.string().default(''),
  kind: kindSchema,
  status: statusSchema.optional(),
  tags: tagsArray,
  pinned: z.boolean().optional(),
  source: sourceSchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})

export const dossierNoteUpsertInputSchema = z.object({
  uuid: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  title: z.string().min(1),
  content: z.string().default(''),
  kind: kindSchema.optional(),
  status: statusSchema.optional(),
  tags: tagsArray,
  pinned: z.boolean().optional(),
  source: sourceSchema.optional()
})

export const dossierNoteDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  noteUuid: z.string().min(1)
})

export type { DossierNote, DossierNoteDeleteInput, DossierNoteUpsertInput }
