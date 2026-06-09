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
  id: z.string().min(1),
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
  id: z.string().min(1).optional(),
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
  noteId: z.string().min(1)
})

export const dossierNoteIndexEntrySchema = z.object({
  id: z.string().min(1),
  dossierId: dossierIdSchema,
  title: z.string().min(1),
  kind: kindSchema,
  status: statusSchema.optional(),
  tags: tagsArray,
  pinned: z.boolean().optional(),
  source: sourceSchema.optional(),
  updatedAt: z.string().min(1)
})

export const dossierNoteIndexSchema = z.object({
  notes: z.array(dossierNoteIndexEntrySchema).default([]),
  updatedAt: z.string().min(1),
  migrated: z.boolean().optional()
})

export type DossierNoteIndexEntry = z.infer<typeof dossierNoteIndexEntrySchema>
export type DossierNoteIndex = z.infer<typeof dossierNoteIndexSchema>

export type { DossierNote, DossierNoteDeleteInput, DossierNoteUpsertInput }
