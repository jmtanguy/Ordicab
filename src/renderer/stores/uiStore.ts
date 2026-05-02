import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { AppLocale, DomainStatusSnapshot, IpcResult } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import type { EulaStatus } from '@shared/contracts/app'
import type { OrdicabDataChangedEvent } from '@shared/contracts/documents'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

type VersionStatus = 'idle' | 'loading' | 'ready' | 'error'
type ActiveView = 'onboarding' | 'dashboard'
type ActiveDashboardPanel = 'grid' | 'detail'

export function resolveActiveView(status: DomainStatusSnapshot): ActiveView {
  if (!status.registeredDomainPath || !status.isAvailable) {
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
}

interface UiStoreActions {
  bootstrap: () => Promise<void>
  applyDomainStatus: (status: DomainStatusSnapshot) => void
  goToOnboarding: () => void
  clearPendingDomainChange: () => void
  openDossierDetail: (dossierId: string) => void
  closeDossierDetail: () => void
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
      set((state) => {
        state.activeView = resolveActiveView(status)
        if (state.activeView !== 'dashboard') {
          state.activeDashboardPanel = 'grid'
          state.activeDossierId = null
        }
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
