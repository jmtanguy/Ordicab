/**
 * dateNormalization — format-tolerant date parsing for PII revert.
 *
 * The pseudonymizer registers a fake date in whatever format the original
 * appeared in (ISO, FR/EU numeric, FR/EN textual). The LLM, however, routinely
 * reformats dates between turns — most often into ISO `YYYY-MM-DD` for tool
 * arguments typed `date`. Plain string match against the stored fakeValue then
 * misses, and the fake date leaks to the backend as if it were the user's real
 * value.
 *
 * This module canonicalises any supported representation to `{year, month, day}`
 * so revert can match across formats, and re-renders the original date in the
 * format the LLM emitted so the output stays consistent with the surrounding
 * text / tool argument.
 */
export interface ParsedDate {
  year: number
  month: number
  day: number
}

export const FR_MONTH_TO_INDEX: Record<string, number> = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12
}

export const EN_MONTH_TO_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
}

export const FR_MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre'
]

export const EN_MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
]

const FR_MONTHS_ALT = Object.keys(FR_MONTH_TO_INDEX).join('|')
const EN_MONTHS_ALT = Object.keys(EN_MONTH_TO_INDEX).join('|')

const NUMERIC_YEAR_FIRST = /^(\d{4})([/\-. ])(\d{1,2})\2(\d{1,2})$/
const NUMERIC_DAY_FIRST = /^(\d{1,2})([/\-. ])(\d{1,2})\2(\d{2,4})$/
const FR_TEXTUAL = new RegExp(`^(\\d{1,2})(?:er)?\\s+(${FR_MONTHS_ALT})\\s+(\\d{2,4})$`, 'i')
const EN_TEXTUAL = new RegExp(
  `^(${EN_MONTHS_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})$`,
  'i'
)

// Pattern source kept as a string so each call gets a fresh RegExp instance
// (avoids the cross-call lastIndex pitfall of a stateful module-level regex).
const DATE_TOKEN_FIND_SOURCE =
  '\\b(?:' +
  '\\d{4}[\\/\\-. ]\\d{1,2}[\\/\\-. ]\\d{1,2}' +
  '|\\d{1,2}[\\/\\-. ]\\d{1,2}[\\/\\-. ]\\d{2,4}' +
  `|\\d{1,2}(?:er)?\\s+(?:${FR_MONTHS_ALT})\\s+\\d{2,4}` +
  `|(?:${EN_MONTHS_ALT})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}` +
  ')\\b'

export function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year
  // Legal/civil-status inputs frequently use two-digit years for older birth
  // dates. Treating every `81` as 2081 corrupts date revert when the LLM
  // canonicalizes a fake date to ISO. Use a conservative rolling-style pivot.
  return year <= 30 ? 2000 + year : 1900 + year
}

export function isValidYMD(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** Parse a date string in any of ISO / FR-numeric / FR-textual / EN-textual forms. */
export function parseDateFlexible(text: string): ParsedDate | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  let m = NUMERIC_YEAR_FIRST.exec(trimmed)
  if (m) {
    const year = parseInt(m[1]!, 10)
    const month = parseInt(m[3]!, 10)
    const day = parseInt(m[4]!, 10)
    return isValidYMD(year, month, day) ? { year, month, day } : null
  }

  m = NUMERIC_DAY_FIRST.exec(trimmed)
  if (m) {
    const day = parseInt(m[1]!, 10)
    const month = parseInt(m[3]!, 10)
    const year = expandTwoDigitYear(parseInt(m[4]!, 10))
    return isValidYMD(year, month, day) ? { year, month, day } : null
  }

  m = FR_TEXTUAL.exec(trimmed)
  if (m) {
    const monthIdx = FR_MONTH_TO_INDEX[m[2]!.toLowerCase()]
    if (monthIdx !== undefined) {
      const day = parseInt(m[1]!, 10)
      const year = expandTwoDigitYear(parseInt(m[3]!, 10))
      return isValidYMD(year, monthIdx, day) ? { year, month: monthIdx, day } : null
    }
  }

  m = EN_TEXTUAL.exec(trimmed)
  if (m) {
    const monthIdx = EN_MONTH_TO_INDEX[m[1]!.toLowerCase()]
    if (monthIdx !== undefined) {
      const day = parseInt(m[2]!, 10)
      const year = expandTwoDigitYear(parseInt(m[3]!, 10))
      return isValidYMD(year, monthIdx, day) ? { year, month: monthIdx, day } : null
    }
  }

  return null
}

/** ISO `YYYY-MM-DD` string used as a hash-friendly canonical key. */
export function canonicalDateKey(parsed: ParsedDate): string {
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function applyCase(name: string, hint: string): string {
  if (/^[A-Z]+$/.test(hint)) return name.toUpperCase()
  if (/^[A-Z]/.test(hint)) return name.charAt(0).toUpperCase() + name.slice(1)
  return name
}

/**
 * Render `parsed` mirroring the format of `hint` (separator, ordering, year
 * width, month name casing, comma). Falls back to ISO when the hint cannot be
 * parsed back to a canonical shape.
 */
export function formatDateLike(parsed: ParsedDate, hint: string): string {
  const trimmed = hint.trim()

  let m = NUMERIC_YEAR_FIRST.exec(trimmed)
  if (m) {
    const sep = m[2]!
    return `${parsed.year}${sep}${pad2(parsed.month)}${sep}${pad2(parsed.day)}`
  }

  m = NUMERIC_DAY_FIRST.exec(trimmed)
  if (m) {
    const sep = m[2]!
    const yearStr = m[4]!.length === 2 ? String(parsed.year).slice(2) : String(parsed.year)
    return `${pad2(parsed.day)}${sep}${pad2(parsed.month)}${sep}${yearStr}`
  }

  m = FR_TEXTUAL.exec(trimmed)
  if (m) {
    const monthName = applyCase(FR_MONTH_NAMES[parsed.month - 1]!, m[2]!)
    const yearStr = m[3]!.length === 2 ? String(parsed.year).slice(2) : String(parsed.year)
    return `${parsed.day} ${monthName} ${yearStr}`
  }

  m = EN_TEXTUAL.exec(trimmed)
  if (m) {
    const monthName = applyCase(EN_MONTH_NAMES[parsed.month - 1]!, m[1]!)
    const sep = trimmed.includes(',') ? ', ' : ' '
    const yearStr = m[3]!.length === 2 ? String(parsed.year).slice(2) : String(parsed.year)
    return `${monthName} ${parsed.day}${sep}${yearStr}`
  }

  return canonicalDateKey(parsed)
}

/** Find date-shaped tokens in arbitrary text. Each match is a candidate for canonical lookup. */
export function findDateTokens(text: string): Array<{ start: number; end: number; value: string }> {
  const out: Array<{ start: number; end: number; value: string }> = []
  const re = new RegExp(DATE_TOKEN_FIND_SOURCE, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, value: m[0] })
  }
  return out
}
