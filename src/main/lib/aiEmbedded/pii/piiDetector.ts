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

import { KNOWN_FIRST_NAMES } from './fakegen'
import { NAME_TOKEN_RE, HONORIFICS, detectTitleAnchoredNames } from './personNameDetection'

export type EntityType =
  | 'email'
  | 'phone'
  | 'SSN'
  | 'IBAN'
  | 'creditCard'
  | 'passport'
  | 'vehicleRegistration'
  | 'password'
  | 'name'
  | 'company'
  | 'companyId'
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

// German phones: +49 or 0 prefix
const PHONE_DE_RE = /(?:\+49[\s.-]?|0)[1-9]\d{1,4}[\s.-]?\d{2,10}/g

// French NIR (sécu): gender digit + 12–14 digits with optional spaces
const SSN_FR_RE = /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g
// US SSN
const SSN_US_RE = /\b\d{3}-\d{2}-\d{4}\b/g

// IBAN (basic — 15–34 alphanums after 2-letter country + 2 check digits)
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b/g

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

const POSTAL_LOCATION_RE = /\b\d{5}\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'' -]+\b/g

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

const STRUCTURAL_PATTERNS: Array<{ re: RegExp; type: EntityType }> = [
  { re: EMAIL_RE, type: 'email' },
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
  { re: ADDRESS_FR_RE, type: 'address' },
  { re: ADDRESS_EN_RE, type: 'address' },
  { re: POSTAL_LOCATION_RE, type: 'postalLocation' }
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

// HONORIFICS and NAME_TOKEN_RE are imported from personNameDetection.ts —
// the shared module that is the single source of truth for FR + EN title/name patterns.
// They are used here in detectCapitalized and detectSalutationAnchored exactly as before.

// Compiled once at module level to avoid per-call RegExp construction overhead
const CAPITALIZED_RE = new RegExp(
  `(?:^|(?<=[^.!?]\\s))(?:${NAME_TOKEN_RE}(?:\\s+${NAME_TOKEN_RE})*|[A-Z]{2,})`,
  'g'
)

function detectCapitalized(text: string): DetectedSpan[] {
  const spans: DetectedSpan[] = []
  // Match sequences of space-separated name tokens (potential names/companies) or ALL-CAPS.
  // Excludes matches immediately after sentence-ending punctuation.
  const re = new RegExp(CAPITALIZED_RE.source, CAPITALIZED_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const word = m[0]!
    if (word.length < 2) continue
    if (CAPITALIZED_STOPWORDS.has(word)) continue
    const parts = word.split(/\s+/).filter(Boolean)
    const containsCompanyKeyword = parts.some((part) => COMPANY_SUFFIXES.has(part.toLowerCase()))
    const containsAcronym = parts.some((part) => /^[A-Z]{2,}$/.test(part))

    // Skip all-caps single words that are common legal/document terms
    if (parts.length === 1 && /^[A-Z]{2,}$/.test(word) && ALL_CAPS_LEGAL_STOPWORDS.has(word))
      continue

    // Standalone all-caps words not in company keywords are too ambiguous (legal headings,
    // section titles, common abbreviations in EN/FR documents) — skip them entirely.
    // Multi-word all-caps sequences (e.g. "DUPONT MARTIN") still pass through below.
    if (parts.length === 1 && /^[A-Z]{2,}$/.test(word) && !containsCompanyKeyword) continue

    if (containsCompanyKeyword || containsAcronym) {
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
      const hasKnownFirstName = meaningfulParts.some((p) => KNOWN_FIRST_NAMES.has(p))
      if (!hasKnownFirstName) continue

      let cursor = m.index
      for (const part of parts) {
        const partStart = text.indexOf(part, cursor)
        const partEnd = partStart + part.length
        cursor = partEnd
        if (CAPITALIZED_STOPWORDS.has(part)) continue
        // Honorifics (Monsieur, Maître…) are titles, not names themselves
        if (HONORIFICS.has(part)) continue
        spans.push({ type: 'name', value: part, start: partStart, end: partEnd })
      }
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

function mergeSpans(spans: DetectedSpan[]): DetectedSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const result: DetectedSpan[] = []
  let cursor = 0
  for (const span of sorted) {
    if (span.start >= cursor) {
      result.push(span)
      cursor = span.end
    }
  }
  return result
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Detect PII spans in text.
 * Returns non-overlapping spans sorted by start position.
 *
 * Detection layers (highest priority first):
 *   1. Structural patterns  — email, phone, SSN, IBAN, credit card, vehicle plate, SIRET, VAT, address
 *   2. Password context     — keyword:value patterns
 *   3. Context-anchored     — SIREN with registry keyword; passport with document keyword
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
  const wordlistSpans = detectWordlist(text, wordlist)
  const salutationAnchored = detectSalutationAnchored(text)
  const titleAnchored = detectTitleAnchoredNames(text)
  const heuristic = detectCapitalized(text)

  // Priority order determines which span wins when ranges overlap
  return mergeSpans([
    ...structural,
    ...passwords,
    ...sirenSpans,
    ...passportSpans,
    ...wordlistSpans,
    ...salutationAnchored,
    ...titleAnchored,
    ...heuristic
  ])
}
