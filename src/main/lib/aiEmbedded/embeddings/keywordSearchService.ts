/**
 * keywordSearchService — literal (non-vector) full-text search over a dossier's
 * already-extracted document text.
 *
 * Why this exists: the embedding model (multilingual E5/bge-m3) does not
 * discriminate well inside a tightly-clustered French legal corpus — every
 * document scores ~0.80 regardless of relevance, so a purely semantic search
 * surfaces irrelevant documents (e.g. a marriage certificate for the query
 * "école"). The only reliable relevance signal in that corpus is the literal
 * presence of the query word. This service provides that signal: it returns a
 * hit ONLY when a content word from the query actually appears in the text.
 *
 * It depends on no model and no network — it reads the extracted text from each
 * document's content-cache JSON and matches with diacritic- and case-insensitive
 * whole-word regexes. Hits reuse the shared SemanticSearchHit shape (offsets +
 * framed snippet) so the renderer highlights them identically to vector hits.
 */

import { readFile } from 'node:fs/promises'

import {
  buildContentWordRegexes,
  buildSnippetWithContext,
  splitIntoSentences,
  type IndexedDocument,
  type SemanticSearchHit
} from './textSearchShared'

// Default number of documents returned.
const DEFAULT_TOP_K = 10

export interface KeywordSearchParams {
  documents: IndexedDocument[]
  query: string
  topK?: number
}

/**
 * Fold common French (and general Latin-1) diacritics to their base letter
 * WITHOUT changing string length, so character offsets into the folded text map
 * 1:1 back onto the original text. NFD normalization is deliberately NOT used
 * here: it expands "é" into two code points (e + combining accent), which would
 * shift every subsequent offset and break highlight positioning.
 */
export function foldDiacritics(input: string): string {
  let out = ''
  for (const ch of input) {
    out += DIACRITIC_MAP[ch] ?? ch
  }
  return out
}

// 1 code point in → 1 code point out. Covers the accented letters that appear
// in French legal text (and a few common Latin-1 extras).
const DIACRITIC_MAP: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  œ: 'oe', æ: 'ae',
  À: 'A', Á: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A',
  Ç: 'C',
  È: 'E', É: 'E', Ê: 'E', Ë: 'E',
  Ì: 'I', Í: 'I', Î: 'I', Ï: 'I',
  Ñ: 'N',
  Ò: 'O', Ó: 'O', Ô: 'O', Õ: 'O', Ö: 'O',
  Ù: 'U', Ú: 'U', Û: 'U', Ü: 'U',
  Ý: 'Y'
}

async function readCacheText(cachePath: string): Promise<string | null> {
  try {
    const raw = await readFile(cachePath, 'utf8')
    const parsed = JSON.parse(raw) as { text?: unknown; isEmpty?: unknown }
    if (parsed.isEmpty === true) return null
    if (typeof parsed.text !== 'string' || parsed.text.length === 0) return null
    return parsed.text
  } catch {
    return null
  }
}

/**
 * Locate the sentence containing an absolute offset and frame it with context.
 * Returns a snippet plus the picked sentence's ABSOLUTE offsets into `text`
 * (for the full-text highlight) and its offsets WITHIN the snippet (for the
 * result-list highlight).
 */
function frameMatch(
  text: string,
  matchOffset: number
): { snippet: string; charStart: number; charEnd: number; snippetMatchStart: number; snippetMatchEnd: number } | null {
  const sentences = splitIntoSentences(text)
  if (sentences.length === 0) {
    const snippet = text.trim().slice(0, 280)
    return { snippet, charStart: 0, charEnd: Math.min(text.length, 280), snippetMatchStart: 0, snippetMatchEnd: snippet.length }
  }
  let pickedIdx = sentences.findIndex((s) => s.charStart <= matchOffset && matchOffset < s.charEnd)
  if (pickedIdx < 0) pickedIdx = 0

  const built = buildSnippetWithContext(sentences, pickedIdx)
  // Narrow the full-text highlight to the picked sentence (same approach as the
  // semantic path's refineSnippets), trimming boundary whitespace that
  // splitIntoSentences keeps in the sentence range.
  const picked = sentences[pickedIdx]!
  const raw = text.slice(picked.charStart, picked.charEnd)
  const leading = raw.length - raw.trimStart().length
  const trailing = raw.length - raw.trimEnd().length
  const charStart = picked.charStart + leading
  const charEnd = picked.charEnd - trailing
  return {
    snippet: built.text,
    charStart: charEnd > charStart ? charStart : picked.charStart,
    charEnd: charEnd > charStart ? charEnd : picked.charEnd,
    snippetMatchStart: built.matchStart,
    snippetMatchEnd: built.matchEnd
  }
}

/**
 * Search a dossier's documents for literal occurrences of the query's content
 * words. Returns at most `topK` hits, capped per document, sorted by the number
 * of distinct query words a document matches (more words = more relevant).
 */
export async function keywordSearchDossier(
  params: KeywordSearchParams
): Promise<SemanticSearchHit[]> {
  const query = params.query.trim()
  if (!query) return []

  const topK = Math.max(1, params.topK ?? DEFAULT_TOP_K)
  // Fold the query's diacritics too so the patterns match the folded text we
  // search against ("école" → "ecole" must match folded "ecole").
  const wordRegexes = buildContentWordRegexes(foldDiacritics(query))
  if (wordRegexes.length === 0) return []

  // Sources come from buildContentWordRegexes' per-word patterns so the
  // whole-word boundaries and singular/plural variants stay consistent. We
  // build a FRESH matcher per document because RegExp objects carry mutable
  // lastIndex state and the documents are scanned concurrently.
  const globalSource = wordRegexes.map((re) => re.source).join('|')

  const perDoc = await Promise.all(
    params.documents.map(async (doc) => {
      const text = await readCacheText(doc.cachePath)
      if (!text) return null

      const folded = foldDiacritics(text)
      const matcher = new RegExp(globalSource, 'gi')
      const matchedWords = new Set<string>()
      let firstOffset = -1
      let m: RegExpExecArray | null
      while ((m = matcher.exec(folded)) !== null) {
        matchedWords.add(m[0].toLowerCase())
        if (firstOffset < 0) firstOffset = m.index
        // Guard against zero-width matches looping forever.
        if (m.index === matcher.lastIndex) matcher.lastIndex += 1
      }
      if (firstOffset < 0) return null

      // One hit per document: keyword search surfaces the document and frames
      // its first match; the reader opens the document to see all occurrences.
      const framed = frameMatch(text, firstOffset)
      if (!framed) return null
      return {
        documentId: doc.documentId,
        displayName: doc.displayName,
        charStart: framed.charStart,
        charEnd: framed.charEnd,
        // Score = distinct query words matched in this document. Keeps
        // documents matching more of the query above single-word matches.
        score: matchedWords.size,
        snippet: framed.snippet,
        snippetMatchStart: framed.snippetMatchStart,
        snippetMatchEnd: framed.snippetMatchEnd
      } satisfies SemanticSearchHit
    })
  )

  const allHits = perDoc.filter((h): h is SemanticSearchHit => h !== null)
  allHits.sort((a, b) => b.score - a.score)
  return allHits.slice(0, topK)
}
