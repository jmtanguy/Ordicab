/**
 * piiDetector — detects PII spans in plain text using regex patterns,
 * context-anchored detection, wordlist matching, and capitalization heuristics.
 *
 * Returns non-overlapping DetectedSpan[] sorted by position.
 * Priority: structural > password > context-anchored > wordlist > title-anchored > heuristic.
 *
 * Name detection (title-anchored, salutation-anchored, capitalization heuristic)
 * relies on shared primitives from personNameDetection.ts:
 *   • NAME_TOKEN_RE    — the canonical Title-Case name-token pattern
 *   • HONORIFICS       — FR + EN civility titles (used to skip non-PII tokens)
 *   • detectTitleAnchoredNames — replaces the local detectTitleAnchored function
 */

import { KNOWN_FIRST_NAMES, isKnownFirstNameNormalized } from './fakegen'
import {
  NAME_TOKEN_RE,
  NAME_TOKEN_OR_ALLCAPS,
  HONORIFICS,
  detectTitleAnchoredNames
} from './personNameDetection'
import { detectNamesInLegalContext } from './legalRoleNameDetection'

export type EntityType =
  | 'email'
  | 'phone'
  | 'SSN'
  | 'IBAN'
  | 'BIC'
  | 'creditCard'
  | 'passport'
  | 'driverLicense'
  | 'vehicleRegistration'
  | 'password'
  | 'name'
  | 'company'
  | 'companyId'
  | 'taxId'
  | 'birthDate'
  | 'date'
  | 'ipAddress'
  | 'macAddress'
  | 'identifier'
  | 'medicalId'
  | 'url'
  | 'filePath'
  | 'gpsCoordinates'
  | 'custom'
  | 'address'
  | 'postalLocation'

export interface DetectedSpan {
  type: EntityType
  value: string
  start: number
  end: number
}

// ── Regex patterns ─────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

// Obfuscated emails — "john[at]example[dot]com", "john (at) example (dot) com",
// also "john at example dot com" when surrounded by enough structure to avoid
// matching ordinary prose ("data at rest dot net" would never have a leading
// alphanumeric local part with a dot/hyphen). Brackets are preferred but not
// required when surrounded by single-token segments that look like an email.
const OBFUSCATED_EMAIL_RE =
  /[a-zA-Z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\{\s*at\s*\})\s*[a-zA-Z0-9.-]+\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\{\s*dot\s*\})\s*[a-zA-Z]{2,}/gi

// French phones: 06/07 + landlines 01-05, with optional +33 / 0033 prefix
const PHONE_FR_RE = /(?:\+33[.\s-]?(?:\(0\)[.\s-]?)?|0033[.\s-]?)?0[1-9](?:[.\s-]?\d{2}){4}/g

// UK phones: mobile 07xxx xxxxxx and landlines, with optional +44 prefix
const PHONE_UK_RE = /(?:\+44\s?(?:\(0\)\s?)?|0)(?:7\d{3}[\s.-]?\d{6}|[1-9]\d{2,3}[\s.-]?\d{6,7})/g

// US / Canada: (xxx) xxx-xxxx, xxx-xxx-xxxx, xxx.xxx.xxxx, with optional +1
const PHONE_US_RE = /(?:\+1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]\d{4}/g

// Belgian phones: +32 or 0 prefix, mobile 04xx and landlines
const PHONE_BE_RE =
  /(?:\+32\s?|0)(?:4[5-9]\d[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2}|[1-9]\d[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/g

// Swiss phones: +41 or 0 prefix
const PHONE_CH_RE = /(?:\+41\s?|0)[1-9]\d[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g

// German phones: +49 or 0 prefix. Real DE numbers carry at least 7 digits after
// the trunk "0", so the subscriber group is sized accordingly to avoid matching
// 5-digit French postal codes like "06100" — the regex is reached after the
// FR/UK/US/BE/CH phone patterns have all failed, so the bar can be conservative.
const PHONE_DE_RE = /(?:\+49[\s.-]?|0)[1-9]\d{1,4}[\s.-]?\d{5,10}/g

// French NIR (sécu): gender digit + 12–14 digits with optional spaces
const SSN_FR_RE = /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g
// US SSN
const SSN_US_RE = /\b\d{3}-\d{2}-\d{4}\b/g

// IBAN: country (2 letters) + check (2 digits) + 11–30 alphanumeric, optionally
// formatted in groups of 4 separated by spaces. Covers FR/BE/DE/CH/IT/UK/etc.
// Examples matched: "FR7612345678901234567890123", "FR76 1234 5678 9012 3456 7890 123",
//                   "DE89370400440532013000", "GB29NWBK60161331926819".
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g

// SIRET: 14-digit French company identifier (3+3+3+5, optional spaces)
// Placed before SIREN to claim the full 14 digits first.
const SIRET_RE = /\b\d{3}\s?\d{3}\s?\d{3}\s?\d{5}\b/g

// French intra-community VAT: FR + 2 alphanumeric chars + 9-digit SIREN
const VAT_FR_RE = /\bFR\s?[A-Z0-9]{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g

// French address: number + type + name  ("42 rue du Marché")
const ADDRESS_FR_RE =
  /\b\d{1,4}\s+(?:rue|avenue|boulevard|impasse|all[ée]e|chemin|route|place|quai|cours|passage|résidence|lotissement)\s+[A-Za-zÀ-ÿ'' -]{2,}\b/gi

// English address: number + name + type  ("42 Oak Street")
const ADDRESS_EN_RE =
  /\b\d{1,4}\s+[A-Za-z][A-Za-z '-]+\s+(?:Street|Road|Lane|Drive|Way|Court|Close|Crescent|Gardens|Grove|Avenue|Place|Boulevard)\b/gi

// Postal code + city. Accept a lowercase-starting city so that casual user
// input ("06100 nice") still flags the locality — the 5-digit anchor keeps
// false positives down, and a structural match here wins over the regex-phone
// layer that would otherwise mis-tag the postal code.
const POSTAL_LOCATION_RE = /\b\d{5}\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'' -]+\b/g

// Credit/debit card: 16 digits formatted in groups of 4 (Visa, Mastercard, CB…)
// Covers space- or dash-separated groups: "4111 1111 1111 1111", "4111-1111-1111-1111"
// Amex (15 digits, 4-6-5): "3714 496353 98431"
// IBAN is caught earlier and has higher priority, so overlap is resolved by mergeSpans.
const CREDIT_CARD_RE =
  /\b(?:4\d{3}|5[1-5]\d{2}|2(?:2[2-9]\d|[3-6]\d{2}|7[01]\d|720)|3[47]\d{2}|6(?:011|5\d{2}))[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4,7}\b/g

// French SIV vehicle registration plate (format since 2009): AA-123-AA
// The strict alternating letter-digit-letter pattern keeps false-positive rate very low.
const VEHICLE_REGISTRATION_FR_RE = /\b[A-Z]{2}-\d{3}-[A-Z]{2}\b/g

// Password context: keyword followed by value
const PASSWORD_CONTEXT_RE =
  /(?:password|passwd|mot\s+de\s+passe|mdp|pwd|secret|token|cl[eé])\s*[:=]\s*(\S{6,})/gi

// Context-anchored SIREN: 9-digit company ID when preceded by a registry keyword.
// Handles both "SIREN: 123 456 789" and "RCS Paris 123 456 789" (city name optional).
const SIREN_CONTEXT_RE =
  /(?:SIREN|SIRET|RCS|répertoire\s+des\s+métiers|RM)\s*[n°.:]*\s*(?:[A-Z][a-zÀ-ÿ]+\s+)?(\d{3}\s?\d{3}\s?\d{3})\b/gi

// Context-anchored passport: passport keyword followed by the document number.
// Bare alphanumeric codes are too ambiguous — require a keyword to anchor detection.
// French passports: 2 letters + 7 digits. Generic: 1–2 letters + 6–9 digits.
const PASSPORT_CONTEXT_RE =
  /(?:passeport|passport|n°\s*passeport|passport\s*(?:no|number|n°|num))\s*[.:#-]?\s*([A-Z]{1,2}\d{6,9})/gi

// Common date token used to anchor several context-aware detectors.
// Order-agnostic: matches DD-first, YYYY-first, and textual-month forms with
// any of the common separators (slash, dash, dot, single space).
// Examples matched:
//   12/07/1981, 12-07-1981, 12.07.1981, 12 07 1981, 12/07/81
//   1981-07-12, 1981/07/12, 1981.07.12, 1981 07 12  ← YYYY first
//   12 mars 1981, March 12 1981, January 12, 1981
const MONTH_NAMES =
  'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|january|february|march|april|may|june|july|august|september|october|november|december'
const DATE_TOKEN =
  '(?:' +
  // YYYY first — must come before the DD-first alternative because the engine
  // takes the first matching branch and a 4-digit year would otherwise be
  // partially consumed by the DD\d{1,2} prefix.
  '\\d{4}[\\/\\-. ]\\d{1,2}[\\/\\-. ]\\d{1,2}' +
  '|\\d{1,2}[\\/\\-. ]\\d{1,2}[\\/\\-. ]\\d{2,4}' +
  '|\\d{1,2}(?:er)?\\s+(?:' +
  MONTH_NAMES +
  ')\\s+\\d{2,4}' +
  '|(?:' +
  MONTH_NAMES +
  ')\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}' +
  ')'

// Birth date — context-anchored only. Generic dates (audience, échéance, etc.)
// are not redacted automatically; only dates qualified as a date of birth are.
const BIRTH_DATE_CONTEXT_RE = new RegExp(
  '(?<![\\p{L}])' +
    '(?:n[ée]e?|nee|born|date\\s+de\\s+naissance|date\\s+of\\s+birth|d\\.?o\\.?b\\.?|naissance)' +
    '(?![\\p{L}])' +
    '(?:\\s+(?:le|on))?\\s*[:.\\-]?\\s*(' +
    DATE_TOKEN +
    ')',
  'giu'
)

// French numéro fiscal de référence (SPI) — 13 digits, sometimes spaced.
// Other countries' tax IDs follow similar shapes. Always context-anchored to
// avoid clashing with phone numbers and other long digit sequences.
const TAX_ID_CONTEXT_RE =
  /(?:num[ée]ro\s+fiscal(?:\s+de\s+r[ée]f[ée]rence)?|n°\s*fiscal|spi(?:\s+du\s+contribuable)?|identifiant\s+fiscal|tax\s+(?:id|identification\s+number|reference)|tin|nif|fiscal\s+id|tax\s+payer\s+number|num[ée]ro\s+contribuable)\s*[:.\-#]?\s*((?:\d{2,4}[\s.-]?){2,5}\d{1,4})/gi

// Driver's licence (FR new format: 12 digits; older / international formats vary).
// Anchored on the keyword to avoid swallowing arbitrary alphanumeric codes.
// The optional "number / no / n° / num" trailer is matched inside the keyword
// group so it is not re-consumed by the capture group.
const DRIVER_LICENSE_CONTEXT_RE =
  /(?:permis(?:\s+de\s+conduire)?|(?:driving\s+|driver'?s?\s+)?licen[cs]e)(?:\s+(?:no|n°|num|number))?\s*[:.\-#]*\s*([A-Z0-9][-A-Z0-9]{5,17})/gi

// IPv4 address — each octet 0–255. Structural; rare false positives.
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g

// MAC address (colon- or dash-separated). Structural; very low false-positive rate.
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g

// URLs (http, https, ftp, mailto, file). Captures up to the next whitespace
// or angle-bracket. URLs frequently embed usernames, query-string emails, and
// session tokens — redact the whole URL rather than trying to parse it.
const URL_RE = /\b(?:https?|ftp|file|mailto):(?:\/\/)?[^\s<>"'`]+/gi

// File paths — Unix /Users/x/..., /home/x/..., Windows C:\Users\x\...,
// home-relative ~/Documents/... — all of which leak the local username.
// Anchored on a recognised root so we don't grab arbitrary slash-strings.
const FILE_PATH_RE =
  /(?:\/(?:Users|home|var\/folders|root|export\/home)\/[^\s<>"'`,;]+|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s<>"'`,;]+|~\/[^\s<>"'`,;]+)/g

// GPS coordinates as decimal lat,long. Requires ≥4 decimal digits on each
// component (typical GPS precision) so ordinary "1.5, 2.5" prose is ignored.
// Latitude clamped to ±90, longitude to ±180 by the leading magnitude classes.
const GPS_DECIMAL_RE =
  /(?<![\d.])-?(?:90(?:\.0+)?|[1-8]?\d\.\d{4,12})\s*[,;]\s*-?(?:180(?:\.0+)?|1[0-7]\d\.\d{4,12}|\d{1,2}\.\d{4,12})(?![\d.])/g

// Medical / healthcare identifiers — context-anchored to avoid colliding with
// generic numeric IDs. Catches French RPPS / ADELI / NIR labels, and EN MRN /
// "medical record number" / "patient id" / "health insurance" forms.
const MEDICAL_ID_CONTEXT_RE =
  /(?:RPPS|ADELI|num[ée]ro\s+(?:de\s+)?(?:patient|s[ée]curit[ée]\s+sociale|ALD|carte\s+vitale)|dossier\s+m[ée]dical|carte\s+vitale|medical\s+record\s+(?:number|no|n°)|patient\s+(?:id|number|n°)|MRN|health\s+insurance\s+(?:id|number|n°))\s*[:.\-#°]*\s*([A-Z0-9][-A-Z0-9]{4,17})/gi

// BIC / SWIFT — 8 or 11 chars (4 letters + 2 country letters + 2 alphanumeric +
// optional 3 alphanumeric branch). Bare BIC is far too ambiguous; require a
// keyword anchor since the IBAN regex already covers most banking strings.
const BIC_CONTEXT_RE =
  /(?:bic|swift(?:\s*\/\s*bic)?|bic\s*\/\s*swift|code\s+bic|code\s+swift)\s*[:.\-#]?\s*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi

// Generic identifier — alphanumeric (≥6 chars) following an explicit ID keyword.
// Catches dossier numbers, client numbers, case files, allocataire numbers, etc.,
// fulfilling the "if a number sits behind a label, treat it as PII" rule.
const IDENTIFIER_CONTEXT_RE =
  /(?:matricule|num[ée]ro\s+(?:de\s+)?(?:client|dossier|adh[ée]rent|usager|allocataire|patient|police|s[ée]curit[ée](?:\s+sociale)?|compte|s[ée]curit[ée]|s[ée]rie)|client\s+n[°o]|dossier\s+n[°o]|compte\s+n[°o]|police\s+n[°o]|case\s+(?:no|number|file)|file\s+(?:no|number)|account\s+(?:no|number|n°)|reference\s+(?:no|number|n°))\s*[:.\-#°]*\s*([A-Z0-9][-/A-Z0-9]{5,24})/gi

// ── Loose / fallback patterns ──────────────────────────────────────────────
//
// User explicitly chose "looser detection — better a false positive than a leak".
// These patterns run AFTER the context-anchored layer so the more specific
// detectors (birthDate, taxId, identifier) keep priority via mergeSpans
// stable-sort tie-breaking on identical (start, end) ranges.

// Generic date — any date in any of the supported orderings/separators.
// Audience dates, deadlines, expiry dates, etc. all become 'date' markers.
const DATE_RE = new RegExp(DATE_TOKEN, 'gi')

// Bare numeric run of 8+ digits — safety net for unstructured IDs that escaped
// every specific structural detector (phone, SSN, IBAN, SIRET, credit card, …).
// Tagged as 'identifier' since we cannot guess which kind of ID it is.
const LONG_NUMERIC_RE = /\b\d{8,}\b/g

// Bare alphanumeric run mixing letters and digits (≥6 chars, ≥1 letter, ≥1 digit).
// Catches reference codes like "AB123456", "X12-Y45", "REF/2024-9981" that have
// no surrounding keyword. Pure-letter and pure-digit runs are excluded so we do
// not over-flag ordinary words or already-covered numeric IDs.
const ALPHANUMERIC_REF_RE = /\b(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9][A-Z0-9/-]{5,23}\b/g

const LOOSE_PATTERNS: Array<{ re: RegExp; type: EntityType }> = [
  { re: DATE_RE, type: 'date' },
  { re: LONG_NUMERIC_RE, type: 'identifier' },
  { re: ALPHANUMERIC_REF_RE, type: 'identifier' }
]

const STRUCTURAL_PATTERNS: Array<{ re: RegExp; type: EntityType }> = [
  // URL must come BEFORE email so a mailto:foo@bar URL claims the full URL span
  // rather than the inner email leaking the wrapping prefix.
  { re: URL_RE, type: 'url' },
  { re: EMAIL_RE, type: 'email' },
  { re: OBFUSCATED_EMAIL_RE, type: 'email' },
  { re: SSN_FR_RE, type: 'SSN' },
  { re: SSN_US_RE, type: 'SSN' },
  { re: IBAN_RE, type: 'IBAN' },
  { re: CREDIT_CARD_RE, type: 'creditCard' },
  { re: VEHICLE_REGISTRATION_FR_RE, type: 'vehicleRegistration' },
  { re: SIRET_RE, type: 'companyId' },
  { re: VAT_FR_RE, type: 'companyId' },
  { re: PHONE_FR_RE, type: 'phone' },
  { re: PHONE_UK_RE, type: 'phone' },
  { re: PHONE_US_RE, type: 'phone' },
  { re: PHONE_BE_RE, type: 'phone' },
  { re: PHONE_CH_RE, type: 'phone' },
  { re: PHONE_DE_RE, type: 'phone' },
  { re: IPV4_RE, type: 'ipAddress' },
  { re: MAC_RE, type: 'macAddress' },
  { re: GPS_DECIMAL_RE, type: 'gpsCoordinates' },
  { re: FILE_PATH_RE, type: 'filePath' },
  { re: ADDRESS_FR_RE, type: 'address' },
  { re: ADDRESS_EN_RE, type: 'address' },
  { re: POSTAL_LOCATION_RE, type: 'postalLocation' }
]

// Context-anchored patterns share the same shape: a keyword followed by a
// captured value. Listed here so each new keyword-anchored detector becomes a
// one-line addition rather than its own bespoke function.
const CONTEXT_ANCHORED_PATTERNS: Array<{ re: RegExp; type: EntityType }> = [
  { re: BIRTH_DATE_CONTEXT_RE, type: 'birthDate' },
  { re: TAX_ID_CONTEXT_RE, type: 'taxId' },
  { re: DRIVER_LICENSE_CONTEXT_RE, type: 'driverLicense' },
  { re: BIC_CONTEXT_RE, type: 'BIC' },
  { re: MEDICAL_ID_CONTEXT_RE, type: 'medicalId' },
  { re: IDENTIFIER_CONTEXT_RE, type: 'identifier' }
]

// ── Capitalization heuristic ───────────────────────────────────────────────

// Legal entity suffixes — stored lowercase for case-insensitive matching
const COMPANY_SUFFIXES = new Set([
  // French legal forms
  'cabinet',
  'conseil',
  'services',
  'groupe',
  'bureau',
  'compagnie',
  'sarl',
  'sas',
  'sci',
  'eurl',
  'selarl',
  'scp',
  'sasu',
  'snc',
  'sca',
  'gie',
  'ei',
  'eirl',
  'scm',
  'scop',
  'association',
  'fondation',
  'syndicat',
  'mutuelle',
  // International legal forms
  'llc',
  'ltd',
  'inc',
  'corp',
  'plc',
  'gmbh'
])

// All-caps words common in legal/formal French documents — not PII
const ALL_CAPS_LEGAL_STOPWORDS = new Set([
  // Connecting / structural words
  'VU',
  'AU',
  'AUX',
  'DU',
  'ET',
  'OU',
  'EN',
  'PAR',
  'SUR',
  'LES',
  'DES',
  'UNE',
  'CE',
  'CET',
  'IL',
  'ILS',
  'LA',
  'LE',
  'SE',
  'SA',
  'SES',
  // Legal terms
  'ARTICLE',
  'ARTICLES',
  'ATTENDU',
  'CONSIDERANT',
  'CONSIDÉRANT',
  'MOTIFS',
  'MOTIF',
  'OBJET',
  'ANNEXE',
  'ANNEXES',
  'NOTE',
  'NOTES',
  'TITRE',
  'CHAPITRE',
  'SECTION',
  'ALINEA',
  'ALINÉA',
  'JUGEMENT',
  'ARRET',
  'ARRÊT',
  'ORDONNANCE',
  'DECISION',
  'DÉCISION',
  'TRIBUNAL',
  'COUR',
  'CHAMBRE',
  'DEMANDEUR',
  'DEMANDEURS',
  'DEMANDERESSE',
  'DEMANDERESSES',
  'DEFENDEUR',
  'DÉFENDEUR',
  'DEFENDEURS',
  'DÉFENDEURS',
  'DEFENDERESSE',
  'DÉFENDERESSE',
  'APPELANT',
  'APPELANTS',
  'APPELANTE',
  'APPELANTES',
  'INTIME',
  'INTIMÉ',
  'INTIMES',
  'INTIMÉS',
  'PARTIE',
  'PARTIES',
  'PAR CES MOTIFS',
  'DISPOSITIF',
  'EXPOSE',
  'EXPOSÉ',
  'PREAMBULE',
  'PRÉAMBULE',
  'CONTRADICTOIREMENT',
  'PUBLIQUEMENT',
  'COMMISSION',
  'PREFECTURE',
  'PRÉFECTURE',
  'REPUBLIQUE',
  'FRANÇAISE',
  'FRANCAISE',
  // Identity / civil-status form headings — these often appear as ALL-CAPS column
  // labels next to actual names ("NOM PRÉNOM DATE NAISSANCE …"), which would
  // otherwise be picked up as fake person names by the all-caps name heuristic.
  'NOM',
  'NOMS',
  'PRENOM',
  'PRÉNOM',
  'PRENOMS',
  'PRÉNOMS',
  'NAISSANCE',
  'NAISSANCES',
  'ETAT',
  'ÉTAT',
  'CIVIL',
  'LIEU',
  'LIEUX',
  'DATE',
  'DATES',
  'NATIONALITE',
  'NATIONALITÉ',
  'DOMICILE',
  'RESIDENCE',
  'RÉSIDENCE',
  'ADRESSE',
  'PAYS',
  'VILLE',
  'COMMUNE',
  'DEPARTEMENT',
  'DÉPARTEMENT',
  'REGION',
  'RÉGION',
  'CODE',
  'POSTAL',
  'PROFESSION',
  'EMPLOYEUR',
  'IDENTITE',
  'IDENTITÉ',
  'PIECE',
  'PIÈCE',
  'PIECES',
  'PIÈCES',
  'OBSERVATIONS',
  'OBSERVATION',
  'SEXE',
  'GENRE',
  'AGE',
  'ÂGE',
  'ENFANT',
  'ENFANTS',
  'PERE',
  'PÈRE',
  'MERE',
  'MÈRE',
  'EPOUX',
  'ÉPOUX',
  'EPOUSE',
  'ÉPOUSE',
  'CONJOINT',
  'CONJOINTE',
  'SITUATION',
  'FAMILIALE',
  'TELEPHONE',
  'TÉLÉPHONE',
  'EMAIL',
  'COURRIEL',
  'FAX',
  // Common document headings
  'CONTRAT',
  'CONVENTION',
  'ACCORD',
  'PROTOCOLE',
  'AVENANT',
  'CONDITIONS',
  'GENERALES',
  'GÉNÉRALES',
  'PARTICULIERES',
  'PARTICULIÈRES',
  'MISE EN DEMEURE',
  'ASSIGNATION',
  'CONCLUSIONS',
  // English legal / formal document terms
  'WHEREAS',
  'THEREFORE',
  'HEREBY',
  'HEREIN',
  'THEREIN',
  'THEREOF',
  'THERETO',
  'HEREUNDER',
  'HEREAFTER',
  'HEREINAFTER',
  'HEREINBEFORE',
  'WITNESSETH',
  'CLAUSE',
  'RECITAL',
  'RECITALS',
  'SCHEDULE',
  'EXHIBIT',
  'APPENDIX',
  'PREAMBLE',
  'AGREEMENT',
  'CONTRACT',
  'DEED',
  'ORDER',
  'JUDGMENT',
  'DECREE',
  'NOTICE',
  'MOTION',
  'PETITION',
  'COMPLAINT',
  'ANSWER',
  'BRIEF',
  'PLAINTIFF',
  'DEFENDANT',
  'CLAIMANT',
  'RESPONDENT',
  'APPLICANT',
  'PETITIONER',
  'APPELLANT',
  'APPELLEE',
  'RESPONDENTS',
  'CLAIMANTS',
  'COURT',
  'TRIBUNAL',
  'CHAMBER',
  'PANEL',
  'NOW',
  'AND',
  'OR',
  'THE',
  'OF',
  'IN',
  'TO',
  'BY',
  'FOR',
  'WITH',
  'BE',
  'IT',
  'IS',
  'ARE',
  'WAS',
  'THAT',
  'THIS',
  'THOSE',
  'THESE',
  'SUCH',
  'TERMS',
  'CONDITIONS',
  'GENERAL',
  'SPECIAL',
  'STANDARD',
  'DATED',
  'BETWEEN',
  'AMONG',
  'UPON',
  'UNDER',
  'ABOVE',
  'BELOW',
  'CONFIDENTIAL',
  'PRIVILEGED',
  'WITHOUT',
  'PREJUDICE'
])

// Words that are never PII regardless of position or context.
// Renamed from CAPITALIZED_STOPWORDS — these are common words that can appear capitalized
// anywhere (sentence start, after colon, in headings, in multi-word sequences).
const CAPITALIZED_STOPWORDS = new Set([
  // French articles définis / indéfinis / partitifs
  'Le',
  'La',
  'Les',
  'Un',
  'Une',
  'Des',
  'Du',
  'De',
  // French articles contractés
  'Au',
  'Aux',
  // French pronoms personnels
  'Je',
  'Tu',
  'Il',
  'Elle',
  'Nous',
  'Vous',
  'Ils',
  'Elles',
  'Me',
  'Te',
  'Se',
  'Lui',
  'Eux',
  'Y',
  'En',
  // French pronoms relatifs / interrogatifs
  'Qui',
  'Que',
  'Quoi',
  'Dont',
  'Où',
  'Lequel',
  'Laquelle',
  'Lesquels',
  'Lesquelles',
  // French déterminants démonstratifs
  'Ce',
  'Cet',
  'Cette',
  'Ces',
  // French déterminants possessifs
  'Mon',
  'Ma',
  'Mes',
  'Ton',
  'Ta',
  'Tes',
  'Son',
  'Sa',
  'Ses',
  'Notre',
  'Nos',
  'Votre',
  'Vos',
  'Leur',
  'Leurs',
  // French déterminants indéfinis
  'Tout',
  'Toute',
  'Tous',
  'Toutes',
  'Chaque',
  'Aucun',
  'Aucune',
  'Quelque',
  'Quelques',
  'Certain',
  'Certaine',
  'Certains',
  'Certaines',
  'Plusieurs',
  'Divers',
  'Diverses',
  'Nul',
  'Nulle',
  'Maint',
  'Maints',
  // French déterminants interrogatifs / exclamatifs
  'Quel',
  'Quelle',
  'Quels',
  'Quelles',
  // French prépositions
  'Et',
  'Ou',
  'Par',
  'Sur',
  'Sous',
  'Dans',
  'Avec',
  'Sans',
  'Selon',
  'Vers',
  'Chez',
  'Lors',
  'Entre',
  'Dès',
  'Depuis',
  'Avant',
  'Après',
  'Pendant',
  'Durant',
  'Malgré',
  'Parmi',
  'Contre',
  'Envers',
  // French adverbes / conjonctions fréquents capitalisés
  'Même',
  'Aussi',
  'Ainsi',
  'Donc',
  'Alors',
  'Mais',
  'Car',
  'Ni',
  'Or',
  'Cependant',
  'Néanmoins',
  'Toutefois',
  'Pourtant',
  'Sinon',
  'Sauf',
  // Formules de politesse / salutations (précèdent souvent un prénom)
  'Cher',
  'Chère',
  'Chers',
  'Chères',
  'Bonjour',
  'Bonsoir',
  'Salut',
  'Madame',
  'Monsieur',
  'Mesdames',
  'Messieurs',
  'Dear',
  'Hello',
  'Hi',
  // English articles
  'The',
  'A',
  'An',
  // English demonstratives
  'This',
  'That',
  'These',
  'Those',
  // English possessives
  'My',
  'Your',
  'His',
  'Her',
  'Its',
  'Our',
  'Their',
  // English indefinites
  'Some',
  'Any',
  'Each',
  'Every',
  'Both',
  'All',
  'Either',
  'Neither',
  'Several',
  // English prepositions
  'In',
  'On',
  'At',
  'To',
  'Of',
  'For',
  'With',
  'From',
  'By',
  'As',
  'About',
  'Between',
  'Without',
  'Within',
  'Against',
  'Among',
  'Per',
  'Into',
  'Onto',
  'Upon',
  'Until',
  'Since',
  'Before',
  'After',
  'During',
  // English conjunctions / adverbs
  'And',
  'Or',
  'But',
  'So',
  'Yet',
  'Nor',
  'If',
  'When',
  'Where',
  'While',
  'However',
  'Therefore',
  'Moreover',
  'Furthermore',
  'Nevertheless',
  // Common French nouns / adjectives appearing capitalized in documents
  'Pays',
  'France',
  'Paris',
  'Europe',
  'État',
  'Etat',
  'Loi',
  'Code',
  'Décret',
  'Arrêté',
  'Ordonnance',
  'Règlement',
  'Circulaire',
  'Directive',
  'Famille',
  'Enfant',
  'Enfants',
  'Parent',
  'Parents',
  'Caisse',
  'Fonds',
  'Régime',
  'Prestation',
  'Allocations',
  'Protection',
  'Général',
  'Générale',
  'Délégué',
  'Déléguée',
  'Informatique',
  'Libertés',
  'Données',
  'Traitement',
  'Chemin',
  'Route',
  'Avenue',
  'Boulevard',
  'Rue',
  'Impasse',
  // Business / document nouns
  'Client',
  'Clients',
  'Clientèle',
  'Relation',
  'Relations',
  'Garantie',
  'Garanties',
  'Référence',
  'Références',
  'Contrat',
  'Contrats',
  'Dossier',
  'Dossiers',
  'Document',
  'Documents',
  'Pièce',
  'Pièces',
  'Objet',
  'Sujet',
  'Motif',
  'Motifs',
  'Accord',
  'Convention',
  'Avenant',
  'Courrier',
  'Lettre',
  'Mail',
  'Date',
  'Délai',
  'Délais',
  'Durée',
  'Montant',
  'Montants',
  'Somme',
  'Sommes',
  'Prix',
  'Adresse',
  'Coordonnées',
  // Months / days
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
  // Tech / app terms
  'Template',
  'Routines',
  'Routine',
  'Module',
  'Service',
  'Version',
  // Confirmation / action words
  'Oui',
  'Non',
  'Yes',
  'No',
  'Ok',
  'Okay',
  'Confirme',
  'Confirmer',
  'Annuler',
  'Cancel',
  'Voulez-vous',
  'Please',
  'Ajouter',
  'Ajoute',
  'Ajoutez',
  'Ajoutons',
  'Créer',
  'Crée',
  'Créez',
  'Creer',
  'Modifier',
  'Modifie',
  'Modifiez',
  'Supprimer',
  'Supprime',
  'Supprimez',
  'Montre',
  'Montrer',
  'Afficher',
  'Affiche',
  'Affichez',
  'Trouver',
  'Trouve',
  'Chercher',
  'Cherche',
  'Lister',
  'Liste',
  'Listez',
  'Rédiger',
  'Rédige',
  'Redige',
  'Envoyer',
  'Envoie',
  'Déplacer',
  'Deplacer',
  'Déplace',
  'Deplace',
  'Generate',
  'Create',
  'Update',
  'Delete',
  'Show',
  'Find',
  'List',
  'Move',
  'Send',
  'Write'
])

// HONORIFICS, NAME_TOKEN_RE, and NAME_TOKEN_OR_ALLCAPS are imported from
// personNameDetection.ts — the shared module that is the single source of truth
// for FR + EN title/name patterns. They are used here in detectCapitalized and
// detectSalutationAnchored exactly as before.

// Compiled once at module level to avoid per-call RegExp construction overhead
const CAPITALIZED_RE = new RegExp(
  `(?:^|(?<=[^.!?]\\s))${NAME_TOKEN_OR_ALLCAPS}(?:\\s+${NAME_TOKEN_OR_ALLCAPS})*`,
  'g'
)

function isAllCapsToken(part: string): boolean {
  return /^[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]{2,}(?:-[A-ZÁÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]{2,})*$/u.test(part)
}

function isKnownFirstNamePart(part: string): boolean {
  return KNOWN_FIRST_NAMES.has(part) || isKnownFirstNameNormalized(part)
}

const ALL_CAPS_NAME_CONTEXT_RE =
  /\b(?:nom|pr[ée]nom|date de naissance|n[ée]\s*(?:\([ée]\))?|personne assur[ée]e|souscripteur|assur[ée])\b/i

function hasAllCapsNameContext(text: string, start: number, end: number): boolean {
  // OCR-heavy legal documents often render identities as full uppercase
  // blocks. Restrict this heuristic to explicit identity context so headings
  // like "TRIBUNAL JUDICIAIRE" do not turn into fake person names.
  const before = text.slice(Math.max(0, start - 180), start)
  const after = text.slice(end, Math.min(text.length, end + 80))
  return ALL_CAPS_NAME_CONTEXT_RE.test(`${before} ${after}`)
}

function pushNameParts(
  spans: DetectedSpan[],
  text: string,
  parts: string[],
  startIndex: number
): void {
  let cursor = startIndex
  for (const part of parts) {
    const partStart = text.indexOf(part, cursor)
    if (partStart === -1) continue
    const partEnd = partStart + part.length
    cursor = partEnd
    if (CAPITALIZED_STOPWORDS.has(part)) continue
    if (HONORIFICS.has(part)) continue
    if (isAllCapsToken(part) && ALL_CAPS_LEGAL_STOPWORDS.has(part)) continue
    spans.push({ type: 'name', value: part, start: partStart, end: partEnd })
  }
}

function detectCapitalized(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  // Match sequences of space-separated name-ish tokens (Title Case or ALL-CAPS).
  // Excludes matches immediately after sentence-ending punctuation.
  const re = new RegExp(CAPITALIZED_RE.source, CAPITALIZED_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const word = m[0]!
    if (word.length < 2) continue
    if (CAPITALIZED_STOPWORDS.has(word)) continue
    const parts = word.split(/\s+/).filter(Boolean)
    const containsCompanyKeyword = parts.some((part) => COMPANY_SUFFIXES.has(part.toLowerCase()))
    const allAreAllCaps = parts.every(isAllCapsToken)
    const containsAcronym = parts.some(isAllCapsToken)

    // Skip all-caps single words that are common legal/document terms
    if (parts.length === 1 && isAllCapsToken(word) && ALL_CAPS_LEGAL_STOPWORDS.has(word)) continue

    // Standalone all-caps words not in company keywords are too ambiguous (legal headings,
    // section titles, common abbreviations in EN/FR documents) — skip them entirely.
    // Multi-word all-caps sequences (e.g. "DUPONT MARTIN") still pass through below.
    if (parts.length === 1 && isAllCapsToken(word) && !containsCompanyKeyword) continue

    if (
      allAreAllCaps &&
      parts.length >= 2 &&
      !containsCompanyKeyword &&
      hasAllCapsNameContext(text, m.index, m.index + word.length)
    ) {
      pushNameParts(spans, text, parts, m.index)
      continue
    }

    if (containsCompanyKeyword || (allAreAllCaps && containsAcronym && parts.length > 1)) {
      // All-caps multi-token sequences are ambiguous between "COMPANY NAME" and
      // "FIRSTNAME SURNAME"; prefer the name interpretation when a known first
      // name is present, otherwise treat as a company label.
      const meaningfulParts = parts.filter(
        (p) => !CAPITALIZED_STOPWORDS.has(p) && !HONORIFICS.has(p)
      )
      const hasKnownFirstName = meaningfulParts.some(isKnownFirstNamePart)
      if (!hasKnownFirstName || containsCompanyKeyword) {
        spans.push({ type: 'company', value: word, start: m.index, end: m.index + word.length })
        continue
      }
      // Fall through into the name-emitting branch below.
    } else if (containsAcronym && parts.length === 1) {
      spans.push({ type: 'company', value: word, start: m.index, end: m.index + word.length })
      continue
    }

    if (parts.length >= 2) {
      // Known-name anchor: require at least one token to be a recognised first name.
      // This filters out capitalized document headings ("Contrat Cadre", "Direction Générale")
      // that pass the stopword check but contain no identifiable first name.
      const meaningfulParts = parts.filter(
        (p) => !CAPITALIZED_STOPWORDS.has(p) && !HONORIFICS.has(p)
      )
      const hasKnownFirstName = meaningfulParts.some(isKnownFirstNamePart)
      if (!hasKnownFirstName) continue

      pushNameParts(spans, text, parts, m.index)
      continue
    }

    // A single capitalized word — whether at sentence start or mid-sentence — is too
    // ambiguous to tag as a name. Common French nouns, headings, month names, and
    // document terms all appear in Title Case. Single names are reliably caught by
    // title-anchored detection (M./Maître/Dr. + name) or by seeding from known contacts.
  }
  return spans
}

// ── Salutation-anchored name detection ────────────────────────────────────
//
// Detects person names that follow a salutation word (Cher, Chère, Dear…).
// A single capitalized word after a salutation is reliably a first name.
// Examples: "Cher Laurent,", "Chère Sophie,", "Dear John,"

const SALUTATION_ANCHORED_RE = new RegExp(
  `(?:Cher(?:e|s|es)?|Dear|Hello|Hi|Bonjour|Bonsoir|Salut)\\s+(${NAME_TOKEN_RE}(?:\\s+${NAME_TOKEN_RE}){0,2})`,
  'g'
)

function detectSalutationAnchored(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  const re = new RegExp(SALUTATION_ANCHORED_RE.source, SALUTATION_ANCHORED_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const nameStr = m[1]!
    const nameOffset = m[0].indexOf(nameStr)
    const nameStart = m.index + nameOffset
    const parts = nameStr.split(/\s+/)
    let cursor = nameStart
    for (const part of parts) {
      const partStart = text.indexOf(part, cursor)
      if (partStart === -1) continue
      cursor = partStart + part.length
      if (CAPITALIZED_STOPWORDS.has(part) || HONORIFICS.has(part)) continue
      spans.push({ type: 'name', value: part, start: partStart, end: partStart + part.length })
    }
  }
  return spans
}

// ── Title-anchored name detection ─────────────────────────────────────────
//
// Delegated entirely to personNameDetection.detectTitleAnchoredNames, which
// covers both FR and EN titles (Mr./Mrs./Ms./Sir/Prof./Doctor in addition to
// the original FR-only set).  The returned NameSpan[] is structurally identical
// to DetectedSpan[] with type:'name', so it can be spread directly into the
// priority merge below.
//
// The local TITLE_ANCHORED_RE and detectTitleAnchored function have been removed;
// use detectTitleAnchoredNames from personNameDetection.ts instead.

// ── Password detection ─────────────────────────────────────────────────────

function detectPasswords(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  const re = new RegExp(PASSWORD_CONTEXT_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[1]!
    const start = m.index + m[0]!.lastIndexOf(value)
    spans.push({ type: 'password', value, start, end: start + value.length })
  }
  return spans
}

// ── Context-anchored SIREN detection ──────────────────────────────────────
//
// A bare 9-digit number is too ambiguous to detect structurally.
// This pass catches SIREN numbers when they appear with a registry keyword
// (SIREN, RCS, RM, répertoire des métiers), which is standard in invoices
// and legal documents.

function detectSiren(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  const re = new RegExp(SIREN_CONTEXT_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[1]!
    const start = m.index + m[0]!.lastIndexOf(value)
    spans.push({ type: 'companyId', value, start, end: start + value.length })
  }
  return spans
}

function detectPassport(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  const re = new RegExp(PASSPORT_CONTEXT_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const value = m[1]!
    const start = m.index + m[0]!.lastIndexOf(value)
    spans.push({ type: 'passport', value, start, end: start + value.length })
  }
  return spans
}

// Generic helper: every context-anchored pattern shares the same shape — a
// keyword followed by a captured value in group 1. The captured group is the
// PII; the keyword itself is intentionally left in clear text so the LLM still
// sees the document structure.
function detectContextAnchored(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  for (const { re: source, type } of CONTEXT_ANCHORED_PATTERNS) {
    const re = new RegExp(source.source, source.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const value = m[1]
      if (!value) continue
      const start = m.index + m[0]!.lastIndexOf(value)
      spans.push({ type, value, start, end: start + value.length })
    }
  }
  return spans
}

// Loose / fallback detection — runs AFTER detectContextAnchored so that a span
// already claimed by a more specific detector (birthDate, taxId, identifier
// behind a keyword) wins via mergeSpans' stable-sort tie-breaking on identical
// (start, end). Left-over dates and long alphanumeric runs are still redacted
// rather than leaking through in clear text.
function detectLoose(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  for (const { re: source, type } of LOOSE_PATTERNS) {
    const re = new RegExp(source.source, source.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      spans.push({ type, value: m[0]!, start: m.index, end: m.index + m[0]!.length })
    }
  }
  return spans
}

// ── Wordlist detection ─────────────────────────────────────────────────────

function detectWordlist(text: string, wordlist: string[]): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  for (const word of wordlist) {
    if (!word.trim()) continue
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      spans.push({ type: 'custom', value: m[0]!, start: m.index, end: m.index + m[0]!.length })
    }
  }
  return spans
}

// ── Merge + de-overlap ─────────────────────────────────────────────────────

// Input order encodes priority: earlier-listed detectors win on overlap. The
// implementation is intentionally O(n²) — we cannot pre-sort by position
// without losing the priority semantic (a high-priority span starting later in
// the text must still beat a low-priority span starting earlier). For typical
// document sizes (≪10⁴ spans) this is well below the regex passes that produced
// the spans; if a workload ever changes that we'd need an interval tree.
export function mergeSpans(spans: DetectedSpan[]): DetectedSpan[] {
  const result: DetectedSpan[] = []
  for (const span of spans) {
    const overlaps = result.some((kept) => span.start < kept.end && kept.start < span.end)
    if (!overlaps) result.push(span)
  }
  return result.sort((a, b) => a.start - b.start || b.end - a.end)
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Structural-only detection: emails, URLs, phones, SSN, IBAN, credit cards,
 * vehicle plates, SIRET/VAT, IPv4, MAC, GPS, file paths, addresses, postal
 * locations. Excludes name heuristics, wordlist matches, and context-anchored
 * detectors. Used to claim whole-token PII patterns BEFORE the seeded-value
 * replacement pass — otherwise a sub-token (e.g. a known contact lastName
 * appearing inside an email's domain) is substituted first, breaking the
 * structural pattern so the regex layer no longer matches it.
 */
export function detectStructuralPii(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  for (const { re, type } of STRUCTURAL_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      spans.push({ type, value: m[0]!, start: m.index, end: m.index + m[0]!.length })
    }
  }
  return mergeSpans(spans)
}

/**
 * Detect PII spans in text.
 * Returns non-overlapping spans sorted by start position.
 *
 * Detection layers (highest priority first):
 *   1. Password context     — keyword:value patterns
 *   2. Context-anchored     — SIREN with registry keyword; passport, birth date,
 *                              tax ID, driver licence, BIC, generic identifier
 *   3. Structural patterns  — email, phone, SSN, IBAN, credit card, vehicle plate,
 *                              SIRET, VAT, address, IPv4, MAC
 *   4. Wordlist             — caller-supplied terms
 *   5. Salutation-anchored  — Cher/Dear/Bonjour + Name (high-precision)
 *   6. Title-anchored names — M./Maître/Dr. + Name (high-precision heuristic)
 *   7. Capitalization       — multi-word Title Case with known-name anchor (broad heuristic)
 */
export function detectPii(text: string, wordlist: string[] = []): DetectedSpan[] {
  const structural: DetectedSpan[] = []

  for (const { re, type } of STRUCTURAL_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      structural.push({ type, value: m[0]!, start: m.index, end: m.index + m[0]!.length })
    }
  }

  const passwords = detectPasswords(text)
  const sirenSpans = detectSiren(text)
  const passportSpans = detectPassport(text)
  const contextAnchored = detectContextAnchored(text)
  const legalRoleNames = detectNamesInLegalContext(text)
  const loose = detectLoose(text)
  const wordlistSpans = detectWordlist(text, wordlist)
  const salutationAnchored = detectSalutationAnchored(text)
  const titleAnchored = detectTitleAnchoredNames(text)
  const heuristic = detectCapitalized(text)

  // Priority order determines which span wins when ranges overlap.
  //   • Context-anchored detectors sit before structural ones so a labelled
  //     identifier such as "RPPS 10003456789" is not swallowed by a phone
  //     sub-match. Structural still beats broad wordlist/name heuristics.
  //   • legalRoleNames (bare surnames anchored by role/verb/adversarial keywords)
  //     sits between contextAnchored and loose so a more specific marker
  //     (birthDate, taxId, identifier) still wins when ranges collide, but a
  //     plain capitalized surname tagged here beats the generic 'date'/loose
  //     fallback for adjacent tokens.
  //   • loose (generic 'date' / unanchored 'identifier') comes after so the
  //     specific markers above keep their type on identical (start, end).
  return mergeSpans([
    ...passwords,
    ...sirenSpans,
    ...passportSpans,
    ...contextAnchored,
    ...structural,
    ...legalRoleNames,
    ...loose,
    ...wordlistSpans,
    ...salutationAnchored,
    ...titleAnchored,
    ...heuristic
  ])
}
