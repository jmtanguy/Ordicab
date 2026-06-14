/**
 * Replaces literal text occurrences in template HTML with smart-tag spans —
 * the text-template counterpart of main/lib/docx/docxTextReplace.ts, used by
 * the AI tagification of imported letters.
 *
 * The HTML is tokenized into markup and text tokens; matches may span inline
 * markup (e.g. a name partly bolded) but never cross block boundaries
 * (</p>, </li>, headings, <br>). Existing smart-tag spans are opaque.
 */

import { TAG_SPAN_PATTERN, renderSmartTagSpan } from './html'

export interface HtmlTagReplacement {
  originalText: string
  tagPath: string
}

export interface HtmlTextReplaceResult {
  html: string
  applied: Array<{ originalText: string; tagPath: string; occurrences: number }>
  failed: Array<{ originalText: string; reason: 'not-found' | 'empty-target' }>
}

type Token =
  | { kind: 'markup'; raw: string; isBlockBoundary: boolean }
  | { kind: 'text'; raw: string; decoded: string }

const BLOCK_BOUNDARY_PATTERN = /^<\/?(p|li|ul|ol|h[1-6]|div|table|tr|td|th|blockquote|br)\b/i

function decodeHtmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function encodeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\u00a0/g, '&nbsp;')
}

function tokenizeHtml(html: string): Token[] {
  const tokens: Token[] = []
  // Smart-tag spans first (opaque markup), then any other tag, then text runs.
  const pattern = new RegExp(`${TAG_SPAN_PATTERN.source}|<[^>]+>`, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const raw = html.slice(lastIndex, match.index)
      tokens.push({ kind: 'text', raw, decoded: decodeHtmlText(raw) })
    }
    const raw = match[0]
    tokens.push({
      kind: 'markup',
      raw,
      // Smart-tag spans are inline but opaque — treat them as boundaries so a
      // match can never extend across an existing tag chip.
      isBlockBoundary: BLOCK_BOUNDARY_PATTERN.test(raw) || raw.includes('data-template-tag-path')
    })
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < html.length) {
    const raw = html.slice(lastIndex)
    tokens.push({ kind: 'text', raw, decoded: decodeHtmlText(raw) })
  }
  return tokens
}

/** Replaces the first eligible occurrence; returns null when not found. */
function replaceOnceInTokens(tokens: Token[], originalText: string, spanHtml: string): boolean {
  // Build contiguous segments of text tokens between block boundaries.
  let segment: Array<{ tokenIndex: number; start: number; decoded: string }> = []
  let segmentTextLength = 0

  const tryReplaceInSegment = (): boolean => {
    if (segment.length === 0) return false
    const fullText = segment.map((piece) => piece.decoded).join('')
    const matchStart = fullText.indexOf(originalText)
    if (matchStart < 0) return false
    const matchEnd = matchStart + originalText.length

    for (const piece of segment) {
      const pieceStart = piece.start
      const pieceEnd = piece.start + piece.decoded.length
      const overlapStart = Math.max(matchStart, pieceStart)
      const overlapEnd = Math.min(matchEnd, pieceEnd)
      if (overlapStart >= overlapEnd) continue

      const before = piece.decoded.slice(0, overlapStart - pieceStart)
      const after = piece.decoded.slice(overlapEnd - pieceStart)
      const insert = overlapStart === matchStart ? spanHtml : ''
      const token = tokens[piece.tokenIndex] as Token & { kind: 'text' }
      token.raw = `${encodeHtmlText(before)}${insert}${encodeHtmlText(after)}`
      // The token now embeds markup; a NUL barrier in the matching text keeps
      // later searches from matching across the inserted span.
      token.decoded = `${before}\u0000${after}`
    }
    return true
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token
    if (token.kind === 'text') {
      segment.push({ tokenIndex: index, start: segmentTextLength, decoded: token.decoded })
      segmentTextLength += token.decoded.length
      continue
    }
    if (token.isBlockBoundary) {
      if (tryReplaceInSegment()) return true
      segment = []
      segmentTextLength = 0
    }
  }
  return tryReplaceInSegment()
}

export function replaceHtmlTextWithTags(
  html: string,
  replacements: HtmlTagReplacement[]
): HtmlTextReplaceResult {
  const tokens = tokenizeHtml(html)
  const applied: HtmlTextReplaceResult['applied'] = []
  const failed: HtmlTextReplaceResult['failed'] = []

  for (const replacement of replacements) {
    if (!replacement.originalText.trim()) {
      failed.push({ originalText: replacement.originalText, reason: 'empty-target' })
      continue
    }
    const spanHtml = renderSmartTagSpan(replacement.tagPath)
    let occurrences = 0
    for (let i = 0; i < 50; i += 1) {
      if (!replaceOnceInTokens(tokens, replacement.originalText, spanHtml)) break
      occurrences += 1
    }
    if (occurrences > 0) {
      applied.push({
        originalText: replacement.originalText,
        tagPath: replacement.tagPath,
        occurrences
      })
    } else {
      failed.push({ originalText: replacement.originalText, reason: 'not-found' })
    }
  }

  return { html: tokens.map((token) => token.raw).join(''), applied, failed }
}
