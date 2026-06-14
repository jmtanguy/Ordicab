/**
 * Role personas — stable fake identities personifying a contact role.
 *
 * Whatever the dossier, the same role is always impersonated by the same fake
 * identity (the client is always "Camille Dupont", the opposing party always
 * "Dominique Moreau", …). This gives the lawyer a stable mental mapping when
 * reading pseudonymized text, in the embedded AI assistant and in the Claude
 * Cowork export alike.
 *
 * `roleKey` is `labelToKey(contact.role)` (diacritics stripped, camelCase),
 * matching the semantic marker prefix `contact.<roleKey>` allocated by
 * PiiPseudonymizer.seedFromContext. Only the first contact of a role gets the
 * persona; additional contacts with the same role fall back to the
 * deterministic fakegen pools.
 */

export interface PiiPersona {
  /** labelToKey(role), e.g. 'avocatAdverse' */
  roleKey: string
  /** Display label for the settings UI, e.g. 'Avocat adverse' */
  roleLabel: string
  /** Every standalone token must be ≥ 4 chars — shorter fakes are dropped by revert. */
  firstName: string
  lastName: string
  gender: 'M' | 'F' | 'N'
  /** Stable fake organisation (tribunal, expert office, law firm…). */
  institution?: string
}

export interface PiiPersonaSettings {
  personas: PiiPersona[]
}

/**
 * Default French personas. Names are deliberately common-but-plausible and
 * every token is ≥ 4 characters (revertWithMappingEntries ignores shorter
 * fake values, which would make the original unrecoverable in LLM prose).
 */
export const DEFAULT_PII_PERSONAS: PiiPersona[] = [
  { roleKey: 'client', roleLabel: 'Client', firstName: 'Camille', lastName: 'Dupont', gender: 'N' },
  {
    roleKey: 'adversaire',
    roleLabel: 'Adversaire',
    firstName: 'Dominique',
    lastName: 'Moreau',
    gender: 'N'
  },
  {
    roleKey: 'avocat',
    roleLabel: 'Avocat',
    firstName: 'Maxime',
    lastName: 'Garnier',
    gender: 'N',
    institution: 'Cabinet Garnier'
  },
  {
    roleKey: 'avocatAdverse',
    roleLabel: 'Avocat adverse',
    firstName: 'Gabriel',
    lastName: 'Lambert',
    gender: 'M',
    institution: 'Cabinet Lambert & Associés'
  },
  {
    roleKey: 'confrere',
    roleLabel: 'Confrère',
    firstName: 'Victoire',
    lastName: 'Marchand',
    gender: 'F'
  },
  {
    roleKey: 'tribunal',
    roleLabel: 'Tribunal',
    firstName: 'Pauline',
    lastName: 'Verdier',
    gender: 'F',
    institution: 'Tribunal judiciaire de Brévanne'
  },
  {
    roleKey: 'expert',
    roleLabel: 'Expert',
    firstName: 'Édouard',
    lastName: 'Blanchet',
    gender: 'M',
    institution: 'Cabinet Blanchet Expertise'
  },
  { roleKey: 'temoin', roleLabel: 'Témoin', firstName: 'Noémie', lastName: 'Fabre', gender: 'F' }
]

/** True when every standalone name token survives the ≥4-char revert filter. */
export function isPersonaNameSafe(persona: Pick<PiiPersona, 'firstName' | 'lastName'>): boolean {
  return [persona.firstName, persona.lastName]
    .flatMap((name) => name.split(/\s+/))
    .filter(Boolean)
    .every((token) => token.length >= 4)
}

/** Merge stored personas over the defaults, dropping unsafe entries. */
export function mergePersonasWithDefaults(stored: PiiPersona[] | undefined): PiiPersona[] {
  const byKey = new Map(DEFAULT_PII_PERSONAS.map((persona) => [persona.roleKey, persona]))
  for (const persona of stored ?? []) {
    if (!persona.roleKey || !persona.firstName || !persona.lastName) continue
    if (!isPersonaNameSafe(persona)) continue
    byKey.set(persona.roleKey, persona)
  }
  return [...byKey.values()]
}
