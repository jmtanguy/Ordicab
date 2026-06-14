// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DOSSIER_NAME_REFERENCE_LABEL, type DossierDetail } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { useTimerStore } from '@renderer/stores/timerStore'

import { Sidebar } from '../Sidebar'

const activeDossier: DossierDetail = {
  slug: 'dos-1',
  uuid: 'uuid-dos-1',
  name: 'Ancien nom',
  type: '',
  status: 'active',
  registeredAt: '2026-03-13T08:30:00.000Z',
  updatedAt: '2026-03-13T09:00:00.000Z',
  lastOpenedAt: null,
  nextUpcomingKeyDate: null,
  nextUpcomingKeyDateLabel: null,
  feeAgreements: [],
  billingItems: [],
  keyDates: [],
  keyReferences: [
    {
      uuid: 'name-reference',
      dossierId: 'dos-1',
      label: DOSSIER_NAME_REFERENCE_LABEL,
      value: 'Ancien nom'
    }
  ],
  notes: []
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useTimerStore.setState(useTimerStore.getInitialState(), true)
})

describe('Sidebar', () => {
  it('edits the active dossier settings from the level 2 title card', async () => {
    const i18n = await createRendererI18n('en')
    const onRenameDossier = vi.fn(async () => true)

    render(
      <I18nextProvider i18n={i18n}>
        <Sidebar
          destination="dossiers"
          activeDossier={activeDossier}
          activeDossierId={activeDossier.slug}
          activeSection="contacts"
          isDetailLoading={false}
          versionLabel="Ordicab 1.0.0"
          dossiers={[]}
          isDossierLoading={false}
          statusFilter="all"
          sortMode="alphabetical"
          searchQuery=""
          onSelectDestination={vi.fn()}
          onOpenDossier={vi.fn()}
          onOpenPicker={vi.fn()}
          onSetStatusFilter={vi.fn()}
          onSetSortMode={vi.fn()}
          onSetSearchQuery={vi.fn()}
          onCloseDossier={vi.fn()}
          onSelectSection={vi.fn()}
          onRenameDossier={onRenameDossier}
          onUnregisterDossier={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit dossier' }))
    fireEvent.change(screen.getByLabelText('Dossier name reference'), {
      target: { value: 'Nouveau nom' }
    })
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'completed' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onRenameDossier).toHaveBeenCalledWith({
        uuid: 'name-reference',
        dossierId: 'dos-1',
        label: DOSSIER_NAME_REFERENCE_LABEL,
        value: 'Nouveau nom'
      })
      expect(onRenameDossier).toHaveBeenCalledWith({
        uuid: undefined,
        dossierId: 'dos-1',
        label: 'Statut',
        value: 'completed'
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit dossier' })).toBeNull()
    })
  })

  it('closes after renaming without calling metadata update when metadata did not change', async () => {
    const i18n = await createRendererI18n('en')
    const onRenameDossier = vi.fn(async () => true)

    render(
      <I18nextProvider i18n={i18n}>
        <Sidebar
          destination="dossiers"
          activeDossier={activeDossier}
          activeDossierId={activeDossier.slug}
          activeSection="contacts"
          isDetailLoading={false}
          versionLabel="Ordicab 1.0.0"
          dossiers={[]}
          isDossierLoading={false}
          statusFilter="all"
          sortMode="alphabetical"
          searchQuery=""
          onSelectDestination={vi.fn()}
          onOpenDossier={vi.fn()}
          onOpenPicker={vi.fn()}
          onSetStatusFilter={vi.fn()}
          onSetSortMode={vi.fn()}
          onSetSearchQuery={vi.fn()}
          onCloseDossier={vi.fn()}
          onSelectSection={vi.fn()}
          onRenameDossier={onRenameDossier}
          onUnregisterDossier={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit dossier' }))
    fireEvent.change(screen.getByLabelText('Dossier name reference'), {
      target: { value: 'Nouveau nom' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onRenameDossier).toHaveBeenCalledOnce()
      expect(screen.queryByRole('dialog', { name: 'Edit dossier' })).toBeNull()
    })
  })

  it('saves tribunal as a key reference without requiring dossier metadata update', async () => {
    const i18n = await createRendererI18n('en')
    const onRenameDossier = vi.fn(async () => true)

    render(
      <I18nextProvider i18n={i18n}>
        <Sidebar
          destination="dossiers"
          activeDossier={activeDossier}
          activeDossierId={activeDossier.slug}
          activeSection="contacts"
          isDetailLoading={false}
          versionLabel="Ordicab 1.0.0"
          dossiers={[]}
          isDossierLoading={false}
          statusFilter="all"
          sortMode="alphabetical"
          searchQuery=""
          onSelectDestination={vi.fn()}
          onOpenDossier={vi.fn()}
          onOpenPicker={vi.fn()}
          onSetStatusFilter={vi.fn()}
          onSetSortMode={vi.fn()}
          onSetSearchQuery={vi.fn()}
          onCloseDossier={vi.fn()}
          onSelectSection={vi.fn()}
          onRenameDossier={onRenameDossier}
          onUnregisterDossier={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit dossier' }))
    fireEvent.change(screen.getByLabelText('Court'), {
      target: { value: 'Tribunal judiciaire de Paris' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onRenameDossier).toHaveBeenCalledWith({
        uuid: undefined,
        dossierId: 'dos-1',
        label: 'Tribunal',
        value: 'Tribunal judiciaire de Paris'
      })
      expect(screen.queryByRole('dialog', { name: 'Edit dossier' })).toBeNull()
    })
  })

  it('restores the save button when dossier settings save fails', async () => {
    const i18n = await createRendererI18n('en')
    const onRenameDossier = vi.fn(async () => {
      throw new Error('IPC unavailable')
    })

    render(
      <I18nextProvider i18n={i18n}>
        <Sidebar
          destination="dossiers"
          activeDossier={activeDossier}
          activeDossierId={activeDossier.slug}
          activeSection="contacts"
          isDetailLoading={false}
          versionLabel="Ordicab 1.0.0"
          dossiers={[]}
          isDossierLoading={false}
          statusFilter="all"
          sortMode="alphabetical"
          searchQuery=""
          onSelectDestination={vi.fn()}
          onOpenDossier={vi.fn()}
          onOpenPicker={vi.fn()}
          onSetStatusFilter={vi.fn()}
          onSetSortMode={vi.fn()}
          onSetSearchQuery={vi.fn()}
          onCloseDossier={vi.fn()}
          onSelectSection={vi.fn()}
          onRenameDossier={onRenameDossier}
          onUnregisterDossier={vi.fn(async () => true)}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit dossier' }))
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'completed' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Unable to save dossier settings.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
    })
  })
})
