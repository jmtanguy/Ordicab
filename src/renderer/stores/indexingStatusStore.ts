import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DossierIndexingStatus,
  IndexingDossierInitialCompleteEvent,
  IndexingStatusSnapshot
} from '@shared/types'

import { getOrdicabApi } from './ipc'

const EMPTY_SNAPSHOT: IndexingStatusSnapshot = {
  dossiers: {},
  totals: { pending: 0, running: 0, errored: 0 }
}

interface IndexingStatusStoreState {
  snapshot: IndexingStatusSnapshot
  isSubscribed: boolean
}

interface IndexingStatusStoreActions {
  subscribe: () => Promise<void>
  unsubscribe: () => void
  getDossierStatus: (dossierId: string) => DossierIndexingStatus | null
  isIdle: () => boolean
  reindexDossier: (dossierId: string) => Promise<void>
  onInitialComplete: (listener: (event: IndexingDossierInitialCompleteEvent) => void) => () => void
}

type IndexingStatusStore = IndexingStatusStoreState & IndexingStatusStoreActions

let statusUnsub: (() => void) | null = null

export const useIndexingStatusStore = create<IndexingStatusStore>()(
  immer((set, get) => ({
    snapshot: EMPTY_SNAPSHOT,
    isSubscribed: false,

    subscribe: async () => {
      if (get().isSubscribed) return

      const api = getOrdicabApi()
      if (!api?.indexing) return

      // Seed with the current snapshot so components don't flash on mount.
      const result = await api.indexing.getStatus()
      if (result.success) {
        set((state) => {
          state.snapshot = result.data
        })
      }

      statusUnsub = api.indexing.onStatus((snapshot) => {
        set((state) => {
          state.snapshot = snapshot
        })
      })

      set((state) => {
        state.isSubscribed = true
      })
    },

    unsubscribe: () => {
      statusUnsub?.()
      statusUnsub = null
      set((state) => {
        state.isSubscribed = false
        state.snapshot = EMPTY_SNAPSHOT
      })
    },

    getDossierStatus: (dossierId) => {
      return get().snapshot.dossiers[dossierId] ?? null
    },

    isIdle: () => {
      const { pending, running } = get().snapshot.totals
      return pending === 0 && running === 0
    },

    reindexDossier: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api?.indexing) return
      await api.indexing.reindexDossier({ dossierId })
    },

    onInitialComplete: (listener) => {
      const api = getOrdicabApi()
      if (!api?.indexing) return () => {}
      return api.indexing.onDossierInitialComplete(listener)
    }
  }))
)
