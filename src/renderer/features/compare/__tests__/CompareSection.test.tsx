// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ComparisonResult, DocumentRecord, OrdicabAPI } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { useCompareStore, useDocumentStore } from '@renderer/stores'

import { CompareSection } from '../CompareSection'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

const DOSSIER = { slug: 'dos-1', name: 'Client Test' }

function makeDocument(overrides: Partial<DocumentRecord>): DocumentRecord {
  const relativePath = overrides.relativePath ?? 'doc.pdf'
  return {
    path: relativePath,
    uuid: `uuid-${relativePath}`,
    dossierId: DOSSIER.slug,
    filename: relativePath.split('/').pop() ?? relativePath,
    byteLength: 10,
    relativePath,
    modifiedAt: '2026-06-01T08:00:00.000Z',
    tags: [],
    textExtraction: { state: 'extractable', isExtractable: true },
    ...overrides
  }
}

function makeResult(overrides: Partial<ComparisonResult>): ComparisonResult {
  return {
    dossierId: DOSSIER.slug,
    oldDocument: { documentPath: 'v1.docx', filename: 'v1.docx', method: 'docx' },
    newDocument: { documentPath: 'v2.pdf', filename: 'v2.pdf', method: 'embedded' },
    blocks: [],
    stats: { addedWords: 0, removedWords: 0, addedBlocks: 0, removedBlocks: 0, modifiedBlocks: 0 },
    pieceReferences: [],
    ...overrides
  }
}

async function renderSection(): Promise<void> {
  const i18n = await createRendererI18n('fr')
  render(
    <I18nextProvider i18n={i18n}>
      <CompareSection dossier={DOSSIER} />
    </I18nextProvider>
  )
}

describe('CompareSection', () => {
  beforeEach(() => {
    useCompareStore.setState(useCompareStore.getInitialState(), true)
    useDocumentStore.setState(useDocumentStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  afterEach(() => {
    cleanup()
  })

  it('lists only extractable documents in the pickers', async () => {
    useDocumentStore.setState((state) => {
      state.documentsByDossierId[DOSSIER.slug] = [
        makeDocument({ relativePath: 'Conclusions/v1.docx' }),
        makeDocument({ relativePath: 'Conclusions/v2.pdf' }),
        makeDocument({
          relativePath: 'photo.jpg',
          textExtraction: { state: 'not-extractable', isExtractable: false }
        })
      ]
    })
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
    })

    await renderSection()

    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toContain('Conclusions/v1.docx')
    expect(options).toContain('Conclusions/v2.pdf')
    expect(options).not.toContain('photo.jpg')
  })

  it('keeps the compare button disabled until two distinct documents are selected', async () => {
    useDocumentStore.setState((state) => {
      state.documentsByDossierId[DOSSIER.slug] = [
        makeDocument({ relativePath: 'v1.docx' }),
        makeDocument({ relativePath: 'v2.pdf' })
      ]
    })
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
    })

    await renderSection()

    const runButton = screen.getByRole('button', { name: 'Comparer' }) as HTMLButtonElement
    expect(runButton.disabled).toBe(true)

    const [oldPicker, newPicker] = screen.getAllByRole('combobox')
    fireEvent.change(oldPicker!, { target: { value: 'v1.docx' } })
    fireEvent.change(newPicker!, { target: { value: 'v1.docx' } })
    expect((screen.getByRole('button', { name: 'Comparer' }) as HTMLButtonElement).disabled).toBe(
      true
    )

    fireEvent.change(newPicker!, { target: { value: 'v2.pdf' } })
    expect((screen.getByRole('button', { name: 'Comparer' }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('renders the diff with added, removed and collapsed blocks plus the stats bar', async () => {
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
      state.status = 'done'
      state.result = makeResult({
        blocks: [
          { type: 'unchanged', segments: [{ kind: 'same', text: 'Socle commun.' }] },
          { type: 'unchanged', segments: [], collapsedCount: 8 },
          { type: 'added', segments: [{ kind: 'added', text: 'Nouveau moyen ajouté.' }] },
          { type: 'removed', segments: [{ kind: 'removed', text: 'Ancien moyen supprimé.' }] }
        ],
        stats: {
          addedWords: 3,
          removedWords: 3,
          addedBlocks: 1,
          removedBlocks: 1,
          modifiedBlocks: 0
        }
      })
    })

    await renderSection()

    expect(screen.getByText('Nouveau moyen ajouté.')).toBeTruthy()
    expect(screen.getByText('Ancien moyen supprimé.')).toBeTruthy()
    expect(screen.getByText(/8 paragraphes inchangés/)).toBeTruthy()
    expect(screen.getByText('+3 mots')).toBeTruthy()
    expect(screen.getByText('−3 mots')).toBeTruthy()
  })

  it('shows the unavailable banner when citation verification could not run', async () => {
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
      state.status = 'done'
      state.result = makeResult({
        citations: { references: [], truncated: false, unavailable: true }
      })
    })

    await renderSection()

    expect(screen.getByText(/Vérification indisponible/)).toBeTruthy()
  })

  it('renders verified citations with their status pill', async () => {
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
      state.status = 'done'
      state.result = makeResult({
        citations: {
          references: [
            {
              reference: 'article 1240 du code civil',
              normalizedReference: 'art. 1240 · Code civil',
              status: 'found',
              confidence: 'high',
              source: 'legifrance',
              matches: [],
              blockIndex: 0
            }
          ],
          truncated: false,
          unavailable: false
        }
      })
    })

    await renderSection()

    expect(screen.getByText('article 1240 du code civil')).toBeTruthy()
    expect(screen.getByText('Trouvée')).toBeTruthy()
  })

  it('renders detected pièces with expanded numbers and excerpt', async () => {
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
      state.status = 'done'
      state.result = makeResult({
        pieceReferences: [
          {
            numbers: [4, 5, 6, 7],
            raw: 'pièces nos 4 à 7',
            excerpt: 'Voir les pièces nos 4 à 7 produites.',
            blockIndex: 2
          }
        ]
      })
    })

    await renderSection()

    expect(screen.getByText('Pièce(s) n° 4, 5, 6, 7')).toBeTruthy()
    expect(screen.getByText(/produites/)).toBeTruthy()
  })

  it('shows an OCR warning when one document came from tesseract', async () => {
    useCompareStore.setState((state) => {
      state.dossierId = DOSSIER.slug
      state.status = 'done'
      state.result = makeResult({
        newDocument: { documentPath: 'scan.pdf', filename: 'scan.pdf', method: 'tesseract' }
      })
    })

    await renderSection()

    expect(screen.getByText(/numérisation \(OCR\)/)).toBeTruthy()
  })
})
