import type { InvoiceSettings } from './invoice'

export class InvoicePatternError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoicePatternError'
  }
}

const SEQ_TOKEN = '{SEQ}'

export interface InvoiceNumberContext {
  sequence: number
  sequencePadding: number
  date: Date
}

export function formatInvoiceNumber(pattern: string, ctx: InvoiceNumberContext): string {
  if (!pattern.includes(SEQ_TOKEN)) {
    throw new InvoicePatternError('Le motif doit contenir {SEQ}.')
  }
  const padding = Math.max(0, Math.min(12, Math.floor(ctx.sequencePadding)))
  const seq = String(Math.max(1, Math.floor(ctx.sequence))).padStart(padding, '0')
  const year = ctx.date.getFullYear()
  const month = String(ctx.date.getMonth() + 1).padStart(2, '0')
  const day = String(ctx.date.getDate()).padStart(2, '0')
  return pattern
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{MM\}/g, month)
    .replace(/\{DD\}/g, day)
    .replace(/\{SEQ\}/g, seq)
}

export interface ResolvedInvoiceNumber {
  number: string
  sequenceValue: number
  sequenceYear: number
  nextSettings: InvoiceSettings
}

export function consumeNextInvoiceNumber(
  settings: InvoiceSettings,
  issuedAt: Date,
  /**
   * Floor enforced against the highest number already issued (for this document
   * type / year). Makes numbering crash-safe — if a previous issuance saved its
   * record but crashed before persisting the advanced counter, the next call
   * still moves forward instead of reusing the number — and prevents a manually
   * lowered `nextSequence` from colliding with an issued number.
   */
  minSequenceValue = 1
): ResolvedInvoiceNumber {
  const year = issuedAt.getFullYear()
  const resetByYear = settings.resetSequenceYearly && settings.currentSequenceYear !== year
  const sequenceValue = Math.max(
    1,
    minSequenceValue,
    resetByYear ? 1 : Math.max(1, settings.nextSequence)
  )
  const number = formatInvoiceNumber(settings.numberPattern, {
    sequence: sequenceValue,
    sequencePadding: settings.sequencePadding,
    date: issuedAt
  })
  return {
    number,
    sequenceValue,
    sequenceYear: year,
    nextSettings: {
      ...settings,
      nextSequence: sequenceValue + 1,
      currentSequenceYear: year
    }
  }
}

export function previewInvoiceNumber(settings: InvoiceSettings, today: Date): string {
  const year = today.getFullYear()
  const resetByYear = settings.resetSequenceYearly && settings.currentSequenceYear !== year
  const sequenceValue = resetByYear ? 1 : Math.max(1, settings.nextSequence)
  return formatInvoiceNumber(settings.numberPattern, {
    sequence: sequenceValue,
    sequencePadding: settings.sequencePadding,
    date: today
  })
}

export const INVOICE_NUMBER_PATTERN_PRESETS: Array<{ pattern: string; label: string }> = [
  { pattern: 'FAC-{YYYY}-{SEQ}', label: 'FAC-2026-0042' },
  { pattern: '{YYYY}-{SEQ}', label: '2026-0042' },
  { pattern: '{YYYY}{MM}-{SEQ}', label: '202605-042' },
  { pattern: 'F{YYYY}{MM}{SEQ}', label: 'F2026050042' },
  { pattern: 'FAC{YYYY}/{SEQ}', label: 'FAC2026/0042' }
]
