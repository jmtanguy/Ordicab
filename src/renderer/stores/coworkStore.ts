/**
 * coworkStore — Zustand store for the Claude Cowork export panel.
 *
 * Thin IPC wrapper: status per dossier, in-flight flags for export/reimport,
 * and the live export progress pushed over cowork:export-progress.
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  CoworkExportProgress,
  CoworkExportResult,
  CoworkReimportResult,
  CoworkStatus
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface CoworkStoreState {
  statusByDossier: Record<string, CoworkStatus>
  isExporting: boolean
  isReimporting: boolean
  progress: CoworkExportProgress | null
  error: string | null
}

interface CoworkStoreActions {
  refreshStatus: (dossierId: string) => Promise<void>
  exportDossier: (dossierId: string) => Promise<CoworkExportResult | null>
  reimportResults: (dossierId: string) => Promise<CoworkReimportResult | null>
  subscribeToExportProgress: () => () => void
  clearError: () => void
}

type CoworkStore = CoworkStoreState & CoworkStoreActions

export const useCoworkStore = create<CoworkStore>()(
  immer((set, get) => ({
    statusByDossier: {},
    isExporting: false,
    isReimporting: false,
    progress: null,
    error: null,

    refreshStatus: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) return

      const result = await api.cowork.status({ dossierId })
      set((state) => {
        if (result.success) {
          state.statusByDossier[dossierId] = result.data
        }
      })
    },

    exportDossier: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return null
      }

      set((state) => {
        state.isExporting = true
        state.progress = null
        state.error = null
      })

      try {
        const result = await api.cowork.export({ dossierId })
        if (!result.success) {
          set((state) => {
            state.error = result.error
          })
          return null
        }
        return result.data
      } finally {
        set((state) => {
          state.isExporting = false
          state.progress = null
        })
        await get().refreshStatus(dossierId)
      }
    },

    reimportResults: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return null
      }

      set((state) => {
        state.isReimporting = true
        state.error = null
      })

      try {
        const result = await api.cowork.reimport({ dossierId })
        if (!result.success) {
          set((state) => {
            state.error = result.error
          })
          return null
        }
        return result.data
      } finally {
        set((state) => {
          state.isReimporting = false
        })
        await get().refreshStatus(dossierId)
      }
    },

    subscribeToExportProgress: () => {
      const api = getOrdicabApi()
      if (!api) return () => {}

      return api.cowork.onExportProgress((event) => {
        set((state) => {
          state.progress = event
        })
      })
    },

    clearError: () => {
      set((state) => {
        state.error = null
      })
    }
  }))
)
