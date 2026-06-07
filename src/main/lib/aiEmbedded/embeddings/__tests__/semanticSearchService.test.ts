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
  model = 'Xenova/bge-m3',
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
    version: 3,
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

    // Mean-centering drops the two chunks that don't match the query direction
    // (their centered cosine is negative), leaving only the genuine match. This
    // is the intended anti-noise behavior, not a regression.
    expect(hits).toHaveLength(1)
    expect(hits[0]!.documentId).toBe('docA.pdf')
    expect(hits[0]!.charStart).toBe(35)
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

    // b.pdf matches the query direction and ranks first; a.pdf points the other
    // way, so after centering its score is negative and it's dropped as noise.
    expect(hits[0]!.documentId).toBe('b.pdf')
    expect(hits.every((h) => h.documentId !== 'a.pdf')).toBe(true)
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
        'Xenova/bge-m3',
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

  it('embeds the query with no input prefix (bge-m3 convention)', async () => {
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

    expect(fakePipe).toHaveBeenCalledWith(['rent dispute'], expect.any(Object))
  })

  // NOTE: exact/literal-match behavior (proper names, case-insensitivity) is no
  // longer part of searchDossier — it moved to keywordSearchService, which is
  // covered by keywordSearchService.test.ts. searchDossier is now pure-vector.

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

  it('refines multi-sentence chunks down to the best-matching sentence', async () => {
    // Chunk contains four sentences. The third one should be picked because
    // its sentence embedding matches the query vector exactly.
    const text =
      'Premier paragraphe sans rapport. Deuxième idée sur autre chose. Le passage pertinent gagne ici. Conclusion neutre.'
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', text, [
        { charStart: 0, charEnd: text.length, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    // bge-m3 uses no prefix, so query and passages arrive as bare text. The
    // mock encodes intent by content:
    //   - the query (contains "quel") → [1, 0, 0, 0]
    //   - any sentence containing "pertinent" → [1, 0, 0, 0]
    //   - any other sentence → [0, 1, 0, 0]
    pipelineSpy.mockResolvedValue(async (inputs: unknown) => {
      const arr = Array.isArray(inputs) ? (inputs as string[]) : [String(inputs)]
      const flat = new Float32Array(arr.length * 4)
      for (let i = 0; i < arr.length; i++) {
        const input = arr[i]!
        const match = input.includes('quel') || input.includes('pertinent')
        flat.set(match ? [1, 0, 0, 0] : [0, 1, 0, 0], i * 4)
      }
      return { data: flat, dims: [arr.length, 4] }
    })

    const hits = await searchDossier({
      documents: [doc],
      query: 'quel passage est le bon',
      topK: 1,
      dim: 4
    })

    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect(hit.snippet).toContain('pertinent')
    // The highlighted span must be the "pertinent" sentence, not just any
    // substring containing the word.
    expect(hit.snippetMatchStart).toBeDefined()
    expect(hit.snippetMatchEnd).toBeDefined()
    const highlighted = hit.snippet.slice(hit.snippetMatchStart!, hit.snippetMatchEnd!)
    expect(highlighted).toBe('Le passage pertinent gagne ici.')
    // Context sentences are included around the match.
    expect(hit.snippet).toContain('Deuxième idée')
    expect(hit.snippet).toContain('Conclusion neutre')
    // The full-text highlight (charStart/charEnd) is narrowed from the whole
    // chunk down to the same picked sentence, so the right-hand viewer marks
    // that passage instead of the entire chunk.
    expect(text.slice(hit.charStart, hit.charEnd)).toBe('Le passage pertinent gagne ici.')
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
