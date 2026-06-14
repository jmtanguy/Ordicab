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
  itemId: string,
  displayName: string,
  text: string,
  chunks: Array<{ charStart: number; charEnd: number; vector: Float32Array }>,
  model = 'Xenova/bge-m3',
  dim = 4
): {
  itemId: string
  displayName: string
  text: string
  chunks: Array<{ charStart: number; charEnd: number; vector: Float32Array }>
  model: string
  dim: number
} {
  return {
    itemId,
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
      pooling: 'cls',
      chunks: doc.chunks.map((c) => ({
        charStart: c.charStart,
        charEnd: c.charEnd,
        vector: encodeVectorBase64(c.vector)
      })),
      createdAt: new Date().toISOString()
    }
  })
  return {
    itemId: doc.itemId,
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

    // The two chunks that don't match the query direction score 0 cosine and
    // fall below the confidence floor, leaving only the genuine match. This is
    // the intended anti-noise behavior, not a regression.
    expect(hits).toHaveLength(1)
    expect(hits[0]!.itemId).toBe('docA.pdf')
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
    // way (cosine 0), so it falls below the confidence floor and is dropped.
    expect(hits[0]!.itemId).toBe('b.pdf')
    expect(hits.every((h) => h.itemId !== 'a.pdf')).toBe(true)
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
    expect(hits[0]!.itemId).toBe('ok.pdf')
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

  it('scores the hit by the picked sentence, not the coarse chunk vector', async () => {
    // Stage-2 ranking: the stored chunk vector matches the query perfectly
    // (cosine 1.0), but the sentence we actually highlight only matches at 0.6.
    // The returned score must be the sentence's 0.6 — so the displayed score and
    // the ranking reflect the highlighted passage, not the whole-chunk average.
    const text = 'Sujet introductif neutre. Le passage pertinent gagne ici. Remarque finale neutre.'
    const doc = await materializeDoc(
      buildIndexedDoc('doc.pdf', 'D', text, [
        { charStart: 0, charEnd: text.length, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    // query (contains "quel") → [1,0,0,0]; the "pertinent" sentence → a unit
    // vector at cosine 0.6 to the query; any other sentence → orthogonal.
    pipelineSpy.mockResolvedValue(async (inputs: unknown) => {
      const arr = Array.isArray(inputs) ? (inputs as string[]) : [String(inputs)]
      const flat = new Float32Array(arr.length * 4)
      for (let i = 0; i < arr.length; i++) {
        const input = arr[i]!
        const vec = input.includes('quel')
          ? [1, 0, 0, 0]
          : input.includes('pertinent')
            ? [0.6, 0.8, 0, 0]
            : [0, 1, 0, 0]
        flat.set(vec, i * 4)
      }
      return { data: flat, dims: [arr.length, 4] }
    })

    const hits = await searchDossier({
      documents: [doc],
      query: 'quelle phrase gagne',
      topK: 1,
      dim: 4
    })

    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect(hit.snippet).toContain('pertinent')
    // Sentence cosine (0.6), NOT the chunk cosine (1.0).
    expect(hit.score).toBeCloseTo(0.6, 5)
  })

  it('ranks single-sentence hits by raw query cosine', async () => {
    // Three documents at increasing cosine to the query [1,0,0,0]. The two above
    // the confidence floor are returned, ordered by cosine; the third is dropped.
    const docs = await Promise.all(
      [
        { id: 'far.pdf', vector: new Float32Array([0.2, 0.9797958971, 0, 0]) }, // cos 0.2 (dropped)
        { id: 'mid.pdf', vector: new Float32Array([0.6, 0.8, 0, 0]) }, // cos 0.6
        { id: 'near.pdf', vector: new Float32Array([0.95, 0.3122498999, 0, 0]) } // cos 0.95
      ].map((c) =>
        materializeDoc(
          buildIndexedDoc(c.id, c.id, `${c.id} only sentence.`, [
            { charStart: 0, charEnd: `${c.id} only sentence.`.length, vector: c.vector }
          ])
        )
      )
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: docs,
      query: 'rank by raw cosine',
      topK: 5,
      dim: 4
    })

    expect(hits.map((h) => h.itemId)).toEqual(['near.pdf', 'mid.pdf'])
    expect(hits[0]!.score).toBeCloseTo(0.95, 5)
    expect(hits[1]!.score).toBeCloseTo(0.6, 5)
  })

  it('drops weak nearest neighbours instead of showing forced semantic matches', async () => {
    const queryVec = new Float32Array([
      0.8642578246792257, -0.0284867090456261, -0.22962450784152322, 0.44657213947276425,
      -0.009634808443288609
    ])
    const chunks = [
      new Float32Array([
        -0.024871623830451384, 0.0991800254042939, -0.40098405713326885, -0.054461191105436145,
        -0.9087301521778401
      ]),
      new Float32Array([
        0.3656566099720655, 0.5612398820515584, -0.6476519906583715, -0.312174898029772,
        -0.1854690551408495
      ]),
      new Float32Array([
        0.6193914069943065, -0.42275436657609583, 0.34446205897978216, -0.5320575097487652,
        0.18945639795427666
      ])
    ]
    const docs = await Promise.all(
      chunks.map((vector, i) =>
        materializeDoc(
          buildIndexedDoc(
            `weak-${i}.pdf`,
            `weak-${i}.pdf`,
            `Weak neighbour ${i}.`,
            [{ charStart: 0, charEnd: `Weak neighbour ${i}.`.length, vector }],
            'Xenova/bge-m3',
            5
          )
        )
      )
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: queryVec,
      dims: [1, 5]
    }))

    const hits = await searchDossier({
      documents: docs,
      query: 'fracture',
      topK: 5,
      dim: 5
    })

    expect(hits).toEqual([])
  })

  it('does not pick generic headings as semantic snippets', async () => {
    const text = 'Discussion\n\nLa fracture du tibia est consolidée avec séquelles.'
    const doc = await materializeDoc(
      buildIndexedDoc('medical.pdf', 'medical.pdf', text, [
        { charStart: 0, charEnd: text.length, vector: new Float32Array([1, 0, 0, 0]) }
      ])
    )

    pipelineSpy.mockResolvedValue(async () => ({
      data: new Float32Array([1, 0, 0, 0]),
      dims: [1, 4]
    }))

    const hits = await searchDossier({
      documents: [doc],
      query: 'fracture tibia',
      topK: 1,
      dim: 4
    })

    expect(hits).toHaveLength(1)
    expect(hits[0]!.snippet).toBe('La fracture du tibia est consolidée avec séquelles.')
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
      itemId: 'bad.pdf',
      displayName: 'bad',
      cachePath: '/does/not/exist.json'
    }

    const count = await preloadDossierIndex([docOk, docBad], {}, 4)
    expect(count).toBe(1)
  })
})
