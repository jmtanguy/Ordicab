export function parseDecimalInput(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return undefined
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseEurosToCents(value: string): number | undefined {
  const parsed = parseDecimalInput(value)
  return typeof parsed === 'number' ? Math.round(parsed * 100) : undefined
}

export function parsePercentToBasisPoints(value: string): number | undefined {
  const parsed = parseDecimalInput(value)
  return typeof parsed === 'number' ? Math.round(parsed * 100) : undefined
}

export function formatMoneyInput(value?: number): string {
  return typeof value === 'number' ? (value / 100).toFixed(2) : ''
}

export function formatNumberInput(value?: number): string {
  return typeof value === 'number' ? String(value) : ''
}

export function formatPercentInput(value?: number): string {
  return typeof value === 'number' ? String(value / 100) : ''
}

export function formatEurosFromCents(value?: number): string {
  if (typeof value !== 'number') {
    return '—'
  }

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(value / 100)
}

export function formatBasisPoints(value?: number): string {
  if (typeof value !== 'number') {
    return '—'
  }

  return `${(value / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: value % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })} %`
}
