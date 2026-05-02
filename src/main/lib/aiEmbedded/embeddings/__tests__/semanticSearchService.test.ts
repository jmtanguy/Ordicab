import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetModelRegistryForTests } from '../../modelRegistry'
import { encodeVectorBase64 } from '../embeddingService'
import { preloadDossierIndex, searchDossier, type IndexedDocument } from '../semanticSearchService'

const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return { pipelineSpy: vi.fn(), envRef: env }
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineSpy,
  env: envRef
}))

beforeEach(() => {
  __resetModelRegistryForTests()
  pipelineSpy.mockReset()
  envRef.localModelPath = undefined
  envRef.allowRemoteModels = true
})

async function writeDoc(entry: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'semsearch-'))
  const path = join(dir, 'cache.json')
  await writeFile(path, JSON.stringify(entry, null, 2), 'utf8')
  return path
}

function buildIndexedDoc(
  documentId: string,
  displayName: string,
  text: string,
  chunks: Array<{ charStart: number; charEnd: number; vector: Float32Array }>,
  model = 'Xenova/multilingual-e5-small',
  dim = 4
): {
  documentId: string
  displayName: string
  text: string
  chunks: Array<{ charStart: number; charEnd: number; vector: Float32Array }>
  model: string
  dim: number
} {
  return {
    documentId,
    displayName,
    text,
    chunks,
    model,
    dim
  }
}

async function materializeDoc(doc: ReturnType<typeof buildIndexedDoc>): Promise<IndexedDocument> {
  const cachePath = await writeDoc({
    version: 2,
    text: doc.text,
    embeddings: {
      model: doc.model,
      dim: doc.dim,
      chunks: doc.chunks.map((c) => ({
        charStart: c.charStart,
        charEnd: c.charEnd,
        vector: encodeVectorBase64(c.vector)
      })),
      createdAt: new Date().toISOString()
    }
  })
  return {
    documentId: doc.documentId,
    displayName: doc.displayName,
    cachePath
  } satisfies IndexedDocument
}

describe('searchDossier', () => {
  it('returns the closest chunk as the top hit', async () => {
    // Query vector [1,0,0,0] — the third chunk is the exact match.
    // Offsets are pre-verified: 0..17 "first chunk text.", 17..35 "Second chunk here.", 35..57 "Relevant passage wins."
    const doc = buildIndexedDoc(
      'docA.pdf',
      'Document A',
      'first chunk text.Second chunk here.Relevant passage wins.',
      [
        { charStart: 0, charEnd: 17, vector: new Float32Array([0, 1, 0, 0]) },
        { charStart: 17, charEnd: 35, vector: new Float32Array([0, 0, 1, 0]) },
        { charStart: 35, charEnd: 57, vector: new Float32Array([1, 0, 0, 0]) }
      ]
    )
    const indexed = await materializeDoc(doc)

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [indexed],
      query: 'find the relevant passage',
      topK: 2,
      dim: 4
    })

    expect(hits).toHaveLength(2)
    expect(hits[0]!.documentId).toBe('docA.pdf')
    expect(hits[0]!.charStart).toBe(35)
    expect(hits[0]!.score).toBeCloseTo(1, 6)
    expect(hits[0]!.snippet).toBe('Relevant passage wins.')
  })

  it('ranks results across multiple documents', async () => {
    const docA = await materializeDoc(
      buildIndexedDoc('a.pdf', 'A', 'irrelevant chunk of text in doc A', [
        { charStart: 0, charEnd: 34, vector: new Float32Array([0, 1, 0, 0]) }
      ])
    )
    const docB = await materializeDoc(
      buildIndexedDoc('b.pdf', 'B', 'winning chunk lives in doc B here', [
        { charStart: 0, charEnd: 33, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [docA, docB],
      query: 'anything',
      dim: 4
    })

    expect(hits[0]!.documentId).toBe('b.pdf')
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('returns [] when the query string is empty', async () => {
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', 'some text', [
        { charStart: 0, charEnd: 9, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    const hits = await searchDossier({ documents: [doc], query: '   ', dim: 4 })
    expect(hits).toEqual([])
    expect(pipelineSpy).not.toHaveBeenCalled()
  })

  it('returns [] when the query embedding fails to load', async () => {
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', 'some text', [
        { charStart: 0, charEnd: 9, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )
    pipelineSpy.mockRejectedValue(new Error('model missing'))

    const hits = await searchDossier({ documents: [doc], query: 'anything', dim: 4 })
    expect(hits).toEqual([])
  })

  it('skips documents indexed with a mismatched model or dim', async () => {
    const docWrongModel = await materializeDoc(
      buildIndexedDoc(
        'wrong-model.pdf',
        'WM',
        'text',
        [{ charStart: 0, charEnd: 4, vector: new Float32Array([1, 0, 0, 0]) }],
        'other/model',
        4
      )
    )
    const docWrongDim = await materializeDoc(
      buildIndexedDoc(
        'wrong-dim.pdf',
        'WD',
        'text',
        [
          {
            charStart: 0,
            charEnd: 4,
            vector: new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])
          }
        ],
        'Xenova/multilingual-e5-small',
        8
      )
    )
    const docOk = await materializeDoc(
      buildIndexedDoc('ok.pdf', 'OK', 'winning text', [
        { charStart: 0, charEnd: 12, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [docWrongModel, docWrongDim, docOk],
      query: 'anything',
      dim: 4
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]!.documentId).toBe('ok.pdf')
  })

  it('applies the E5 "query: " prefix to the query embedding', async () => {
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', 'text', [
        { charStart: 0, charEnd: 4, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )
    const fakePipe = vi.fn(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))
    pipelineSpy.mockResolvedValue(fakePipe)

    await searchDossier({ documents: [doc], query: 'rent dispute', dim: 4 })

    expect(fakePipe).toHaveBeenCalledWith(['query: rent dispute'], expect.any(Object))
  })

  it('prioritizes exact text matches for proper names over weaker vector hits', async () => {
    const docA = await materializeDoc(
      buildIndexedDoc('a.pdf', 'A', 'Compte rendu pour Jean Dupont au dossier.', [
        { charStart: 0, charEnd: 40, vector: new Float32Array([0.2, 0.1, 0, 0]) }
      ])
    )
    const docB = await materializeDoc(
      buildIndexedDoc('b.pdf', 'B', 'Texte plus proche vectoriellement mais sans ce nom.', [
        { charStart: 0, charEnd: 49, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [docA, docB],
      query: 'Jean Dupont',
      topK: 2,
      dim: 4
    })

    expect(hits[0]!.documentId).toBe('a.pdf')
    expect(hits[0]!.snippet).toContain('Jean Dupont')
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('matches exact names case-insensitively', async () => {
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', 'Le client principal est JEAN DUPONT.', [
        { charStart: 0, charEnd: 36, vector: new Float32Array([0.1, 0, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [doc],
      query: 'jean dupont',
      topK: 1,
      dim: 4
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]!.snippet).toContain('JEAN DUPONT')
    expect(hits[0]!.charStart).toBeGreaterThanOrEqual(0)
    expect(hits[0]!.charEnd).toBeGreaterThan(hits[0]!.charStart)
  })

  it('builds snippets from the selected chunk only', async () => {
    const text = 'Chunk A.Chunk B match.Chunk C.Chunk D.'
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', text, [
        { charStart: 0, charEnd: 8, vector: new Float32Array([0, 0, 1, 0]) },
        { charStart: 8, charEnd: 22, vector: new Float32Array([1, 0, 0, 0]) },
        { charStart: 22, charEnd: 30, vector: new Float32Array([0, 1, 0, 0]) },
        { charStart: 30, charEnd: 38, vector: new Float32Array([0, 0, 0, 1]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [doc],
      query: 'match',
      topK: 1,
      dim: 4
    })

    expect(hits[0]!.snippet).toBe('Chunk B match.')
  })

  it('keeps the full selected chunk without truncating it', async () => {
    const text = 'First chunk.Last chunk.'
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', text, [
        { charStart: 0, charEnd: 12, vector: new Float32Array([1, 0, 0, 0]) },
        { charStart: 12, charEnd: 23, vector: new Float32Array([0, 1, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [doc],
      query: 'edge',
      topK: 1,
      dim: 4
    })

    expect(hits[0]!.snippet).toBe('First chunk.')
  })
})

describe('preloadDossierIndex', () => {
  it('counts only documents that load cleanly', async () => {
    const docOk = await materializeDoc(
      buildIndexedDoc('ok.pdf', 'OK', 'text', [
        { charStart: 0, charEnd: 4, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )
    const docBad: IndexedDocument = {
      documentId: 'bad.pdf',
      displayName: 'bad',
      cachePath: '/does/not/exist.json'
    }

    const count = await preloadDossierIndex([docOk, docBad], {}, 4)
    expect(count).toBe(1)
  })
})
