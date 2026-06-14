/**
 * Pure matching/normalization rules for the conflict-of-interest check
 * (vérification des conflits d'intérêts) across dossiers.
 *
 * The IO part (scanning the other registered dossiers' contacts) lives in
 * src/main/services/domain/conflictCheckService.ts; this module only holds
 * the name comparison logic so it stays unit-testable.
 */

export type ConflictMatchKind = 'exact' | 'partial'

/** Query for a conflict check: the contact name being saved and its dossier. */
export interface ConflictCheckInput {
  dossierId: string
  firstName?: string
  lastName?: string
}

/** One contact in another dossier whose name matches the checked contact. */
export interface ConflictMatch {
  dossierId: string
  dossierName: string
  contactUuid: string
  contactDisplayName: string
  contactRole?: string
  matchKind: ConflictMatchKind
}

/**
 * Last names of 2 characters or fewer (particles like "Le", "De", initials)
 * are too ambiguous to flag on their own.
 */
const PARTIAL_MATCH_MIN_LAST_NAME_LENGTH = 3

/**
 * Normalizes a name for comparison: trimmed, case-insensitive,
 * accent-insensitive, and hyphen variants treated as spaces so
 * "Jean-Pierre" matches "jean pierre".
 */
export function normalizeNameForConflictCheck(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-\u2010-\u2015]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Match rules:
 * - 'exact'   — both first AND last names are equal after normalization
 * - 'partial' — only the last name matches, and it is longer than 2
 *               characters (short particles/initials are ignored)
 * - null      — anything else; without a last name there is never a match
 */
export function evaluateNameConflict(
  query: { firstName?: string; lastName?: string },
  candidate: { firstName?: string; lastName?: string }
): ConflictMatchKind | null {
  const queryLastName = normalizeNameForConflictCheck(query.lastName)
  const candidateLastName = normalizeNameForConflictCheck(candidate.lastName)

  if (!queryLastName || queryLastName !== candidateLastName) {
    return null
  }

  const queryFirstName = normalizeNameForConflictCheck(query.firstName)
  const candidateFirstName = normalizeNameForConflictCheck(candidate.firstName)

  if (queryFirstName && queryFirstName === candidateFirstName) {
    return 'exact'
  }

  return queryLastName.length >= PARTIAL_MATCH_MIN_LAST_NAME_LENGTH ? 'partial' : null
}

/** Display order for matches: exact first, then by dossier name, then contact name. */
export function compareConflictMatches(left: ConflictMatch, right: ConflictMatch): number {
  if (left.matchKind !== right.matchKind) {
    return left.matchKind === 'exact' ? -1 : 1
  }

  const byDossierName = left.dossierName.localeCompare(right.dossierName, undefined, {
    sensitivity: 'base'
  })

  if (byDossierName !== 0) {
    return byDossierName
  }

  return left.contactDisplayName.localeCompare(right.contactDisplayName, undefined, {
    sensitivity: 'base'
  })
}
