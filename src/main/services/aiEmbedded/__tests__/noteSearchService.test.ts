import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { DossierNote } from '@shared/domain/dossierNote'

import { DEFAULT_EMBEDDING_DIM } from '../../../lib/aiEmbedded/embeddings/embeddingService'
import {
  getDossierNoteEmbeddingCachePath,
  getDossierNotesDirectoryPath
} from '../../../lib/ordicab/ordicabPaths'
import { buildNoteText, indexNoteEmbeddings, searchNotes } from '../noteSearchService'

function makeNote(overrides: Partial<DossierNote> = {}): DossierNote {
  return {
    uuid: 'note-1',
    dossierId: 'dossier-1',
    title: 'Vérifier la prescription',
    content: 'Le délai de prescription pourrait être expiré.',
    kind: 'to_verify',
    createdAt: '2026-03-21T09:00:00.000Z',
    updatedAt: '2026-03-21T09:00:00.000Z',
    ...overrides
  }
}

// Deterministic embedder: a unit vector whose first slot encodes the query/text
// hash so identical strings collide and distinct strings diverge. Enough to
// exercise the wiring without loading the real ONNX model.
function fakeEmbedder(texts: string[]): Promise<Float32Array[]> {
  return Promise.resolve(
    texts.map((text) => {
      const vec = new Float32Array(DEFAULT_EMBEDDING_DIM)
      let hash = 0
      for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 997
      vec[hash % DEFAULT_EMBEDDING_DIM] = 1
      return vec
    })
  )
}

async function makeDossierDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'note-search-test-'))
  await mkdir(getDossierNotesDirectoryPath(root), { recursive: true })
  return root
}

describe('buildNoteText', () => {
  it('joins title and content with a blank line', () => {
    expect(buildNoteText({ title: 'Titre', content: 'Corps' })).toBe('Titre\n\nCorps')
  })

  it('returns just the title when content is empty', () => {
    expect(buildNoteText({ title: 'Titre', content: '' })).toBe('Titre')
  })
})

describe('indexNoteEmbeddings', () => {
  it('writes the note text and embeddings into the per-note cache', async () => {
    const dossierPath = await makeDossierDir()
    const note = makeNote()

    await indexNoteEmbeddings({ dossierPath, note, embedder: fakeEmbedder })

    const cachePath = getDossierNoteEmbeddingCachePath(dossierPath, note.uuid)
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as {
      text: string
      embeddings?: { dim: number; chunks: unknown[] }
    }
    expect(cache.text).toBe(buildNoteText(note))
    expect(cache.embeddings?.dim).toBe(DEFAULT_EMBEDDING_DIM)
    expect((cache.embeddings?.chunks ?? []).length).toBeGreaterThan(0)
  })
})

describe('searchNotes', () => {
  it('finds a note by exact keyword and returns a keyword hit', async () => {
    const dossierPath = await makeDossierDir()
    const note = makeNote()
    await indexNoteEmbeddings({ dossierPath, note, embedder: fakeEmbedder })

    const hits = await searchNotes({
      dossierPath,
      notes: [note],
      query: 'prescription',
      embedder: fakeEmbedder
    })

    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0]).toMatchObject({ noteUuid: 'note-1', matchKind: 'keyword' })
  })

  it('returns nothing for an empty query or empty note set', async () => {
    const dossierPath = await makeDossierDir()
    expect(
      await searchNotes({ dossierPath, notes: [], query: 'x', embedder: fakeEmbedder })
    ).toEqual([])
    expect(
      await searchNotes({
        dossierPath,
        notes: [makeNote()],
        query: '   ',
        embedder: fakeEmbedder
      })
    ).toEqual([])
  })
})
