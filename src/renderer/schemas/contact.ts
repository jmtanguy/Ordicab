import { z } from 'zod'

import type { ContactDeleteInput, ContactRecord, ContactUpsertInput } from '@shared/domain/contact'
import { getContactManagedFieldValues, type ContactManagedFieldValues } from '@shared/types'
import { labelToKey } from '@shared/templateContent'

import { dossierIdSchema } from './dossier'

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

const optionalContactTextSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
)
const optionalContactGenderSchema = z.preprocess(
  emptyStringToUndefined,
  z.enum(['M', 'F', 'N']).optional()
)
const optionalContactEmailSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().email().optional()
)

// Lenient email validation for data read from disk (e.g. written by Claude Cowork).
// Strict email validation is enforced at the form level via optionalContactEmailSchema.
const optionalContactEmailDiskSchema = z.preprocess(
  emptyStringToUndefined,
  z.string().trim().min(1).optional()
)

const contactCustomFieldsSchema = z
  .record(z.string(), z.string())
  .optional()
  .transform(
    (value) =>
      Object.fromEntries(
        Object.entries(value ?? {})
          .map(([key, entryValue]) => [labelToKey(key), entryValue.trim()])
          .filter(([, entryValue]) => entryValue.length > 0)
      ) as ContactManagedFieldValues
  )

function normalizeStoredContact(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const record = input as Record<string, unknown>
  return {
    ...record,
    customFields: {
      ...(record.customFields && typeof record.customFields === 'object'
        ? (record.customFields as Record<string, string>)
        : {}),
      ...getContactManagedFieldValues(record)
    }
  }
}

const contactBaseSchema = z.object({
  id: z.string().min(1).optional(),
  dossierId: dossierIdSchema,
  title: optionalContactTextSchema,
  firstName: optionalContactTextSchema,
  lastName: optionalContactTextSchema,
  gender: optionalContactGenderSchema,
  role: optionalContactTextSchema,
  institution: optionalContactTextSchema,
  addressLine: optionalContactTextSchema,
  addressLine2: optionalContactTextSchema,
  zipCode: optionalContactTextSchema,
  city: optionalContactTextSchema,
  country: optionalContactTextSchema,
  phone: optionalContactTextSchema,
  information: optionalContactTextSchema,
  customFields: contactCustomFieldsSchema.default({})
})

export const contactRecordSchema = z.preprocess(
  normalizeStoredContact,
  contactBaseSchema.extend({
    uuid: z.string().min(1),
    email: optionalContactEmailDiskSchema
  })
)

export const contactUpsertInputSchema = z.preprocess(
  normalizeStoredContact,
  contactBaseSchema.extend({
    email: optionalContactEmailSchema
  })
)

export const contactDeleteInputSchema = z.object({
  dossierId: dossierIdSchema,
  contactUuid: z.string().min(1)
})

export type { ContactDeleteInput, ContactRecord, ContactUpsertInput }
