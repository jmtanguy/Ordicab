/**
 * AI-driven augmentation of Word documents with tracked changes.
 *
 * Pipeline:
 * 1. Load a .docx (buffer or file) via PizZip
 * 2. Parse word/document.xml to extract paragraphs (top-level body only,
 *    excluding those nested in tables/sdt) with their source offsets
 * 3. Extract indexed text for the AI to reason about
 * 4. Apply operations (insert/replace/delete) as tracked changes (<w:ins>/<w:del>)
 *    by splicing the revised XML at the recorded byte offsets, keeping
 *    untouched paragraphs byte-identical
 * 5. Apply accept/reject decisions per revision id (flatten or restore)
 *
 * Session/journal orchestration lives in redactionSessionService; this module
 * only holds the pure docx transformations.
 */

import { readFile } from 'node:fs/promises'
import PizZip from 'pizzip'
import { computeDiff } from './compare/diffEngine'
import type { DiffBlock } from '@shared/domain/compare'
import {
  buildInsertionParagraphXml,
  buildInsertionXmlFromRuns,
  buildReplaceParagraphXml,
  findMaxRevisionId,
  parseParagraphXml,
  updateDocumentXmlInZip,
  wrapRunsAsDeletion
} from './docxRevisions'

// ============================================================================
// Types
// ============================================================================

export interface AugmentParagraph {
  index: number
  text: string
  /** Source byte offsets in word/document.xml */
  sourceStart: number
  sourceEnd: number
  rawXml: string
  pPrXml: string
}

export type OperationType = 'insert_after' | 'insert_before' | 'replace' | 'delete'

export interface AugmentOperation {
  id: string
  op: OperationType
  /** For insert_after/insert_before/replace */
  anchorIndex?: number
  /** For replace/delete */
  index?: number
  /** New text (for insert/replace) */
  text?: string
  /**
   * Optional rich content for insert/replace (manual edits): a minimal HTML
   * subset (strong/b, em/i, u) converted to formatted runs. Takes precedence
   * over `text` for the inserted content.
   */
  html?: string
  /** Rationale for the AI's action */
  rationale?: string
  /** Legal references (Légifrance ids, etc.) */
  legalRefs?: string[]
}

export interface ApplyOperationsResult {
  trackedDocumentXml: string
  /** Full .docx with all revisions applied, as a buffer. */
  docxBuffer: Uint8Array
  /** operation.id → w:id values assigned in revisions */
  opRevisionIds: Map<string, number[]>
  diffBlocks: DiffBlock[]
}

// ============================================================================
// Paragraph Parsing: Tokenized depth-aware scan
// ============================================================================

/**
 * Parse word/document.xml to extract top-level body `<w:p>` paragraphs
 * with their source offsets. This avoids DOM re-serialization that would
 * break byte-identity and preserves the exact XML structure.
 *
 * Algorithm: scan for `<w:p` at depth 0 (outside tables/sdt), record
 * offsets, extract text from each run's `<w:t>`.
 */
export function parseTopLevelParagraphs(documentXml: string): AugmentParagraph[] {
  const paragraphs: AugmentParagraph[] = []
  let depth = 0
  let pos = 0
  const len = documentXml.length

  while (pos < len) {
    const openTag = documentXml.indexOf('<', pos)
    if (openTag === -1) break

    const closeTag = documentXml.indexOf('>', openTag)
    if (closeTag === -1) break

    const tagContent = documentXml.slice(openTag + 1, closeTag)
    const isSelfClosing = tagContent.endsWith('/')
    const isClosing = tagContent.startsWith('/')
    // Strip the leading '/' of closing tags BEFORE splitting: '/w:tbl' would
    // otherwise yield an empty tag name and the depth would never decrement,
    // hiding every paragraph located after the first table of the document.
    const tagName = (isClosing ? tagContent.slice(1) : tagContent).split(/[\s>/]/)[0] ?? ''

    // Track depth for table and sdt
    if (tagName === 'w:tbl' || tagName === 'w:sdt') {
      if (!isClosing) depth++
      else depth = Math.max(0, depth - 1)
    }

    // At depth 0, capture <w:p>…</w:p>
    if (tagName === 'w:p' && depth === 0) {
      if (!isClosing && !isSelfClosing) {
        const sourceStart = openTag
        // Find matching closing tag
        const closePattern = /<\/w:p\s*>/
        const remaining = documentXml.slice(closeTag + 1)
        const closeMatch = closePattern.exec(remaining)

        if (closeMatch) {
          const sourceEnd = closeTag + 1 + closeMatch.index + closeMatch[0].length
          const rawXml = documentXml.slice(sourceStart, sourceEnd)
          const pPrXml = extractPPrXml(rawXml)
          const text = extractTextFromParagraph(rawXml)

          paragraphs.push({
            index: paragraphs.length,
            text,
            sourceStart,
            sourceEnd,
            rawXml,
            pPrXml
          })

          pos = sourceEnd
          continue
        }
      }
    }

    pos = closeTag + 1
  }

  return paragraphs
}

function extractPPrXml(pXml: string): string {
  const match = pXml.match(/<w:pPr[^>]*>([\s\S]*?)<\/w:pPr>/i)
  return match?.[1] ?? '' // extract inner content
}

/**
 * Decode the XML character entities of `<w:t>` content back to plain text.
 * The document stores `'` as `&apos;`, `&` as `&amp;`, etc. — without this,
 * the diff/outline/editor (and the text the model reads) show raw entities,
 * and re-saving an edited paragraph would double-escape them.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/**
 * Matches a NON-self-closing `<w:t>` opening tag (with or without attributes)
 * and captures its content. `<w:t[^>]*>` is not enough: it also matches the
 * self-closing `<w:t/>` / `<w:t xml:space="preserve"/>` that Word leaves in
 * empty runs — and then lazily captures the inter-run XML up to the NEXT
 * run's `</w:t>`, leaking raw OOXML (`</w:r><w:proofErr…`) into the extracted
 * text. It would even match `<w:tab/>` or `<w:tcPr>`.
 */
const W_T_CONTENT_PATTERN = /<w:t(?:\s[^>]*[^/>])?>([\s\S]*?)<\/w:t>/g

function extractTextFromParagraph(pXml: string): string {
  // Extract all <w:t>…</w:t> content
  const textPattern = new RegExp(W_T_CONTENT_PATTERN.source, W_T_CONTENT_PATTERN.flags)
  let text = ''
  let match: RegExpExecArray | null

  while ((match = textPattern.exec(pXml)) !== null) {
    text += match[1]
  }

  return decodeXmlEntities(text)
}

// ============================================================================
// Rich-text bridge: OOXML runs ↔ minimal HTML (strong/em/u)
// ============================================================================

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Tri-state run-property flag: true (present), false (explicitly disabled
 * with w:val="0|false|none"), undefined (absent — inherit from the paragraph).
 */
function rPrFlagState(rPrXml: string, tag: 'b' | 'i' | 'u'): boolean | undefined {
  const match = rPrXml.match(new RegExp(`<w:${tag}(?:\\s([^>]*))?/?>`))
  if (!match) return undefined
  const attrs = match[1] ?? ''
  if (/w:val="(?:0|false|none)"/.test(attrs)) return false
  return true
}

/** Word's built-in heading/title styles render bold even without run-level <w:b/>. */
const BOLD_PARAGRAPH_STYLE =
  /<w:pStyle w:val="(?:Heading[1-9]|Titre[1-9]?|Title|Sous-titre|Subtitle)"/i

/**
 * Convert a paragraph's runs to a minimal HTML string (bold/italic/underline)
 * for the rich paragraph editor. Uses the "accepted" view: pending insertions
 * are included, deleted content (<w:del>) is skipped.
 *
 * Formatting resolution mirrors Word's inheritance for the common cases:
 * run-level <w:rPr> wins; otherwise the paragraph-mark run properties
 * (<w:pPr><w:rPr>…) apply; heading/title paragraph styles imply bold.
 */
export function paragraphRunsToHtml(paragraphXml: string): string {
  const withoutDeletions = paragraphXml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')

  // Paragraph-level defaults: pPr run properties + bold-by-style headings
  const pPrXml = withoutDeletions.match(/<w:pPr[^>]*>([\s\S]*?)<\/w:pPr>/)?.[0] ?? ''
  const paraRPr = pPrXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? ''
  const paraBold = rPrFlagState(paraRPr, 'b') ?? BOLD_PARAGRAPH_STYLE.test(pPrXml)
  const paraItalic = rPrFlagState(paraRPr, 'i') ?? false
  const paraUnderline = rPrFlagState(paraRPr, 'u') ?? false

  const runsOnly = withoutDeletions.replace(/<w:pPr[^>]*>[\s\S]*?<\/w:pPr>/, '')
  const runPattern = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g
  let html = ''
  let match: RegExpExecArray | null

  while ((match = runPattern.exec(runsOnly)) !== null) {
    const runXml = match[1] ?? ''
    const rPr = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? ''
    let text = ''
    const tPattern = new RegExp(W_T_CONTENT_PATTERN.source, W_T_CONTENT_PATTERN.flags)
    let tMatch: RegExpExecArray | null
    while ((tMatch = tPattern.exec(runXml)) !== null) {
      text += tMatch[1]
    }
    if (!text) continue

    let piece = escapeHtmlText(decodeXmlEntities(text))
    if (rPrFlagState(rPr, 'u') ?? paraUnderline) piece = `<u>${piece}</u>`
    if (rPrFlagState(rPr, 'i') ?? paraItalic) piece = `<em>${piece}</em>`
    if (rPrFlagState(rPr, 'b') ?? paraBold) piece = `<strong>${piece}</strong>`
    html += piece
  }

  return html
}

/**
 * Convert a minimal HTML subset (strong/b, em/i, u — everything else is
 * unwrapped) into formatted OOXML runs. Never throws: unknown tags are
 * ignored, text is always preserved.
 */
export function htmlToRunsXml(html: string): string {
  const tokens = html.split(/(<[^>]+>)/)
  let bold = 0
  let italic = 0
  let underline = 0
  let runs = ''

  const decodeHtmlEntities = (value: string): string =>
    value
      .replaceAll('&nbsp;', ' ')
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&')

  for (const token of tokens) {
    if (!token) continue
    if (token.startsWith('<')) {
      const closing = token.startsWith('</')
      const name = token.replace(/^<\/?\s*([a-zA-Z0-9]+)[\s\S]*$/, '$1').toLowerCase()
      const delta = closing ? -1 : 1
      if (name === 'br' && !closing) {
        // TipTap uses <br> for Shift+Enter. Preserve it as a hard Word line
        // break rather than silently concatenating the adjacent text runs.
        runs += '<w:r><w:br/></w:r>'
      } else if (name === 'strong' || name === 'b') bold = Math.max(0, bold + delta)
      else if (name === 'em' || name === 'i') italic = Math.max(0, italic + delta)
      else if (name === 'u') underline = Math.max(0, underline + delta)
      continue
    }

    const text = decodeHtmlEntities(token)
    if (!text) continue
    const rPrParts =
      `${bold > 0 ? '<w:b/>' : ''}${italic > 0 ? '<w:i/>' : ''}` +
      `${underline > 0 ? '<w:u w:val="single"/>' : ''}`
    const rPr = rPrParts ? `<w:rPr>${rPrParts}</w:rPr>` : ''
    runs += `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`
  }

  return runs || '<w:r><w:t xml:space="preserve"></w:t></w:r>'
}

// ============================================================================
// Zip helpers
// ============================================================================

export function readDocumentXml(content: Uint8Array): string {
  const zip = new PizZip(content)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('No word/document.xml found')
  return entry.asText()
}

/** Rebuild a .docx buffer from an original zip plus a modified document.xml. */
export function rebuildDocxWithDocumentXml(content: Uint8Array, documentXml: string): Uint8Array {
  const zip = new PizZip(content)
  updateDocumentXmlInZip(zip, documentXml)
  return zip.generate({
    type: 'nodebuffer' as const,
    compression: 'DEFLATE' as const
  }) as Uint8Array
}

// ============================================================================
// Public Service Functions
// ============================================================================

/**
 * Extract indexed paragraphs from a .docx buffer for AI reasoning.
 */
export function extractIndexedTextFromContent(content: Uint8Array): {
  paragraphs: AugmentParagraph[]
  previewText: string
} {
  const documentXml = readDocumentXml(content)
  const paragraphs = parseTopLevelParagraphs(documentXml)
  const previewText = paragraphs.map((p) => `[${p.index}] ${p.text}`).join('\n\n')
  return { paragraphs, previewText }
}

/**
 * Load a .docx file and extract indexed paragraphs for AI reasoning.
 */
export async function extractIndexedText(
  docxPath: string
): Promise<{ paragraphs: AugmentParagraph[]; previewText: string }> {
  const content = await readFile(docxPath)

  try {
    return extractIndexedTextFromContent(content)
  } catch (error) {
    throw new Error(
      `Failed to extract indexed text from ${docxPath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Apply all operations to a .docx buffer as tracked changes.
 * Returns the modified document XML, the revised .docx buffer, and diff blocks.
 *
 * Each operation is marked with unique revision IDs (seeded above the
 * document's existing max id). Insertions are wrapped in <w:ins>,
 * deletions in <w:del>.
 *
 * Operations are applied in descending target order against the offsets of
 * the initial parse, so at most ONE replace/delete per paragraph per batch
 * is supported (redactionSessionService enforces this).
 */
export function applyOperationsToContent(
  content: Uint8Array,
  operations: AugmentOperation[],
  meta: { author: string; dateIso: string }
): ApplyOperationsResult {
  let documentXml = readDocumentXml(content)
  const paragraphs = parseTopLevelParagraphs(documentXml)
  const opRevisionIds = new Map<string, number[]>()

  // Seed revision IDs above the existing max
  let nextRevId = findMaxRevisionId(documentXml) + 1

  // Apply operations in reverse target order to preserve source offsets.
  // Tie-breaker: for EQUAL targets (several insert_after on the same anchor,
  // e.g. a whole letter appended paragraph by paragraph), apply the LAST
  // submitted operation first — successive splices at the same offset stack
  // backwards, so this keeps the submitted reading order in the document.
  const sortedOps = operations
    .map((op, submittedIndex) => ({ op, submittedIndex }))
    .sort((a, b) => {
      const byTarget = (b.op.index ?? b.op.anchorIndex ?? 0) - (a.op.index ?? a.op.anchorIndex ?? 0)
      return byTarget !== 0 ? byTarget : b.submittedIndex - a.submittedIndex
    })
    .map((entry) => entry.op)

  for (const op of sortedOps) {
    const revIds: number[] = []

    if (op.op === 'insert_after' || op.op === 'insert_before') {
      const anchorIndex = op.anchorIndex ?? 0
      const neighborPara = paragraphs[anchorIndex]
      if (!neighborPara) continue

      const revisionMeta = { revId: nextRevId, author: meta.author, dateIso: meta.dateIso }
      const newPXml =
        op.html !== undefined
          ? `<w:p><w:pPr>${neighborPara.pPrXml}</w:pPr>${buildInsertionXmlFromRuns(htmlToRunsXml(op.html), revisionMeta)}</w:p>`
          : buildInsertionParagraphXml(op.text ?? '', neighborPara.pPrXml, revisionMeta)

      const insertPos = op.op === 'insert_after' ? neighborPara.sourceEnd : neighborPara.sourceStart

      documentXml = documentXml.slice(0, insertPos) + newPXml + documentXml.slice(insertPos)

      revIds.push(nextRevId)
      nextRevId++
    } else if (op.op === 'replace') {
      const index = op.index ?? 0
      const para = paragraphs[index]
      if (!para) continue

      const parsed = parseParagraphXml(para.rawXml)
      if (!parsed) continue

      const newPXml = buildReplaceParagraphXml(
        parsed.runsXml,
        op.text ?? '',
        parsed.pPrXml,
        { revId: nextRevId, author: meta.author, dateIso: meta.dateIso },
        { revId: nextRevId + 1, author: meta.author, dateIso: meta.dateIso },
        op.html !== undefined ? htmlToRunsXml(op.html) : undefined
      )

      documentXml =
        documentXml.slice(0, para.sourceStart) + newPXml + documentXml.slice(para.sourceEnd)
      revIds.push(nextRevId, nextRevId + 1)
      nextRevId += 2
    } else if (op.op === 'delete') {
      const index = op.index ?? 0
      const para = paragraphs[index]
      if (!para) continue

      const parsed = parseParagraphXml(para.rawXml)
      if (!parsed) continue

      const newPXml = wrapRunsAsDeletion(parsed.pPrXml, parsed.runsXml, {
        revId: nextRevId,
        author: meta.author,
        dateIso: meta.dateIso
      })

      documentXml =
        documentXml.slice(0, para.sourceStart) + newPXml + documentXml.slice(para.sourceEnd)
      revIds.push(nextRevId)
      nextRevId++
    }

    opRevisionIds.set(op.id, revIds)
  }

  const docxBuffer = rebuildDocxWithDocumentXml(content, documentXml)

  // Compute diff between original and augmented text
  const originalText = paragraphs.map((p) => p.text).join('\n\n')
  const augmentedText = extractTextFromTrackedXml(documentXml)
  const { blocks: diffBlocks } = computeDiff(originalText, augmentedText)

  return {
    trackedDocumentXml: documentXml,
    docxBuffer,
    opRevisionIds,
    diffBlocks
  }
}

/**
 * Apply all operations to a .docx file as tracked changes.
 */
export async function applyOperations(
  docxPath: string,
  operations: AugmentOperation[],
  meta: { author: string; dateIso: string }
): Promise<ApplyOperationsResult> {
  const content = await readFile(docxPath)
  return applyOperationsToContent(content, operations, meta)
}

/**
 * Extract plain text from tracked-change XML.
 * Insertions count as content; deleted text (<w:delText>) is ignored so the
 * extracted text reflects the document as if all revisions were accepted.
 */
export function extractTextFromTrackedXml(documentXml: string): string {
  // Remove all <w:ins> wrappers but keep their content
  const withoutIns = documentXml.replaceAll(/<w:ins[^>]*>/g, '').replaceAll(/<\/w:ins>/g, '')

  const tPattern = new RegExp(W_T_CONTENT_PATTERN.source, W_T_CONTENT_PATTERN.flags)
  let extracted = ''
  let match: RegExpExecArray | null

  while ((match = tPattern.exec(withoutIns)) !== null) {
    extracted += match[1]
  }

  return decodeXmlEntities(extracted)
}

/**
 * Apply an accept/reject decision to the revisions of one operation
 * (identified by its w:id values) inside a tracked document XML.
 */
export function applyRevisionDecision(
  documentXml: string,
  revIds: number[],
  decision: 'accept' | 'reject'
): string {
  let result = documentXml
  for (const revId of revIds) {
    result = decision === 'accept' ? flattenRevision(result, revId) : rejectRevision(result, revId)
  }
  return result
}

/**
 * Flatten a revision: remove <w:ins> tags and keep content, remove <w:del> content entirely.
 */
export function flattenRevision(documentXml: string, revId: number): string {
  let result = documentXml

  // Remove <w:ins>…</w:ins> tags but keep content
  const insPattern = new RegExp(`<w:ins\\s+[^>]*w:id="${revId}"[^>]*>(.*?)</w:ins>`, 'gs')
  result = result.replace(insPattern, '$1')

  // Remove <w:del>…</w:del> and their content entirely
  const delPattern = new RegExp(`<w:del\\s+[^>]*w:id="${revId}"[^>]*>.*?</w:del>`, 'gs')
  result = result.replace(delPattern, '')

  return result
}

/**
 * Reject a revision: remove <w:ins> content entirely, unwrap <w:del> (restore original).
 */
export function rejectRevision(documentXml: string, revId: number): string {
  let result = documentXml

  // Remove <w:ins>…</w:ins> and their content entirely
  const insPattern = new RegExp(`<w:ins\\s+[^>]*w:id="${revId}"[^>]*>.*?</w:ins>`, 'gs')
  result = result.replace(insPattern, '')

  // Unwrap <w:del>: convert <w:delText> back to <w:t>
  const delPattern = new RegExp(`<w:del\\s+[^>]*w:id="${revId}"[^>]*>(.*?)</w:del>`, 'gs')
  result = result.replace(delPattern, (_match, content: string) => {
    // Convert <w:delText> back to <w:t> within the content
    return content.replaceAll('<w:delText', '<w:t').replaceAll('</w:delText>', '</w:t>')
  })

  return result
}
