// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrdicabAPI } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { useDocumentStore } from '@renderer/stores'

import { SemanticSearchPanel } from '../SemanticSearchPanel'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

async function renderPanel(onOpenDocument = vi.fn()): Promise<void> {
  const i18n = await createRendererI18n('en')
  render(
    <I18nextProvider i18n={i18n}>
      <SemanticSearchPanel dossierId="dos-1" onOpenDocument={onOpenDocument} />
    </I18nextProvider>
  )
}

describe('SemanticSearchPanel', () => {
  beforeEach(() => {
    useDocumentStore.setState(useDocumentStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  afterEach(() => {
    cleanup()
  })

  it('dispatches a search and lists hits when submitted', async () => {
    const semanticSearch = vi.fn(async () => ({
      success: true as const,
      data: {
        dossierId: 'dos-1',
        query: 'indemnity clause',
        hits: [
          {
            documentId: 'contract.pdf',
            filename: 'contract.pdf',
            charStart: 0,
            charEnd: 40,
            score: 0.82,
            snippet: 'The indemnity clause limits liability.'
          }
        ]
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: { semanticSearch }
    } as unknown as OrdicabAPI

    await renderPanel()

    fireEvent.change(screen.getByLabelText('Search query'), {
      target: { value: 'indemnity clause' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(screen.getByText('contract.pdf')).toBeTruthy()
    })
    expect(screen.getByText('The indemnity clause limits liability.')).toBeTruthy()
    expect(semanticSearch).toHaveBeenCalledWith({
      dossierId: 'dos-1',
      query: 'indemnity clause',
      topK: undefined
    })
  })

  it('opens the document when a hit is clicked', async () => {
    const onOpenDocument = vi.fn()
    useDocumentStore.setState((state) => {
      state.semanticSearchStatesByDossierId['dos-1'] = {
        status: 'ready',
        query: 'q',
        results: {
          dossierId: 'dos-1',
          query: 'q',
          hits: [
            {
              documentId: 'a.pdf',
              filename: 'a.pdf',
              charStart: 0,
              charEnd: 10,
              score: 0.5,
              snippet: 'snippet'
            }
          ]
        },
        error: null
      }
    })

    await renderPanel(onOpenDocument)

    fireEvent.click(screen.getByText('a.pdf'))

    expect(onOpenDocument).toHaveBeenCalledWith({ dossierId: 'dos-1', documentId: 'a.pdf' })
  })

  it('renders the empty-result state without throwing', async () => {
    useDocumentStore.setState((state) => {
      state.semanticSearchStatesByDossierId['dos-1'] = {
        status: 'ready',
        query: 'nothing',
        results: { dossierId: 'dos-1', query: 'nothing', hits: [] },
        error: null
      }
    })

    await renderPanel()

    expect(
      screen.getByText(
        'No matching passages. Try a different query or make sure documents have been extracted.'
      )
    ).toBeTruthy()
  })

  it('renders Ordicab <NL> markers as line breaks in hit previews', async () => {
    useDocumentStore.setState((state) => {
      state.semanticSearchStatesByDossierId['dos-1'] = {
        status: 'ready',
        query: 'newline',
        results: {
          dossierId: 'dos-1',
          query: 'newline',
          hits: [
            {
              documentId: 'note.txt',
              filename: 'note.txt',
              charStart: 0,
              charEnd: 24,
              score: 0.9,
              snippet: 'Ligne 1<NL>Ligne 2'
            }
          ]
        },
        error: null
      }
    })

    await renderPanel()

    expect(
      screen.getByText((_, element) => element?.textContent === 'Ligne 1\nLigne 2')
    ).toBeTruthy()
    expect(screen.queryByText('Ligne 1<NL>Ligne 2')).toBeNull()
  })
})
