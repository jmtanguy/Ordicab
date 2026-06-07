import type { LegifranceFond } from './legal'

/**
 * Result of parsing a free-text legal search query.
 *
 * The parser is deliberately conservative: it only sets `isCitation` (and the
 * structured fields) when the query clearly matches an article-citation pattern
 * such as "article 1240 du code civil" or "L. 121-3 code de la consommation".
 * For anything else (natural-language / conceptual queries) it returns
 * `isCitation: false` so the caller keeps the broad UN_DES_MOTS behaviour.
 */
export interface ParsedLegalQuery {
  /** Bare article number, e.g. "1240", "L121-3". */
  articleNumber?: string
  /** Canonical Légifrance code name, e.g. "Code civil". */
  codeName?: string
  /** Restricted fond when a code is detected. */
  fond?: LegifranceFond
  /** True when an article/code citation was recognised. */
  isCitation: boolean
}

// Canonical Légifrance code names keyed by an accent-free, lowercased, space
// collapsed form of common spellings and abbreviations. Extend as needed.
const CODE_NAME_ALIASES: Record<string, string> = {
  'code civil': 'Code civil',
  'c civ': 'Code civil',
  cciv: 'Code civil',
  'code de procedure civile': 'Code de procédure civile',
  cpc: 'Code de procédure civile',
  'code penal': 'Code pénal',
  'c pen': 'Code pénal',
  cpen: 'Code pénal',
  'code de procedure penale': 'Code de procédure pénale',
  cpp: 'Code de procédure pénale',
  'code de la consommation': 'Code de la consommation',
  'code conso': 'Code de la consommation',
  'code du travail': 'Code du travail',
  'code de commerce': 'Code de commerce',
  'code de la sante publique': 'Code de la santé publique',
  csp: 'Code de la santé publique',
  'code de la securite sociale': 'Code de la sécurité sociale',
  css: 'Code de la sécurité sociale',
  'code general des impots': 'Code général des impôts',
  cgi: 'Code général des impôts',
  'code de la route': 'Code de la route',
  'code de lurbanisme': "Code de l'urbanisme",
  'code de l urbanisme': "Code de l'urbanisme",
  'code monetaire et financier': 'Code monétaire et financier',
  cmf: 'Code monétaire et financier'
}

/** Strip diacritics, lowercase, drop punctuation and collapse whitespace. */
function canonicalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Capitalise only the first word, matching the Légifrance convention for code
 * names ("Code des transports", "Code de la consommation").
 */
function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Normalise a raw code spelling to the canonical Légifrance name.
 * Falls back to a Title-cased form for unrecognised "code X" inputs so the
 * value remains usable as a NOM_CODE facet.
 */
export function normalizeCodeName(raw: string): string | undefined {
  const key = canonicalize(raw)
  if (!key) return undefined
  if (CODE_NAME_ALIASES[key]) return CODE_NAME_ALIASES[key]
  if (key.startsWith('code')) return capitalizeFirst(key)
  return undefined
}

// "article"/"art." optional, optional L/R/D prefix, composed numbers (1240,
// 121-3, L. 121-3). Capture group 1 is the article number (prefix + digits).
const ARTICLE_PATTERN = /(?:\b(?:article|art)\b\.?\s*)?((?:[LRD]\.?\s*)?\d+(?:-\d+)*)/i
// "(du|de la|de l'|des) code <name>" — captures the code name run of letters.
const CODE_PATTERN =
  /\bcode\s+(?:de\s+la\s+|de\s+l['’]\s*|de\s+|du\s+|des\s+)?[a-zàâçéèêëîïôûùüÿñæœ' -]+/i

/**
 * Detect a code name in a query, either via an explicit "code X" phrase or via
 * a known abbreviation ("c. civ.", "cpc"). Abbreviations are matched on the
 * canonicalized query so "art. 1240 c. civ." resolves to "Code civil".
 */
function detectCodeName(query: string): string | undefined {
  const codeMatch = query.match(CODE_PATTERN)
  if (codeMatch) {
    const name = normalizeCodeName(codeMatch[0])
    if (name) return name
  }
  const canonical = canonicalize(query)
  for (const [alias, name] of Object.entries(CODE_NAME_ALIASES)) {
    // Abbreviations only (those without the word "code"); whole-word match to
    // avoid e.g. "css" matching inside another token.
    if (alias.includes('code')) continue
    if (new RegExp(`\\b${alias}\\b`).test(canonical)) return name
  }
  return undefined
}

/**
 * Parse a free-text query into structured citation fields when it matches an
 * article/code pattern. Returns `isCitation: false` otherwise.
 */
export function parseLegalQuery(query: string): ParsedLegalQuery {
  const trimmed = query.trim()
  if (!trimmed) return { isCitation: false }

  const codeName = detectCodeName(trimmed)

  // Only treat the leading token as an article number when the query actually
  // looks like a citation: it must also reference a code, or start with an
  // explicit "article"/"art." / L-R-D marker. This keeps conceptual queries
  // that merely contain a number out of the structured path.
  const hasArticleMarker = /\b(?:article|art)\b\.?/i.test(trimmed)
  const hasLrdMarker = /\b[LRD]\.?\s*\d/i.test(trimmed)
  let articleNumber: string | undefined
  if (codeName || hasArticleMarker || hasLrdMarker) {
    const articleMatch = trimmed.match(ARTICLE_PATTERN)
    if (articleMatch?.[1]) {
      // Drop spaces and the separator dot after an L/R/D prefix: "L. 121-3" -> "L121-3".
      articleNumber = articleMatch[1].replace(/[\s.]/g, '').toUpperCase()
    }
  }

  if (!articleNumber && !codeName) return { isCitation: false }

  return {
    articleNumber,
    codeName,
    fond: codeName ? 'CODE_DATE' : undefined,
    isCitation: true
  }
}
