/**
 * documentSearchService — keyword-based semantic search over cached document text.
 *
 * Strategy:
 *   1. For each document in the dossier that has cached text, read the cache.
 *   2. Split the text into overlapping chunks (~600 chars, 100-char overlap).
 *   3. Score each chunk against the query using token frequency (TF).
 *   4. Return the top N chunks sorted by score, each tagged with its source document.
 *
 * This deliberately avoids vector embeddings to stay lightweight and fully local.
 * Results give the calling LLM grounded excerpts to cite when answering questions
 * about dossier content — preventing hallucination.
 */
import { join } from 'node:path'
import type { DocumentRecord } from '@shared/types'
import { readCachedDocumentText } from './documentContentService'

const CHUNK_SIZE = 600
const CHUNK_OVERLAP = 100
const MAX_RESULTS = 8
const MIN_SCORE = 0.1
const MAX_EXCERPT_LINES = 8

export interface DocumentSearchMatch {
  documentId: string
  filename: string
  excerpt: string
}

interface ScoredMatch extends DocumentSearchMatch {
  score: number
}

export interface DocumentSearchResult {
  matches: DocumentSearchMatch[]
  /** Number of documents scanned (including those with no cached text). */
  documentsScanned: number
  /** Number of documents skipped because text was not yet extracted. */
  documentsWithoutCache: number
}

// ── Text normalisation ────────────────────────────────────────────────────────

function normalise(text: string): string {
  return text
    .replace(/<NL>/g, '\n')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function decodeExtractedLineBreaks(text: string): string {
  // In extracted document text, line breaks may be encoded as "<NL>".
  return text.replace(/<NL>/g, '\n')
}

function tokenise(text: string): string[] {
  return normalise(text)
    .split(/\s+/)
    .filter((t) => t.length >= 2)
}

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE))
    start += CHUNK_SIZE - CHUNK_OVERLAP
    if (start >= text.length) break
  }
  return chunks
}

function formatExcerpt(chunk: string): string {
  const lines = chunk
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_EXCERPT_LINES)

  // Keep the existing character cap behavior from chunking, while also capping lines.
  return lines.join('\n').slice(0, CHUNK_SIZE).trim()
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreChunk(chunk: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const normChunk = normalise(chunk)
  const matched = new Set<string>()
  for (const token of queryTokens) {
    if (normChunk.includes(token)) matched.add(token)
  }
  return matched.size / queryTokens.length
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function searchDocuments(
  query: string,
  documents: DocumentRecord[],
  dossierRoot: string,
  cacheDir: string
): Promise<DocumentSearchResult> {
  const queryTokens = tokenise(query)
  const allMatches: ScoredMatch[] = []
  let documentsWithoutCache = 0

  for (const doc of documents) {
    const absolutePath = join(dossierRoot, doc.relativePath)
    let text: string
    try {
      const result = await readCachedDocumentText(absolutePath, cacheDir)
      if (result === null) {
        documentsWithoutCache++
        continue
      }
      text = result.text
    } catch {
      documentsWithoutCache++
      continue
    }

    const normalizedText = decodeExtractedLineBreaks(text)
    if (!normalizedText.trim()) continue

    const chunks = chunkText(normalizedText)
    for (const chunk of chunks) {
      const score = scoreChunk(chunk, queryTokens)
      if (score >= MIN_SCORE) {
        allMatches.push({
          documentId: doc.id,
          filename: doc.filename,
          excerpt: formatExcerpt(chunk),
          score
        })
      }
    }
  }

  // Sort by score desc, deduplicate by keeping best chunk per document first,
  // then allow additional chunks from same document if they score well.
  allMatches.sort((a, b) => b.score - a.score)

  // Keep at most MAX_RESULTS, but ensure at least one match per document
  // when possible so the model sees breadth across documents.
  const seen = new Map<string, number>() // documentId → count included
  const topMatches: ScoredMatch[] = []

  // First pass: one best chunk per document
  for (const match of allMatches) {
    if (!seen.has(match.documentId)) {
      seen.set(match.documentId, 1)
      topMatches.push(match)
    }
    if (topMatches.length >= MAX_RESULTS) break
  }

  // Second pass: fill remaining slots with best remaining chunks
  if (topMatches.length < MAX_RESULTS) {
    for (const match of allMatches) {
      if ((seen.get(match.documentId) ?? 0) === 0) continue // already in first pass skip
      if (topMatches.includes(match)) continue
      topMatches.push(match)
      seen.set(match.documentId, (seen.get(match.documentId) ?? 0) + 1)
      if (topMatches.length >= MAX_RESULTS) break
    }
  }

  topMatches.sort((a, b) => b.score - a.score)

  // Strip internal score before returning — it has no value for the LLM
  // and leaks floating-point noise that pseudonymize could accidentally match.
  const matches: DocumentSearchMatch[] = topMatches.map(({ documentId, filename, excerpt }) => ({
    documentId,
    filename,
    excerpt
  }))

  return {
    matches,
    documentsScanned: documents.length,
    documentsWithoutCache
  }
}
