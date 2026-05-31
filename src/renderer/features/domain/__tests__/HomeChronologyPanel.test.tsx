// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'
import { useDossierStore } from '@renderer/stores'

import { HomeChronologyPanel } from '../HomeChronologyPanel'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useDossierStore.setState(useDossierStore.getInitialState(), true)
})

describe('HomeChronologyPanel', () => {
  it('keeps existing chronology rows visible while a refresh is running', async () => {
    const i18n = await createRendererI18n('en')

    useDossierStore.setState({
      dossiers: [
        {
          id: 'dos-1',
          name: 'Client Alpha',
          status: 'active',
          type: '',
          updatedAt: '2026-03-13T09:00:00.000Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null
        }
      ],
      chronologyEntries: [
        {
          dossierId: 'dos-1',
          dossierName: 'Client Alpha',
          keyDate: {
            id: 'kd-1',
            dossierId: 'dos-1',
            label: 'Audience de mise en état',
            date: '2099-06-10'
          },
          billingItemIds: []
        }
      ],
      isChronologyLoading: true
    })

    render(
      <I18nextProvider i18n={i18n}>
        <HomeChronologyPanel onOpenDossier={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('Audience de mise en état')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Client Alpha' })).toBeTruthy()
  })
})
