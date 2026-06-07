/**
 * textSearchShared — pure text helpers shared between the semantic search
 * (vector) and keyword search (literal) services.
 *
 * Both services produce the same hit shape (offsets + framed snippet) so the
 * renderer can highlight either kind of result identically. Keeping the
 * snippet framing, sentence splitting, query-word extraction, and per-document
 * limiting in one module guarantees the two search paths stay consistent.
 *
 * Nothing here touches embeddings or the ONNX runtime — it is plain string
 * work, safe to call without any model downloaded.
 */

export interface IndexedDocument {
  /** Stable identifier for the document (e.g. relative path inside the dossier). */
  documentId: string
  /** Human-readable name (shown in the search UI). */
  displayName?: string
  /** Absolute path to the per-document content cache JSON. */
  cachePath: string
}

export interface SemanticSearchHit {
  documentId: string
  displayName?: string
  charStart: number
  charEnd: number
  score: number
  snippet: string
  /** Offsets within `snippet` marking the sentence that actually carried the
   *  match. Surrounding text is context. Undefined when no refinement ran. */
  snippetMatchStart?: number
  snippetMatchEnd?: number
}

// Maximum number of hits returned per document in the final top-K. Prevents a
// single document from occupying multiple slots when a common term matches it
// many times — the reader can open the document to see all occurrences; the
// search panel should prioritise breadth across documents.
export const MAX_HITS_PER_DOCUMENT = 2

// Snippet framing budget. Chunks/documents can be long; we frame the matched
// sentence with surrounding sentences up to this many characters.
export const SNIPPET_MAX_CHARS = 280

// Score added per matched content word from the query found verbatim in the
// candidate text. Used by the semantic path as a hybrid keyword-presence
// signal so documents literally containing the query terms beat documents
// that are only semantically adjacent.
export const KEYWORD_BONUS_PER_WORD = 0.04

// Stop words stripped from the query before keyword-presence scoring and
// keyword search. Covers French and English (tests use English text).
export const STOP_WORDS = new Set([
  // French
  'de',
  'du',
  'des',
  'le',
  'la',
  'les',
  'un',
  'une',
  'et',
  'ou',
  'au',
  'aux',
  'en',
  'pour',
  'par',
  'sur',
  'avec',
  'dans',
  'qui',
  'que',
  'se',
  'ce',
  'sa',
  'son',
  'ses',
  'leur',
  'leurs',
  'je',
  'tu',
  'il',
  'elle',
  'nous',
  'vous',
  'ils',
  'elles',
  'est',
  'sont',
  'ont',
  'été',
  'ne',
  'pas',
  'mais',
  'car',
  'ni',
  'dont',
  'si',
  'or',
  // English
  'the',
  'an',
  'and',
  'in',
  'of',
  'to',
  'is',
  'are',
  'was',
  'for',
  'on',
  'at',
  'this',
  'that',
  'it',
  'be',
  'by',
  'with'
])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract the meaningful content words from a query as word-boundary regexes.
 * Each word also matches its naive singular/plural variant. Words shorter than
 * 3 chars and stop-words are dropped.
 */
export function buildContentWordRegexes(query: string): RegExp[] {
  return query
    .toLocaleLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => {
      const alt = w.endsWith('s') ? w.slice(0, -1) : w + 's'
      // Word-boundary match prevents "nom" hitting "notamment", etc.
      return new RegExp(`\\b(${escapeRegExp(w)}|${escapeRegExp(alt)})\\b`)
    })
}

export function computeKeywordBonus(chunkText: string, wordRegexes: readonly RegExp[]): number {
  if (wordRegexes.length === 0) return 0
  const lower = chunkText.toLocaleLowerCase()
  let bonus = 0
  for (const re of wordRegexes) {
    if (re.test(lower)) bonus += KEYWORD_BONUS_PER_WORD
  }
  return bonus
}

export interface Sentence {
  /** Offset relative to the text the sentence was split from. */
  charStart: number
  charEnd: number
  /** Trimmed text. */
  text: string
}

export function splitIntoSentences(text: string): Sentence[] {
  const sentences: Sentence[] = []
  // Sentence terminators: a run of .!? followed by whitespace, one or more
  // newlines, or a semicolon followed by whitespace. Semicolons are included
  // because French legal text uses them heavily as clause/article separators
  // (e.g. "L.114-17 du code de la Sécurité sociale ; Article L6145-11...").
  const boundaryRe = /[.!?]+\s+|\n+|;\s+/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = boundaryRe.exec(text)) !== null) {
    const end = m.index + m[0].length
    const slice = text.slice(last, end)
    const trimmed = slice.trim()
    // Skip tiny fragments (abbreviations like "L.", "N°", lone digits) that
    // produce useless embeddings and clutter context.
    if (trimmed.length >= 5) sentences.push({ charStart: last, charEnd: end, text: trimmed })
    last = end
  }
  if (last < text.length) {
    const trimmed = text.slice(last).trim()
    if (trimmed) sentences.push({ charStart: last, charEnd: text.length, text: trimmed })
  }
  return sentences
}

export interface BuiltSnippet {
  text: string
  /** Offset into `text` where the picked sentence starts. */
  matchStart: number
  /** Offset into `text` where the picked sentence ends. */
  matchEnd: number
}

/**
 * Build a snippet from the picked sentence, padded with the sentences
 * immediately before and after so the reader can interpret the match in
 * context. We alternate before/after additions to keep the match roughly
 * centred and stop as soon as we hit SNIPPET_MAX_CHARS.
 */
export function buildSnippetWithContext(sentences: Sentence[], pickedIdx: number): BuiltSnippet {
  const match = sentences[pickedIdx]!.text
  let before = ''
  let after = ''
  let prev = pickedIdx - 1
  let next = pickedIdx + 1
  let addAfterNext = true

  const totalLen = (): number =>
    (before ? before.length + 1 : 0) + match.length + (after ? after.length + 1 : 0)

  while (prev >= 0 || next < sentences.length) {
    let added = false
    if (addAfterNext && next < sentences.length) {
      const candidate = sentences[next]!.text
      if (totalLen() + 1 + candidate.length <= SNIPPET_MAX_CHARS) {
        after = after ? `${after} ${candidate}` : candidate
        next += 1
        added = true
      } else {
        // Can't fit any more on this side
        next = sentences.length
      }
    } else if (!addAfterNext && prev >= 0) {
      const candidate = sentences[prev]!.text
      if (totalLen() + 1 + candidate.length <= SNIPPET_MAX_CHARS) {
        before = before ? `${candidate} ${before}` : candidate
        prev -= 1
        added = true
      } else {
        prev = -1
      }
    }
    if (!added) {
      addAfterNext = !addAfterNext
      // If both directions are now exhausted, bail
      if (prev < 0 && next >= sentences.length) break
      continue
    }
    addAfterNext = !addAfterNext
  }

  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(match)
  if (after) parts.push(after)
  const text = parts.join(' ')
  const matchStart = before ? before.length + 1 : 0
  const matchEnd = matchStart + match.length
  return { text, matchStart, matchEnd }
}

export function limitHitsPerDocument(hits: SemanticSearchHit[], max: number): SemanticSearchHit[] {
  const countByDoc = new Map<string, number>()
  return hits.filter((hit) => {
    const n = countByDoc.get(hit.documentId) ?? 0
    if (n >= max) return false
    countByDoc.set(hit.documentId, n + 1)
    return true
  })
}
