import type { AppLocale } from './contracts/app'

export type ManagedFieldValueType = 'text' | 'date'

export interface ManagedFieldDefinition {
  label: string
  type: ManagedFieldValueType
}

type LocaleTable<T> = Record<AppLocale, T>

function pickByLocale<T>(table: LocaleTable<T>, locale: AppLocale): T {
  return table[locale] ?? table.fr
}

// =============================================================================
// Role presets (avocat français solo)
// =============================================================================

const ROLE_PRESETS_BY_LOCALE: LocaleTable<string[]> = {
  fr: [
    'partie représentée',
    'avocat de la partie représentée',
    'partie adverse',
    'avocat de la partie adverse',
    'juridiction',
    'juge',
    'greffier',
    'expert judiciaire',
    'notaire',
    'huissier de justice',
    'commissaire de justice',
    'assureur',
    'témoin',
    'tuteur',
    'organisme public',
    'médiateur',
    'procureur de la République',
    'médecin expert',
    'interprète'
  ],
  en: [
    'represented party',
    "represented party's lawyer",
    'opposing party',
    "opposing party's lawyer",
    'court',
    'judge',
    'court clerk',
    'court-appointed expert',
    'notary',
    'bailiff',
    'judicial commissioner',
    'insurer',
    'witness',
    'guardian',
    'public body',
    'mediator',
    'public prosecutor',
    'medical expert',
    'interpreter'
  ]
}

export function getRolePresets(locale: AppLocale = 'fr'): string[] {
  return pickByLocale(ROLE_PRESETS_BY_LOCALE, locale)
}

// =============================================================================
// Default contact fields
// =============================================================================

const DEFAULT_CONTACT_FIELDS_FR: ManagedFieldDefinition[] = [
  { label: 'Prénoms complémentaires', type: 'text' },
  { label: 'Nom de jeune fille', type: 'text' },
  { label: 'Date de naissance', type: 'date' },
  { label: 'Nationalité', type: 'text' },
  { label: 'Pays de naissance', type: 'text' },
  { label: 'Profession', type: 'text' },
  { label: 'N° sécurité sociale', type: 'text' }
]

const DEFAULT_CONTACT_FIELDS_EN: ManagedFieldDefinition[] = [
  { label: 'Additional first names', type: 'text' },
  { label: 'Maiden name', type: 'text' },
  { label: 'Date of birth', type: 'date' },
  { label: 'Nationality', type: 'text' },
  { label: 'Country of birth', type: 'text' },
  { label: 'Occupation', type: 'text' },
  { label: 'Social security number', type: 'text' }
]

const DEFAULT_CONTACT_FIELDS_BY_LOCALE: LocaleTable<ManagedFieldDefinition[]> = {
  fr: DEFAULT_CONTACT_FIELDS_FR,
  en: DEFAULT_CONTACT_FIELDS_EN
}

export function getDefaultContactFields(locale: AppLocale = 'fr'): ManagedFieldDefinition[] {
  return pickByLocale(DEFAULT_CONTACT_FIELDS_BY_LOCALE, locale)
}

// =============================================================================
// Default key date fields
// =============================================================================

const DEFAULT_KEY_DATE_FIELDS_BY_LOCALE: LocaleTable<ManagedFieldDefinition[]> = {
  fr: [
    { label: "Date d'audience", type: 'date' },
    { label: 'Date de délibéré', type: 'date' },
    { label: 'Date de renvoi', type: 'date' }
  ],
  en: [
    { label: 'Hearing date', type: 'date' },
    { label: 'Deliberation date', type: 'date' },
    { label: 'Postponement date', type: 'date' }
  ]
}

export function getDefaultKeyDateFields(locale: AppLocale = 'fr'): ManagedFieldDefinition[] {
  return pickByLocale(DEFAULT_KEY_DATE_FIELDS_BY_LOCALE, locale)
}

// =============================================================================
// Default key reference fields
// =============================================================================

const DEFAULT_KEY_REFERENCE_FIELDS_BY_LOCALE: LocaleTable<ManagedFieldDefinition[]> = {
  fr: [
    { label: 'Juridiction', type: 'text' },
    { label: 'Tribunal', type: 'text' },
    { label: 'N° dossier', type: 'text' },
    { label: 'N° RG', type: 'text' },
    { label: 'N° Portalis', type: 'text' },
    { label: 'N° dossier adverse', type: 'text' }
  ],
  en: [
    { label: 'Jurisdiction', type: 'text' },
    { label: 'Court', type: 'text' },
    { label: 'Case number', type: 'text' },
    { label: 'Court file number', type: 'text' },
    { label: 'Portalis number', type: 'text' },
    { label: 'Opposing case number', type: 'text' }
  ]
}

export function getDefaultKeyReferenceFields(locale: AppLocale = 'fr'): ManagedFieldDefinition[] {
  return pickByLocale(DEFAULT_KEY_REFERENCE_FIELDS_BY_LOCALE, locale)
}

// =============================================================================
// Organization role hints (heuristic to flag organization-style roles)
// =============================================================================

const ORGANIZATION_ROLE_HINTS_BY_LOCALE: LocaleTable<string[]> = {
  fr: [
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
  ],
  en: [
    'court',
    'public body',
    'bank',
    'insurer',
    'office',
    'department',
    'authority',
    'agency',
    'company',
    'firm',
    'building manager'
  ]
}

export function isOrganizationRole(role: string, locale: AppLocale = 'fr'): boolean {
  const lower = role.toLowerCase()
  const hints = pickByLocale(ORGANIZATION_ROLE_HINTS_BY_LOCALE, locale)
  return hints.some((hint) => lower.includes(hint))
}
