import { z } from 'zod'

import type {
  PieceAddInput,
  PieceGenerateInput,
  PieceRecord,
  PieceRemoveInput,
  PieceUpdateInput
} from '@shared/domain/piece'

import { dossierIdSchema } from './dossierId'

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const pieceTitleSchema = z.string().trim().min(1).max(300)
const optionalPieceDateSchema = z.preprocess(emptyToUndefined, z.string().trim().date().optional())
const optionalSummarySchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(1000).optional()
)
const optionalHeaderTextSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).max(300).optional()
)

export const pieceStampPositionSchema = z.enum([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
])

export const pieceRecordSchema = z.object({
  uuid: z.string().min(1),
  pieceNumber: z.number().int().positive(),
  documentUuid: z.string().min(1),
  sourceFilename: z.string().min(1),
  title: pieceTitleSchema,
  pieceDate: optionalPieceDateSchema,
  summary: optionalSummarySchema,
  addedAt: z.string().min(1),
  communicatedAt: z.string().min(1).optional()
})

export const pieceAddInputSchema = z.object({
  dossierId: dossierIdSchema,
  items: z
    .array(
      z.object({
        documentUuid: z.string().min(1),
        title: pieceTitleSchema,
        pieceDate: optionalPieceDateSchema,
        summary: optionalSummarySchema
      })
    )
    .min(1)
    .max(200)
})

export const pieceUpdateInputSchema = z.object({
  dossierId: dossierIdSchema,
  pieceUuid: z.string().min(1),
  title: pieceTitleSchema,
  pieceDate: optionalPieceDateSchema,
  summary: optionalSummarySchema
})

export const pieceRemoveInputSchema = z.object({
  dossierId: dossierIdSchema,
  pieceUuid: z.string().min(1)
})

export const pieceGenerateInputSchema = z
  .object({
    dossierId: dossierIdSchema,
    outputs: z.object({
      bundle: z.boolean(),
      bordereau: z.boolean(),
      individual: z.boolean()
    }),
    header: z
      .object({
        juridiction: optionalHeaderTextSchema,
        rg: optionalHeaderTextSchema,
        parties: optionalHeaderTextSchema,
        place: optionalHeaderTextSchema
      })
      .optional(),
    bordereauDate: optionalPieceDateSchema
  })
  .refine((input) => input.outputs.bundle || input.outputs.bordereau || input.outputs.individual, {
    message: 'At least one output must be selected.',
    path: ['outputs']
  })

export type { PieceAddInput, PieceGenerateInput, PieceRecord, PieceRemoveInput, PieceUpdateInput }
