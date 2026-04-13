import type {
  DocumentStructuredAnalysis,
  DocumentStructuredClause,
  DocumentStructuredDate,
  DocumentStructuredMonetaryAmount,
  DocumentStructuredParty
} from '@shared/domain/document'

// Keep both accented and unaccented French month names because OCR often drops accents.
const FRENCH_MONTHS: Record<string, string> = {
  janvier: '01',
  fevrier: '02',
  février: '02',
  mars: '03',
  avril: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  octobre: '10',
  novembre: '11',
  decembre: '12',
  décembre: '12'
}

function clampResults<T>(values: T[], max = 10): T[] {
  return values.slice(0, max)
}

function dedupeBy<T>(values: T[], getKey: (value: T) => string): T[] {
  const seen = new Set<string>()
  const deduped: T[] = []

  for (const value of values) {
    const key = getKey(value)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(value)
  }

  return deduped
}

function toIsoDate(year: string, month: string, day: string): string | undefined {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(`${iso}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : iso
}

function extractDates(text: string): DocumentStructuredDate[] {
  const results: DocumentStructuredDate[] = []

  // ISO dates are the most reliable signal, so they get high confidence.
  for (const match of text.matchAll(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g)) {
    const [raw, year, month, day] = match
    results.push({ raw, isoDate: toIsoDate(year, month, day), confidence: 'high' })
  }

  // Numeric local formats are useful but more ambiguous across locales.
  for (const match of text.matchAll(/\b([0-3]?\d)[/.-]([0-1]?\d)[/.-]((?:19|20)\d{2})\b/g)) {
    const [raw, day, month, year] = match
    results.push({ raw, isoDate: toIsoDate(year, month, day), confidence: 'medium' })
  }

  for (const match of text.matchAll(
    /\b([0-3]?\d)\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\s+((?:19|20)\d{2})\b/giu
  )) {
    const [raw, day, rawMonth, year] = match
    const month = FRENCH_MONTHS[rawMonth.toLocaleLowerCase()]
    results.push({
      raw,
      isoDate: month ? toIsoDate(year, month, day) : undefined,
      confidence: 'high'
    })
  }

  return clampResults(
    dedupeBy(results, (entry) => `${entry.isoDate ?? ''}|${entry.raw.toLocaleLowerCase()}`),
    12
  )
}

function normalizeEuroAmount(raw: string): string | undefined {
  // Normalize OCR- and locale-shaped EUR strings so downstream code can compare
  // amounts without depending on the original formatting.
  const numericPart = raw
    .replace(/euros?/giu, '')
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(/(?<=\d) (?=\d{3}\b)/g, '')
    .replace(',', '.')

  const parsed = Number(numericPart)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : undefined
}

function extractMonetaryAmounts(text: string): DocumentStructuredMonetaryAmount[] {
  const results: DocumentStructuredMonetaryAmount[] = []

  for (const match of text.matchAll(/\b\d{1,3}(?:[ .]\d{3})*(?:,\d{2})?\s?(?:€|euros?)\b/giu)) {
    const [raw] = match
    results.push({
      raw,
      currency: 'EUR',
      normalizedAmount: normalizeEuroAmount(raw),
      confidence: 'high'
    })
  }

  return clampResults(
    dedupeBy(
      results,
      (entry) => `${entry.normalizedAmount ?? ''}|${entry.raw.toLocaleLowerCase()}`
    ),
    10
  )
}

function extractParties(text: string): DocumentStructuredParty[] {
  const results: DocumentStructuredParty[] = []

  // Person extraction stays conservative on purpose: false positives are more
  // harmful than missing a borderline name when this output is shown to the AI.
  for (const match of text.matchAll(
    /\b(Madame|Monsieur|Mme|M\.|Me|Maître)\s+([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3})\b/gu
  )) {
    const [raw] = match
    results.push({
      name: raw.trim(),
      kind: 'person',
      confidence: raw.startsWith('Me') || raw.startsWith('Maître') ? 'high' : 'medium'
    })
  }

  for (const match of text.matchAll(
    /\b(SARL|SAS|SASU|SCI|SELARL|EURL|SCP|Association)\s+([A-Z0-9][\p{L}0-9'’&., -]{1,80})\b/gu
  )) {
    const [raw] = match
    results.push({
      name: raw.trim(),
      kind: 'organization',
      confidence: 'medium'
    })
  }

  return clampResults(
    dedupeBy(results, (entry) => `${entry.kind}|${entry.name.toLocaleLowerCase()}`),
    10
  )
}

function extractClauses(text: string): DocumentStructuredClause[] {
  const results: DocumentStructuredClause[] = []

  // Clause detection is intentionally generic: it surfaces likely anchors for
  // follow-up reasoning without pretending to understand the clause semantics.
  for (const match of text.matchAll(
    /\b(?:Article|Clause|Section)\s+(?:\d+[A-Za-z-]*|[IVXLC]+|premier|unique)(?:\s*[-:]\s*[^.]{1,80})?/giu
  )) {
    const [raw] = match
    results.push({
      title: raw.trim().replace(/\s+/g, ' '),
      confidence: 'medium'
    })
  }

  return clampResults(
    dedupeBy(results, (entry) => entry.title.toLocaleLowerCase()),
    10
  )
}

export function extractStructuredDocumentAnalysis(text: string): DocumentStructuredAnalysis {
  const dates = extractDates(text)
  const monetaryAmounts = extractMonetaryAmounts(text)
  const parties = extractParties(text)
  const clauses = extractClauses(text)

  // Suggested tags are deliberately derived from deterministic signals so they
  // can safely augment LLM-produced tags without introducing unstable wording.
  const years = dates
    .map((entry) => entry.isoDate?.slice(0, 4))
    .filter((year): year is string => typeof year === 'string' && year.length === 4)
  const latestYear = years.length > 0 ? [years.reduce((a, b) => (b > a ? b : a))] : []

  const suggestedTags = dedupeBy(
    [
      ...latestYear,
      ...(monetaryAmounts.length > 0 ? ['montants'] : []),
      ...(parties.length > 0 ? ['parties'] : []),
      ...(clauses.length > 0 ? ['clauses'] : [])
    ],
    (value) => value
  )

  return {
    parties,
    dates,
    monetaryAmounts,
    clauses,
    suggestedTags
  }
}
