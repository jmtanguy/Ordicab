import { create } from 'zustand'

import type { DossierIndexingStatus, IndexingStatusSnapshot } from '@shared/types'

import { getOrdicabApi } from './ipc'

/**
 * Mirrors the background indexing queue's per-dossier status snapshot (emitted
 * by the main process over `indexing:status`, debounced 250 ms) into the
 * renderer so the UI can supervise the otherwise-silent extraction work.
 *
 * The subscription is set up lazily and only once — see {@link subscribe}.
 */
interface IndexingStoreState {
  snapshot: IndexingStatusSnapshot | null
  /**
   * Seed the snapshot once and start mirroring push events. Idempotent: repeat
   * calls return the existing teardown. Returns an unsubscribe function.
   */
  subscribe: () => () => void
}

let unsubscribeStatus: (() => void) | null = null

export const useIndexingStore = create<IndexingStoreState>((set) => ({
  snapshot: null,
  subscribe: () => {
    const api = getOrdicabApi()
    if (!api) return () => {}

    if (unsubscribeStatus) return unsubscribeStatus

    // Seed with the current snapshot so the first render reflects in-flight work
    // that started before this subscription (e.g. startup catch-up).
    void api.indexing.getStatus().then((result) => {
      if (result.success) set({ snapshot: result.data })
    })

    unsubscribeStatus = api.indexing.onStatus((snapshot) => {
      set({ snapshot })
    })

    return () => {
      unsubscribeStatus?.()
      unsubscribeStatus = null
    }
  }
}))

/**
 * Per-dossier indexing status, or null when the dossier has no entry yet
 * (never registered, or snapshot not seeded). Use inside a selector:
 * `useIndexingStore((s) => selectDossierIndexing(s, id))`.
 */
export function selectDossierIndexing(
  state: IndexingStoreState,
  dossierId: string | null
): DossierIndexingStatus | null {
  if (!dossierId) return null
  return state.snapshot?.dossiers[dossierId] ?? null
}
