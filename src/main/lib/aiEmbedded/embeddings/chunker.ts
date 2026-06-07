/**
 * chunker — split extracted document text into overlapping windows suitable
 * for embedding + retrieval.
 *
 * Strategy:
 *   1. Segment on paragraph boundaries first. `normalizeExtractedText`
 *      (documentContentService.ts) collapses paragraph breaks into a single
 *      blank line, so we split on `\n\s*\n+`.
 *   2. Pack paragraphs greedily into ~maxChars-long windows. A window is
 *      closed when adding the next paragraph would overflow; the next window
 *      is seeded with the tail of the previous one (overlapChars) so a span
 *      that straddles a boundary is still retrievable.
 *   3. If a single paragraph is already larger than maxChars, hard-split it
 *      at word boundaries. Graceful fallback — never loses text.
 *
 * The chunker is char-based, not token-based — chars keep it model-agnostic and
 * the offsets directly citable against the extracted text. The embedding side
 * passes `truncation: true` to the pipeline as a hard safety cap (transformers.js
 * does NOT truncate by default), so chunks are sized conservatively below the
 * model's token window rather than relied upon to hit it exactly.
 *
 * Each returned chunk carries (charStart, charEnd) relative to the input
 * string so the UI can jump straight to the matched passage.
 */

export interface TextChunk {
  /** Inclusive character offset into the input text. */
  charStart: number
  /** Exclusive character offset into the input text. */
  charEnd: number
  /** The chunk content. Equals input.slice(charStart, charEnd). */
  text: string
}

export interface ChunkOptions {
  /** Target window size in characters. Defaults to 800 (~200 tokens). */
  maxChars?: number
  /** Overlap between adjacent windows in characters. Defaults to 150 (~40 tokens). */
  overlapChars?: number
}

// ~800 chars (≈ 3-5 sentences) is the retrieval sweet spot for legal documents:
// small enough that a relevant passage gets its OWN vector instead of being
// diluted into a whole-document average, large enough to keep the passage's
// surrounding context. (bge-m3 handles up to 8192 tokens, so the cap is about
// retrieval granularity, not the model window.) A smaller window also yields
// tighter, more citable highlights. Overlap preserves spans that straddle a
// window boundary.
const DEFAULT_MAX_CHARS = 800
const DEFAULT_OVERLAP_CHARS = 150
// Matches normalizeExtractedText's paragraph separator (a blank line).
const PARAGRAPH_SPLITTER = /\n\s*\n+/

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const maxChars = Math.max(1, opts.maxChars ?? DEFAULT_MAX_CHARS)
  const overlapChars = Math.max(
    0,
    Math.min(opts.overlapChars ?? DEFAULT_OVERLAP_CHARS, maxChars - 1)
  )

  if (!text) return []
  if (text.length <= maxChars) {
    return [{ charStart: 0, charEnd: text.length, text }]
  }

  const paragraphs = splitParagraphsWithOffsets(text)
  if (paragraphs.length === 0) return []

  const chunks: TextChunk[] = []
  let windowStart = paragraphs[0]!.start
  let windowEnd = paragraphs[0]!.start

  const pushWindow = (endInclusiveExclusive: number): void => {
    const start = windowStart
    const end = Math.min(endInclusiveExclusive, text.length)
    if (end <= start) return
    chunks.push({ charStart: start, charEnd: end, text: text.slice(start, end) })
  }

  for (const paragraph of paragraphs) {
    const candidateEnd = paragraph.end
    const currentLength = windowEnd - windowStart

    // Single paragraph larger than the window — hard-split it on word
    // boundaries. Everything accumulated so far is flushed first.
    if (paragraph.end - paragraph.start > maxChars) {
      if (currentLength > 0) {
        pushWindow(windowEnd)
      }
      for (const piece of hardSplit(text, paragraph.start, paragraph.end, maxChars, overlapChars)) {
        chunks.push(piece)
      }
      // Reset the window to start right after the last hard-split piece.
      const lastEnd = chunks.length > 0 ? chunks[chunks.length - 1]!.charEnd : paragraph.end
      windowStart = Math.max(lastEnd - overlapChars, paragraph.end)
      windowEnd = windowStart
      continue
    }

    // Would adding this paragraph overflow the window?
    if (currentLength > 0 && candidateEnd - windowStart > maxChars) {
      pushWindow(windowEnd)
      // Seed next window with the tail of the just-emitted window so overlap
      // preserves context across the boundary.
      windowStart = Math.max(windowEnd - overlapChars, 0)
      windowEnd = windowStart
    }

    if (windowEnd === windowStart) {
      // Starting a fresh window — align its start to the paragraph start
      // unless we already seeded it with overlap from the previous window.
      if (windowStart < paragraph.start) {
        windowStart = Math.max(paragraph.start - overlapChars, windowStart)
      }
    }
    windowEnd = candidateEnd
  }

  if (windowEnd > windowStart) {
    pushWindow(windowEnd)
  }

  return chunks
}

interface ParagraphSlice {
  start: number
  end: number
}

function splitParagraphsWithOffsets(text: string): ParagraphSlice[] {
  const slices: ParagraphSlice[] = []
  let cursor = 0
  // Iterate via exec to keep track of match offsets — simpler than split().
  const re = new RegExp(PARAGRAPH_SPLITTER, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) {
      slices.push({ start: cursor, end: match.index })
    }
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    slices.push({ start: cursor, end: text.length })
  }
  return slices.filter((slice) => text.slice(slice.start, slice.end).trim().length > 0)
}

function hardSplit(
  text: string,
  start: number,
  end: number,
  maxChars: number,
  overlapChars: number
): TextChunk[] {
  const chunks: TextChunk[] = []
  let cursor = start
  while (cursor < end) {
    const tentativeEnd = Math.min(cursor + maxChars, end)
    // Try to break at a whitespace boundary within the last ~10% of the
    // window to avoid slicing mid-word.
    let breakAt = tentativeEnd
    if (tentativeEnd < end) {
      const backstop = Math.max(cursor + Math.floor(maxChars * 0.9), cursor + 1)
      const slice = text.slice(backstop, tentativeEnd)
      const ws = slice.search(/\s\S/)
      if (ws >= 0) {
        breakAt = backstop + ws + 1
      }
    }
    chunks.push({ charStart: cursor, charEnd: breakAt, text: text.slice(cursor, breakAt) })
    if (breakAt >= end) break
    cursor = Math.max(breakAt - overlapChars, cursor + 1)
  }
  return chunks
}
