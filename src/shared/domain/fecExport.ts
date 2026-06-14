/**
 * FEC export — Fichier des Écritures Comptables (DGFiP, arrêté du 29 juillet 2013).
 *
 * Produces the tab-separated accounting journal that French firms must hand to
 * their expert-comptable. Each issued invoice / credit note / corrective invoice
 * becomes one balanced écriture in the sales journal:
 *
 *   normal sale  : DEBIT  client (411)  TTC
 *                  CREDIT revenue (706) HT      (one line per VAT rate)
 *                  CREDIT VAT     (44571) VAT   (one line per VAT rate)
 *   credit note  : the same lines with debit/credit swapped (an avoir).
 *
 * Amounts are always non-negative (direction is carried by the debit/credit
 * column, never by a minus sign), French-formatted with a comma decimal.
 */
import type { InvoiceRecord, InvoiceVatBreakdownLine } from './invoice'

/** The 18 mandatory FEC columns, in order. */
export const FEC_COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise'
] as const

export interface FecExportOptions {
  /** Client receivable account (411). */
  clientAccount?: string
  clientAccountLabel?: string
  /** Revenue account (706 — prestations de services). */
  revenueAccount?: string
  revenueAccountLabel?: string
  /** Collected-VAT account (44571 — TVA collectée). */
  vatAccount?: string
  vatAccountLabel?: string
  journalCode?: string
  journalLabel?: string
}

const DEFAULTS = {
  clientAccount: '411000',
  clientAccountLabel: 'Clients',
  revenueAccount: '706000',
  revenueAccountLabel: 'Prestations de services',
  vatAccount: '445710',
  vatAccountLabel: 'TVA collectée',
  journalCode: 'VT',
  journalLabel: 'Ventes'
} as const

/** Cents → French amount with a comma decimal, e.g. 123456 → "1234,56". Always ≥ 0. */
function fecAmount(cents: number): string {
  return (Math.abs(Math.round(cents)) / 100).toFixed(2).replace('.', ',')
}

/** ISO date (YYYY-MM-DD…) → FEC date (YYYYMMDD). */
function fecDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '')
}

/** FEC fields are tab-separated and single-line: strip any tab / CR / LF. */
function fecText(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim()
}

interface FecLine {
  compteNum: string
  compteLib: string
  compAuxNum: string
  compAuxLib: string
  debit: number
  credit: number
}

function vatBreakdownOrFallback(invoice: InvoiceRecord): InvoiceVatBreakdownLine[] {
  if (invoice.vatBreakdown.length > 0) return invoice.vatBreakdown
  // Defensive fallback for a record without a stored breakdown: a single line
  // carrying the whole HT/VAT/TTC so the écriture still balances.
  return [
    {
      vatRateBasisPoints: 0,
      taxableHtCents: invoice.totalHtCents,
      vatCents: invoice.totalVatCents,
      totalTtcCents: invoice.totalTtcCents
    }
  ]
}

/**
 * Build the FEC text for the given issued invoices. Invoices are emitted in
 * chronological order (issue date, then number); each gets a sequential
 * EcritureNum shared by all of its lines.
 */
export function buildFecExport(invoices: InvoiceRecord[], options: FecExportOptions = {}): string {
  const cfg = { ...DEFAULTS, ...stripUndefined(options) }

  const ordered = [...invoices].sort((a, b) =>
    a.issuedAt === b.issuedAt
      ? a.number.localeCompare(b.number)
      : a.issuedAt.localeCompare(b.issuedAt)
  )

  const rows: string[][] = [FEC_COLUMNS.slice()]
  let ecritureNum = 0

  for (const invoice of ordered) {
    ecritureNum += 1
    const isCreditNote = invoice.documentType === 'creditNote'
    const date = fecDate(invoice.issuedAt)
    const clientLabel = fecText(invoice.clientLabel ?? invoice.clientSnapshot?.name ?? '')
    const label = fecText(
      `${isCreditNote ? 'Avoir' : 'Facture'} ${invoice.number}${clientLabel ? ` - ${clientLabel}` : ''}`
    )

    const lines: FecLine[] = []
    // Receivable: debit on a sale, credit on an avoir.
    lines.push({
      compteNum: cfg.clientAccount,
      compteLib: cfg.clientAccountLabel,
      compAuxNum: invoice.clientContactUuid ?? '',
      compAuxLib: clientLabel,
      debit: isCreditNote ? 0 : invoice.totalTtcCents,
      credit: isCreditNote ? invoice.totalTtcCents : 0
    })
    // Revenue + VAT per rate: credit on a sale, debit on an avoir.
    for (const breakdown of vatBreakdownOrFallback(invoice)) {
      lines.push({
        compteNum: cfg.revenueAccount,
        compteLib: cfg.revenueAccountLabel,
        compAuxNum: '',
        compAuxLib: '',
        debit: isCreditNote ? breakdown.taxableHtCents : 0,
        credit: isCreditNote ? 0 : breakdown.taxableHtCents
      })
      if (breakdown.vatCents > 0) {
        lines.push({
          compteNum: cfg.vatAccount,
          compteLib: cfg.vatAccountLabel,
          compAuxNum: '',
          compAuxLib: '',
          debit: isCreditNote ? breakdown.vatCents : 0,
          credit: isCreditNote ? 0 : breakdown.vatCents
        })
      }
    }

    for (const line of lines) {
      rows.push([
        cfg.journalCode,
        cfg.journalLabel,
        String(ecritureNum),
        date,
        line.compteNum,
        line.compteLib,
        line.compAuxNum,
        line.compAuxLib,
        fecText(invoice.number),
        date,
        label,
        fecAmount(line.debit),
        fecAmount(line.credit),
        '', // EcritureLet (lettrage) — not tracked
        '', // DateLet
        date, // ValidDate — issued invoices are immutable/validated at issue
        '', // Montantdevise
        '' // Idevise
      ])
    }
  }

  return rows.map((row) => row.join('\t')).join('\r\n')
}

function stripUndefined(options: FecExportOptions): Partial<typeof DEFAULTS> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'string' && value.trim()) out[key] = value.trim()
  }
  return out as Partial<typeof DEFAULTS>
}
