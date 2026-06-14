import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  CalendarSyncOptionsInput,
  CalendarSyncRunResult,
  CalendarSyncSettingsSaveInput,
  CalendarSyncStatus
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface CalendarSyncStoreState {
  status: CalendarSyncStatus | null
  isLoading: boolean
  isSaving: boolean
  isSyncing: boolean
  error: string | null
  /** Result of the last manual "sync now", for the settings dialog feedback. */
  lastRunResult: CalendarSyncRunResult | null
}

interface CalendarSyncStoreActions {
  loadStatus: () => Promise<void>
  saveSettings: (input: CalendarSyncSettingsSaveInput) => Promise<boolean>
  deleteCredentials: () => Promise<boolean>
  setOptions: (input: CalendarSyncOptionsInput) => Promise<void>
  syncNow: () => Promise<void>
  /** Subscribe to main-process status pushes; returns the unsubscribe. */
  subscribeToStatus: () => () => void
}

type CalendarSyncStore = CalendarSyncStoreState & CalendarSyncStoreActions

export const useCalendarSyncStore = create<CalendarSyncStore>()(
  immer((set) => ({
    status: null,
    isLoading: false,
    isSaving: false,
    isSyncing: false,
    error: null,
    lastRunResult: null,

    loadStatus: async () => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      set((state) => {
        state.isLoading = true
        state.error = null
      })
      try {
        const result = await api.calendarSync.getStatus()
        set((state) => {
          if (result.success) state.status = result.data
          else state.error = result.error
        })
      } finally {
        set((state) => {
          state.isLoading = false
        })
      }
    },

    saveSettings: async (input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }
      set((state) => {
        state.isSaving = true
        state.error = null
        state.lastRunResult = null
      })
      try {
        const result = await api.calendarSync.saveSettings(input)
        set((state) => {
          if (result.success) state.status = result.data
          else state.error = result.error
        })
        return result.success
      } finally {
        set((state) => {
          state.isSaving = false
        })
      }
    },

    deleteCredentials: async () => {
      const api = getOrdicabApi()
      if (!api) return false
      const result = await api.calendarSync.deleteCredentials()
      set((state) => {
        if (result.success) {
          state.status = result.data
          state.lastRunResult = null
          state.error = null
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    setOptions: async (input) => {
      const api = getOrdicabApi()
      if (!api) return
      const result = await api.calendarSync.setOptions(input)
      set((state) => {
        if (result.success) state.status = result.data
        else state.error = result.error
      })
    },

    syncNow: async () => {
      const api = getOrdicabApi()
      if (!api) return
      set((state) => {
        state.isSyncing = true
        state.error = null
        state.lastRunResult = null
      })
      try {
        const result = await api.calendarSync.syncNow()
        set((state) => {
          if (result.success) state.lastRunResult = result.data
          else state.error = result.error
        })
      } finally {
        set((state) => {
          state.isSyncing = false
        })
      }
    },

    subscribeToStatus: () => {
      const api = getOrdicabApi()
      if (!api?.calendarSync?.onStatusChanged) {
        return () => undefined
      }
      return api.calendarSync.onStatusChanged((status) => {
        set((state) => {
          state.status = status
        })
      })
    }
  }))
)
