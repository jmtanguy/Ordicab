/**
 * Builders for Word tracked changes (`<w:ins>` insertion, `<w:del>` deletion).
 *
 * Approach: after parsing a DOCX and identifying paragraphs to edit,
 * build the revision XML elements (keeping insertion/deletion runs within
 * `<w:ins>`/`<w:del>` tags) and inject them via string replacement,
 * using the same pattern as docxLinesTable: find the target paragraph
 * via sentinel or index, replace its `<w:p>` with the revised version,
 * ensuring untouched paragraphs remain byte-identical.
 *
 * Revisions need unique w:id values (seeded above existing ids in the
 * document), w:author, and ISO 8601 w:date. Word displays them as
 * red/underlined (insertions) or struck-through (deletions) and permits
 * native accept/reject in the Revisions pane.
 */
import type PizZip from 'pizzip'

export interface RevisionMetadata {
  revId: number
  author: string
  dateIso: string // ISO 8601, e.g. "2026-07-05T10:00:00Z"
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Build a `<w:ins>` element wrapping the given text in a run.
 * Used for insertion-only paragraphs or newly added text within a replaced paragraph.
 */
export function buildInsertionXml(text: string, meta: RevisionMetadata): string {
  const safeText = escapeXml(text)
  return (
    `<w:ins w:id="${meta.revId}" w:author="${escapeXml(meta.author)}" w:date="${meta.dateIso}">` +
    `<w:r><w:t xml:space="preserve">${safeText}</w:t></w:r>` +
    `</w:ins>`
  )
}

/**
 * Build a `<w:ins>` element from pre-built run XML (rich manual edits: the
 * runs carry their own <w:rPr> formatting — bold, italic, underline).
 */
export function buildInsertionXmlFromRuns(runsXml: string, meta: RevisionMetadata): string {
  return (
    `<w:ins w:id="${meta.revId}" w:author="${escapeXml(meta.author)}" w:date="${meta.dateIso}">` +
    runsXml +
    `</w:ins>`
  )
}

/**
 * Build a `<w:del>` element wrapping the given text in a run with `<w:delText>`.
 * Used for deletion-only paragraphs or removed text within a replaced paragraph.
 */
export function buildDeletionXml(text: string, meta: RevisionMetadata): string {
  const safeText = escapeXml(text)
  return (
    `<w:del w:id="${meta.revId}" w:author="${escapeXml(meta.author)}" w:date="${meta.dateIso}">` +
    `<w:r><w:delText xml:space="preserve">${safeText}</w:delText></w:r>` +
    `</w:del>`
  )
}

/**
 * Build a complete `<w:p>` paragraph with insertion markup, copying the style
 * properties (`<w:pPr>`) from a neighbor paragraph to preserve formatting.
 */
export function buildInsertionParagraphXml(
  text: string,
  neighborPPrXml: string | undefined,
  meta: RevisionMetadata
): string {
  const pPr = neighborPPrXml ? `<w:pPr>${neighborPPrXml}</w:pPr>` : '<w:pPr></w:pPr>'
  const insXml = buildInsertionXml(text, meta)
  return `<w:p>${pPr}${insXml}</w:p>`
}

/**
 * Convert every text run to a deleted-text run.
 * `<w:t>` may appear with or without attributes — matching the literal
 * '<w:t ' only would convert the closing tags but not the attribute-less
 * openings, producing `<w:t>…</w:delText>` mismatches (invalid XML that
 * Word refuses to open).
 */
function convertRunsToDeleted(runsXml: string): string {
  return runsXml.replace(/<w:t(?=[\s>])/g, '<w:delText').replace(/<\/w:t>/g, '</w:delText>')
}

/**
 * Wrap run content in `<w:del>` elements, WITHOUT nesting existing `<w:del>`
 * blocks (second-round edits on an already-revised paragraph): those blocks
 * are kept as-is and only the segments between them are wrapped in new
 * deletion elements sharing the same revision id. The accept/reject regexes
 * operate per-id with the /g flag, so several `<w:del>` elements with one id
 * are handled naturally — whereas a nested `<w:del><w:del>` mis-pairs the
 * non-greedy closing match and corrupts the document on commit.
 */
function wrapSegmentsAsDeletion(runsXml: string, meta: RevisionMetadata): string {
  const openDel = `<w:del w:id="${meta.revId}" w:author="${escapeXml(meta.author)}" w:date="${meta.dateIso}">`
  return runsXml
    .split(/(<w:del\b[\s\S]*?<\/w:del>)/g)
    .map((segment) => {
      if (segment.startsWith('<w:del')) return segment
      if (!segment.trim()) return segment
      return `${openDel}${convertRunsToDeleted(segment)}</w:del>`
    })
    .join('')
}

/**
 * Wrap the runs (text content) of an existing `<w:p>` in deletion markup.
 */
export function wrapRunsAsDeletion(
  pPrXml: string,
  runsXml: string,
  meta: RevisionMetadata
): string {
  return `<w:p><w:pPr>${pPrXml}</w:pPr>${wrapSegmentsAsDeletion(runsXml, meta)}</w:p>`
}

/**
 * Build a paragraph where existing runs are wrapped in deletion and new text
 * is added in insertion. Used for "replace" operations.
 *
 * Format:
 *   <w:p>
 *     <w:pPr>…original paragraph properties…</w:pPr>
 *     <w:del id="X" author="…" date="…">
 *       <w:r>…original runs (with <w:delText> instead of <w:t>)…</w:r>
 *     </w:del>
 *     <w:ins id="Y" author="…" date="…">
 *       <w:r><w:t>…new text…</w:t></w:r>
 *     </w:ins>
 *   </w:p>
 */
export function buildReplaceParagraphXml(
  oldRunsXml: string,
  newText: string,
  pPrXml: string,
  oldMeta: RevisionMetadata,
  newMeta: RevisionMetadata,
  /** Pre-built formatted runs for the insertion (rich manual edits). */
  newRunsXml?: string
): string {
  const delXml = wrapSegmentsAsDeletion(oldRunsXml, oldMeta)
  const insXml = newRunsXml
    ? buildInsertionXmlFromRuns(newRunsXml, newMeta)
    : buildInsertionXml(newText, newMeta)

  return `<w:p><w:pPr>${pPrXml}</w:pPr>${delXml}${insXml}</w:p>`
}

/**
 * Scan the document and find the maximum w:id value currently in use,
 * so new revisions can be seeded with ids above this max.
 */
export function findMaxRevisionId(documentXml: string): number {
  // Match all w:id="<number>" in <w:ins> and <w:del> tags
  const idPattern = /w:id="(\d+)"/g
  let maxId = 0
  let match: RegExpExecArray | null

  while ((match = idPattern.exec(documentXml)) !== null) {
    const id = parseInt(match[1] ?? '0', 10)
    if (id > maxId) maxId = id
  }

  return maxId
}

/**
 * Parse a `<w:p>…</w:p>` paragraph element and extract:
 * - pPr: the `<w:pPr>…</w:pPr>` block (paragraph properties)
 * - runs: the concatenated `<w:r>…</w:r>` blocks (text content)
 *
 * Returns null if the element is malformed.
 */
export function parseParagraphXml(pXml: string): {
  pPrXml: string
  runsXml: string
} | null {
  // Extract <w:pPr>…</w:pPr>
  const pPrMatch = pXml.match(/<w:pPr[^>]*>([\s\S]*?)<\/w:pPr>/i)
  const pPrXml = pPrMatch?.[1] ?? '' // extract inner content

  // Extract everything after pPr as runs (until closing </w:p>)
  let runsXml = pXml
  if (pPrMatch) {
    const pPrEnd = pXml.indexOf(pPrMatch[0]) + pPrMatch[0].length
    runsXml = pXml.slice(pPrEnd)
  } else {
    runsXml = pXml.slice(pXml.indexOf('>') + 1) // skip <w:p …>
  }
  runsXml = runsXml.replace(/<\/w:p>$/, '') // remove closing </w:p>

  return { pPrXml, runsXml }
}

/**
 * Replace a paragraph in a document XML string using string substitution.
 * Locates the paragraph by exact match (oldPXml must be the full original).
 */
export function replaceParagraphInXml(
  documentXml: string,
  oldPXml: string,
  newPXml: string
): string {
  const idx = documentXml.indexOf(oldPXml)
  if (idx < 0) {
    // Paragraph not found; might be due to whitespace or encoding differences
    return documentXml
  }
  return documentXml.slice(0, idx) + newPXml + documentXml.slice(idx + oldPXml.length)
}

/**
 * Update the document.xml in a PizZip with a modified version.
 * Also updates headers and footers if present.
 */
export function updateDocumentXmlInZip(zip: PizZip, updatedDocumentXml: string): void {
  const entry = zip.file('word/document.xml')
  if (entry) {
    zip.file('word/document.xml', updatedDocumentXml)
  }
}
