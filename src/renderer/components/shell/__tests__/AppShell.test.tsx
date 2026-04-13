// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcErrorCode, type OrdicabAPI } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'
import {
  useContactStore,
  useDocumentStore,
  useDomainStore,
  useDossierStore,
  useEntityStore,
  useTemplateStore,
  useUiStore
} from '@renderer/stores'

import AppShell from '../AppShell'

vi.mock('../AuroraBackground', () => ({
  AuroraBackground: () => null
}))

vi.mock('../TopNav', () => ({
  TopNav: ({
    activeTab,
    onTabChange
  }: {
    activeTab: 'dossiers' | 'modeles' | 'delegated' | 'parametres'
    onTabChange: (tab: 'dossiers' | 'modeles' | 'delegated' | 'parametres') => void
  }) => (
    <div>
      <div data-testid="top-nav-active-tab">{activeTab}</div>
      <button type="button" onClick={() => onTabChange('parametres')}>
        go-settings
      </button>
    </div>
  )
}))

vi.mock('@renderer/features/domain/DomainDashboard', () => ({
  DomainDashboard: ({
    activeTab,
    onChangeDomain
  }: {
    activeTab: 'dossiers' | 'modeles' | 'delegated' | 'parametres'
    onChangeDomain: () => Promise<void>
  }) => (
    <div>
      <div data-testid="domain-dashboard-active-tab">{activeTab}</div>
      {activeTab === 'parametres' ? (
        <button type="button" onClick={() => void onChangeDomain()}>
          change-domain
        </button>
      ) : null}
    </div>
  )
}))

vi.mock('@renderer/features/onboarding/OnboardingPage', () => ({
  OnboardingPage: ({ onSelectDomain }: { onSelectDomain: () => Promise<void> }) => (
    <div>
      <div data-testid="onboarding-page">onboarding</div>
      <button type="button" onClick={() => void onSelectDomain()}>
        select-domain
      </button>
    </div>
  )
}))

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function installApiStub(): void {
  const statusSnapshots = [
    { registeredDomainPath: '/tmp/domain-a', isAvailable: true, dossierCount: 1 },
    { registeredDomainPath: '/tmp/domain-b', isAvailable: true, dossierCount: 2 }
  ]

  ;(globalThis as MutableGlobal).ordicabAPI = {
    app: {
      version: vi.fn(async () => ({
        success: true as const,
        data: { name: 'Ordicab', version: '1.0.0' }
      })),
      setLocale: vi.fn(async () => ({ success: true as const, data: null }))
    },
    domain: {
      status: vi.fn(async () => ({
        success: true as const,
        data: statusSnapshots.length > 1 ? statusSnapshots.shift()! : statusSnapshots[0]
      })),
      select: vi.fn(async () => ({
        success: true as const,
        data: { selectedPath: '/tmp/domain-b' }
      }))
    },
    dossier: {
      list: vi.fn(async () => ({ success: true as const, data: [] })),
      get: vi.fn(async () => ({
        success: true as const,
        data: {
          id: 'dos-1',
          name: 'Client Alpha',
          registeredAt: '2026-03-13T08:30:00.000Z',
          status: 'active',
          type: '',
          updatedAt: '2026-03-13T09:00:00.000Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null,
          keyDates: [],
          keyReferences: []
        }
      })),
      open: vi.fn(async () => ({
        success: true as const,
        data: {
          id: 'dos-1',
          name: 'Client Alpha',
          registeredAt: '2026-03-13T08:30:00.000Z',
          status: 'active',
          type: '',
          updatedAt: '2026-03-13T09:00:00.000Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null,
          keyDates: [],
          keyReferences: []
        }
      }))
    },
    contact: {
      list: vi.fn(async () => ({ success: true as const, data: [] }))
    },
    entity: {
      get: vi.fn(async () => ({ success: true as const, data: null }))
    },
    template: {
      list: vi.fn(async () => ({ success: true as const, data: [] }))
    },
    ordicab: {
      onDataChanged: vi.fn(() => vi.fn())
    }
  } as unknown as OrdicabAPI
}

afterEach(() => {
  cleanup()
  delete (globalThis as MutableGlobal).ordicabAPI
})

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState(), true)
  useDomainStore.setState(useDomainStore.getInitialState(), true)
  useDossierStore.setState(useDossierStore.getInitialState(), true)
  useContactStore.setState(useContactStore.getInitialState(), true)
  useDocumentStore.setState(useDocumentStore.getInitialState(), true)
  useEntityStore.setState(useEntityStore.getInitialState(), true)
  useTemplateStore.setState(useTemplateStore.getInitialState(), true)
})

function buildOrdicabApiWithDataChanged(
  overrides: Record<string, unknown>,
  setListener: (
    l: (payload: { dossierId: string | null; type: string; changedAt: string }) => void
  ) => void
): OrdicabAPI {
  return {
    app: {
      version: vi.fn(async () => ({
        success: true as const,
        data: { name: 'Ordicab', version: '1.0.0' }
      })),
      setLocale: vi.fn(async () => ({ success: true as const, data: null }))
    },
    domain: {
      status: vi.fn(async () => ({
        success: true as const,
        data: { registeredDomainPath: '/tmp/domain-a', isAvailable: true, dossierCount: 1 }
      })),
      select: vi.fn(async () => ({
        success: true as const,
        data: { selectedPath: '/tmp/domain-a' }
      }))
    },
    dossier: {
      list: vi.fn(async () => ({ success: true as const, data: [] })),
      get: vi.fn(async () => ({ success: true as const, data: null })),
      open: vi.fn(async () => ({ success: true as const, data: null }))
    },
    contact: { list: vi.fn(async () => ({ success: true as const, data: [] })) },
    entity: { get: vi.fn(async () => ({ success: true as const, data: null })) },
    template: { list: vi.fn(async () => ({ success: true as const, data: [] })) },
    ordicab: {
      onDataChanged: vi.fn((listener) => {
        setListener(listener)
        return vi.fn()
      })
    },
    ...overrides
  } as unknown as OrdicabAPI
}

function setValidationState(): void {
  useUiStore.setState({
    ...useUiStore.getInitialState(),
    activeView: 'dashboard',
    activeDashboardPanel: 'detail',
    activeDossierId: 'dos-1',
    versionStatus: 'ready',
    versionLabel: 'Ordicab 1.0.0'
  })
  useDomainStore.setState({
    ...useDomainStore.getInitialState(),
    snapshot: { registeredDomainPath: '/tmp/domain-a', isAvailable: true, dossierCount: 1 },
    isLoading: false,
    hasLoadedOnce: true,
    error: null
  })
}

describe('AppShell', () => {
  it('returns to the dossiers tab after selecting a new domain from settings', async () => {
    installApiStub()
    const i18n = await createRendererI18n('en')

    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab').textContent).toBe('dossiers')
    })

    fireEvent.click(screen.getByRole('button', { name: 'go-settings' }))

    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab').textContent).toBe('parametres')
    })

    fireEvent.click(screen.getByRole('button', { name: 'change-domain' }))

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-page')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'select-domain' }))

    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab').textContent).toBe('dossiers')
    })
  })

  it('shows a warning when Claude writes invalid dossier, contacts, entity, or templates data', async () => {
    const i18n = await createRendererI18n('en')

    // dossier invalid
    let listener1:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      {
        dossier: {
          list: vi.fn(async () => ({ success: true as const, data: [] })),
          get: vi.fn(async () => ({
            success: false as const,
            error: 'Stored dossier metadata is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          })),
          open: vi.fn(async () => ({
            success: false as const,
            error: 'Stored dossier metadata is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          }))
        }
      },
      (l) => {
        listener1 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })
    listener1?.({ dossierId: 'dos-1', type: 'dossier', changedAt: '2026-03-20T12:00:00.000Z' })
    await waitFor(() => {
      expect(
        screen.getByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeTruthy()
    })
    cleanup()
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)

    // contacts invalid
    let listener2:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      {
        dossier: {
          list: vi.fn(async () => ({ success: true as const, data: [] })),
          get: vi.fn(async () => ({
            success: true as const,
            data: {
              id: 'dos-1',
              name: 'Client Alpha',
              registeredAt: '2026-01-01T00:00:00.000Z',
              status: 'active',
              type: '',
              updatedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: null,
              nextUpcomingKeyDate: null,
              nextUpcomingKeyDateLabel: null,
              keyDates: [],
              keyReferences: []
            }
          })),
          open: vi.fn(async () => ({
            success: true as const,
            data: {
              id: 'dos-1',
              name: 'Client Alpha',
              registeredAt: '2026-01-01T00:00:00.000Z',
              status: 'active',
              type: '',
              updatedAt: '2026-01-01T00:00:00.000Z',
              lastOpenedAt: null,
              nextUpcomingKeyDate: null,
              nextUpcomingKeyDateLabel: null,
              keyDates: [],
              keyReferences: []
            }
          }))
        },
        contact: {
          list: vi.fn(async () => ({
            success: false as const,
            error: 'Stored contacts are invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          }))
        }
      },
      (l) => {
        listener2 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })
    listener2?.({ dossierId: 'dos-1', type: 'contacts', changedAt: '2026-03-20T12:00:00.000Z' })
    await waitFor(() => {
      expect(
        screen.getByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeTruthy()
    })
    cleanup()
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)

    // entity invalid
    let listener3:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      {
        entity: {
          get: vi.fn(async () => ({
            success: false as const,
            error: 'Entity profile is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          }))
        }
      },
      (l) => {
        listener3 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })
    listener3?.({ dossierId: null, type: 'entity', changedAt: '2026-03-20T12:00:00.000Z' })
    await waitFor(() => {
      expect(
        screen.getByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeTruthy()
    })
    cleanup()
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)

    // templates invalid
    let listener4:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      {
        template: {
          list: vi.fn(async () => ({
            success: false as const,
            error: 'Templates file is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          }))
        }
      },
      (l) => {
        listener4 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })
    listener4?.({ dossierId: null, type: 'templates', changedAt: '2026-03-20T12:00:00.000Z' })
    await waitFor(() => {
      expect(
        screen.getByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeTruthy()
    })
  })

  it('does not reload contacts when event dossierId does not match active dossier, and clears warning when active dossier changes', async () => {
    const i18n = await createRendererI18n('en')

    // mismatched dossierId
    let listener1:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    const contactListMock = vi.fn(async () => ({ success: true as const, data: [] }))
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      { contact: { list: contactListMock } },
      (l) => {
        listener1 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })

    const callCountBefore = contactListMock.mock.calls.length
    listener1?.({ dossierId: 'dos-OTHER', type: 'contacts', changedAt: '2026-03-20T12:00:00.000Z' })
    await new Promise((r) => setTimeout(r, 50))
    expect(contactListMock.mock.calls.length).toBe(callCountBefore)
    cleanup()
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)

    // warning clears when dossier changes
    let listener2:
      | ((payload: { dossierId: string | null; type: string; changedAt: string }) => void)
      | undefined
    ;(globalThis as MutableGlobal).ordicabAPI = buildOrdicabApiWithDataChanged(
      {
        dossier: {
          list: vi.fn(async () => ({ success: true as const, data: [] })),
          get: vi.fn(async () => ({
            success: false as const,
            error: 'Stored dossier metadata is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          })),
          open: vi.fn(async () => ({
            success: false as const,
            error: 'Stored dossier metadata is invalid.',
            code: IpcErrorCode.VALIDATION_FAILED
          }))
        }
      },
      (l) => {
        listener2 = l
      }
    )
    setValidationState()
    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <AppShell />
        </I18nextProvider>
      </ToastProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('domain-dashboard-active-tab')).toBeTruthy()
    })

    listener2?.({ dossierId: 'dos-1', type: 'dossier', changedAt: '2026-03-20T12:00:00.000Z' })
    await waitFor(() => {
      expect(
        screen.getByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeTruthy()
    })

    useUiStore.setState({ ...useUiStore.getState(), activeDossierId: 'dos-2' })
    await waitFor(() => {
      expect(
        screen.queryByText(
          'Claude wrote data that could not be parsed. Please check the file and try again.'
        )
      ).toBeNull()
    })
  })
})
