import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { UpdaterProgressPayload, UpdaterStatus } from '@shared/types'

import { getOrdicabApi } from './ipc'

interface UpdaterStoreState {
  status: UpdaterStatus
  progress: UpdaterProgressPayload | null
  isSubscribed: boolean
}

interface UpdaterStoreActions {
  subscribe: () => void
  unsubscribe: () => void
  startDownload: () => Promise<void>
  installNow: () => Promise<void>
  installOnQuit: () => Promise<void>
  dismiss: () => Promise<void>
}

type UpdaterStore = UpdaterStoreState & UpdaterStoreActions

let stateUnsubscribe: (() => void) | null = null
let progressUnsubscribe: (() => void) | null = null

export const useUpdaterStore = create<UpdaterStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    status: { kind: 'idle' },
    progress: null,
    isSubscribed: false,

    subscribe: () => {
      if (useUpdaterStore.getState().isSubscribed) {
        return
      }

      const api = getOrdicabApi()
      if (!api?.updater) {
        return
      }

      stateUnsubscribe = api.updater.onState((next) => {
        set((state) => {
          state.status = next
          if (next.kind === 'downloaded' || next.kind === 'idle' || next.kind === 'error') {
            state.progress = null
          }
        })
      })

      progressUnsubscribe = api.updater.onProgress((progress) => {
        set((state) => {
          state.progress = progress
        })
      })

      set((state) => {
        state.isSubscribed = true
      })
    },

    unsubscribe: () => {
      stateUnsubscribe?.()
      progressUnsubscribe?.()
      stateUnsubscribe = null
      progressUnsubscribe = null
      set((state) => {
        state.isSubscribed = false
      })
    },

    startDownload: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return
      }
      await api.updater.startDownload()
    },

    installNow: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return
      }
      await api.updater.installNow()
    },

    installOnQuit: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return
      }
      await api.updater.installOnQuit()
      set((state) => {
        state.status = { kind: 'idle' }
        state.progress = null
      })
    },

    dismiss: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return
      }
      await api.updater.dismiss()
      set((state) => {
        state.status = { kind: 'idle' }
        state.progress = null
      })
    }
  }))
)
