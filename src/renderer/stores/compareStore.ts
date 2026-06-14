import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type { CompareProgressEvent, ComparisonResult } from '@shared/types'

import { requireApi } from './ipc'

interface CompareStoreState {
  /** Dossier the current selection/result belongs to. */
  dossierId: string | null
  oldDocumentPath: string | null
  newDocumentPath: string | null
  verifyCitations: boolean
  status: 'idle' | 'running' | 'done' | 'error'
  progress: CompareProgressEvent | null
  result: ComparisonResult | null
  error: string | null
}

interface CompareStoreActions {
  /** Resets selection and result when switching dossiers. */
  setDossier: (dossierId: string) => void
  setOldDocumentPath: (path: string | null) => void
  setNewDocumentPath: (path: string | null) => void
  swapSelection: () => void
  setVerifyCitations: (value: boolean) => void
  run: () => Promise<void>
  clearError: () => void
}

type CompareStore = CompareStoreState & CompareStoreActions

let unsubscribeProgress: (() => void) | null = null

export const useCompareStore = create<CompareStore>()(
  immer((set, get) => ({
    dossierId: null,
    oldDocumentPath: null,
    newDocumentPath: null,
    verifyCitations: true,
    status: 'idle',
    progress: null,
    result: null,
    error: null,

    setDossier: (dossierId) => {
      if (get().dossierId === dossierId) return
      set((state) => {
        state.dossierId = dossierId
        state.oldDocumentPath = null
        state.newDocumentPath = null
        state.status = 'idle'
        state.progress = null
        state.result = null
        state.error = null
      })
    },

    setOldDocumentPath: (path) => {
      set((state) => {
        state.oldDocumentPath = path
      })
    },

    setNewDocumentPath: (path) => {
      set((state) => {
        state.newDocumentPath = path
      })
    },

    swapSelection: () => {
      set((state) => {
        const previousOld = state.oldDocumentPath
        state.oldDocumentPath = state.newDocumentPath
        state.newDocumentPath = previousOld
      })
    },

    setVerifyCitations: (value) => {
      set((state) => {
        state.verifyCitations = value
      })
    },

    run: async () => {
      const api = requireApi(set)
      if (!api) return

      const { dossierId, oldDocumentPath, newDocumentPath, verifyCitations, status } = get()
      if (!dossierId || !oldDocumentPath || !newDocumentPath) return
      if (oldDocumentPath === newDocumentPath || status === 'running') return

      unsubscribeProgress?.()
      unsubscribeProgress = api.compare.onProgress((event) => {
        if (event.dossierId !== dossierId) return
        set((state) => {
          state.progress = event
        })
      })

      set((state) => {
        state.status = 'running'
        state.progress = null
        state.result = null
        state.error = null
      })

      const result = await api.compare.run({
        dossierId,
        oldDocumentPath,
        newDocumentPath,
        verifyCitations
      })

      unsubscribeProgress?.()
      unsubscribeProgress = null

      set((state) => {
        state.progress = null
        if (result.success) {
          state.status = 'done'
          state.result = result.data
        } else {
          state.status = 'error'
          state.error = result.error
        }
      })
    },

    clearError: () => {
      set((state) => {
        state.error = null
      })
    }
  }))
)
