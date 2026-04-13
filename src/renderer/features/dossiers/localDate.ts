type DatePart = 'day' | 'month' | 'year'

const ISO_LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function getLocaleDatePartOrder(locale: string): DatePart[] {
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).formatToParts(new Date(Date.UTC(2006, 10, 23)))

  const order = parts
    .map((part) => part.type)
    .filter((part): part is DatePart => part === 'day' || part === 'month' || part === 'year')

  return order.length === 3 ? order : ['day', 'month', 'year']
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }

  const candidate = new Date(Date.UTC(year, month - 1, day))

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  )
}

export function formatIsoDateForLocaleInput(
  isoDate: string | null | undefined,
  locale: string
): string {
  if (!isoDate) {
    return ''
  }

  const normalized = isoDate.trim()

  if (!ISO_LOCAL_DATE_PATTERN.test(normalized)) {
    return normalized
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${normalized}T00:00:00.000Z`))
  } catch {
    return normalized
  }
}

export function parseLocaleDateToIso(localDate: string, locale: string): string | null {
  const normalized = localDate.trim()

  if (!normalized) {
    return ''
  }

  if (ISO_LOCAL_DATE_PATTERN.test(normalized)) {
    return normalized
  }

  const numericParts = normalized.match(/\d+/g)

  if (!numericParts || numericParts.length !== 3) {
    return null
  }

  const order = getLocaleDatePartOrder(locale)
  const partMap = new Map<DatePart, string>()

  order.forEach((part, index) => {
    partMap.set(part, numericParts[index] ?? '')
  })

  const yearRaw = partMap.get('year') ?? ''
  const monthRaw = partMap.get('month') ?? ''
  const dayRaw = partMap.get('day') ?? ''

  if (yearRaw.length !== 4) {
    return null
  }

  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  if (!isValidDateParts(year, month, day)) {
    return null
  }

  return `${yearRaw}-${monthRaw.padStart(2, '0')}-${dayRaw.padStart(2, '0')}`
}
