import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DossierScopedQuery,
  PieceAddInput,
  PieceGenerateInput,
  PieceGenerateProgressEvent,
  PieceGenerateResult,
  PieceRecord,
  PieceRemoveInput,
  PieceUpdateInput
} from '@shared/types'

import { requireApi } from './ipc'

export interface PieceGenerateState {
  status: 'idle' | 'running' | 'done' | 'error'
  progress: PieceGenerateProgressEvent | null
  result: PieceGenerateResult | null
  error: string | null
}

const IDLE_GENERATE_STATE: PieceGenerateState = {
  status: 'idle',
  progress: null,
  result: null,
  error: null
}

interface PieceStoreState {
  piecesByDossierId: Record<string, PieceRecord[]>
  isLoading: boolean
  isMutating: boolean
  error: string | null
  generateState: PieceGenerateState
}

interface PieceStoreActions {
  load: (query: DossierScopedQuery) => Promise<void>
  add: (input: PieceAddInput) => Promise<boolean>
  update: (input: PieceUpdateInput) => Promise<boolean>
  remove: (input: PieceRemoveInput) => Promise<boolean>
  generate: (input: PieceGenerateInput) => Promise<PieceGenerateResult | null>
  resetGenerateState: () => void
  clearError: () => void
}

type PieceStore = PieceStoreState & PieceStoreActions

let unsubscribeGenerateProgress: (() => void) | null = null

export const usePieceStore = create<PieceStore>()(
  immer((set) => ({
    piecesByDossierId: {},
    isLoading: false,
    isMutating: false,
    error: null,
    generateState: IDLE_GENERATE_STATE,

    load: async (query) => {
      const api = requireApi(set)
      if (!api) return

      set((state) => {
        state.isLoading = true
        state.error = null
      })
      const result = await api.pieces.list(query)
      set((state) => {
        state.isLoading = false
        if (result.success) {
          state.piecesByDossierId[query.dossierId] = result.data
        } else {
          state.error = result.error
        }
      })
    },

    add: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      set((state) => {
        state.isMutating = true
        state.error = null
      })
      const result = await api.pieces.add(input)
      set((state) => {
        state.isMutating = false
        if (result.success) {
          state.piecesByDossierId[input.dossierId] = result.data
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    update: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      set((state) => {
        state.isMutating = true
        state.error = null
      })
      const result = await api.pieces.update(input)
      set((state) => {
        state.isMutating = false
        if (result.success) {
          state.piecesByDossierId[input.dossierId] = result.data
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    remove: async (input) => {
      const api = requireApi(set)
      if (!api) return false

      set((state) => {
        state.isMutating = true
        state.error = null
      })
      const result = await api.pieces.remove(input)
      set((state) => {
        state.isMutating = false
        if (result.success) {
          state.piecesByDossierId[input.dossierId] = result.data
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    generate: async (input) => {
      const api = requireApi(set)
      if (!api) return null

      unsubscribeGenerateProgress?.()
      unsubscribeGenerateProgress = api.pieces.onGenerateProgress((event) => {
        if (event.dossierId !== input.dossierId) return
        set((state) => {
          state.generateState.progress = event
        })
      })

      set((state) => {
        state.generateState = { status: 'running', progress: null, result: null, error: null }
      })

      const result = await api.pieces.generate(input)

      unsubscribeGenerateProgress?.()
      unsubscribeGenerateProgress = null

      if (result.success) {
        set((state) => {
          state.generateState = {
            status: 'done',
            progress: null,
            result: result.data,
            error: null
          }
        })
        // communicatedAt changes on first generation — refresh the list.
        const refreshed = await api.pieces.list({ dossierId: input.dossierId })
        if (refreshed.success) {
          set((state) => {
            state.piecesByDossierId[input.dossierId] = refreshed.data
          })
        }
        return result.data
      }

      set((state) => {
        state.generateState = { status: 'error', progress: null, result: null, error: result.error }
      })
      return null
    },

    resetGenerateState: () => {
      set((state) => {
        state.generateState = IDLE_GENERATE_STATE
      })
    },

    clearError: () => {
      set((state) => {
        state.error = null
      })
    }
  }))
)
