/**
 * HTML builder for the bordereau de communication de pièces.
 *
 * Two variants sharing the same layout:
 *  - 'bordereau': the standalone document annexed to conclusions
 *    (CPC art. 768 / 954) — columns N° | Intitulé | Date.
 *  - 'bundle-index': the index pages opening the merged bundle — adds a
 *    Page column pointing into the bundle.
 *
 * Pieces not yet communicated (no communicatedAt) are rendered in bold,
 * matching the appellate practice of bolding newly communicated pièces.
 *
 * Pure (no electron import): rendered to PDF via the injected printHtmlToPdf.
 */
import type { EntityProfile, PieceGenerateHeader } from '@shared/types'

import { stampOwnerLines } from './stampRenderer'

export interface BordereauRow {
  pieceNumber: number
  title: string
  pieceDate?: string
  summary?: string
  /** True when the pièce has never appeared on a generated bordereau. */
  isNew: boolean
  /** 1-based page where the pièce starts in the bundle ('bundle-index' only). */
  pageStart?: number
  pageCount?: number
}

export interface BordereauHtmlOptions {
  variant: 'bordereau' | 'bundle-index'
  rows: BordereauRow[]
  profile: EntityProfile | null
  header?: PieceGenerateHeader
  dossierName: string
  /** ISO date (YYYY-MM-DD) used for "Fait à …, le …". */
  date: string
}

function escapeHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

export function buildBordereauHtml(options: BordereauHtmlOptions): string {
  const { variant, rows, profile, header, dossierName } = options
  const isBundleIndex = variant === 'bundle-index'
  const { name, subtitle } = stampOwnerLines(profile)

  const addressParts = [
    profile?.addressLine,
    profile?.addressLine2,
    [profile?.zipCode, profile?.city].filter(Boolean).join(' ')
  ]
    .map((part) => part?.trim())
    .filter(Boolean) as string[]

  const headerLines = [
    header?.juridiction ? `<p class="court">${escapeHtml(header.juridiction)}</p>` : '',
    header?.rg ? `<p class="court-meta">RG n° ${escapeHtml(header.rg)}</p>` : '',
    header?.parties ? `<p class="court-meta">${escapeHtml(header.parties)}</p>` : ''
  ]
    .filter(Boolean)
    .join('')

  const tableRows = rows
    .map((row) => {
      const summary = row.summary ? `<div class="row-summary">${escapeHtml(row.summary)}</div>` : ''
      const pageCell = isBundleIndex
        ? `<td class="col-num">${escapeHtml(row.pageStart ?? '')}</td>`
        : ''
      return `
        <tr${row.isNew ? ' class="new-piece"' : ''}>
          <td class="col-number">${escapeHtml(row.pieceNumber)}</td>
          <td class="col-title"><div>${escapeHtml(row.title)}</div>${summary}</td>
          <td class="col-date">${escapeHtml(formatDateIso(row.pieceDate))}</td>
          ${pageCell}
        </tr>
      `
    })
    .join('')

  const title = isBundleIndex ? 'PIÈCES COMMUNIQUÉES' : 'BORDEREAU DE COMMUNICATION DE PIÈCES'
  const placeLabel = header?.place?.trim() || profile?.city?.trim() || ''
  const madeAt = placeLabel
    ? `Fait à ${escapeHtml(placeLabel)}, le ${escapeHtml(formatDateIso(options.date))}`
    : `Le ${escapeHtml(formatDateIso(options.date))}`

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(dossierName)}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; font-size: 11pt; line-height: 1.45; }
  .lawyer { margin-bottom: 18px; }
  .lawyer-name { font-weight: 700; margin: 0; }
  .lawyer-meta { margin: 0; font-size: 9.5pt; color: #5c5c5a; }
  .court-block { text-align: right; margin-bottom: 8px; }
  .court { font-weight: 600; margin: 0 0 2px 0; text-transform: uppercase; }
  .court-meta { margin: 0; font-size: 10pt; color: #5c5c5a; }
  h1 { text-align: center; font-size: 14pt; letter-spacing: 0.08em; margin: 22px 0 4px 0; }
  .dossier-name { text-align: center; font-size: 10pt; color: #5c5c5a; margin: 0 0 18px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th { background: #f4f3ee; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.08em; color: #5c5c5a; padding: 7px 8px; border-bottom: 1px solid #d1cfc6; }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #efece4; vertical-align: top; font-size: 10pt; }
  .col-number { width: 44px; font-variant-numeric: tabular-nums; }
  .col-date { width: 120px; white-space: nowrap; }
  .col-num { width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
  .row-summary { font-size: 9pt; color: #8a8a85; margin-top: 2px; font-weight: 400; }
  tr.new-piece td { font-weight: 700; }
  tr.new-piece .row-summary { font-weight: 400; }
  .legend { font-size: 8.5pt; color: #8a8a85; margin-top: 8px; }
  .signature { margin-top: 36px; display: flex; justify-content: flex-end; }
  .signature-block { text-align: center; min-width: 200px; }
  .signature-block .made-at { margin: 0 0 48px 0; font-size: 10pt; }
  .signature-block .sign-name { margin: 0; font-weight: 600; font-size: 10pt; }
</style>
</head>
<body>
  <div class="court-block">${headerLines}</div>
  <div class="lawyer">
    <p class="lawyer-name">${escapeHtml(name)}</p>
    <p class="lawyer-meta">${escapeHtml(subtitle)}</p>
    ${addressParts.map((part) => `<p class="lawyer-meta">${escapeHtml(part)}</p>`).join('')}
  </div>

  <h1>${escapeHtml(title)}</h1>
  <p class="dossier-name">Dossier : ${escapeHtml(dossierName)}</p>

  <table>
    <thead>
      <tr>
        <th>N°</th>
        <th>Intitulé</th>
        <th>Date</th>
        ${isBundleIndex ? '<th class="col-num">Page</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  ${rows.some((row) => row.isNew) && rows.some((row) => !row.isNew) ? '<p class="legend">En gras : pièces nouvellement communiquées.</p>' : ''}

  <div class="signature">
    <div class="signature-block">
      <p class="made-at">${madeAt}</p>
      <p class="sign-name">${escapeHtml(name)}</p>
    </div>
  </div>
</body>
</html>`
}
