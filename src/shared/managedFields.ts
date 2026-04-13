import type { EntityProfession } from './contactRoles'
import { getRolePresets, roleToTagKey } from './contactRoles'
import { labelToKey } from './templateContent'

export type ManagedFieldValueType = 'text' | 'date'

export interface ManagedFieldDefinition {
  label: string
  type: ManagedFieldValueType
}

export type ContactManagedFieldValues = Record<string, string>

export interface EntityManagedFieldsConfig {
  contactRoles: string[]
  contacts: ManagedFieldDefinition[]
  keyDates: ManagedFieldDefinition[]
  keyReferences: ManagedFieldDefinition[]
  contactRoleFields: Record<string, string[]>
}

export const LEGACY_CONTACT_MANAGED_FIELDS: ManagedFieldDefinition[] = [
  {
    label: "Prénoms complémentaires de l'état civil",
    type: 'text'
  },
  {
    label: 'Nom de jeune fille',
    type: 'text'
  },
  {
    label: 'Date de naissance',
    type: 'date'
  },
  {
    label: 'Nationalité',
    type: 'text'
  },
  {
    label: 'Pays de naissance',
    type: 'text'
  },
  {
    label: 'Profession',
    type: 'text'
  },
  {
    label: 'N° sécurité sociale',
    type: 'text'
  }
]

export const CONTACT_ADDITIONAL_FIRST_NAMES_FIELD_KEY = 'additionalFirstNames'

const DEFAULT_CONTACT_FIELDS: Record<EntityProfession, ManagedFieldDefinition[]> = {
  lawyer: LEGACY_CONTACT_MANAGED_FIELDS,
  architect: [
    { label: 'Date de naissance', type: 'date' },
    { label: 'Nationalité', type: 'text' },
    { label: 'Profession', type: 'text' },
    { label: 'Qualité', type: 'text' },
    { label: 'Représentant légal', type: 'text' },
    { label: 'Référence assurance', type: 'text' },
    { label: 'N° police assurance', type: 'text' }
  ],
  real_estate: [
    { label: 'Date de naissance', type: 'date' },
    { label: 'Nationalité', type: 'text' },
    { label: 'Profession', type: 'text' },
    { label: 'Situation matrimoniale', type: 'text' },
    { label: 'Régime matrimonial', type: 'text' },
    { label: "N° pièce d'identité", type: 'text' },
    { label: "Date d'expiration pièce d'identité", type: 'date' }
  ],
  building_trades: [
    { label: 'Qualité', type: 'text' },
    { label: 'Représentant légal', type: 'text' },
    { label: 'SIRET', type: 'text' },
    { label: 'Référence chantier', type: 'text' },
    { label: 'Référence assurance', type: 'text' },
    { label: 'N° police assurance', type: 'text' }
  ],
  consulting_services: [
    { label: 'Fonction', type: 'text' },
    { label: 'Service', type: 'text' },
    { label: 'SIRET', type: 'text' },
    { label: 'TVA intracommunautaire', type: 'text' },
    { label: 'Référence achat', type: 'text' },
    { label: 'Référence client', type: 'text' }
  ]
}

const DEFAULT_KEY_DATE_FIELDS: Record<EntityProfession, ManagedFieldDefinition[]> = {
  lawyer: [
    { label: "Date d'audience", type: 'date' },
    { label: 'Date de délibéré', type: 'date' },
    { label: 'Date de renvoi', type: 'date' }
  ],
  architect: [
    { label: "Date d'ouverture du chantier", type: 'date' },
    { label: "Date de réunion d'expertise", type: 'date' },
    { label: 'Date de réception des travaux', type: 'date' }
  ],
  real_estate: [
    { label: 'Date du compromis', type: 'date' },
    { label: "Date de signature de l'acte", type: 'date' },
    { label: "Date d'entrée dans les lieux", type: 'date' }
  ],
  building_trades: [
    { label: 'Date du devis', type: 'date' },
    { label: 'Date de commande', type: 'date' },
    { label: "Date d'intervention", type: 'date' }
  ],
  consulting_services: [
    { label: 'Date de mission', type: 'date' },
    { label: 'Date de livraison', type: 'date' },
    { label: "Date d'échéance", type: 'date' }
  ]
}

const DEFAULT_KEY_REFERENCE_FIELDS: Record<EntityProfession, ManagedFieldDefinition[]> = {
  lawyer: [
    { label: 'N° dossier', type: 'text' },
    { label: 'N° RG', type: 'text' },
    { label: 'N° dossier adverse', type: 'text' }
  ],
  architect: [
    { label: 'N° projet', type: 'text' },
    { label: 'N° mission', type: 'text' },
    { label: 'Référence sinistre', type: 'text' }
  ],
  real_estate: [
    { label: 'N° dossier', type: 'text' },
    { label: 'N° mandat', type: 'text' },
    { label: 'Référence du bien', type: 'text' }
  ],
  building_trades: [
    { label: 'N° devis', type: 'text' },
    { label: 'N° facture', type: 'text' },
    { label: 'N° chantier', type: 'text' }
  ],
  consulting_services: [
    { label: 'N° mission', type: 'text' },
    { label: 'N° commande', type: 'text' },
    { label: 'N° facture', type: 'text' }
  ]
}

const ORGANIZATION_ROLE_HINTS = [
  'juridiction',
  'organisme',
  'banque',
  'assureur',
  'service',
  'bureau',
  'entreprise',
  'promoteur',
  'gestionnaire',
  'syndic'
]

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

type ManagedFieldDefinitionInput = Partial<ManagedFieldDefinition> & { key?: string }

const LEGACY_CONTACT_FIELD_KEY_BY_LABEL = new Map(
  [
    ["Prénoms complémentaires de l'état civil", 'additionalFirstNames'],
    ['Nom de jeune fille', 'maidenName'],
    ['Date de naissance', 'dateOfBirth'],
    ['Nationalité', 'nationality'],
    ['Pays de naissance', 'countryOfBirth'],
    ['Profession', 'occupation'],
    ['N° sécurité sociale', 'socialSecurityNumber']
  ].map(([label, key]) => [labelToKey(label), key])
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

function getDefaultContactFields(profession?: EntityProfession | null): ManagedFieldDefinition[] {
  return DEFAULT_CONTACT_FIELDS[profession ?? 'lawyer'] ?? DEFAULT_CONTACT_FIELDS.lawyer
}

function suggestContactFieldKeysForRole(
  role: string,
  profession?: EntityProfession | null
): string[] {
  const lower = role.toLowerCase()
  const isOrganization = ORGANIZATION_ROLE_HINTS.some((hint) => lower.includes(hint))

  if (isOrganization) {
    return []
  }

  return getDefaultContactFields(profession).map((field) => getManagedFieldKey(field))
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
  profession?: EntityProfession | null
): EntityManagedFieldsConfig {
  const roles = normalizeContactRoles(getRolePresets(profession))
  const defaultContactFields = getDefaultContactFields(profession)
  const contactRoleFields = Object.fromEntries(
    roles.map((role) => [roleToTagKey(role), suggestContactFieldKeysForRole(role, profession)])
  )

  return {
    contactRoles: roles,
    contacts: defaultContactFields,
    keyDates: DEFAULT_KEY_DATE_FIELDS[profession ?? 'lawyer'] ?? DEFAULT_KEY_DATE_FIELDS.lawyer,
    keyReferences:
      DEFAULT_KEY_REFERENCE_FIELDS[profession ?? 'lawyer'] ?? DEFAULT_KEY_REFERENCE_FIELDS.lawyer,
    contactRoleFields
  }
}

export function normalizeManagedFieldsConfig(
  input: Partial<EntityManagedFieldsConfig> | null | undefined,
  profession?: EntityProfession | null
): EntityManagedFieldsConfig {
  const defaults = createDefaultManagedFieldsConfig(profession)
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
      suggestContactFieldKeysForRole(role, profession)
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

  for (const field of LEGACY_CONTACT_MANAGED_FIELDS) {
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
