import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  CabinetBillingCatalog,
  CabinetBillingDefaultInput,
  CabinetServicePresetDeleteInput,
  CabinetServicePresetUpsertInput
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { requireApi } from './ipc'

interface CabinetBillingStoreState {
  catalog: CabinetBillingCatalog | null
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface CabinetBillingStoreActions {
  load: () => Promise<void>
  upsertService: (input: CabinetServicePresetUpsertInput) => Promise<boolean>
  deleteService: (input: CabinetServicePresetDeleteInput) => Promise<boolean>
  setDefaultService: (input: CabinetBillingDefaultInput) => Promise<boolean>
  reset: () => void
}

type CabinetBillingStore = CabinetBillingStoreState & CabinetBillingStoreActions

export const useCabinetBillingStore = create<CabinetBillingStore>()(
  immer((set) => ({
    catalog: null,
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

      const result = await api.cabinetBilling.get()

      set((state) => {
        state.isLoading = false
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.catalog = result.data
        state.error = null
        state.errorCode = null
      })
    },
    upsertService: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      const result = await api.cabinetBilling.upsertService(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.catalog = result.data
        state.error = null
        state.errorCode = null
      })

      return result.success
    },
    deleteService: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      const result = await api.cabinetBilling.deleteService(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.catalog = result.data
        state.error = null
        state.errorCode = null
      })

      return result.success
    },
    setDefaultService: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      const result = await api.cabinetBilling.setDefaultService(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.catalog = result.data
        state.error = null
        state.errorCode = null
      })

      return result.success
    },
    reset: () => {
      set((state) => {
        state.catalog = null
        state.isLoading = false
        state.error = null
        state.errorCode = null
      })
    }
  }))
)
