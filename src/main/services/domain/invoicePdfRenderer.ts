/**
 * Builds a self-contained, printable HTML representation of an invoice.
 *
 * Two entry points:
 *  - `buildInvoiceHtmlFromDocx(path)` — preferred. Reads the generated DOCX
 *    (the contractual document, rendered from the user-selected template)
 *    and converts it to HTML via mammoth, so the PDF mirrors the DOCX
 *    template choices (layout, headings, table structure).
 *  - `buildInvoiceHtml(record)` — fallback for legacy invoices that have no
 *    DOCX on disk. Renders a generic, template-agnostic layout from the
 *    persisted record.
 *
 * Pure (no `electron` import) so the domain service can stay decoupled from
 * Electron — the BrowserWindow + printToPDF step is injected by the container.
 */
import { readFile } from 'node:fs/promises'

import mammoth from 'mammoth'

import type { InvoiceRecord } from '@shared/types'

const DOCX_STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Titre 1'] => h1:fresh",
  "p[style-name='Titre 2'] => h2:fresh",
  "p[style-name='Titre 3'] => h3:fresh",
  'b => strong',
  'i => em',
  'u => u',
  'strike => s'
]

function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

function formatDateIso(iso: string | undefined): string {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(
      new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
    )
  } catch {
    return iso
  }
}

function formatVatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)} %`
}

const DOCUMENT_TYPE_LABEL: Record<InvoiceRecord['documentType'], string> = {
  invoice: 'Facture',
  creditNote: 'Avoir',
  correctiveInvoice: 'Facture rectificative'
}

function partyBlock(
  title: string,
  party:
    | {
        name?: string
        address?: string
        siret?: string
        vatNumber?: string
        iban?: string
      }
    | undefined,
  fallbackName?: string
): string {
  const name = party?.name ?? fallbackName ?? ''
  const address = (party?.address ?? '').replace(/\n/g, '<br/>')
  const lines: string[] = []
  if (party?.siret) lines.push(`SIRET ${escapeHtml(party.siret)}`)
  if (party?.vatNumber) lines.push(`TVA ${escapeHtml(party.vatNumber)}`)
  if (party?.iban) lines.push(`IBAN ${escapeHtml(party.iban)}`)
  return `
    <section class="party">
      <p class="party-title">${escapeHtml(title)}</p>
      <p class="party-name">${escapeHtml(name) || '—'}</p>
      ${address ? `<p class="party-address">${address}</p>` : ''}
      ${lines.map((line) => `<p class="party-meta">${line}</p>`).join('')}
    </section>
  `
}

export function buildInvoiceHtml(invoice: InvoiceRecord): string {
  const sign = invoice.documentType === 'creditNote' ? -1 : 1
  const docTypeLabel = DOCUMENT_TYPE_LABEL[invoice.documentType]

  const linesRows = invoice.lines
    .map((line) => {
      const description = line.description
        ? `<div class="line-description">${escapeHtml(line.description)}</div>`
        : ''
      return `
        <tr>
          <td class="col-date">${escapeHtml(formatDateIso(line.date))}</td>
          <td class="col-label">
            <div>${escapeHtml(line.label)}</div>
            ${description}
          </td>
          <td class="col-num">${escapeHtml(line.quantity)}${line.quantityUnit === 'hours' ? ' h' : ''}</td>
          <td class="col-num">${escapeHtml(formatCents(line.unitPriceHtCents))}</td>
          <td class="col-num">${escapeHtml(formatCents(sign * line.totalHtCents))}</td>
          <td class="col-num">${escapeHtml(formatVatRate(line.vatRateBasisPoints))}</td>
          <td class="col-num">${escapeHtml(formatCents(sign * line.totalTtcCents))}</td>
        </tr>
      `
    })
    .join('')

  const vatRows = invoice.vatBreakdown
    .map(
      (entry) => `
        <tr>
          <td>TVA ${formatVatRate(entry.vatRateBasisPoints)} sur ${formatCents(sign * entry.taxableHtCents)}</td>
          <td class="col-num">${formatCents(sign * entry.vatCents)}</td>
        </tr>
      `
    )
    .join('')

  const refsBlock =
    invoice.originalInvoiceRefs.length > 0
      ? `
        <section class="meta-block">
          <p class="meta-label">Factures d'origine</p>
          <p>${escapeHtml(invoice.originalInvoiceRefs.map((ref) => ref.number).join(', '))}</p>
          ${
            invoice.correctionReason
              ? `<p class="meta-small">Motif : ${escapeHtml(invoice.correctionReason)}</p>`
              : ''
          }
        </section>
      `
      : ''

  const paymentsBlock =
    invoice.payments.length > 0
      ? `
        <section class="meta-block">
          <p class="meta-label">Règlements enregistrés</p>
          <table class="payments-table">
            ${invoice.payments
              .map(
                (p) => `
                  <tr>
                    <td>${escapeHtml(formatDateIso(p.paidAt))}</td>
                    <td>${escapeHtml(p.method)}${p.reference ? ` · ${escapeHtml(p.reference)}` : ''}</td>
                    <td class="col-num">${escapeHtml(formatCents(p.amountCents))}</td>
                  </tr>
                `
              )
              .join('')}
          </table>
        </section>
      `
      : ''

  const balanceBlock =
    invoice.documentType !== 'creditNote'
      ? `
        <tr><td>Encaissé</td><td class="col-num">${formatCents(invoice.paidAmountCents)}</td></tr>
        <tr class="balance"><td>Solde restant</td><td class="col-num">${formatCents(invoice.remainingAmountCents)}</td></tr>
      `
      : ''

  const legalFooter = invoice.issuerSnapshot?.iban
    ? `<p class="legal">IBAN : ${escapeHtml(invoice.issuerSnapshot.iban)}</p>`
    : ''

  const notes = invoice.notes
    ? `<section class="notes"><p class="meta-label">Notes</p><p>${escapeHtml(invoice.notes).replace(/\n/g, '<br/>')}</p></section>`
    : ''

  const paymentTerms = invoice.paymentTerms
    ? `<p class="meta-small">Conditions de paiement : ${escapeHtml(invoice.paymentTerms)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTypeLabel)} ${escapeHtml(invoice.number)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.45; }
  body { padding: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .doc-meta { text-align: right; }
  .doc-meta h1 { margin: 0 0 4px 0; font-size: 22pt; color: #0a5c68; }
  .doc-meta .number { font-weight: 600; font-size: 14pt; }
  .doc-meta p { margin: 2px 0; font-size: 10pt; color: #5c5c5a; }
  .parties { display: flex; gap: 24px; margin: 28px 0 8px 0; }
  .party { flex: 1; }
  .party-title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #8a8a85; margin: 0 0 4px 0; }
  .party-name { font-weight: 600; margin: 0 0 4px 0; }
  .party-address, .party-meta { margin: 0; font-size: 10pt; color: #5c5c5a; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.lines thead th { background: #f4f3ee; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #5c5c5a; padding: 8px; border-bottom: 1px solid #d1cfc6; }
  table.lines tbody td { padding: 8px; border-bottom: 1px solid #efece4; vertical-align: top; font-size: 10pt; }
  .col-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .line-description { font-size: 9pt; color: #8a8a85; margin-top: 2px; }
  .totals-wrapper { display: flex; gap: 24px; margin-top: 16px; align-items: flex-start; }
  .totals-wrapper > section { flex: 1; }
  table.totals, table.vat-table, table.payments-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  table.totals td, table.vat-table td, table.payments-table td { padding: 6px 8px; border-bottom: 1px solid #efece4; }
  table.totals tr.grand td { font-weight: 700; font-size: 11pt; border-top: 1px solid #1a1a1a; }
  table.totals tr.balance td { color: #b16f00; font-weight: 600; }
  .meta-block { margin-top: 18px; }
  .meta-label { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #8a8a85; margin: 0 0 4px 0; }
  .meta-small { font-size: 9pt; color: #5c5c5a; margin: 2px 0; }
  .notes { margin-top: 18px; }
  .legal { margin-top: 24px; font-size: 9pt; color: #8a8a85; border-top: 1px solid #efece4; padding-top: 8px; }
  .footer { margin-top: 32px; font-size: 8.5pt; color: #8a8a85; text-align: center; }
</style>
</head>
<body>
  <header class="header">
    ${partyBlock('Émetteur', invoice.issuerSnapshot)}
    <div class="doc-meta">
      <h1>${escapeHtml(docTypeLabel)}</h1>
      <p class="number">N° ${escapeHtml(invoice.number)}</p>
      <p>Émise le ${escapeHtml(formatDateIso(invoice.issuedAt))}</p>
      ${invoice.dueAt ? `<p>Échéance : ${escapeHtml(formatDateIso(invoice.dueAt))}</p>` : ''}
    </div>
  </header>

  <section class="parties">
    <div style="flex:1"></div>
    ${partyBlock('Adressée à', invoice.clientSnapshot, invoice.clientLabel)}
  </section>

  ${refsBlock}

  <table class="lines">
    <thead>
      <tr>
        <th>Date</th>
        <th>Prestation</th>
        <th class="col-num">Qté</th>
        <th class="col-num">PU HT</th>
        <th class="col-num">HT</th>
        <th class="col-num">TVA</th>
        <th class="col-num">TTC</th>
      </tr>
    </thead>
    <tbody>
      ${linesRows}
    </tbody>
  </table>

  <div class="totals-wrapper">
    <section>
      <p class="meta-label">Ventilation TVA</p>
      <table class="vat-table">
        ${vatRows || '<tr><td>—</td><td class="col-num">—</td></tr>'}
      </table>
    </section>
    <section>
      <p class="meta-label">Totaux</p>
      <table class="totals">
        <tr><td>Total HT</td><td class="col-num">${formatCents(sign * invoice.totalHtCents)}</td></tr>
        <tr><td>TVA</td><td class="col-num">${formatCents(sign * invoice.totalVatCents)}</td></tr>
        <tr class="grand"><td>Total TTC</td><td class="col-num">${formatCents(sign * invoice.totalTtcCents)}</td></tr>
        ${balanceBlock}
      </table>
      ${paymentTerms}
    </section>
  </div>

  ${paymentsBlock}
  ${notes}
  ${legalFooter}

  <p class="footer">${escapeHtml(docTypeLabel)} ${escapeHtml(invoice.number)} — ${escapeHtml(formatDateIso(invoice.issuedAt))}</p>
</body>
</html>`
}

export async function buildInvoiceHtmlFromDocx(docxPath: string, title: string): Promise<string> {
  const docxBuffer = await readFile(docxPath)
  const result = await mammoth.convertToHtml({ buffer: docxBuffer }, { styleMap: DOCX_STYLE_MAP })
  const body = result.value ?? ''
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 18pt; margin: 0 0 12px 0; }
  h2 { font-size: 14pt; margin: 16px 0 8px 0; }
  h3 { font-size: 12pt; margin: 12px 0 6px 0; }
  p { margin: 0 0 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #c8c8c0; padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  thead th { background: #f4f3ee; text-align: left; }
  ul, ol { margin: 6px 0 6px 24px; padding: 0; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>
${body}
</body>
</html>`
}
