import type { TemplateRoutineEntry, TemplateRoutineGroup } from '@shared/templateRoutines'
import { TEMPLATE_ROUTINE_GROUPS, templateRoutineCatalog } from '@shared/templateRoutines'
import { labelToKey } from '@shared/templateContent'
import {
  getManagedFieldKey,
  normalizeManagedFieldsConfig,
  type EntityManagedFieldsConfig
} from '@shared/managedFields'
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

const RECOMMENDED_CONTACT_ROLE_FIELDS = new Set([
  'displayName',
  'salutationFull',
  'dear',
  'addressFormatted',
  'email',
  'phone'
])

export const tagCatalog: TagCatalogEntry[] = templateRoutineCatalog

/**
 * Returns role-keyed tag entries for the given role labels.
 * e.g. role "client" → {{contact.client.displayName}}, {{contact.client.email}}, ...
 */
export function buildRoleTagEntries(roles: string[]): TagCatalogEntry[] {
  return roles.flatMap((role) =>
    CONTACT_ROLE_FIELDS.filter(({ field }) => RECOMMENDED_CONTACT_ROLE_FIELDS.has(field)).map(
      ({ field, fieldFr, example, subGroup }) => ({
        tag: `{{contact.${roleToTagKey(role)}.${field}}}`,
        tagFr: fieldFr ? `{{contact.${roleToTagKey(role)}.${fieldFr}}}` : undefined,
        group: 'contact' as TagGroup,
        description: `${field} du contact « ${role} »`,
        descriptionFr: `${fieldFr ?? field} du contact « ${role} »`,
        subGroup,
        example
      })
    )
  )
}

function buildFeeAgreementContactTagEntries(
  role: 'client' | 'signatory',
  roleFr: string
): TagCatalogEntry[] {
  return CONTACT_ROLE_FIELDS.filter(({ field }) => RECOMMENDED_CONTACT_ROLE_FIELDS.has(field)).map(
    ({ field, fieldFr, example, subGroup }) => ({
      tag: `{{dossier.feeAgreement.${role}.${field}}}`,
      tagFr: `{{convention.${roleFr}.${fieldFr ?? field}}}`,
      group: 'feeAgreement' as TagGroup,
      description: `${field} du ${role === 'client' ? 'client contractant' : 'signataire'}`,
      descriptionFr: `${fieldFr ?? field} du ${role === 'client' ? 'client contractant' : 'signataire'}`,
      subGroup,
      example
    })
  )
}

function buildManagedDossierReferenceTagEntries(
  managedFields: EntityManagedFieldsConfig
): TagCatalogEntry[] {
  return managedFields.keyReferences.map((definition) => {
    const key = labelToKey(definition.label)
    const tag = `{{dossier.${key}}}`
    return {
      tag,
      tagFr: tag,
      group: 'dossier' as TagGroup,
      description: `Référence dossier « ${definition.label} »`,
      descriptionFr: `Référence dossier « ${definition.label} »`,
      example: definition.label
    }
  })
}

// Index of the static contact-level personalInfo entries keyed by their
// canonical English field key. Default managed contact fields reuse these
// rich entries (French alias, example, polished description).
const STATIC_CONTACT_PERSONAL_INFO_BY_KEY = new Map<string, TagCatalogEntry>(
  templateRoutineCatalog
    .filter((entry) => entry.group === 'contact' && entry.subGroup === 'personalInfo')
    .map((entry) => {
      const match = /^\{\{\s*contact\.([^.]+)\s*\}\}$/.exec(entry.tag)
      return match ? ([match[1]!, entry] as const) : null
    })
    .filter(Boolean) as Array<readonly [string, TagCatalogEntry]>
)

function buildManagedContactFieldTagEntries(
  managedFields: EntityManagedFieldsConfig
): TagCatalogEntry[] {
  return managedFields.contacts.map((definition) => {
    const englishKey = getManagedFieldKey(definition)
    const staticEntry = STATIC_CONTACT_PERSONAL_INFO_BY_KEY.get(englishKey)
    if (staticEntry) return staticEntry

    const labelKey = labelToKey(definition.label)
    const tag = `{{contact.${labelKey}}}`
    return {
      tag,
      tagFr: tag,
      group: 'contact' as TagGroup,
      subGroup: 'personalInfo' as const,
      description: `Primary contact ${definition.label}`,
      descriptionFr: `${definition.label} du contact principal`,
      example: definition.label
    }
  })
}

function dedupeTagEntries(entries: TagCatalogEntry[]): TagCatalogEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.tag)) return false
    seen.add(entry.tag)
    return true
  })
}

/**
 * Returns the full tag catalog, including role-specific contact tags
 * derived from the given profession.
 */
export function getTagCatalog(
  managedFieldsInput?: EntityManagedFieldsConfig | null
): TagCatalogEntry[] {
  const managedFields = normalizeManagedFieldsConfig(managedFieldsInput)
  const roleEntries = buildRoleTagEntries(managedFields.contactRoles)
  const managedDossierReferenceEntries = buildManagedDossierReferenceTagEntries(managedFields)
  const managedContactFieldEntries = buildManagedContactFieldTagEntries(managedFields)
  const feeAgreementEntries = [
    ...buildFeeAgreementContactTagEntries('client', 'client'),
    ...buildFeeAgreementContactTagEntries('signatory', 'signataire')
  ]

  // Drop static contact-level personalInfo entries — the picker now sources
  // them from managedFields.contacts so removing/adding a field in settings
  // is reflected in the routine dialog.
  const baseCatalog = tagCatalog.filter(
    (entry) => !(entry.group === 'contact' && entry.subGroup === 'personalInfo')
  )

  return dedupeTagEntries([
    ...baseCatalog,
    ...managedContactFieldEntries,
    ...managedDossierReferenceEntries,
    ...feeAgreementEntries,
    ...roleEntries
  ])
}
