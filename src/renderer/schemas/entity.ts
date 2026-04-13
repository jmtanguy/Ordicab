import { z } from 'zod'

import type { EntityProfile, EntityProfileDraft } from '@shared/domain/entity'
import { normalizeManagedFieldsConfig, type EntityManagedFieldsConfig } from '@shared/managedFields'

export const PROFESSION_VALUES = [
  'lawyer',
  'architect',
  'real_estate',
  'building_trades',
  'consulting_services'
] as const

export const professionSchema = z.enum(PROFESSION_VALUES).optional()

export type Profession = z.infer<typeof professionSchema>

export const TITLE_VALUES = ['M.', 'Mme', 'Me', 'Dr', 'Pr'] as const

export const GENDER_VALUES = ['M', 'F', 'N'] as const

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
  const profession =
    record.profession === 'lawyer' ||
    record.profession === 'architect' ||
    record.profession === 'real_estate' ||
    record.profession === 'building_trades' ||
    record.profession === 'consulting_services'
      ? record.profession
      : undefined

  return {
    ...record,
    managedFields: normalizeManagedFieldsConfig(
      (record.managedFields as Partial<EntityManagedFieldsConfig> | undefined) ?? undefined,
      profession
    )
  }
}

// Used for reading entity.json from disk — lenient email to tolerate external writes.
const entityProfileBaseSchema = z.object({
  firmName: z.string().trim().min(1),
  profession: professionSchema,
  title: z.string().trim().optional(),
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
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
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

/**
 * Maps an EntityProfile to template substitution variables.
 * Keys follow the `entity.<field>` convention expected by the Story 4.x template engine.
 * A null profile produces empty strings for all fields so templates render cleanly.
 */
export function toEntityTemplateContext(profile: EntityProfile | null): Record<string, string> {
  return {
    'entity.firmName': profile?.firmName ?? '',
    'entity.title': profile?.title ?? '',
    'entity.gender': profile?.gender ?? '',
    'entity.firstName': profile?.firstName ?? '',
    'entity.lastName': profile?.lastName ?? '',
    'entity.addressLine': profile?.addressLine ?? '',
    'entity.addressLine2': profile?.addressLine2 ?? '',
    'entity.zipCode': profile?.zipCode ?? '',
    'entity.city': profile?.city ?? '',
    'entity.country': profile?.country ?? '',
    'entity.vatNumber': profile?.vatNumber ?? '',
    'entity.phone': profile?.phone ?? '',
    'entity.email': profile?.email ?? ''
  }
}
