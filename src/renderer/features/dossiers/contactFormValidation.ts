import type { ContactUpsertInput } from '@shared/types'
import {
  getManagedFieldKey,
  LEGACY_CONTACT_MANAGED_FIELDS,
  type ManagedFieldDefinition
} from '@shared/managedFields'
import { setContactManagedFieldValue } from '@shared/types'
import { labelToKey } from '@shared/templateContent'

import { contactUpsertInputSchema } from '@renderer/schemas'

import { parseLocaleDateToIso } from './contactDateOfBirth'

export interface ContactFormErrors {
  addressLine?: string
  addressLine2?: string
  city?: string
  country?: string
  institution?: string
  displayName?: string
  email?: string
  firstName?: string
  gender?: string
  information?: string
  lastName?: string
  phone?: string
  role?: string
  title?: string
  zipCode?: string
  dateOfBirth?: string
  customFields?: Record<string, string>
}

export interface ContactFormValues {
  addressLine: string
  addressLine2: string
  city: string
  country: string
  institution: string
  displayName: string
  email: string
  firstName: string
  additionalFirstNames: string
  gender: string
  id?: string
  information: string
  lastName: string
  phone: string
  role: string
  title: string
  zipCode: string
  dateOfBirth: string
  countryOfBirth: string
  nationality: string
  occupation: string
  socialSecurityNumber: string
  maidenName: string
  customFields?: Record<string, string>
}

export function validateContactFormInput(
  input: ContactFormValues & { dossierId: string },
  messages: { invalidDate: string; invalidEmail: string; required: string },
  options: { customFieldDefinitions?: ManagedFieldDefinition[]; locale: string }
): { data: ContactUpsertInput; success: true } | { errors: ContactFormErrors; success: false } {
  const errors: ContactFormErrors = {}
  let normalizedCustomFields: Record<string, string> = {
    ...(input.customFields ?? {}),
    additionalFirstNames: input.additionalFirstNames,
    dateOfBirth: input.dateOfBirth,
    countryOfBirth: input.countryOfBirth,
    nationality: input.nationality,
    occupation: input.occupation,
    socialSecurityNumber: input.socialSecurityNumber,
    maidenName: input.maidenName
  }

  const customFieldDefinitions = options.customFieldDefinitions ?? LEGACY_CONTACT_MANAGED_FIELDS

  for (const definition of customFieldDefinitions) {
    const definitionKey = getManagedFieldKey(definition)

    if (definition.type !== 'date') {
      continue
    }

    const rawValue = normalizedCustomFields[definitionKey] ?? ''
    const hasValue = rawValue.trim().length > 0
    const normalizedValue = hasValue ? parseLocaleDateToIso(rawValue, options.locale) : rawValue

    if (hasValue && normalizedValue === null) {
      errors.customFields = {
        ...(errors.customFields ?? {}),
        [definitionKey]: messages.invalidDate
      }
      if (definitionKey === 'dateOfBirth') {
        errors.dateOfBirth = messages.invalidDate
      }
      continue
    }

    normalizedCustomFields = setContactManagedFieldValue(
      normalizedCustomFields,
      definitionKey,
      normalizedValue ?? ''
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { displayName, ...inputWithoutDisplayName } = input

  const parsed = contactUpsertInputSchema.safeParse({
    ...inputWithoutDisplayName,
    customFields: Object.fromEntries(
      Object.entries(normalizedCustomFields).map(([key, value]) => [labelToKey(key), value])
    )
  })

  if (parsed.success && !errors.customFields) {
    return {
      success: true,
      data: parsed.data
    }
  }

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]

      if (field === 'email') {
        errors.email = messages.invalidEmail
      }
    }
  }

  if (
    !options.customFieldDefinitions &&
    errors.customFields?.dateOfBirth &&
    Object.keys(errors.customFields).length === 1
  ) {
    delete errors.customFields
  }

  return {
    success: false,
    errors
  }
}
