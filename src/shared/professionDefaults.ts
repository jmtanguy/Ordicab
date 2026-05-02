import type { AppLocale } from './contracts/app'

export type EntityProfession =
  | 'lawyer'
  | 'architect'
  | 'real_estate'
  | 'building_trades'
  | 'consulting_services'

export type ManagedFieldValueType = 'text' | 'date'

export interface ManagedFieldDefinition {
  label: string
  type: ManagedFieldValueType
}

type ProfessionTable<T> = Record<EntityProfession, T>
type LocaleTable<T> = Record<AppLocale, T>

function pickByLocale<T>(table: LocaleTable<T>, locale: AppLocale): T {
  return table[locale] ?? table.fr
}

function pickByProfession<T>(
  table: ProfessionTable<T>,
  profession: EntityProfession | null | undefined
): T {
  return table[profession ?? 'lawyer'] ?? table.lawyer
}

// =============================================================================
// Role presets
// =============================================================================

const ROLE_PRESETS_FR: ProfessionTable<string[]> = {
  lawyer: [
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
  architect: [
    "maître d'ouvrage",
    "maître d'œuvre",
    'entreprise générale',
    'sous-traitant',
    'bureau de contrôle',
    'coordinateur SPS',
    'géomètre-expert',
    'notaire',
    'assureur',
    'architecte des bâtiments de France',
    'service urbanisme',
    'syndic de copropriété'
  ],
  real_estate: [
    'vendeur',
    'acquéreur',
    'notaire',
    'agent immobilier',
    'promoteur immobilier',
    'gestionnaire locatif',
    'bailleur',
    'locataire',
    'garant',
    'banque',
    'diagnostiqueur',
    'syndic',
    'copropriétaire',
    'assureur'
  ],
  building_trades: [
    'client',
    "maître d'ouvrage",
    'architecte',
    'bureau de contrôle',
    'fournisseur',
    'assureur',
    'sous-traitant'
  ],
  consulting_services: [
    'client',
    'contact facturation',
    'contact projet',
    'sous-traitant',
    'partenaire'
  ]
}

const ROLE_PRESETS_EN: ProfessionTable<string[]> = {
  lawyer: [
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
  ],
  architect: [
    'project owner',
    'project manager',
    'general contractor',
    'subcontractor',
    'inspection office',
    'safety coordinator',
    'land surveyor',
    'notary',
    'insurer',
    'heritage architect',
    'planning department',
    'property management'
  ],
  real_estate: [
    'seller',
    'buyer',
    'notary',
    'real estate agent',
    'property developer',
    'rental manager',
    'landlord',
    'tenant',
    'guarantor',
    'bank',
    'property inspector',
    'building manager',
    'co-owner',
    'insurer'
  ],
  building_trades: [
    'client',
    'project owner',
    'architect',
    'inspection office',
    'supplier',
    'insurer',
    'subcontractor'
  ],
  consulting_services: ['client', 'billing contact', 'project contact', 'subcontractor', 'partner']
}

const ROLE_PRESETS_BY_LOCALE: LocaleTable<ProfessionTable<string[]>> = {
  fr: ROLE_PRESETS_FR,
  en: ROLE_PRESETS_EN
}

const FALLBACK_ROLES_BY_LOCALE: LocaleTable<string[]> = {
  fr: ['client', 'contact', 'partenaire'],
  en: ['client', 'contact', 'partner']
}

export function getRolePresets(
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): string[] {
  const presets = pickByLocale(ROLE_PRESETS_BY_LOCALE, locale)
  if (profession && profession in presets) {
    return presets[profession]
  }
  return pickByLocale(FALLBACK_ROLES_BY_LOCALE, locale)
}

// =============================================================================
// Legacy contact managed fields (historical lawyer defaults)
// =============================================================================

const LEGACY_CONTACT_FIELDS_FR: ManagedFieldDefinition[] = [
  { label: "Prénoms complémentaires de l'état civil", type: 'text' },
  { label: 'Nom de jeune fille', type: 'text' },
  { label: 'Date de naissance', type: 'date' },
  { label: 'Nationalité', type: 'text' },
  { label: 'Pays de naissance', type: 'text' },
  { label: 'Profession', type: 'text' },
  { label: 'N° sécurité sociale', type: 'text' }
]

const LEGACY_CONTACT_FIELDS_EN: ManagedFieldDefinition[] = [
  { label: 'Additional first names', type: 'text' },
  { label: 'Maiden name', type: 'text' },
  { label: 'Date of birth', type: 'date' },
  { label: 'Nationality', type: 'text' },
  { label: 'Country of birth', type: 'text' },
  { label: 'Occupation', type: 'text' },
  { label: 'Social security number', type: 'text' }
]

const LEGACY_CONTACT_FIELDS_BY_LOCALE: LocaleTable<ManagedFieldDefinition[]> = {
  fr: LEGACY_CONTACT_FIELDS_FR,
  en: LEGACY_CONTACT_FIELDS_EN
}

export function getLegacyContactManagedFields(locale: AppLocale = 'fr'): ManagedFieldDefinition[] {
  return pickByLocale(LEGACY_CONTACT_FIELDS_BY_LOCALE, locale)
}

// =============================================================================
// Default contact fields per profession
// =============================================================================

const DEFAULT_CONTACT_FIELDS_FR: ProfessionTable<ManagedFieldDefinition[]> = {
  lawyer: LEGACY_CONTACT_FIELDS_FR,
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

const DEFAULT_CONTACT_FIELDS_EN: ProfessionTable<ManagedFieldDefinition[]> = {
  lawyer: LEGACY_CONTACT_FIELDS_EN,
  architect: [
    { label: 'Date of birth', type: 'date' },
    { label: 'Nationality', type: 'text' },
    { label: 'Occupation', type: 'text' },
    { label: 'Capacity', type: 'text' },
    { label: 'Legal representative', type: 'text' },
    { label: 'Insurance reference', type: 'text' },
    { label: 'Insurance policy number', type: 'text' }
  ],
  real_estate: [
    { label: 'Date of birth', type: 'date' },
    { label: 'Nationality', type: 'text' },
    { label: 'Occupation', type: 'text' },
    { label: 'Marital status', type: 'text' },
    { label: 'Matrimonial regime', type: 'text' },
    { label: 'ID number', type: 'text' },
    { label: 'ID expiry date', type: 'date' }
  ],
  building_trades: [
    { label: 'Capacity', type: 'text' },
    { label: 'Legal representative', type: 'text' },
    { label: 'SIRET', type: 'text' },
    { label: 'Site reference', type: 'text' },
    { label: 'Insurance reference', type: 'text' },
    { label: 'Insurance policy number', type: 'text' }
  ],
  consulting_services: [
    { label: 'Position', type: 'text' },
    { label: 'Department', type: 'text' },
    { label: 'SIRET', type: 'text' },
    { label: 'VAT number', type: 'text' },
    { label: 'Purchase reference', type: 'text' },
    { label: 'Customer reference', type: 'text' }
  ]
}

const DEFAULT_CONTACT_FIELDS_BY_LOCALE: LocaleTable<ProfessionTable<ManagedFieldDefinition[]>> = {
  fr: DEFAULT_CONTACT_FIELDS_FR,
  en: DEFAULT_CONTACT_FIELDS_EN
}

export function getDefaultContactFields(
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): ManagedFieldDefinition[] {
  return pickByProfession(pickByLocale(DEFAULT_CONTACT_FIELDS_BY_LOCALE, locale), profession)
}

// =============================================================================
// Default key date fields per profession
// =============================================================================

const DEFAULT_KEY_DATE_FIELDS_FR: ProfessionTable<ManagedFieldDefinition[]> = {
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

const DEFAULT_KEY_DATE_FIELDS_EN: ProfessionTable<ManagedFieldDefinition[]> = {
  lawyer: [
    { label: 'Hearing date', type: 'date' },
    { label: 'Deliberation date', type: 'date' },
    { label: 'Postponement date', type: 'date' }
  ],
  architect: [
    { label: 'Site opening date', type: 'date' },
    { label: 'Expert meeting date', type: 'date' },
    { label: 'Acceptance date', type: 'date' }
  ],
  real_estate: [
    { label: 'Preliminary contract date', type: 'date' },
    { label: 'Deed signing date', type: 'date' },
    { label: 'Move-in date', type: 'date' }
  ],
  building_trades: [
    { label: 'Quote date', type: 'date' },
    { label: 'Order date', type: 'date' },
    { label: 'Service date', type: 'date' }
  ],
  consulting_services: [
    { label: 'Engagement date', type: 'date' },
    { label: 'Delivery date', type: 'date' },
    { label: 'Due date', type: 'date' }
  ]
}

const DEFAULT_KEY_DATE_FIELDS_BY_LOCALE: LocaleTable<ProfessionTable<ManagedFieldDefinition[]>> = {
  fr: DEFAULT_KEY_DATE_FIELDS_FR,
  en: DEFAULT_KEY_DATE_FIELDS_EN
}

export function getDefaultKeyDateFields(
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): ManagedFieldDefinition[] {
  return pickByProfession(pickByLocale(DEFAULT_KEY_DATE_FIELDS_BY_LOCALE, locale), profession)
}

// =============================================================================
// Default key reference fields per profession
// =============================================================================

const DEFAULT_KEY_REFERENCE_FIELDS_FR: ProfessionTable<ManagedFieldDefinition[]> = {
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

const DEFAULT_KEY_REFERENCE_FIELDS_EN: ProfessionTable<ManagedFieldDefinition[]> = {
  lawyer: [
    { label: 'Case number', type: 'text' },
    { label: 'Court file number', type: 'text' },
    { label: 'Opposing case number', type: 'text' }
  ],
  architect: [
    { label: 'Project number', type: 'text' },
    { label: 'Mission number', type: 'text' },
    { label: 'Claim reference', type: 'text' }
  ],
  real_estate: [
    { label: 'Case number', type: 'text' },
    { label: 'Mandate number', type: 'text' },
    { label: 'Property reference', type: 'text' }
  ],
  building_trades: [
    { label: 'Quote number', type: 'text' },
    { label: 'Invoice number', type: 'text' },
    { label: 'Site number', type: 'text' }
  ],
  consulting_services: [
    { label: 'Mission number', type: 'text' },
    { label: 'Order number', type: 'text' },
    { label: 'Invoice number', type: 'text' }
  ]
}

const DEFAULT_KEY_REFERENCE_FIELDS_BY_LOCALE: LocaleTable<
  ProfessionTable<ManagedFieldDefinition[]>
> = {
  fr: DEFAULT_KEY_REFERENCE_FIELDS_FR,
  en: DEFAULT_KEY_REFERENCE_FIELDS_EN
}

export function getDefaultKeyReferenceFields(
  profession?: EntityProfession | null,
  locale: AppLocale = 'fr'
): ManagedFieldDefinition[] {
  return pickByProfession(pickByLocale(DEFAULT_KEY_REFERENCE_FIELDS_BY_LOCALE, locale), profession)
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
