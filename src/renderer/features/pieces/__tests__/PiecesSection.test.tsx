// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OrdicabAPI, PieceRecord } from '@shared/types'
import { ToastProvider } from '@renderer/contexts/ToastContext'
import { createRendererI18n } from '@renderer/i18n'
import { useDocumentStore, usePieceStore } from '@renderer/stores'

import { PiecesSection } from '../PiecesSection'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

const DOSSIER = { slug: 'dos-1', name: 'Client Test', juridiction: 'TJ Paris' }

function makePiece(overrides: Partial<PieceRecord>): PieceRecord {
  return {
    uuid: overrides.uuid ?? `piece-${overrides.pieceNumber}`,
    pieceNumber: overrides.pieceNumber ?? 1,
    documentUuid: overrides.documentUuid ?? 'uuid-1',
    sourceFilename: overrides.sourceFilename ?? 'contrat.pdf',
    title: overrides.title ?? 'Contrat',
    addedAt: '2026-06-01T08:00:00.000Z',
    ...overrides
  }
}

async function renderSection(): Promise<void> {
  const i18n = await createRendererI18n('fr')
  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <PiecesSection dossier={DOSSIER} />
      </ToastProvider>
    </I18nextProvider>
  )
}

describe('PiecesSection', () => {
  beforeEach(() => {
    usePieceStore.setState(usePieceStore.getInitialState(), true)
    useDocumentStore.setState(useDocumentStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  afterEach(() => {
    cleanup()
  })

  it('renders pieces sorted by number with their badges and flags missing sources', async () => {
    usePieceStore.setState((state) => {
      state.piecesByDossierId[DOSSIER.slug] = [
        makePiece({
          pieceNumber: 1,
          documentUuid: 'uuid-present',
          title: 'Contrat de bail',
          communicatedAt: '2026-06-02T10:00:00.000Z'
        }),
        makePiece({
          pieceNumber: 3,
          documentUuid: 'uuid-gone',
          title: 'Photographie des lieux'
        })
      ]
    })
    useDocumentStore.setState((state) => {
      state.documentsByDossierId[DOSSIER.slug] = [
        {
          path: 'contrat.pdf',
          uuid: 'uuid-present',
          dossierId: DOSSIER.slug,
          filename: 'contrat.pdf',
          byteLength: 10,
          relativePath: 'contrat.pdf',
          modifiedAt: '2026-06-01T08:00:00.000Z',
          tags: [],
          textExtraction: { state: 'extractable', isExtractable: true }
        }
      ]
    })

    await renderSection()

    expect(screen.getByText('Contrat de bail')).toBeTruthy()
    expect(screen.getByText('Photographie des lieux')).toBeTruthy()
    // Permanent numbers shown, gap preserved (1 then 3).
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    // Communicated badge for piece 1, missing-source flag for piece 3 only.
    expect(screen.getByText(/Communiquée le/)).toBeTruthy()
    expect(screen.getAllByText('Source manquante')).toHaveLength(1)
    expect(screen.getByText('Non communiquée')).toBeTruthy()
  })

  it('shows the empty state and disables generation when no piece is coted', async () => {
    await renderSection()

    expect(screen.getByText(/Aucune pièce cotée/)).toBeTruthy()
    const generateButton = screen.getByRole('button', { name: 'Générer…' })
    expect((generateButton as HTMLButtonElement).disabled).toBe(true)
  })
})
