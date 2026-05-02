/**
 * legalRoleNameDetection — catches bare surnames that escape title-anchored
 * detection by leveraging legal/administrative domain anchors.
 *
 * Motivation
 * ──────────
 * The title-anchored detector needs "M./Maître/Dr./Mrs.". The capitalization
 * heuristic needs a KNOWN first name somewhere in the sequence. A document like
 *
 *     "Le demandeur Lefebvre soutient que Durand n'a pas signé."
 *
 * has neither — both surnames leak in clear text. This module plugs that gap
 * by anchoring on legal roles, adversarial markers, and verbs of speech.
 *
 * Returns NameSpan[] with type:'name', structurally identical to the output of
 * detectTitleAnchoredNames. Priority is resolved by piiDetector's mergeSpans.
 *
 * Implementation note: case-insensitive matching is built into the keyword
 * alternations explicitly (per-character `[Aa]` classes) rather than using
 * the regex `/i` flag, because `/i` would also lowercase the NAME_TOKEN_RE
 * range `[A-Z]…` and let lowercase tokens through as fake "names".
 */

import { NAME_TOKEN_OR_ALLCAPS, HONORIFICS, type NameSpan } from './personNameDetection'

// A short, bounded filler between an anchor and the captured name. Allows
// honorifics, determiners, punctuation, and short words such as "entendu :",
// "le", "M.", ", Mme.", " : ", " du dossier numéro X par ". Capped at 25 chars
// (lazy) so the regex never spans paragraphs or pulls names from unrelated
// sentences. Excludes line breaks for the same reason.
const FILLER = '[^\\n]{0,25}?'

// Build a case-insensitive alternation ([Aa]bc|[Dd]ef|…) WITHOUT using the
// regex /i flag, which would otherwise also case-fold the NAME_TOKEN range.
function escapeReChar(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function ciKeyword(word: string): string {
  return Array.from(word)
    .map((c) => {
      const upper = c.toUpperCase()
      const lower = c.toLowerCase()
      if (upper === lower) return escapeReChar(c)
      return `[${upper}${lower}]`
    })
    .join('')
}

function ciAlt(words: ReadonlyArray<string>): string {
  return words.map(ciKeyword).join('|')
}

// Legal-role keywords that commonly sit before or after a party name.
// Both French and English variants. Lowercased — case folded by ciAlt.
const ROLE_KEYWORDS: ReadonlyArray<string> = [
  // FR parties
  'demandeur',
  'demandeurs',
  'demandeuse',
  'demanderesse',
  'demanderesses',
  'défendeur',
  'defendeur',
  'défendeurs',
  'defendeurs',
  'défenderesse',
  'defenderesse',
  'requérant',
  'requerant',
  'requérante',
  'requerante',
  'requérants',
  'requerants',
  'appelant',
  'appelante',
  'appelants',
  'appelantes',
  'intimé',
  'intime',
  'intimée',
  'intimee',
  'intimés',
  'intimes',
  'partie',
  'parties',
  'consorts',
  // FR legal professionals
  'avocat',
  'avocate',
  'notaire',
  'notaires',
  'huissier',
  'huissière',
  'huissiere',
  'greffier',
  'greffière',
  'greffiere',
  'expert',
  'experte',
  'conseil',
  'mandataire',
  'commissaire',
  // FR witness / other
  'témoin',
  'temoin',
  'témoins',
  'temoins',
  'héritier',
  'heritier',
  'héritière',
  'heritiere',
  'héritiers',
  'heritiers',
  // EN parties
  'plaintiff',
  'plaintiffs',
  'defendant',
  'defendants',
  'claimant',
  'claimants',
  'respondent',
  'respondents',
  'appellant',
  'appellants',
  'appellee',
  'appellees',
  'petitioner',
  'petitioners',
  'applicant',
  'applicants',
  'complainant',
  'complainants',
  'intervenor',
  'intervenors',
  'intervener',
  'interveners',
  'deponent',
  'deponents',
  'guardian',
  'guardians',
  'executor',
  'executors',
  'administrator',
  'administrators',
  'beneficiary',
  'beneficiaries',
  'heir',
  'heirs',
  'witness',
  'witnesses',
  // EN professionals
  'attorney',
  'attorneys',
  'lawyer',
  'lawyers',
  'solicitor',
  'solicitors',
  'barrister',
  'barristers',
  'counsel',
  'counsels',
  'notary',
  'notaries',
  'bailiff',
  'bailiffs',
  'clerk',
  'clerks',
  'expert',
  'experts',
  'commissioner',
  'commissioners',
  'trustee',
  'trustees',
  'receiver',
  'receivers'
]

// Adversarial markers — "X contre Y", "X c/ Y", "X vs Y". The right-hand side
// is almost always a party name in litigation; the left-hand side often is too.
const ADVERSARIAL_KEYWORDS: ReadonlyArray<string> = [
  'contre',
  'c/',
  'vs',
  'vs.',
  'versus',
  'against',
  'v',
  'v.'
]

// Action / speech verbs that reliably take a person subject in legal prose.
// Used to identify the {name} {verb} pattern.
const PERSON_VERBS: ReadonlyArray<string> = [
  // FR
  'déclare',
  'declare',
  'affirme',
  'soutient',
  'conclut',
  'représente',
  'represente',
  'comparaît',
  'comparait',
  'signe',
  'atteste',
  'certifie',
  'convoque',
  'conteste',
  'sollicite',
  'réclame',
  'reclame',
  'saisit',
  'plaide',
  'invoque',
  'allègue',
  'allegue',
  'reconnaît',
  'reconnait',
  'produit',
  'dépose',
  'depose',
  // EN
  'declares',
  'states',
  'affirms',
  'represents',
  'appears',
  'signs',
  'certifies',
  'contests',
  'acknowledges',
  'alleges',
  'testifies',
  'argues',
  'asserts',
  'submits',
  'maintains',
  'requests',
  'seeks',
  'claims',
  'files',
  'confirms',
  'denies',
  'deposes'
]

// Tokens that look like names (capitalized / ALL-CAPS) but never are.
// Kept intentionally narrow — the role-anchor is a strong signal, so we only
// need to block the high-frequency false positives the patterns introduce.
const NOT_A_NAME: ReadonlySet<string> = new Set([
  // Legal document nouns
  'Tribunal',
  'TRIBUNAL',
  'Cour',
  'COUR',
  'Chambre',
  'CHAMBRE',
  'Section',
  'SECTION',
  'Article',
  'ARTICLE',
  'Cabinet',
  'CABINET',
  'Société',
  'Societe',
  'SOCIÉTÉ',
  'SOCIETE',
  'Association',
  'ASSOCIATION',
  'Entreprise',
  'Compagnie',
  'Direction',
  'Service',
  'Contrat',
  'Convention',
  'Jugement',
  'Arrêt',
  'Arret',
  'Ordonnance',
  'Décision',
  'Decision',
  'Audience',
  'Dossier',
  'Pièce',
  'Piece',
  'Annexe',
  'Affaire',
  'Action',
  'Procédure',
  'Procedure',
  'Justice',
  'Judiciaire',
  'Court',
  'COURT',
  'Chamber',
  'CHAMBER',
  'Registry',
  'REGISTRY',
  'Agreement',
  'AGREEMENT',
  'Judgment',
  'JUDGMENT',
  'Judgement',
  'JUDGEMENT',
  'Order',
  'ORDER',
  'Notice',
  'NOTICE',
  'Motion',
  'MOTION',
  'Petition',
  'PETITION',
  'Complaint',
  'COMPLAINT',
  'Answer',
  'ANSWER',
  'Brief',
  'BRIEF',
  'Claim',
  'CLAIM',
  'Claims',
  'CLAIMS',
  'Party',
  'PARTY',
  'Parties',
  'PARTIES',
  'Schedule',
  'SCHEDULE',
  'Exhibit',
  'EXHIBIT',
  'Appendix',
  'APPENDIX',
  'Preamble',
  'PREAMBLE',
  'Department',
  'DEPARTMENT',
  'Office',
  'OFFICE',
  'Division',
  'DIVISION',
  'Commission',
  'COMMISSION',
  'Authority',
  'AUTHORITY',
  'Board',
  'BOARD',
  'Council',
  'COUNCIL',
  // Role titles (these are never the proper name)
  'Président',
  'Présidente',
  'President',
  'Juge',
  'Judge',
  'Procureur',
  'Procureure',
  'Maire',
  'Mayor',
  'Directeur',
  'Directrice',
  'Director',
  'Attorney',
  'Lawyer',
  'Solicitor',
  'Barrister',
  'Counsel',
  'Notary',
  'Bailiff',
  'Greffier',
  'Greffière',
  'Greffiere',
  'Clerk',
  'Administrateur',
  'Expert',
  'Experte',
  'Administrator',
  'Commissioner',
  'Trustee',
  'Receiver',
  'Witness',
  'Plaintiff',
  'Defendant',
  'Claimant',
  'Respondent',
  'Appellant',
  'Appellee',
  'Petitioner',
  'Applicant',
  'Complainant',
  'Guardian',
  'Executor',
  'Beneficiary',
  'Heir',
  'Notaire',
  'Huissier',
  'Avocat',
  'Avocate',
  // Determiners / pronouns that happen to start capitalized.
  // Subject pronouns matter here because VERB_RE captures `{Title-Case} {verb}`,
  // so a sentence-initial "Je signe" / "On déclare" / "We acknowledge" would
  // otherwise turn the pronoun into a fake person name.
  'Le',
  'La',
  'Les',
  'Un',
  'Une',
  'Des',
  'Du',
  'De',
  'Au',
  'Aux',
  'Ce',
  'Cet',
  'Cette',
  'Ces',
  'Son',
  'Sa',
  'Ses',
  'Leur',
  'Leurs',
  'Notre',
  'Votre',
  'Mon',
  'Ma',
  'Je',
  'Tu',
  'Il',
  'Elle',
  'On',
  'Nous',
  'Vous',
  'Ils',
  'Elles',
  'The',
  'This',
  'That',
  'These',
  'Those',
  'His',
  'Her',
  'Its',
  'Our',
  'Their',
  'I',
  'You',
  'We',
  'They',
  'One',
  // Months
  'Janvier',
  'Février',
  'Fevrier',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Aout',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
  'Decembre',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  // Days
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  // Salutations (handled by another detector but listed for safety)
  'Cher',
  'Chère',
  'Dear',
  'Bonjour',
  'Hello',
  'Hi',
  'Hey'
])

const ROLE_ALT = ciAlt(ROLE_KEYWORDS)
const ADV_ALT = ciAlt(ADVERSARIAL_KEYWORDS)
const VERB_ALT = ciAlt(PERSON_VERBS)

// {role} … {name 1..4 tokens}
// Lazy filler bounded to 25 chars so the regex never crosses sentence-distant
// material. Captures the name after fillers like " entendu : ", " M. ", ", ".
const PRE_ROLE_RE = new RegExp(
  `\\b(?:${ROLE_ALT})\\b${FILLER}` +
    `(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})`,
  'g'
)

// {name 1..4 tokens}, {role}   — apposition form: "Bonnefoy, avocat au barreau"
const POST_ROLE_RE = new RegExp(
  `(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})` +
    `[ \\t]*,[ \\t]*(?:${ROLE_ALT})\\b`,
  'g'
)

// {adv} {name 1..4 tokens}    — right-hand side of "contre / c/ / vs"
const ADVERSARIAL_RIGHT_RE = new RegExp(
  `(?:^|[\\s(])(?:${ADV_ALT})\\s+(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})`,
  'g'
)

// {name 1..4} {adv} {name 1..4}  — both sides at once: "Lefebvre c/ Marchand"
const ADVERSARIAL_BIDIR_RE = new RegExp(
  `(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})` +
    `\\s+(?:${ADV_ALT})\\s+` +
    `(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})`,
  'g'
)

// {name 1..4} + verb-of-speech — subject immediately before an action verb.
const VERB_RE = new RegExp(
  `(${NAME_TOKEN_OR_ALLCAPS}(?:[ \\t]+${NAME_TOKEN_OR_ALLCAPS}){0,3})[ \\t]+(?:${VERB_ALT})\\b`,
  'g'
)

// Patterns where group 1 holds the captured name.
const SINGLE_NAME_PATTERNS: ReadonlyArray<RegExp> = [
  PRE_ROLE_RE,
  POST_ROLE_RE,
  ADVERSARIAL_RIGHT_RE,
  VERB_RE
]

function emitNameTokens(text: string, nameStr: string, nameStart: number, into: NameSpan[]): void {
  const parts = nameStr.split(/\s+/).filter(Boolean)
  let cursor = nameStart
  for (const part of parts) {
    const partStart = text.indexOf(part, cursor)
    if (partStart === -1) continue
    cursor = partStart + part.length
    if (HONORIFICS.has(part)) continue
    if (NOT_A_NAME.has(part)) continue
    if (part.length < 2) continue
    into.push({ type: 'name', value: part, start: partStart, end: partStart + part.length })
  }
}

export function detectNamesInLegalContext(text: string): NameSpan[] {
  const spans: NameSpan[] = []

  for (const source of SINGLE_NAME_PATTERNS) {
    const re = new RegExp(source.source, source.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const nameStr = m[1]
      if (!nameStr) continue
      const nameOffset = m[0].indexOf(nameStr)
      if (nameOffset === -1) continue
      emitNameTokens(text, nameStr, m.index + nameOffset, spans)
    }
  }

  // Bidirectional adversarial: both sides are names (e.g. "Lefebvre c/ Marchand")
  const bidir = new RegExp(ADVERSARIAL_BIDIR_RE.source, ADVERSARIAL_BIDIR_RE.flags)
  let m: RegExpExecArray | null
  while ((m = bidir.exec(text)) !== null) {
    const left = m[1]
    const right = m[2]
    if (left) {
      const offset = m[0].indexOf(left)
      if (offset !== -1) emitNameTokens(text, left, m.index + offset, spans)
    }
    if (right) {
      // For the right name, search after the left name to avoid index collision
      // when both names happen to share a substring.
      const offset = m[0].lastIndexOf(right)
      if (offset !== -1) emitNameTokens(text, right, m.index + offset, spans)
    }
  }

  return spans
}
