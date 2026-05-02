import { roleToTagKey } from './contactRoles'
import type { AppLocale } from './contracts/app'
import {
  getDefaultContactFields,
  getDefaultKeyDateFields,
  getDefaultKeyReferenceFields,
  getLegacyContactManagedFields,
  getRolePresets,
  isOrganizationRole,
  type EntityProfession,
  type ManagedFieldDefinition,
  type ManagedFieldValueType
} from './professionDefaults'
import { labelToKey } from './templateContent'

export type { ManagedFieldDefinition, ManagedFieldValueType }

export type ContactManagedFieldValues = Record<string, string>

export interface EntityManagedFieldsConfig {
  contactRoles: string[]
  contacts: ManagedFieldDefinition[]
  keyDates: ManagedFieldDefinition[]
  keyReferences: ManagedFieldDefinition[]
  contactRoleFields: Record<string, string[]>
}

export const CONTACT_ADDITIONAL_FIRST_NAMES_FIELD_KEY = 'additionalFirstNames'

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

type ManagedFieldDefinitionInput = Partial<ManagedFieldDefinition> & { key?: string }

const LEGACY_CONTACT_FIELD_KEY_BY_LABEL = new Map(
  (
    [
      ["Prénoms complémentaires de l'état civil", 'additionalFirstNames'],
      ['Nom de jeune fille', 'maidenName'],
      ['Date de naissance', 'dateOfBirth'],
      ['Nationalité', 'nationality'],
      ['Pays de naissance', 'countryOfBirth'],
      ['Profession', 'occupation'],
      ['N° sécurité sociale', 'socialSecurityNumber']
    ] as const
  ).map(([label, key]) => [labelToKey(label), key])
)

export function getManagedFieldKey(input: ManagedFieldDefinition | string): string {
  const label = typeof input === 'string' ? input : input.label
  const normalizedLabelKey = labelToKey(label)
  return LEGACY_CONTACT_FIELD_KEY_BY_LABEL.get(normalizedLabelKey) ?? normalizedLabelKey
}

function normalizeFieldDefinition(
  input: ManagedFieldDefinitionInput | null | undefined
): ManagedFieldDefinition | null {
  const label = (input?.label ?? '').trim()
  const type = input?.type === 'date' ? 'date' : 'text'

  if (!label) {
    return null
  }

  return { label, type }
}

function dedupeFieldDefinitions(
  definitions: ManagedFieldDefinitionInput[]
): ManagedFieldDefinition[] {
  const deduped = new Map<string, ManagedFieldDefinition>()

  for (const definition of definitions) {
    const normalized = normalizeFieldDefinition(definition)
    if (!normalized) continue
    deduped.set(getManagedFieldKey(normalized), normalized)
  }

  return [...deduped.values()]
}

function normalizeRoleFieldKeys(
  input: Record<string, string[] | undefined> | null | undefined,
  allowedRoleKeys: Set<string>,
  allowedKeys: Set<string>
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {}

  for (const [roleKey, fieldKeys] of Object.entries(input ?? {})) {
    const nextRoleKey = labelToKey(roleKey)
    if (!nextRoleKey || !allowedRoleKeys.has(nextRoleKey)) continue

    const nextFieldKeys = [
      ...new Set(
        (fieldKeys ?? [])
          .map((fieldKey) => labelToKey(fieldKey))
          .filter((fieldKey) => allowedKeys.has(fieldKey))
      )
    ]
    normalized[nextRoleKey] = nextFieldKeys
  }

  return normalized
}

function suggestContactFieldKeysForRole(
  role: string,
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): string[] {
  if (isOrganizationRole(role, locale)) {
    return []
  }

  return getDefaultContactFields(profession, locale).map((field) => getManagedFieldKey(field))
}

function normalizeContactRoles(input: string[] | null | undefined): string[] {
  const deduped = new Map<string, string>()

  for (const role of input ?? []) {
    const label = capitalizeFirst(role.trim())
    const key = roleToTagKey(label)

    if (!label || deduped.has(key)) {
      continue
    }

    deduped.set(key, label)
  }

  return [...deduped.values()]
}

export function createDefaultManagedFieldsConfig(
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): EntityManagedFieldsConfig {
  const roles = normalizeContactRoles(getRolePresets(profession, locale))
  const contactRoleFields = Object.fromEntries(
    roles.map((role) => [
      roleToTagKey(role),
      suggestContactFieldKeysForRole(role, profession, locale)
    ])
  )

  return {
    contactRoles: roles,
    contacts: getDefaultContactFields(profession, locale),
    keyDates: getDefaultKeyDateFields(profession, locale),
    keyReferences: getDefaultKeyReferenceFields(profession, locale),
    contactRoleFields
  }
}

export function normalizeManagedFieldsConfig(
  input: Partial<EntityManagedFieldsConfig> | null | undefined,
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): EntityManagedFieldsConfig {
  const defaults = createDefaultManagedFieldsConfig(profession, locale)
  const hasCustomContacts = Boolean(
    input && Object.prototype.hasOwnProperty.call(input, 'contacts')
  )
  const hasCustomKeyDates = Boolean(
    input && Object.prototype.hasOwnProperty.call(input, 'keyDates')
  )
  const hasCustomKeyReferences = Boolean(
    input && Object.prototype.hasOwnProperty.call(input, 'keyReferences')
  )
  const hasCustomContactRoleFields = Boolean(
    input && Object.prototype.hasOwnProperty.call(input, 'contactRoleFields')
  )
  const hasCustomContactRoles = Boolean(
    input && Object.prototype.hasOwnProperty.call(input, 'contactRoles')
  )
  const contactRoles = hasCustomContactRoles
    ? normalizeContactRoles(input?.contactRoles)
    : defaults.contactRoles
  const allowedRoleKeys = new Set(contactRoles.map((role) => roleToTagKey(role)))
  const contacts = dedupeFieldDefinitions(
    hasCustomContacts ? [...(input?.contacts ?? [])] : [...(defaults.contacts ?? [])]
  )
  const allowedContactKeys = new Set(contacts.map((field) => getManagedFieldKey(field)))
  const defaultContactRoleFields = Object.fromEntries(
    contactRoles.map((role) => [
      roleToTagKey(role),
      suggestContactFieldKeysForRole(role, profession, locale)
    ])
  )

  return {
    contactRoles,
    contacts,
    keyDates: dedupeFieldDefinitions(
      hasCustomKeyDates ? [...(input?.keyDates ?? [])] : [...(defaults.keyDates ?? [])]
    ),
    keyReferences: dedupeFieldDefinitions(
      hasCustomKeyReferences
        ? [...(input?.keyReferences ?? [])]
        : [...(defaults.keyReferences ?? [])]
    ),
    contactRoleFields: hasCustomContactRoleFields
      ? normalizeRoleFieldKeys(input?.contactRoleFields, allowedRoleKeys, allowedContactKeys)
      : defaultContactRoleFields
  }
}

export function getContactManagedFieldValue(
  contact: { customFields?: ContactManagedFieldValues } | null | undefined,
  key: string
): string | undefined {
  const record = (contact ?? {}) as Record<string, unknown>
  const normalizedKey = labelToKey(key)
  const fromCustomFields = contact?.customFields?.[normalizedKey]

  if (typeof fromCustomFields === 'string' && fromCustomFields.trim()) {
    return fromCustomFields
  }

  const legacyValue = record[normalizedKey]
  if (typeof legacyValue === 'string' && legacyValue.trim()) {
    return legacyValue
  }

  return undefined
}

export function getContactManagedFieldValues(
  contact: { customFields?: ContactManagedFieldValues } | null | undefined
): ContactManagedFieldValues {
  const values: ContactManagedFieldValues = { ...(contact?.customFields ?? {}) }

  for (const field of getLegacyContactManagedFields()) {
    const value = getContactManagedFieldValue(contact, getManagedFieldKey(field))
    if (value) {
      values[getManagedFieldKey(field)] = value
    }
  }

  return values
}

export function getContactManagedFieldTemplateValues(
  contact: { customFields?: ContactManagedFieldValues } | null | undefined,
  definitions: ManagedFieldDefinition[]
): ContactManagedFieldValues {
  const values: ContactManagedFieldValues = {}

  for (const definition of definitions) {
    const value = getContactManagedFieldValue(contact, getManagedFieldKey(definition))
    const templateKey = labelToKey(definition.label)

    if (value && templateKey) {
      values[templateKey] = value
    }
  }

  return values
}

export function setContactManagedFieldValue(
  values: ContactManagedFieldValues,
  key: string,
  value: string
): ContactManagedFieldValues {
  const normalizedKey = labelToKey(key)
  const next = { ...values }
  const trimmed = value.trim()

  if (trimmed) {
    next[normalizedKey] = value
  } else {
    delete next[normalizedKey]
  }

  return next
}
