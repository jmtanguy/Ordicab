import type { InvoiceRecord } from '@shared/types'

export interface OverdueInfo {
  /** Whole days elapsed since the due date (always >= 1). */
  daysOverdue: number
}

/** Only invoices still awaiting payment can be overdue. */
const OVERDUE_ELIGIBLE_STATUSES: ReadonlySet<InvoiceRecord['status']> = new Set([
  'issued',
  'partiallyPaid'
])

function localDayStart(value: string | Date): number {
  // Date-only ISO strings are anchored at noon so the local day is unambiguous
  // (same convention as the date formatters used by the invoice views).
  const date =
    typeof value === 'string' ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const DAY_MS = 86_400_000

/**
 * Returns overdue information for an invoice, or `null` when the invoice is
 * not overdue (paid/cancelled/…, no due date, due today or in the future).
 */
export function computeOverdueInfo(
  invoice: Pick<InvoiceRecord, 'status' | 'dueAt'>,
  today: Date = new Date()
): OverdueInfo | null {
  if (!invoice.dueAt || !OVERDUE_ELIGIBLE_STATUSES.has(invoice.status)) return null
  const dueStart = localDayStart(invoice.dueAt)
  if (Number.isNaN(dueStart)) return null
  // Round absorbs DST shifts so the count stays in whole days.
  const daysOverdue = Math.round((localDayStart(today) - dueStart) / DAY_MS)
  return daysOverdue > 0 ? { daysOverdue } : null
}
