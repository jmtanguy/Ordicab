import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { DomainSelectionResult, DomainStatusSnapshot } from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface DomainStoreState {
  snapshot: DomainStatusSnapshot
  isLoading: boolean
  hasLoadedOnce: boolean
  error: string | null
}

interface DomainStoreActions {
  refreshStatus: () => Promise<DomainStatusSnapshot>
  selectDomain: () => Promise<DomainSelectionResult>
}

type DomainStore = DomainStoreState & DomainStoreActions

const initialSnapshot: DomainStatusSnapshot = {
  registeredDomainPath: null,
  isAvailable: false,
  dossierCount: 0
}

export const useDomainStore = create<DomainStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    snapshot: initialSnapshot,
    isLoading: false,
    hasLoadedOnce: false,
    error: null,
    refreshStatus: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.hasLoadedOnce = true
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return useDomainStore.getState().snapshot
      }

      set((state) => {
        state.isLoading = true
        state.error = null
      })

      const result = await api.domain.status()

      set((state) => {
        state.hasLoadedOnce = true
        state.isLoading = false
        if (result.success) {
          state.snapshot = result.data
          return
        }

        state.error = result.error
      })

      return useDomainStore.getState().snapshot
    },
    selectDomain: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.hasLoadedOnce = true
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return { selectedPath: null }
      }

      set((state) => {
        state.isLoading = true
        state.error = null
      })

      const result = await api.domain.select()

      if (!result.success) {
        set((state) => {
          state.hasLoadedOnce = true
          state.isLoading = false
          state.error = result.error
        })
        return { selectedPath: null }
      }

      if (!result.data.selectedPath) {
        set((state) => {
          state.hasLoadedOnce = true
          state.isLoading = false
        })
        return result.data
      }

      const statusResult = await api.domain.status()

      set((state) => {
        state.hasLoadedOnce = true
        state.isLoading = false
        if (!statusResult.success) {
          state.error = statusResult.error
          return
        }

        state.snapshot = statusResult.data
        state.error = null
      })

      return result.data
    }
  }))
)
