/**
 * noteSearchService — embedding indexing and hybrid (keyword + semantic) search
 * over a dossier's notes (pense-bête / TODO / AI reflection log).
 *
 * Notes reuse the document search engine wholesale. Each note carries a
 * sibling embedding cache file `notes/{id}.embeddings.json` whose shape is
 * identical to the per-document content cache (`{ text, embeddings }`), so the
 * shared `keywordSearchDossier` / `searchDossier` paths and the hybrid-fusion
 * helper consume notes through the exact same code as documents — no separate
 * vector store, no note-specific embedding model. The shared bge-m3 model
 * (1024-dim, multilingual) is the right and only embedding model here.
 *
 * Indexing is best-effort: a missing model or a write failure never throws to
 * the caller. The note is fully usable from its `notes/{id}.json` record even
 * when its embeddings are absent — keyword and tag filtering still work, and
 * the next upsert retries indexing.
 */

import type { DossierNote } from '@shared/domain/dossierNote'

import {
  getDossierNoteEmbeddingCachePath,
  getDossierNotesDirectoryPath
} from '../../lib/ordicab/ordicabPaths'
import {
  DEFAULT_EMBEDDING_DIM,
  type EmbeddingServiceConfig
} from '../../lib/aiEmbedded/embeddings/embeddingService'
import { indexDocumentEmbeddings } from '../../lib/aiEmbedded/embeddings/embeddingIndexer'
import { keywordSearchDossier } from '../../lib/aiEmbedded/embeddings/keywordSearchService'
import { searchDossier } from '../../lib/aiEmbedded/embeddings/semanticSearchService'
import {
  mergeHybridHits,
  type HitMatchKind,
  type IndexedDocument
} from '../../lib/aiEmbedded/embeddings/textSearchShared'
import { saveRecord } from '../../lib/system/perFileStore'

type NoteEmbedder = (
  texts: string[],
  config?: EmbeddingServiceConfig
) => Promise<Float32Array[] | null>

/**
 * The text indexed and searched for a note: title then content. Kept free of
 * any model prefix (bge-m3 pools raw text) so search stays clean.
 */
export function buildNoteText(note: Pick<DossierNote, 'title' | 'content'>): string {
  const title = note.title.trim()
  const content = note.content.trim()
  if (title && content) return `${title}\n\n${content}`
  return title || content
}

export interface IndexNoteOptions {
  dossierPath: string
  note: DossierNote
  embeddingConfig?: EmbeddingServiceConfig
  embedder?: NoteEmbedder
}

/**
 * Write a note's text into its embedding cache and (re)compute embeddings.
 *
 * The cache file is overwritten with the current `{ text }` before indexing.
 * Overwriting drops any prior `embeddings` field, which is exactly the stale
 * signal `indexDocumentEmbeddings` relies on to re-index after an edit.
 */
export async function indexNoteEmbeddings(options: IndexNoteOptions): Promise<void> {
  const cachePath = getDossierNoteEmbeddingCachePath(options.dossierPath, options.note.uuid)
  const text = buildNoteText(options.note)
  try {
    await saveRecord(getDossierNotesDirectoryPath(options.dossierPath), cachePath, { text })
    await indexDocumentEmbeddings(cachePath, {
      embeddingConfig: options.embeddingConfig,
      dim: DEFAULT_EMBEDDING_DIM,
      force: true,
      embedder: options.embedder
    })
  } catch (error) {
    // Best-effort: notes remain searchable by keyword/tag without embeddings.
    console.warn(
      `[noteSearchService] Failed to index embeddings for note ${options.note.uuid}.`,
      error instanceof Error ? error.message : error
    )
  }
}

export interface NoteSearchHit {
  noteUuid: string
  title: string
  snippet: string
  score: number
  matchKind: HitMatchKind
}

export interface SearchNotesParams {
  dossierPath: string
  notes: DossierNote[]
  query: string
  topK?: number
  embeddingConfig?: EmbeddingServiceConfig
  embedder?: NoteEmbedder
}

/**
 * Hybrid search over the provided notes. `notes` is the already-filtered set
 * (the caller applies tag/kind/status filters before calling). Returns at most
 * `topK` hits, keyword lane first.
 */
export async function searchNotes(params: SearchNotesParams): Promise<NoteSearchHit[]> {
  const query = params.query.trim()
  if (!query || params.notes.length === 0) return []

  const titleById = new Map(params.notes.map((note) => [note.uuid, note.title]))
  const documents: IndexedDocument[] = params.notes.map((note) => ({
    itemId: note.uuid,
    displayName: note.title,
    cachePath: getDossierNoteEmbeddingCachePath(params.dossierPath, note.uuid)
  }))

  const topK = params.topK ?? 10
  const [keywordHits, semanticHits] = await Promise.all([
    keywordSearchDossier({ documents, query, topK }),
    searchDossier({
      documents,
      query,
      topK,
      embeddingConfig: params.embeddingConfig,
      dim: DEFAULT_EMBEDDING_DIM,
      embedder: params.embedder
    })
  ])

  const merged = mergeHybridHits(keywordHits, semanticHits)
  return merged.slice(0, topK).map(({ hit, matchKind }) => ({
    noteUuid: hit.itemId,
    title: titleById.get(hit.itemId) ?? hit.displayName ?? hit.itemId,
    snippet: hit.snippet,
    score: hit.score,
    matchKind
  }))
}
