/**
 * personNameDetection — shared primitives for detecting person names in plain text.
 *
 * This module is the single source of truth for:
 *   - the name-token regex pattern (Title Case, hyphenated, accented)
 *   - the full set of civility honorifics (FR + EN)
 *   - the title-anchored name detection regex (FR + EN)
 *   - a convenience line-tester used by the contact extraction scanner
 *
 * It is consumed by two callers with different needs:
 *   • piiDetector.ts  — needs DetectedSpan[] for each name token found in a chunk of text
 *   • aiService.ts    — needs a fast boolean "does this line contain a titled person name?"
 *
 * Keeping this logic here rather than duplicated ensures that improvements
 * (new titles, new locales, edge-case fixes) propagate to both callers at once.
 *
 * Language support
 * ────────────────
 * French  : Monsieur, Madame, Mademoiselle, Maître (+ Maitre), Docteur, Professeur
 *           and their abbreviated forms M., Mme., Mlle., Me., Dr., Pr.
 * English : Mr., Mrs., Ms., Miss, Sir, Professor, Doctor
 *           and their abbreviated forms Prof., Dr.
 *
 * Note: Dr. / Prof. are shared between FR and EN; they are listed once.
 */

import { KNOWN_FIRST_NAMES } from './fakegen'

// ── Name-token pattern ─────────────────────────────────────────────────────
//
// A name token is a single word in Title Case (uppercase first letter followed
// by one or more lowercase letters), optionally joined to further syllables by
// hyphens.  Each hyphenated syllable follows the same rule.
//
// Examples that match  : Martin, Jean-Pierre, Marie-Claire-Hélène, Müller
// Examples that do NOT : DUPONT (all-caps), dupont (lowercase), A (single char)
//
// The character classes include the full range of accented letters used in
// French (À–Ÿ / à–ÿ), which covers the common diacritics: é è ê ë î ï ô ù û ü ç…
//
// This is exported as a plain string so that callers can embed it inside larger
// regex literals without importing a RegExp object (which cannot be interpolated).
export const NAME_TOKEN_RE =
  "(?:[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-záàâäéèêëîïôöùûüç]+|[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]['’][A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-záàâäéèêëîïôöùûüç]+)(?:[-'’][A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ][a-záàâäéèêëîïôöùûüç]+)*"

// Title-Case (NAME_TOKEN_RE) OR ALL-CAPS run. Used wherever a name span needs
// to match either the standard "John Smith" form or the ALL-CAPS "JOHN SMITH"
// form found in legal documents and form fields.
export const NAME_TOKEN_OR_ALLCAPS = `(?:${NAME_TOKEN_RE}|[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]{2,}(?:-[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]{2,})*)`

// ── Honorific titles ───────────────────────────────────────────────────────
//
// Honorifics are civility titles that immediately precede a person name.
// They are NOT considered PII themselves — only the name that follows them is.
//
// The set is used in two ways:
//   1. In detectTitleAnchored: as the trigger that begins a name match.
//   2. In detectCapitalized  : to skip honorific tokens when splitting a
//      multi-word sequence into individual name spans (so "Monsieur" is not
//      emitted as a name span when scanning "Monsieur Jean Dupont").

/** French civility titles and their standard abbreviations. */
const HONORIFICS_FR: ReadonlySet<string> = new Set([
  // Full forms
  'Monsieur',
  'Madame',
  'Mademoiselle',
  'Maître',
  'Maitre', // non-accented variant found in scanned documents
  'Docteur',
  'Professeur',
  // Abbreviated forms — the dot is part of the token here (no word boundary issue
  // because these are matched as literals inside a regex alternation)
  'M.',
  'Mr',
  'Mr.',
  'Mme.',
  'Mme', // sometimes written without trailing dot
  'Mlle.',
  'Mlle',
  'Me.',
  'Me',
  'Dr.',
  'Dr',
  'Pr.',
  'Pr'
])

/** English civility titles and their standard abbreviations. */
const HONORIFICS_EN: ReadonlySet<string> = new Set([
  // Full forms
  'Mister',
  'Master',
  'Mistress', // archaic but still appears in legal documents
  'Miss',
  'Madam',
  'Sir',
  'Dame',
  'Lord',
  'Lady',
  'Professor',
  'Doctor',
  'Reverend',
  'Honourable',
  'Honorable',
  'Justice',
  'Captain',
  'Major',
  'Colonel',
  'General',
  'Admiral',
  'Sergeant',
  'Lieutenant',
  'Commander',
  'Corporal',
  'Venerable',
  'Canon',
  'Father', // religious
  'Brother', // religious
  'Sister', // religious
  'Bishop',
  'Archbishop',
  // Abbreviated forms
  'Mr.',
  'Mr',
  'Mrs.',
  'Mrs',
  'Miss.',
  'Ms.',
  'Ms',
  'Mx.',
  'Mx',
  'Prof.',
  'Prof',
  'Rev.',
  'Rev',
  'Hon.',
  'Hon',
  'Honble.',
  'Honble',
  'Capt.',
  'Capt',
  'Maj.',
  'Maj',
  'Col.',
  'Col',
  'Gen.',
  'Gen',
  'Adm.',
  'Adm',
  'Sgt.',
  'Sgt',
  'Lt.',
  'Lt',
  'Cpl.',
  'Cpl',
  'Cmdr.',
  'Cmdr',
  'Ven.',
  'Ven',
  // Dr. / Dr are shared with FR — already in HONORIFICS_FR; listed here for
  // completeness when iterating HONORIFICS_EN in isolation.
  'Dr.',
  'Dr'
])

/**
 * Combined set of all honorifics (FR + EN).
 * Used by piiDetector's detectCapitalized and detectTitleAnchored functions.
 */
export const HONORIFICS: ReadonlySet<string> = new Set([...HONORIFICS_FR, ...HONORIFICS_EN])

const NON_PERSON_ROLE_TOKENS: ReadonlySet<string> = new Set([
  'Président',
  'Présidente',
  'Maire',
  'Directeur',
  'Directrice',
  'Direction',
  'Juge',
  'Greffier',
  'Greffière',
  'Procureur',
  'Procureure',
  'Avocat',
  'Avocate',
  'Plaignant',
  'Plaignante',
  'Défendeur',
  'Défenderesse',
  'Requérant',
  'Requérante',
  'Client',
  'Cliente',
  'Support',
  'Service',
  'Comptabilité',
  'Comptable',
  'Juridique',
  'Legal',
  'Manager',
  'President',
  'Mayor',
  'Judge',
  'Director',
  'Justice',
  'Attorney',
  'Lawyer',
  'Solicitor',
  'Barrister',
  'Counsel',
  'Notary',
  'Bailiff',
  'Clerk',
  'Plaintiff',
  'Defendant',
  'Claimant',
  'Respondent',
  'Appellant',
  'Appellee',
  'Petitioner',
  'Applicant',
  'Witness',
  'Customer',
  'Operations',
  'Relations',
  'Compliance',
  'Administration',
  'Department',
  'Office',
  'Client',
  'Support',
  'Accounting',
  'Finance',
  'Team'
])

// ── Title-anchored regex ───────────────────────────────────────────────────
//
// Matches a civility title immediately followed by one to four name tokens.
// The name tokens are captured in group 1 so callers can split them further.
//
// Design notes:
//   • The alternation is ordered longest-first within each locale to avoid
//     short prefixes (M., Me.) matching the start of longer titles.
//   • Abbreviated titles end with \. (dot is literal inside the character
//     class) or are written without a dot — both variants appear in real docs.
//   • The `g` flag is intentionally omitted here; callers reconstruct the
//     regex with `new RegExp(TITLE_ANCHORED_RE.source, 'g')` so that each
//     call gets a fresh `lastIndex` (avoids the stateful-regex bug when the
//     same RegExp object is reused across calls).
//
// Matches examples:
//   FR : "M. Dupont", "Mme Martin", "Maître Lefebvre", "Docteur Renard",
//        "Monsieur Jean Dupont", "Mme. Marie-Claire Fontaine"
//   EN : "Mr. Smith", "Mrs. Johnson", "Miss Emily Brown", "Sir Arthur Lewis",
//        "Dr. Watson", "Prof. Moriarty", "Professor Elizabeth Turner",
//        "Reverend Samuel Price", "Hon. Robert Miles", "Captain John Reed"

const TITLE_ANCHORED_RE = new RegExp(
  // ── French titles (longest first to avoid prefix shadowing) ──
  '(?:' +
    'Mademoiselle|Monsieur|Madame|Professeur|Docteur|' + // full forms
    'Maître|Maitre|' + // Maître (with/without accent)
    'Mlle\\.?|Mme\\.?|Me\\.?|Pr\\.?|Dr\\.?|M\\.' + // abbreviations (dot optional except M.)
    '|' +
    // ── English titles (longest first) ──
    'Archbishop|Honourable|Honorable|Professor|Reverend|Mistress|Commander|Lieutenant|Corporal|' +
    'Admiral|General|Colonel|Captain|Venerable|Justice|Mister|Master|Madam|Doctor|Bishop|Father|' +
    'Brother|Sister|Canon|Major|Dame|Lord|Lady|Miss|Sir|' + // full forms
    'Honble\\.?|Capt\\.?|Cmdr\\.?|Prof\\.?|Rev\\.?|Hon\\.?|Mrs\\.?|Mr\\.?|Ms\\.?|Mx\\.?|Maj\\.?|' +
    'Col\\.?|Gen\\.?|Adm\\.?|Sgt\\.?|Lt\\.?|Cpl\\.?' + // abbreviations (dot optional)
    ')' +
    // One mandatory space/newline, then 1–4 name tokens separated by horizontal
    // whitespace only ([ \t]+, not \s+) so the match never crosses a line boundary
    // and pulls a role keyword from the next line into the name span.
    `[ \\t]+(${NAME_TOKEN_RE}(?:[ \\t]+${NAME_TOKEN_RE}){0,3})`
)

/**
 * Detects all title-anchored person name spans in `text`.
 *
 * Each name token (first name, last name, etc.) is returned as a separate
 * span with its start/end byte offsets in the original string. The civility
 * title itself is excluded — it is not PII.
 *
 * This function is the one consumed by piiDetector.ts, replacing its local
 * `detectTitleAnchored` implementation.  The interface mirrors what the PII
 * pipeline expects: an array of `{ value, start, end }` objects with a
 * `type: 'name'` discriminant.
 *
 * @param text  Arbitrary plain text, may span multiple lines.
 * @returns     Non-overlapping name spans sorted by start position.
 *              (De-overlapping against spans from other detectors is handled
 *              by piiDetector's `mergeSpans`.)
 */
export interface NameSpan {
  type: 'name'
  value: string
  start: number
  end: number
}

export function detectTitleAnchoredNames(text: string): NameSpan[] {
  const spans: NameSpan[] = []
  // Reconstruct with 'g' flag so we iterate all matches (a fresh RegExp
  // object per call avoids lastIndex bleed between invocations).
  const re = new RegExp(TITLE_ANCHORED_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    // m[1] is the capture group: everything after the title + space.
    // Example: "Monsieur Jean-Pierre Dupont" → m[1] = "Jean-Pierre Dupont"
    const nameStr = m[1]!

    // Locate the name string inside the full match to get its absolute offset.
    // m[0] = full match (title + space + name), m.index = start of full match.
    const nameOffset = m[0].indexOf(nameStr)
    const nameStart = m.index + nameOffset

    // Split "Jean-Pierre Dupont" → ["Jean-Pierre", "Dupont"] and emit each
    // as an individual span. Hyphenated compounds stay as one token.
    const parts = splitNameParts(nameStr)
    if (!isLikelyPersonNameParts(parts)) continue
    let cursor = nameStart

    for (const part of parts) {
      const partStart = text.indexOf(part, cursor)
      if (partStart === -1) continue // should never happen
      cursor = partStart + part.length

      // Skip any token that is itself an honorific (can happen when the title
      // list and the name string overlap, e.g. "Madame Docteur Lefebvre").
      if (HONORIFICS.has(part)) continue

      spans.push({ type: 'name', value: part, start: partStart, end: partStart + part.length })
    }
  }

  return spans
}

function splitNameParts(value: string): string[] {
  return value.split(/\s+/).filter(Boolean)
}

function isLikelyPersonNameParts(parts: string[]): boolean {
  const filteredParts = parts.filter((part) => !HONORIFICS.has(part))
  if (filteredParts.length === 0) return false

  const hasKnownFirstName = filteredParts.some((part) => KNOWN_FIRST_NAMES.has(part))
  const roleTokenCount = filteredParts.filter((part) => NON_PERSON_ROLE_TOKENS.has(part)).length
  const lastPart = filteredParts[filteredParts.length - 1] ?? ''

  // Reject obvious role / department phrases such as "Madame La Présidente"
  // or "Mr. Support Client", but keep common single-token surname forms.
  if (NON_PERSON_ROLE_TOKENS.has(lastPart)) return false
  if (roleTokenCount > 0 && filteredParts.length > 1 && !hasKnownFirstName) return false

  return true
}
