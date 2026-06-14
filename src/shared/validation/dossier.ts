import { z } from 'zod'

import type { DossierMetadataFile } from '@shared/domain/dossier'
import { LEGAL_AID_STATUS_VALUES, LEGAL_AID_TYPE_VALUES } from '@shared/domain/dossier'

import { dossierIdSchema } from './dossierId'
import { dossierBillingItemSchema, feeAgreementSchema } from './billing'
import { storedDocumentMetadataSchema } from './document'
import { dossierNoteSchema } from './dossierNote'
import { keyDateSchema } from './keyDate'
import { keyReferenceSchema } from './keyReference'
import { pieceRecordSchema } from './piece'

export { dossierIdSchema } from './dossierId'
function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const optionalInformationTextSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
)

const dossierStatusValues = ['active', 'pending', 'completed', 'archived'] as const
export const dossierStatusSchema = z.enum(dossierStatusValues)
export const dossierTypeSchema = z.string()

const optionalAjIsoDateSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().date().optional()
)
const optionalNonNegativeIntegerSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.number().int().nonnegative().optional()
)

const legalAidStatusSchema = z.enum(LEGAL_AID_STATUS_VALUES)
const legalAidTypeSchema = z.enum(LEGAL_AID_TYPE_VALUES)

export const dossierLegalAidSchema = z
  .object({
    status: legalAidStatusSchema,
    type: legalAidTypeSchema.optional(),
    shareBasisPoints: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.number().int().min(0).max(10_000).optional()
    ),
    bajDecisionNumber: optionalInformationTextSchema,
    bajDecisionDate: optionalAjIsoDateSchema,
    bajOffice: optionalInformationTextSchema,
    aidNumber: optionalInformationTextSchema,
    stateRetributionHtCents: optionalNonNegativeIntegerSchema,
    complementHtCents: optionalNonNegativeIntegerSchema,
    autoSetupDone: z.boolean().optional(),
    notes: optionalInformationTextSchema
  })
  .refine((data) => data.status !== 'granted' || data.type !== undefined, {
    message: "Le type d'AJ (totale/partielle) est requis lorsque l'AJ est accordée.",
    path: ['type']
  })
  .refine(
    (data) =>
      data.type !== 'partial' ||
      (typeof data.shareBasisPoints === 'number' && data.shareBasisPoints > 0),
    {
      message: "Le taux d'AJ partielle est requis pour une AJ partielle.",
      path: ['shareBasisPoints']
    }
  )
export const dossierRegistrationInputSchema = z.object({
  slug: dossierIdSchema
})
export const dossierCreateInputSchema = z.object({
  name: dossierIdSchema
})
export const dossierUnregisterInputSchema = z.object({
  slug: dossierIdSchema
})
export const dossierEligibleFolderSchema = z.object({
  slug: dossierIdSchema,
  name: z.string().min(1),
  path: z.string().min(1)
})

export const dossierSchema = z.object({
  slug: dossierIdSchema,
  uuid: z.string().min(1),
  name: z.string().min(1),
  type: dossierTypeSchema,
  status: dossierStatusSchema,
  updatedAt: z.string().min(1),
  lastOpenedAt: z.string().min(1).nullable(),
  nextUpcomingKeyDate: z.string().min(1).nullable(),
  nextUpcomingKeyDateLabel: z.string().min(1).nullable()
})

export const dossierDetailSchema = dossierSchema.extend({
  registeredAt: z.string().min(1),
  information: optionalInformationTextSchema,
  juridiction: optionalInformationTextSchema,
  tribunal: optionalInformationTextSchema,
  legalAid: dossierLegalAidSchema.optional(),
  feeAgreements: z.array(feeAgreementSchema).default([]),
  billingItems: z.array(dossierBillingItemSchema).default([]),
  keyDates: z.array(keyDateSchema),
  keyReferences: z.array(keyReferenceSchema),
  // Notes are stored per-file (notes/{id}.json) and loaded separately, like
  // key dates. Defaulted so legacy dossier.json (no notes field) still parses;
  // persisted metadata always strips them back to [].
  notes: z.array(dossierNoteSchema).default([])
})

export const dossierMetadataFileSchema = dossierDetailSchema.extend({
  documents: z.array(storedDocumentMetadataSchema).default([]),
  // Cotation des pièces — must stay in this schema: dossier.json is rewritten
  // wholesale by two writers (documentService and dossierRegistryService) and
  // Zod strips unknown keys, so a missing field here would silently erase the
  // pieces on the next metadata write.
  pieces: z.array(pieceRecordSchema).default([])
})

export const dossierScopedQuerySchema = z.object({
  dossierId: dossierIdSchema
})

export const dossierUpdateInputSchema = z.object({
  slug: dossierIdSchema,
  status: dossierStatusSchema,
  type: dossierTypeSchema,
  information: optionalInformationTextSchema,
  juridiction: optionalInformationTextSchema,
  tribunal: optionalInformationTextSchema,
  legalAid: dossierLegalAidSchema.optional()
})

export const dossierUpdateLegalAidInputSchema = z.object({
  dossierId: dossierIdSchema,
  legalAid: dossierLegalAidSchema
})

export const dossierSetupLegalAidInputSchema = z.object({
  dossierId: dossierIdSchema,
  force: z.boolean().optional()
})

export type { DossierMetadataFile }
