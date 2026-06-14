import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { EntityProfile, EntityProfileDraft } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR, requireApi } from './ipc'

interface EntityStoreState {
  profile: EntityProfile | null
  /** Data URL of the imported stamp image (settings preview); null when none. */
  stampDataUrl: string | null
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface EntityStoreActions {
  load: () => Promise<void>
  save: (draft: EntityProfileDraft) => Promise<void>
  importDefaultTemplate: () => Promise<{ imported: boolean; error?: string }>
  openDefaultTemplate: () => Promise<{ ok: boolean; error?: string }>
  removeDefaultTemplate: () => Promise<{ ok: boolean; error?: string }>
  loadStampPreview: () => Promise<void>
  importStamp: () => Promise<{ imported: boolean; error?: string }>
  removeStamp: () => Promise<{ ok: boolean; error?: string }>
}

type EntityStore = EntityStoreState & EntityStoreActions

export const useEntityStore = create<EntityStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    profile: null,
    stampDataUrl: null,
    isLoading: false,
    error: null,
    errorCode: null,
    load: async () => {
      const api = requireApi(set)
      if (!api) return

      set((state) => {
        state.isLoading = true
        state.error = null
        state.errorCode = null
      })

      const result = await api.entity.get()

      set((state) => {
        state.isLoading = false
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.profile = result.data
        state.errorCode = null
      })
    },
    save: async (draft) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.entity.update(draft)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.profile = result.data
        state.error = null
        state.errorCode = null
      })
    },
    importDefaultTemplate: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return { imported: false, error: IPC_NOT_AVAILABLE_ERROR }
      }
      const result = await api.entity.importDefaultTemplate()
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return { imported: false, error: result.error }
      }
      if (!result.data) {
        return { imported: false }
      }
      set((state) => {
        state.profile = result.data
        state.error = null
        state.errorCode = null
      })
      return { imported: true }
    },
    openDefaultTemplate: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return { ok: false, error: IPC_NOT_AVAILABLE_ERROR }
      }
      const result = await api.entity.openDefaultTemplate()
      if (!result.success) {
        return { ok: false, error: result.error }
      }
      return { ok: true }
    },
    removeDefaultTemplate: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return { ok: false, error: IPC_NOT_AVAILABLE_ERROR }
      }
      const result = await api.entity.removeDefaultTemplate()
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return { ok: false, error: result.error }
      }
      set((state) => {
        state.profile = result.data
        state.error = null
        state.errorCode = null
      })
      return { ok: true }
    },
    loadStampPreview: async () => {
      const api = getOrdicabApi()
      if (!api) return
      const result = await api.entity.getStampDataUrl()
      set((state) => {
        state.stampDataUrl = result.success ? result.data : null
      })
    },
    importStamp: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return { imported: false, error: IPC_NOT_AVAILABLE_ERROR }
      }
      const result = await api.entity.importStamp()
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return { imported: false, error: result.error }
      }
      if (!result.data) {
        return { imported: false }
      }
      const preview = await api.entity.getStampDataUrl()
      set((state) => {
        state.profile = result.data
        state.stampDataUrl = preview.success ? preview.data : null
        state.error = null
        state.errorCode = null
      })
      return { imported: true }
    },
    removeStamp: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return { ok: false, error: IPC_NOT_AVAILABLE_ERROR }
      }
      const result = await api.entity.removeStamp()
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return { ok: false, error: result.error }
      }
      set((state) => {
        state.profile = result.data
        state.stampDataUrl = null
        state.error = null
        state.errorCode = null
      })
      return { ok: true }
    }
  }))
)
