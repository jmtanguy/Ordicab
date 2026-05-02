import type { TemplateRoutineEntry, TemplateRoutineGroup } from '@shared/templateRoutines'
import {
  CONTACT_ROLE_FIELD_ALIASES,
  TEMPLATE_ROUTINE_GROUPS,
  templateRoutineCatalog
} from '@shared/templateRoutines'
import {
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type EntityManagedFieldsConfig
} from '@shared/managedFields'
import { getLegacyContactManagedFields } from '@shared/professionDefaults'
import type { Profession } from '@shared/validation'
import { roleToTagKey } from '../dossiers/rolePresets'

export const TAG_GROUPS = TEMPLATE_ROUTINE_GROUPS

export type TagGroup = TemplateRoutineGroup
export type TagCatalogEntry = TemplateRoutineEntry

const CONTACT_ROLE_FIELDS: Array<{
  field: string
  fieldFr?: string
  example: string
  subGroup?: 'address' | 'identity' | 'personalInfo' | 'salutation'
}> = [
  { field: 'displayName', fieldFr: 'nomAffiche', example: 'Me John Martin', subGroup: 'identity' },
  { field: 'title', fieldFr: 'titre', example: 'Me', subGroup: 'identity' },
  { field: 'firstName', fieldFr: 'prenom', example: 'John', subGroup: 'identity' },
  { field: 'firstNames', fieldFr: 'prenoms', example: 'John Marie Louise', subGroup: 'identity' },
  {
    field: 'additionalFirstNames',
    fieldFr: 'prenomsComplementaires',
    example: 'Marie Louise',
    subGroup: 'personalInfo'
  },
  { field: 'lastName', fieldFr: 'nom', example: 'Bernard', subGroup: 'identity' },
  { field: 'maidenName', fieldFr: 'nomJeuneFille', example: 'Dupont', subGroup: 'personalInfo' },
  { field: 'role', example: 'client', subGroup: 'identity' },
  { field: 'email', example: 'john.martin@test-example.com', subGroup: 'identity' },
  { field: 'phone', fieldFr: 'telephone', example: '+33 1 98 76 54 32', subGroup: 'identity' },
  { field: 'institution', example: 'Bernard Legal Services', subGroup: 'identity' },
  { field: 'salutation', fieldFr: 'civilite', example: 'Madame', subGroup: 'salutation' },
  {
    field: 'salutationFull',
    fieldFr: 'civiliteNom',
    example: 'Madame LASTNAME-A',
    subGroup: 'salutation'
  },
  { field: 'dear', fieldFr: 'formuleAppel', example: 'Chère Madame', subGroup: 'salutation' },
  {
    field: 'dateOfBirth',
    fieldFr: 'dateNaissance',
    example: '15/03/1980',
    subGroup: 'personalInfo'
  },
  {
    field: 'countryOfBirth',
    fieldFr: 'paysNaissance',
    example: 'France',
    subGroup: 'personalInfo'
  },
  { field: 'nationality', fieldFr: 'nationalite', example: 'Française', subGroup: 'personalInfo' },
  { field: 'occupation', fieldFr: 'profession', example: 'Ingénieur', subGroup: 'personalInfo' },
  {
    field: 'socialSecurityNumber',
    fieldFr: 'numeroSecu',
    example: '1 85 12 34 567 890 12',
    subGroup: 'personalInfo'
  },
  {
    field: 'addressLine',
    fieldFr: 'ligneAdresse',
    example: '42 avenue de la République',
    subGroup: 'address'
  },
  { field: 'addressLine2', fieldFr: 'ligneAdresse2', example: 'Suite 5', subGroup: 'address' },
  { field: 'zipCode', fieldFr: 'codePostal', example: '75002', subGroup: 'address' },
  { field: 'city', fieldFr: 'ville', example: 'Lyon', subGroup: 'address' },
  { field: 'country', fieldFr: 'pays', example: 'France', subGroup: 'address' },
  {
    field: 'addressFormatted',
    fieldFr: 'adresseFormatee',
    example: '12 rue des Fleurs\n75008 Paris',
    subGroup: 'address'
  },
  {
    field: 'addressInline',
    fieldFr: 'adresseCompacte',
    example: '12 rue des Fleurs, 75008 Paris',
    subGroup: 'address'
  }
]

const MANAGED_CONTACT_FIELD_KEYS = new Set(
  getLegacyContactManagedFields().map((field) => getManagedFieldKey(field))
)
const CONTACT_FIELD_ALIAS_BY_KEY = new Map(CONTACT_ROLE_FIELD_ALIASES.map(({ en, fr }) => [en, fr]))
const CONTACT_IDENTITY_FIELD_KEYS = new Set([
  'displayName',
  'title',
  'firstName',
  'firstNames',
  'lastName',
  'role',
  'email',
  'phone',
  'institution'
])
const CONTACT_PERSONAL_INFO_FIELD_KEYS = new Set([
  'additionalFirstNames',
  'maidenName',
  'dateOfBirth',
  'countryOfBirth',
  'nationality',
  'occupation',
  'socialSecurityNumber'
])

function isStaticManagedContactEntry(entry: TagCatalogEntry): boolean {
  if (entry.group !== 'contact') {
    return false
  }

  const match = /^\{\{contact\.([^.}]+)\}\}$/.exec(entry.tag)
  return match ? MANAGED_CONTACT_FIELD_KEYS.has(match[1] ?? '') : false
}

function getContactSubGroup(fieldKey: string): TagCatalogEntry['subGroup'] | undefined {
  if (CONTACT_IDENTITY_FIELD_KEYS.has(fieldKey)) {
    return 'identity'
  }

  if (CONTACT_PERSONAL_INFO_FIELD_KEYS.has(fieldKey)) {
    return 'personalInfo'
  }

  return undefined
}

export const tagCatalog: TagCatalogEntry[] = templateRoutineCatalog.filter(
  (entry) => !isStaticManagedContactEntry(entry)
)

/**
 * Returns role-keyed tag entries for the given role labels.
 * e.g. role "client" → {{contact.client.displayName}}, {{contact.client.email}}, ...
 */
export function buildRoleTagEntries(roles: string[]): TagCatalogEntry[] {
  return roles.flatMap((role) =>
    CONTACT_ROLE_FIELDS.map(({ field, fieldFr, example, subGroup }) => ({
      tag: `{{contact.${roleToTagKey(role)}.${field}}}`,
      tagFr: fieldFr ? `{{contact.${roleToTagKey(role)}.${fieldFr}}}` : undefined,
      group: 'contact' as TagGroup,
      description: `${field} du contact « ${role} »`,
      descriptionFr: `${fieldFr ?? field} du contact « ${role} »`,
      subGroup,
      example
    }))
  )
}

function buildLocalizedManagedContactTag(path: string, fieldKey: string): string | undefined {
  const fieldFr = CONTACT_FIELD_ALIAS_BY_KEY.get(fieldKey)
  return fieldFr ? path.replace(fieldKey, fieldFr) : undefined
}

function buildManagedContactTagEntries(
  managedFields: EntityManagedFieldsConfig
): TagCatalogEntry[] {
  const primaryEntries = managedFields.contacts.map((definition) => {
    const fieldKey = getManagedFieldKey(definition)
    const tag = `{{contact.${fieldKey}}}`

    return {
      tag,
      tagFr: buildLocalizedManagedContactTag(tag, fieldKey),
      group: 'contact' as TagGroup,
      description: `${definition.label} du contact principal`,
      descriptionFr: `${definition.label} du contact principal`,
      subGroup: getContactSubGroup(fieldKey),
      example: definition.type === 'date' ? '1985-06-15' : definition.label
    }
  })

  const roleEntries = Object.entries(managedFields.contactRoleFields).flatMap(
    ([roleKey, fieldKeys]) =>
      fieldKeys.flatMap((fieldKey) => {
        const definition = managedFields.contacts.find(
          (entry) => getManagedFieldKey(entry) === fieldKey
        )
        if (!definition) return []

        const tag = `{{contact.${roleKey}.${getManagedFieldKey(definition)}}}`

        return [
          {
            tag,
            tagFr: buildLocalizedManagedContactTag(tag, getManagedFieldKey(definition)),
            group: 'contact' as TagGroup,
            description: `${definition.label} du contact « ${roleKey} »`,
            descriptionFr: `${definition.label} du contact « ${roleKey} »`,
            subGroup: getContactSubGroup(getManagedFieldKey(definition)),
            example: definition.type === 'date' ? '1985-06-15' : definition.label
          }
        ]
      })
  )

  return [...primaryEntries, ...roleEntries]
}

/**
 * Returns the full tag catalog, including role-specific contact tags
 * derived from the given profession.
 */
export function getTagCatalog(
  profession?: Profession | null,
  managedFieldsInput?: EntityManagedFieldsConfig | null
): TagCatalogEntry[] {
  const managedFields = normalizeManagedFieldsConfig(managedFieldsInput, profession)
  const roleEntries = buildRoleTagEntries(managedFields.contactRoles)
  const managedContactEntries = buildManagedContactTagEntries(managedFields)

  return [...tagCatalog, ...managedContactEntries, ...roleEntries]
}
