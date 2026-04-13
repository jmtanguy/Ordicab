// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'

import { DashboardGrid } from '../DashboardGrid'

afterEach(() => {
  cleanup()
})

describe('DashboardGrid', () => {
  it('renders dossier cards with placeholder type and key-date fields', async () => {
    const i18n = await createRendererI18n('en')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[
              {
                id: 'Client Alpha',
                name: 'Client Alpha',
                status: 'active',
                type: '',
                updatedAt: '2026-03-13T09:00:00.000Z',
                lastOpenedAt: null,
                nextUpcomingKeyDate: null,
                nextUpcomingKeyDateLabel: null
              }
            ]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    expect(markup).toContain('Client Alpha')
    expect(markup).toContain('Active')
    expect(markup).toContain('Type')
    expect(markup).toContain('Next key date')
  })

  it('renders the empty state and registration CTA when no dossiers exist', async () => {
    const i18n = await createRendererI18n('fr')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    expect(markup).toContain('Enregistrer un dossier')
    expect(markup).toContain('Aucun dossier enregistré pour le moment')
  })

  it('renders the duplicate-registration error message when errorCode is INVALID_INPUT', async () => {
    const i18n = await createRendererI18n('en')
    const { IpcErrorCode } = await import('@shared/types')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[]}
            eligibleFolders={[]}
            isLoading={false}
            error="This dossier is already registered."
            errorCode={IpcErrorCode.INVALID_INPUT}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    expect(markup).toContain('This dossier is already registered.')
  })

  it('renders the unregister confirmation panel on the correct card', async () => {
    const i18n = await createRendererI18n('en')

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[
              {
                id: 'Client Alpha',
                name: 'Client Alpha',
                status: 'active',
                type: '',
                updatedAt: '2026-03-13T09:00:00.000Z',
                lastOpenedAt: null,
                nextUpcomingKeyDate: null,
                nextUpcomingKeyDateLabel: null
              }
            ]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    expect(markup).not.toContain('Remove this dossier from Ordicab?')
  })

  it('renders a registered notice with the dossier name', async () => {
    const i18n = await createRendererI18n('en')

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={{ kind: 'registered', dossierName: 'Client Alpha' }}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    expect((await screen.findByRole('region')).textContent).toContain(
      'Client Alpha is now on the dashboard.'
    )
  })

  it('filters dossiers by name from the dashboard search field', async () => {
    const i18n = await createRendererI18n('en')

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[
              {
                id: 'alpha',
                name: 'Client Alpha',
                status: 'active',
                type: '',
                updatedAt: '2026-03-13T09:00:00.000Z',
                lastOpenedAt: null,
                nextUpcomingKeyDate: null,
                nextUpcomingKeyDateLabel: null
              },
              {
                id: 'beta',
                name: 'Client Beta',
                status: 'pending',
                type: '',
                updatedAt: '2026-03-13T09:00:00.000Z',
                lastOpenedAt: null,
                nextUpcomingKeyDate: null,
                nextUpcomingKeyDateLabel: null
              }
            ]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    fireEvent.change(screen.getByLabelText('Search dossiers'), { target: { value: 'beta' } })

    expect(screen.queryByText('Client Alpha')).toBeNull()
    expect(screen.getByText('Client Beta')).toBeTruthy()
  })

  it('renders a filtered empty state when no dossier name matches', async () => {
    const i18n = await createRendererI18n('en')

    render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <DashboardGrid
            dossiers={[
              {
                id: 'alpha',
                name: 'Client Alpha',
                status: 'active',
                type: '',
                updatedAt: '2026-03-13T09:00:00.000Z',
                lastOpenedAt: null,
                nextUpcomingKeyDate: null,
                nextUpcomingKeyDateLabel: null
              }
            ]}
            eligibleFolders={[]}
            isLoading={false}
            error={null}
            errorCode={null}
            notice={null}
            activeDossierId={null}
            statusFilter="all"
            sortMode="alphabetical"
            onLoadEligibleFolders={async () => undefined}
            onOpenDetail={() => undefined}
            onRegister={async () => true}
            onSetStatusFilter={() => undefined}
            onSetSortMode={() => undefined}
            onClearNotice={() => undefined}
          />
        </ToastProvider>
      </I18nextProvider>
    )

    fireEvent.change(screen.getByLabelText('Search dossiers'), { target: { value: 'zzz' } })

    expect(screen.getByText('No dossier matches your filters')).toBeTruthy()
    expect(
      screen.getByText('Try another dossier name or adjust the current status and sort filters.')
    ).toBeTruthy()
  })
})
