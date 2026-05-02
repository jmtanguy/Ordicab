const DIACRITIC_VARIANTS: Record<string, string> = {
  a: 'aàáâãäåāăąǎǟǡ',
  c: 'cçćĉċč',
  d: 'dďđ',
  e: 'eèéêëēĕėęěȅȇ',
  g: 'gĝğġģ',
  h: 'hĥħ',
  i: 'iìíîïĩīĭįıǐȉȋ',
  j: 'jĵ',
  k: 'kķ',
  l: 'lĺļľł',
  n: 'nñńņňŉŋ',
  o: 'oòóôõöøōŏőǒȍȏ',
  r: 'rŕŗř',
  s: 'sśŝşš',
  t: 'tţťŧ',
  u: 'uùúûüũūŭůűųǔȕȗ',
  w: 'wŵ',
  y: 'yýÿŷ',
  z: 'zźżž'
}

function escapeForCharClass(value: string): string {
  return value.replace(/[\\\]-]/g, '\\$&')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Canonicalize Unicode dash/hyphen and whitespace variants. LLMs frequently
// return typographically "nicer" characters (non-breaking hyphen, en/em dash,
// NBSP) in places where the source had the ASCII equivalent, which breaks
// strict equality comparisons against stored fake values.
const DASH_VARIANTS = '-\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212'
const SPACE_VARIANTS = ' \u00a0\u2000-\u200a\u202f\u205f\u3000'
const DASH_VARIANTS_RE = new RegExp(`[${DASH_VARIANTS}]`, 'g')
const SPACE_VARIANTS_RE = new RegExp(`[${SPACE_VARIANTS}]+`, 'g')

export function normalizeMatchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(DASH_VARIANTS_RE, '-')
    .replace(SPACE_VARIANTS_RE, ' ')
    .trim()
}

/**
 * Collapse whitespace runs (any Unicode space variant) to a single regular
 * space and trim. Preserves case and diacritics — used to clean values that
 * are stored verbatim (e.g. PII originals coming from OCR or imported contact
 * fields) without altering the user-facing characters.
 */
export function normalizeWhitespace(value: string): string {
  return value.replace(SPACE_VARIANTS_RE, ' ').trim()
}

export function buildDiacriticInsensitivePattern(value: string): string {
  return Array.from(value.normalize('NFC'))
    .map((char) => {
      const lower = char.toLocaleLowerCase()
      const base = normalizeMatchKey(char)
      const variants = DIACRITIC_VARIANTS[base]
      if (variants) {
        return `[${escapeForCharClass(variants)}]\\p{M}*`
      }
      if (base.length === 1 && base !== lower) {
        return `[${escapeForCharClass(`${base}${lower}`)}]\\p{M}*`
      }
      if (DASH_VARIANTS.includes(char)) {
        return `[${escapeForCharClass(DASH_VARIANTS)}]`
      }
      if (/\s/.test(char)) {
        return `[${escapeForCharClass(SPACE_VARIANTS)}]+`
      }
      return escapeRegex(char)
    })
    .join('')
}
