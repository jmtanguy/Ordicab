import { labelToKey } from './templateContent'

export type EntityProfession =
  | 'lawyer'
  | 'architect'
  | 'real_estate'
  | 'building_trades'
  | 'consulting_services'

const ROLE_PRESETS: Record<EntityProfession, string[]> = {
  lawyer: [
    'partie représentée',
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

const FALLBACK_ROLES: string[] = ['client', 'contact', 'partenaire']

export function getRolePresets(profession?: EntityProfession | null): string[] {
  if (profession && profession in ROLE_PRESETS) {
    return ROLE_PRESETS[profession]
  }

  return FALLBACK_ROLES
}

export function roleToTagKey(role: string): string {
  return labelToKey(role) || 'contact'
}
