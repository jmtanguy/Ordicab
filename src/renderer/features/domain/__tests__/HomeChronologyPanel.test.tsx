// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'
import { useDossierStore, useReminderStore } from '@renderer/stores'

import { HomeChronologyPanel } from '../HomeChronologyPanel'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  useDossierStore.setState(useDossierStore.getInitialState(), true)
  useReminderStore.setState(useReminderStore.getInitialState(), true)
})

describe('HomeChronologyPanel', () => {
  it('keeps existing chronology rows visible while a refresh is running', async () => {
    const i18n = await createRendererI18n('en')

    useDossierStore.setState({
      dossiers: [
        {
          slug: 'dos-1',
          uuid: 'uuid-dos-1',
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
            uuid: 'kd-1',
            dossierId: 'dos-1',
            label: 'Audience de mise en état',
            date: '2099-06-10'
          },
          billingItemUuids: []
        }
      ],
      isChronologyLoading: true
    })

    render(
      <I18nextProvider i18n={i18n}>
        <HomeChronologyPanel onOpenDossier={vi.fn()} onConvertKeyDateToBilling={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.getByText('Audience de mise en état')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Client Alpha' })).toBeTruthy()
  })

  it('shows the add-event button even with no dossiers', async () => {
    const i18n = await createRendererI18n('en')

    useDossierStore.setState({ dossiers: [], chronologyEntries: [] })

    render(
      <I18nextProvider i18n={i18n}>
        <HomeChronologyPanel onOpenDossier={vi.fn()} onConvertKeyDateToBilling={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.getByRole('button', { name: 'Add an event' })).toBeTruthy()
  })

  it('refreshes the upcoming summary when the local day changes', async () => {
    const i18n = await createRendererI18n('en')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 6, 9, 0, 0))

    useDossierStore.setState({
      dossiers: [],
      chronologyEntries: [
        {
          dossierId: '__general__',
          dossierName: '',
          isGeneral: true,
          keyDate: {
            uuid: 'today',
            label: 'Today deadline',
            date: '2026-06-06'
          },
          billingItemUuids: []
        },
        {
          dossierId: '__general__',
          dossierName: '',
          isGeneral: true,
          keyDate: {
            uuid: 'tomorrow',
            label: 'Tomorrow deadline',
            date: '2026-06-07'
          },
          billingItemUuids: []
        },
        {
          dossierId: '__general__',
          dossierName: '',
          isGeneral: true,
          keyDate: {
            uuid: 'next-week',
            label: 'Next week deadline',
            date: '2026-06-08'
          },
          billingItemUuids: []
        }
      ]
    })

    render(
      <I18nextProvider i18n={i18n}>
        <HomeChronologyPanel onOpenDossier={vi.fn()} onConvertKeyDateToBilling={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.getByText('2 deadline(s) this week')).toBeTruthy()
    expect(screen.getByText('1 today')).toBeTruthy()
    expect(screen.getByText('1 tomorrow')).toBeTruthy()

    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 60 * 1000 + 2000)
    })

    expect(screen.getByText('1 deadline(s) this week')).toBeTruthy()
    expect(screen.getByText('1 today')).toBeTruthy()
    expect(screen.queryByText('1 tomorrow')).toBeNull()
  })

  it('renders a general event with the "No case" badge and opens the editor (not the dossier) on click', async () => {
    const i18n = await createRendererI18n('en')
    const onOpenDossier = vi.fn()

    useDossierStore.setState({
      dossiers: [],
      chronologyEntries: [
        {
          dossierId: '__general__',
          dossierName: '',
          isGeneral: true,
          keyDate: {
            uuid: 'gkd-1',
            label: 'Personal deadline',
            date: '2099-06-10'
          },
          billingItemUuids: []
        }
      ]
    })

    render(
      <I18nextProvider i18n={i18n}>
        <HomeChronologyPanel onOpenDossier={onOpenDossier} onConvertKeyDateToBilling={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.getByText('No case')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Personal deadline' }))

    // Opens the unified event dialog instead of navigating to a dossier. The
    // dialog is identified by its editable Label field (the old free-text hint
    // was dropped in the chronology refactor).
    expect(onOpenDossier).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Label/)).toBeTruthy()
  })
})
