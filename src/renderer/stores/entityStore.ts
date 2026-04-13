import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { EntityProfile, EntityProfileDraft } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface EntityStoreState {
  profile: EntityProfile | null
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface EntityStoreActions {
  load: () => Promise<void>
  save: (draft: EntityProfileDraft) => Promise<void>
}

type EntityStore = EntityStoreState & EntityStoreActions

export const useEntityStore = create<EntityStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    profile: null,
    isLoading: false,
    error: null,
    errorCode: null,
    load: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

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
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

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
    }
  }))
)
