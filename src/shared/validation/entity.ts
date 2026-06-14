import { z } from 'zod'

import type { EntityProfile, EntityProfileDraft } from '@shared/domain/entity'
import { normalizeManagedFieldsConfig, type EntityManagedFieldsConfig } from '@shared/managedFields'

// Re-exported so existing consumers of `@shared/validation` (e.g. EntityPanel)
// keep working; the canonical source is now @shared/domain/gender.
import { GENDER_VALUES } from '@shared/domain/gender'

import { pieceStampPositionSchema } from './piece'

export { GENDER_VALUES }

export const TITLE_VALUES = ['M.', 'Mme', 'Me', 'Dr', 'Pr'] as const

// Ordicab is lawyer-only: the entity (user of the app) is always an avocat,
// so the title is a constant rather than an editable field.
export const ENTITY_TITLE_SHORT = 'Me'
export const ENTITY_TITLE_LONG = 'Maître'

const optionalGenderSchema = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.enum(GENDER_VALUES).optional()
)

const managedFieldTypeSchema = z.enum(['text', 'date'])
const managedFieldDefinitionSchema = z.object({
  key: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1),
  type: managedFieldTypeSchema
})

const entityManagedFieldsConfigSchema = z
  .object({
    contactRoles: z.array(z.string().trim().min(1)).optional(),
    contacts: z.array(managedFieldDefinitionSchema).optional(),
    keyDates: z.array(managedFieldDefinitionSchema).optional(),
    keyReferences: z.array(managedFieldDefinitionSchema).optional(),
    contactRoleFields: z.record(z.string(), z.array(z.string())).optional()
  })
  .optional()

function normalizeEntityProfileInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const record = input as Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { profession: _, ...rest } = record

  return {
    ...rest,
    managedFields: normalizeManagedFieldsConfig(
      (record.managedFields as Partial<EntityManagedFieldsConfig> | undefined) ?? undefined
    )
  }
}

// Used for reading entity.json from disk — lenient email to tolerate external writes.
const entityProfileBaseSchema = z.object({
  firmName: z.string().trim().min(1),
  gender: optionalGenderSchema,
  firstName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  // Structured address fields (new paradigm)
  addressLine: z.string().trim().optional(),
  addressLine2: z.string().trim().optional(),
  zipCode: z.string().trim().optional(),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  // Legacy field — kept for backward-compat migration of existing entity.json files
  address: z.string().trim().optional(),
  vatNumber: z.string().trim().optional(),
  siren: z.string().trim().optional(),
  siret: z.string().trim().optional(),
  legalForm: z.string().trim().optional(),
  shareCapital: z.string().trim().optional(),
  rcsNumber: z.string().trim().optional(),
  rcsCity: z.string().trim().optional(),
  iban: z.string().trim().optional(),
  bic: z.string().trim().optional(),
  carpaIban: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  barreau: z.string().trim().optional(),
  toque: z.string().trim().optional(),
  defaultTemplateFileName: z.string().trim().optional(),
  defaultTemplateImportedAt: z.string().trim().optional(),
  stampImageFileName: z.string().trim().optional(),
  stampImportedAt: z.string().trim().optional(),
  stampPosition: pieceStampPositionSchema.optional(),
  managedFields: entityManagedFieldsConfigSchema
})

export const entityProfileSchema = z.preprocess(
  normalizeEntityProfileInput,
  entityProfileBaseSchema
)

// Used for UI form validation — strict email format enforced.
export const entityProfileDraftSchema = z.preprocess(
  normalizeEntityProfileInput,
  entityProfileBaseSchema.extend({
    email: z.union([z.string().trim().email(), z.literal('')]).optional()
  })
)

export type { EntityProfile, EntityProfileDraft }
