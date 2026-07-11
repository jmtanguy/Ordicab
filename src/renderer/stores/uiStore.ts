import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  AppLocale,
  DomainStatusSnapshot,
  DossierFeeAgreement,
  IpcResult,
  KeyDate,
  SourceFeeAgreementBillingKind
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import type { EulaStatus } from '@shared/contracts/app'
import type { OrdicabDataChangedEvent } from '@shared/contracts/documents'

type PendingBillingConversion =
  | { dossierId: string; source: 'keyDate'; keyDate: KeyDate }
  | {
      dossierId: string
      source: 'feeAgreement'
      agreement: DossierFeeAgreement
      feeAgreementConversionKind: SourceFeeAgreementBillingKind
    }

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'
import { useDomainStore } from './domainStore'
import { resolveOnboardingComplete, useOnboardingStore } from './onboardingStore'

type VersionStatus = 'idle' | 'loading' | 'ready' | 'error'
type ActiveView = 'onboarding' | 'dashboard'
type ActiveDashboardPanel = 'grid' | 'detail'

function resolveActiveView(status: DomainStatusSnapshot, onboardingComplete: boolean): ActiveView {
  if (!status.registeredDomainPath || !status.isAvailable) {
    return 'onboarding'
  }

  // Domain is registered and available, but keep the guided wizard up until the
  // user finishes or skips it (see resolveOnboardingComplete for the fail-open
  // rule that keeps existing, populated domains out of the wizard).
  if (!onboardingComplete) {
    return 'onboarding'
  }

  return 'dashboard'
}

interface UiStoreState {
  activeView: ActiveView
  activeDashboardPanel: ActiveDashboardPanel
  activeDossierId: string | null
  isPendingDomainChange: boolean
  versionStatus: VersionStatus
  versionLabel: string
  error: string | null
  isSavingLocale: boolean
  pendingBillingConversion: PendingBillingConversion | null
  /**
   * Level-2 dossier section another feature asked to open (e.g. the AI chat
   * navigating to 'redaction' after document_augment). Consumed by AppShell.
   */
  pendingSectionNavigation: string | null
}

interface UiStoreActions {
  bootstrap: () => Promise<void>
  applyDomainStatus: (status: DomainStatusSnapshot) => void
  /** Marks the guided onboarding finished and routes immediately to the dashboard. */
  completeOnboardingAndEnterDashboard: () => void
  /**
   * Leaves the wizard without completing any step. Returns to the dashboard and,
   * when the domain is already configured (fail-open rule), restores the
   * `completedAt` flag so the gate does not bounce the user back into onboarding.
   */
  exitOnboardingToDashboard: () => void
  goToOnboarding: () => void
  clearPendingDomainChange: () => void
  openDossierDetail: (dossierId: string) => void
  closeDossierDetail: () => void
  requestBillingConversion: (input: PendingBillingConversion) => void
  consumePendingBillingConversion: () => PendingBillingConversion | null
  requestSectionNavigation: (section: string) => void
  clearPendingSectionNavigation: () => void
  persistLocale: (locale: AppLocale) => Promise<boolean>
  /** Reads the EULA status for the requested locale. Components must not call IPC directly. */
  getEulaStatus: (locale: AppLocale) => Promise<IpcResult<EulaStatus>>
  /** Persists EULA acceptance for the given version + locale. */
  acceptEula: (input: { version: string; locale: AppLocale }) => Promise<IpcResult<EulaStatus>>
  /** Asks the OS to open the given path (allowed paths only — see main handler). */
  openFolder: (path: string) => Promise<IpcResult<null>>
  /**
   * Subscribes to filesystem-driven Ordicab data change events. The handler is
   * defined by the caller (typically the app shell) so it can dispatch to the
   * relevant feature stores; only the IPC bridging lives here.
   */
  subscribeToOrdicabDataChanged: (listener: (event: OrdicabDataChangedEvent) => void) => () => void
}

type UiStore = UiStoreState & UiStoreActions

export const useUiStore = create<UiStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    activeView: 'onboarding',
    activeDashboardPanel: 'grid',
    activeDossierId: null,
    isPendingDomainChange: false,
    versionStatus: 'idle',
    versionLabel: 'Pending',
    error: null,
    isSavingLocale: false,
    pendingBillingConversion: null,
    pendingSectionNavigation: null,
    requestSectionNavigation: (section) => {
      set((state) => {
        state.pendingSectionNavigation = section
      })
    },
    clearPendingSectionNavigation: () => {
      set((state) => {
        state.pendingSectionNavigation = null
      })
    },
    bootstrap: async () => {
      if (useUiStore.getState().versionStatus !== 'idle') return

      const api = getOrdicabApi()

      set((state) => {
        state.versionStatus = 'loading'
      })

      if (!api) {
        set((state) => {
          state.versionStatus = 'error'
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.versionLabel = 'Bridge unavailable'
        })
        return
      }

      const result = await api.app.version()

      set((state) => {
        if (!result.success) {
          state.versionStatus = 'error'
          state.error = result.error
          state.versionLabel = result.error
          return
        }

        state.versionStatus = 'ready'
        state.versionLabel = `${result.data.name} ${result.data.version}`
        state.error = null
      })
    },
    applyDomainStatus: (status) => {
      const onboardingComplete = resolveOnboardingComplete(
        useOnboardingStore.getState().progress,
        status.dossierCount
      )
      set((state) => {
        state.activeView = resolveActiveView(status, onboardingComplete)
        if (state.activeView !== 'dashboard') {
          state.activeDashboardPanel = 'grid'
          state.activeDossierId = null
        }
      })
    },
    completeOnboardingAndEnterDashboard: () => {
      useOnboardingStore.getState().finishOnboarding()
      set((state) => {
        state.activeView = 'dashboard'
        state.activeDashboardPanel = 'grid'
      })
    },
    exitOnboardingToDashboard: () => {
      const alreadyConfigured = resolveOnboardingComplete(
        useOnboardingStore.getState().progress,
        useDomainStore.getState().snapshot.dossierCount
      )
      // Only persist completion when the domain is already usable; a brand-new
      // empty setup stays "incomplete" so the gate can guide the user later.
      if (alreadyConfigured) {
        useOnboardingStore.getState().finishOnboarding()
      }
      set((state) => {
        state.activeView = 'dashboard'
        state.activeDashboardPanel = 'grid'
        state.activeDossierId = null
        state.isPendingDomainChange = false
      })
    },
    goToOnboarding: () => {
      set((state) => {
        state.activeView = 'onboarding'
        state.activeDashboardPanel = 'grid'
        state.activeDossierId = null
        state.isPendingDomainChange = true
      })
    },
    clearPendingDomainChange: () => {
      set((state) => {
        state.isPendingDomainChange = false
      })
    },
    openDossierDetail: (dossierId) => {
      set((state) => {
        state.activeDashboardPanel = 'detail'
        state.activeDossierId = dossierId
      })
    },
    closeDossierDetail: () => {
      set((state) => {
        state.activeDashboardPanel = 'grid'
        state.activeDossierId = null
      })
    },
    requestBillingConversion: (input) => {
      set((state) => {
        state.activeDashboardPanel = 'detail'
        state.activeDossierId = input.dossierId
        state.pendingBillingConversion = input
      })
    },
    consumePendingBillingConversion: () => {
      let current: PendingBillingConversion | null = null
      set((state) => {
        current = state.pendingBillingConversion as PendingBillingConversion | null
        if (state.pendingBillingConversion) {
          state.pendingBillingConversion = null
        }
      })
      return current
    },
    persistLocale: async (locale) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }

      set((state) => {
        state.isSavingLocale = true
        state.error = null
      })

      const result = await api.app.setLocale({ locale })

      set((state) => {
        state.isSavingLocale = false
        if (!result.success) {
          state.error = result.error
        }
      })

      return result.success
    },
    getEulaStatus: async (locale) => {
      const api = getOrdicabApi()
      if (!api?.app?.eulaStatus) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }
      return api.app.eulaStatus({ locale })
    },
    acceptEula: async (input) => {
      const api = getOrdicabApi()
      if (!api?.app?.eulaAccept) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }
      return api.app.eulaAccept(input)
    },
    openFolder: async (path) => {
      const api = getOrdicabApi()
      if (!api?.app?.openFolder) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }
      return api.app.openFolder({ path })
    },
    subscribeToOrdicabDataChanged: (listener) => {
      const api = getOrdicabApi()
      if (!api?.ordicab?.onDataChanged) {
        return () => undefined
      }
      return api.ordicab.onDataChanged(listener)
    }
  }))
)
