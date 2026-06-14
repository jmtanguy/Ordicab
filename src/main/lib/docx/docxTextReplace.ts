/**
 * Replaces literal text occurrences inside a .docx with `{{tag}}` tokens, for
 * the AI tagification of imported Word letters.
 *
 * Word splits runs arbitrarily, so a target string may span several `<w:t>`
 * nodes. Within each paragraph we concatenate the decoded text of all `<w:t>`
 * nodes, locate the occurrence, write the whole `{{tag}}` token into the node
 * where the match starts (keeping that run's formatting) and excise the
 * remaining matched characters from the following nodes. Because the token is
 * authored in a single run, docxtemplater parses it without the split-run
 * heuristics needed for Word-authored tags.
 *
 * Matches spanning a paragraph boundary are reported as failed — names, dates
 * and references almost never cross paragraphs.
 */

import PizZip from 'pizzip'

export interface DocxTagReplacement {
  originalText: string
  tagPath: string
}

export interface DocxTextReplaceResult {
  buffer: Buffer
  applied: Array<{ originalText: string; tagPath: string; occurrences: number }>
  failed: Array<{ originalText: string; reason: 'not-found' | 'empty-target' }>
}

const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
const TEXT_NODE_PATTERN = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function encodeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ensurePreserveSpace(openingTag: string, text: string): string {
  if (!/^\s|\s$/.test(text)) return openingTag
  if (openingTag.includes('xml:space')) return openingTag
  return openingTag.replace(/<w:t/, '<w:t xml:space="preserve"')
}

/**
 * Replaces the first occurrence of `originalText` in the paragraph with the
 * tag token. Returns the updated paragraph XML, or null when not found.
 */
function replaceOnceInParagraph(
  paragraphXml: string,
  originalText: string,
  tagToken: string
): string | null {
  const nodes: Array<{ opening: string; text: string; closing: string; start: number }> = []
  let cursor = 0
  const pattern = new RegExp(TEXT_NODE_PATTERN.source, TEXT_NODE_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(paragraphXml)) !== null) {
    const decoded = decodeXmlText(match[2] as string)
    nodes.push({
      opening: match[1] as string,
      text: decoded,
      closing: match[3] as string,
      start: cursor
    })
    cursor += decoded.length
  }

  const fullText = nodes.map((node) => node.text).join('')

  // Skip occurrences inside an already-inserted {{…}} token (e.g. when the
  // original text is a substring of the tag path itself).
  const isInsideTagToken = (index: number): boolean => {
    const open = fullText.lastIndexOf('{{', index)
    if (open < 0) return false
    const close = fullText.indexOf('}}', open)
    return close >= 0 && index < close + 2
  }

  let matchStart = fullText.indexOf(originalText)
  while (matchStart >= 0 && isInsideTagToken(matchStart)) {
    matchStart = fullText.indexOf(originalText, matchStart + 1)
  }
  if (matchStart < 0) return null
  const matchEnd = matchStart + originalText.length

  const nextTexts = nodes.map((node) => {
    const nodeStart = node.start
    const nodeEnd = node.start + node.text.length
    const overlapStart = Math.max(matchStart, nodeStart)
    const overlapEnd = Math.min(matchEnd, nodeEnd)
    if (overlapStart >= overlapEnd) return node.text

    const before = node.text.slice(0, overlapStart - nodeStart)
    const after = node.text.slice(overlapEnd - nodeStart)
    const insert = overlapStart === matchStart ? tagToken : ''
    return before + insert + after
  })

  let nodeIndex = 0
  return paragraphXml.replace(
    new RegExp(TEXT_NODE_PATTERN.source, TEXT_NODE_PATTERN.flags),
    (_full, opening: string, _content: string, closing: string) => {
      const nextText = nextTexts[nodeIndex] ?? ''
      nodeIndex += 1
      return `${ensurePreserveSpace(opening, nextText)}${encodeXmlText(nextText)}${closing}`
    }
  )
}

export function replaceTextWithTags(
  docxBuffer: Buffer,
  replacements: DocxTagReplacement[]
): DocxTextReplaceResult {
  const zip = new PizZip(docxBuffer)
  const documentEntry = zip.file('word/document.xml')
  if (!documentEntry) {
    throw new Error('word/document.xml not found in the .docx archive.')
  }

  let xml = documentEntry.asText()
  const applied: DocxTextReplaceResult['applied'] = []
  const failed: DocxTextReplaceResult['failed'] = []

  for (const replacement of replacements) {
    const originalText = replacement.originalText
    if (!originalText.trim()) {
      failed.push({ originalText, reason: 'empty-target' })
      continue
    }

    const tagToken = `{{${replacement.tagPath}}}`
    let occurrences = 0

    xml = xml.replace(
      new RegExp(PARAGRAPH_PATTERN.source, PARAGRAPH_PATTERN.flags),
      (paragraph) => {
        let current = paragraph
        // Guard against pathological loops (e.g. originalText contained in tagToken)
        for (let i = 0; i < 50; i += 1) {
          const next = replaceOnceInParagraph(current, originalText, tagToken)
          if (next === null) break
          current = next
          occurrences += 1
        }
        return current
      }
    )

    if (occurrences > 0) {
      applied.push({ originalText, tagPath: replacement.tagPath, occurrences })
    } else {
      failed.push({ originalText, reason: 'not-found' })
    }
  }

  zip.file('word/document.xml', xml)
  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer

  return { buffer, applied, failed }
}
