/**
 * Native Word table for `{{invoice.linesTable}}` (and FR alias).
 *
 * Approach: during tag resolution, `{{invoice.linesTable}}` resolves to a unique
 * sentinel string that lands inside a single `<w:r>` (text run) created by
 * docxtemplater. After `doc.render()` we scan word/document.xml + headers/footers,
 * find the enclosing `<w:p>` paragraph containing the sentinel, and replace that
 * paragraph with a `<w:tbl>` element — which is OOXML-valid since `<w:tbl>` is a
 * sibling of `<w:p>` inside `<w:body>` / `<w:hdr>` / `<w:ftr>`.
 *
 * If the template doesn't contain the tag, no sentinel exists in the XML, the
 * regex finds nothing, and the function is a no-op.
 */
import type PizZip from 'pizzip'

export const INVOICE_LINES_TABLE_SENTINEL = '__ORDICAB_INVOICE_LINES_TABLE_SENTINEL__'

export interface InvoiceLinesTableHeaders {
  date: string
  label: string
  quantity: string
  unitPriceHt: string
  totalHt: string
  totalTtc: string
}

export const DEFAULT_INVOICE_LINES_TABLE_HEADERS_FR: InvoiceLinesTableHeaders = {
  date: 'Date',
  label: 'Libellé',
  quantity: 'Quantité',
  unitPriceHt: 'Prix unitaire HT',
  totalHt: 'Total HT',
  totalTtc: 'Total TTC'
}

export interface InvoiceLinesTableRow {
  date: string
  label: string
  quantity: string
  unitPriceHt: string
  totalHt: string
  totalTtc: string
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildCellXml(
  text: string,
  opts: { header?: boolean; align?: 'left' | 'right' } = {}
): string {
  const align = opts.align ?? 'left'
  const jc = align === 'right' ? '<w:jc w:val="right"/>' : ''
  const runProps = opts.header ? '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' : ''
  const shading = opts.header ? '<w:shd w:val="clear" w:color="auto" w:fill="333333"/>' : ''
  // Preserve spaces in the cell text and split on newlines into separate runs.
  const safeText = escapeXml(text)
  const paragraphs = safeText
    .split(/\r?\n/)
    .map(
      (line) =>
        `<w:p><w:pPr>${jc}<w:spacing w:after="0"/></w:pPr><w:r>${runProps}<w:t xml:space="preserve">${line}</w:t></w:r></w:p>`
    )
  return `<w:tc><w:tcPr>${shading}</w:tcPr>${paragraphs.join('')}</w:tc>`
}

function buildRowXml(row: InvoiceLinesTableRow, header = false): string {
  return [
    '<w:tr>',
    buildCellXml(row.date, { header }),
    buildCellXml(row.label, { header }),
    buildCellXml(row.quantity, { header, align: 'right' }),
    buildCellXml(row.unitPriceHt, { header, align: 'right' }),
    buildCellXml(row.totalHt, { header, align: 'right' }),
    buildCellXml(row.totalTtc, { header, align: 'right' }),
    '</w:tr>'
  ].join('')
}

export function buildInvoiceLinesTableXml(
  rows: InvoiceLinesTableRow[],
  headers: InvoiceLinesTableHeaders
): string {
  const tableProps =
    '<w:tblPr>' +
    '<w:tblW w:w="5000" w:type="pct"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:color="auto"/>' +
    '<w:left w:val="single" w:sz="4" w:color="auto"/>' +
    '<w:bottom w:val="single" w:sz="4" w:color="auto"/>' +
    '<w:right w:val="single" w:sz="4" w:color="auto"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="auto"/>' +
    '<w:insideV w:val="single" w:sz="4" w:color="auto"/>' +
    '</w:tblBorders>' +
    '</w:tblPr>'

  const grid =
    '<w:tblGrid>' +
    '<w:gridCol w:w="1400"/>' +
    '<w:gridCol w:w="3200"/>' +
    '<w:gridCol w:w="900"/>' +
    '<w:gridCol w:w="1500"/>' +
    '<w:gridCol w:w="1500"/>' +
    '<w:gridCol w:w="1500"/>' +
    '</w:tblGrid>'

  const headerRow: InvoiceLinesTableRow = {
    date: headers.date,
    label: headers.label,
    quantity: headers.quantity,
    unitPriceHt: headers.unitPriceHt,
    totalHt: headers.totalHt,
    totalTtc: headers.totalTtc
  }

  const body = [buildRowXml(headerRow, true), ...rows.map((row) => buildRowXml(row))].join('')

  return `<w:tbl>${tableProps}${grid}${body}</w:tbl>`
}

/**
 * Walks the document parts (main body + headers + footers) of a docxtemplater zip,
 * finds any `<w:p>` paragraph containing the sentinel and replaces it with the
 * table XML. Idempotent and a no-op if the sentinel is absent.
 */
export function replaceInvoiceLinesTableSentinel(zip: PizZip, tableXml: string): void {
  // Iterate over candidate XML parts: document, headers, footers.
  const candidatePattern = /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml)$/
  const paragraphPattern = new RegExp(
    `<w:p\\b(?:[^>]*)>(?:(?!</w:p>).)*?${INVOICE_LINES_TABLE_SENTINEL}(?:(?!</w:p>).)*?</w:p>`,
    'gs'
  )

  // PizZip exposes `.files` as a record of filename → file entry. Iterate it.
  const files = (zip as unknown as { files: Record<string, { name: string }> }).files
  for (const fileName of Object.keys(files)) {
    if (!candidatePattern.test(fileName)) continue
    const entry = zip.file(fileName)
    if (!entry) continue
    const original = entry.asText()
    if (!original.includes(INVOICE_LINES_TABLE_SENTINEL)) continue
    const replaced = original.replace(paragraphPattern, tableXml)
    if (replaced !== original) {
      zip.file(fileName, replaced)
    }
  }
}
