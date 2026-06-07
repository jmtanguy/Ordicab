import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  foldDiacritics,
  keywordSearchDossier
} from '../keywordSearchService'
import type { IndexedDocument } from '../textSearchShared'

let counter = 0
async function makeDoc(documentId: string, text: string): Promise<IndexedDocument> {
  const dir = await mkdtemp(join(tmpdir(), 'kwsearch-'))
  const path = join(dir, `cache-${counter++}.json`)
  await writeFile(path, JSON.stringify({ version: 3, text, isEmpty: false }), 'utf8')
  return { documentId, displayName: documentId, cachePath: path }
}

describe('foldDiacritics', () => {
  it('folds French accents to base letters preserving length', () => {
    const input = 'École à Châteauroux — garçon élevé'
    const folded = foldDiacritics(input)
    expect(folded).toBe('Ecole a Chateauroux — garcon eleve')
    expect(folded.length).toBe(input.length)
  })

  it('leaves unaccented text unchanged', () => {
    expect(foldDiacritics('plain ascii text')).toBe('plain ascii text')
  })
})

describe('keywordSearchDossier', () => {
  it('returns no hit when the keyword is absent', async () => {
    const docs = [
      await makeDoc('mariage.docx', 'Extrait d acte de mariage. Mairie de Lyon 6e arrondissement.'),
      await makeDoc('pension.docx', 'Le montant de la pension alimentaire est fixe.')
    ]
    const hits = await keywordSearchDossier({ documents: docs, query: 'école' })
    expect(hits).toEqual([])
  })

  it('matches a literal keyword and returns the document', async () => {
    const docs = [
      await makeDoc('scolarite.docx', "Certificat de scolarité de l'enfant inscrit à l'école primaire."),
      await makeDoc('mariage.docx', 'Extrait acte de mariage. Mairie de Lyon.')
    ]
    const hits = await keywordSearchDossier({ documents: docs, query: 'école' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.documentId).toBe('scolarite.docx')
  })

  it('is case- and accent-insensitive', async () => {
    const doc = await makeDoc('doc.docx', "Inscription à l'ECOLE communale.")
    const hits = await keywordSearchDossier({ documents: [doc], query: 'École' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.documentId).toBe('doc.docx')
  })

  it('matches the singular/plural variant', async () => {
    const doc = await makeDoc('doc.docx', 'La garde des enfants est partagée.')
    const hits = await keywordSearchDossier({ documents: [doc], query: 'enfant' })
    expect(hits).toHaveLength(1)
  })

  it('produces correct full-text offsets on accented text', async () => {
    const text = "Première phrase neutre. Inscription à l'école primaire de la ville. Conclusion."
    const doc = await makeDoc('doc.docx', text)
    const hits = await keywordSearchDossier({ documents: [doc], query: 'école' })
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    // The highlighted span must be the sentence that contains "école",
    // sliced from the ORIGINAL (accented) text via the returned offsets.
    expect(text.slice(hit.charStart, hit.charEnd)).toContain('école')
    expect(text.slice(hit.charStart, hit.charEnd)).toBe(
      "Inscription à l'école primaire de la ville."
    )
  })

  it('ranks documents matching more query words higher, one hit per document', async () => {
    const docs = [
      await makeDoc('one.docx', 'La pension est due.'),
      await makeDoc('both.docx', 'La pension alimentaire est due.')
    ]
    const hits = await keywordSearchDossier({ documents: docs, query: 'pension alimentaire' })
    expect(hits).toHaveLength(2)
    expect(hits[0]!.documentId).toBe('both.docx')
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score)
  })

  it('returns [] for an empty or stop-word-only query', async () => {
    const doc = await makeDoc('doc.docx', 'du texte quelconque ici présent')
    expect(await keywordSearchDossier({ documents: [doc], query: '   ' })).toEqual([])
    expect(await keywordSearchDossier({ documents: [doc], query: 'de la le' })).toEqual([])
  })

  it('skips documents whose cache is empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kwsearch-'))
    const path = join(dir, 'empty.json')
    await writeFile(path, JSON.stringify({ version: 3, text: '', isEmpty: true }), 'utf8')
    const doc: IndexedDocument = { documentId: 'empty.docx', displayName: 'empty', cachePath: path }
    expect(await keywordSearchDossier({ documents: [doc], query: 'école' })).toEqual([])
  })
})
