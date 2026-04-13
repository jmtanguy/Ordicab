export const TEMPLATE_ROUTINE_GROUPS = [
  'dossier',
  'contact',
  'entity',
  'keyDates',
  'keyRefs',
  'system'
] as const

export type TemplateRoutineGroup = (typeof TEMPLATE_ROUTINE_GROUPS)[number]

export interface TemplateRoutineEntry {
  tag: string
  tagFr?: string
  group: TemplateRoutineGroup
  description: string
  descriptionFr?: string
  subGroup?: 'address' | 'identity' | 'personalInfo' | 'salutation'
  example: string
}

export const CONTACT_ROLE_FIELD_ALIASES: Array<{ en: string; fr: string }> = [
  { en: 'displayName', fr: 'nomAffiche' },
  { en: 'title', fr: 'titre' },
  { en: 'firstName', fr: 'prenom' },
  { en: 'firstNames', fr: 'prenoms' },
  { en: 'additionalFirstNames', fr: 'prenomsComplementaires' },
  { en: 'lastName', fr: 'nom' },
  { en: 'salutation', fr: 'civilite' },
  { en: 'salutationFull', fr: 'civiliteNom' },
  { en: 'dear', fr: 'formuleAppel' },
  { en: 'phone', fr: 'telephone' },
  { en: 'institution', fr: 'institution' },
  { en: 'address', fr: 'adresse' },
  { en: 'addressLine', fr: 'ligneAdresse' },
  { en: 'addressLine2', fr: 'ligneAdresse2' },
  { en: 'city', fr: 'ville' },
  { en: 'zipCode', fr: 'codePostal' },
  { en: 'country', fr: 'pays' },
  { en: 'dateOfBirth', fr: 'dateNaissance' },
  { en: 'countryOfBirth', fr: 'paysNaissance' },
  { en: 'nationality', fr: 'nationalite' },
  { en: 'occupation', fr: 'profession' },
  { en: 'socialSecurityNumber', fr: 'numeroSecu' },
  { en: 'maidenName', fr: 'nomJeuneFille' },
  { en: 'addressFormatted', fr: 'adresseFormatee' },
  { en: 'addressInline', fr: 'adresseCompacte' }
]
