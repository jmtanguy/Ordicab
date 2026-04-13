import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import {
  type DossierKeyDateDeleteInput,
  type DossierKeyDateUpsertInput,
  type DossierKeyReferenceDeleteInput,
  type DossierKeyReferenceUpsertInput,
  IpcErrorCode,
  type DossierDetail,
  type DossierEligibleFolder,
  type DossierStatus,
  type DossierSummary,
  type DossierUpdateInput
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface DossierNotice {
  kind: 'registered' | 'unregistered'
  dossierName: string
}

interface DossierDetailNotice {
  kind:
    | 'saved'
    | 'key-date-saved'
    | 'key-date-deleted'
    | 'key-reference-saved'
    | 'key-reference-deleted'
  dossierName: string
}

export type DossierStatusFilter = 'all' | DossierStatus
export type DossierSortMode = 'alphabetical' | 'next-key-date' | 'last-opened'

const DOSSIER_SORT_MODE_STORAGE_KEY = 'dossiers-sort-mode'

interface DossierStoreState {
  dossiers: DossierSummary[]
  eligibleFolders: DossierEligibleFolder[]
  isLoading: boolean
  isDetailLoading: boolean
  isSavingDetail: boolean
  error: string | null
  errorCode: IpcErrorCode | null
  notice: DossierNotice | null
  activeDossier: DossierDetail | null
  detailError: string | null
  detailErrorCode: IpcErrorCode | null
  detailNotice: DossierDetailNotice | null
  statusFilter: DossierStatusFilter
  sortMode: DossierSortMode
}

interface DossierStoreActions {
  load: () => Promise<void>
  loadEligibleFolders: () => Promise<void>
  openDetail: (id: string) => Promise<void>
  loadDetail: (id: string) => Promise<void>
  register: (id: string) => Promise<boolean>
  saveDetail: (input: DossierUpdateInput) => Promise<boolean>
  upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  upsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  deleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  unregister: (id: string) => Promise<boolean>
  setStatusFilter: (filter: DossierStatusFilter) => void
  setSortMode: (mode: DossierSortMode) => void
  clearNotice: () => void
  clearDetailNotice: () => void
  reset: () => void
}

type DossierStore = DossierStoreState & DossierStoreActions

function isVisibleEligibleFolder(entry: DossierEligibleFolder): boolean {
  return !entry.name.startsWith('.') && !entry.id.startsWith('.')
}

function compareAlphabetical(left: DossierSummary, right: DossierSummary): number {
  return left.name.localeCompare(right.name)
}

function compareNextKeyDate(left: DossierSummary, right: DossierSummary): number {
  if (left.nextUpcomingKeyDate && right.nextUpcomingKeyDate) {
    const byDate = left.nextUpcomingKeyDate.localeCompare(right.nextUpcomingKeyDate)
    return byDate !== 0 ? byDate : compareAlphabetical(left, right)
  }

  if (left.nextUpcomingKeyDate) {
    return -1
  }

  if (right.nextUpcomingKeyDate) {
    return 1
  }

  return compareAlphabetical(left, right)
}

function compareLastOpened(left: DossierSummary, right: DossierSummary): number {
  if (left.lastOpenedAt && right.lastOpenedAt) {
    const byLastOpened = right.lastOpenedAt.localeCompare(left.lastOpenedAt)
    return byLastOpened !== 0 ? byLastOpened : compareAlphabetical(left, right)
  }

  if (left.lastOpenedAt) {
    return -1
  }

  if (right.lastOpenedAt) {
    return 1
  }

  return compareAlphabetical(left, right)
}

function sortDossiers(dossiers: DossierSummary[], mode: DossierSortMode): DossierSummary[] {
  const next = [...dossiers]

  if (mode === 'next-key-date') {
    next.sort(compareNextKeyDate)
    return next
  }

  if (mode === 'last-opened') {
    next.sort(compareLastOpened)
    return next
  }

  next.sort(compareAlphabetical)
  return next
}

function getStoredSortMode(): DossierSortMode | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const value = window.localStorage.getItem(DOSSIER_SORT_MODE_STORAGE_KEY)
    if (value === 'alphabetical' || value === 'next-key-date' || value === 'last-opened') {
      return value
    }
  } catch {
    // Ignore storage access failures in non-browser contexts.
  }

  return null
}

function setStoredSortMode(mode: DossierSortMode): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(DOSSIER_SORT_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore storage access failures in non-browser contexts.
  }
}

function upsertDossierSummary(
  dossiers: DossierSummary[],
  dossier: DossierSummary,
  mode: DossierSortMode
): DossierSummary[] {
  return sortDossiers([dossier, ...dossiers.filter((entry) => entry.id !== dossier.id)], mode)
}

function toSummary(dossier: DossierDetail): DossierSummary {
  return {
    id: dossier.id,
    name: dossier.name,
    status: dossier.status,
    type: dossier.type,
    updatedAt: dossier.updatedAt,
    lastOpenedAt: dossier.lastOpenedAt,
    nextUpcomingKeyDate: dossier.nextUpcomingKeyDate,
    nextUpcomingKeyDateLabel: dossier.nextUpcomingKeyDateLabel
  }
}

function applySavedDetail(
  state: DossierStoreState,
  dossier: DossierDetail,
  kind: DossierDetailNotice['kind']
): void {
  state.isSavingDetail = false
  state.activeDossier = dossier
  state.dossiers = upsertDossierSummary(state.dossiers, toSummary(dossier), state.sortMode)
  state.detailNotice = {
    kind,
    dossierName: dossier.name
  }
  state.detailError = null
  state.detailErrorCode = null
}

export function selectVisibleDossiers(
  state: Pick<DossierStoreState, 'dossiers' | 'statusFilter' | 'sortMode'>
): DossierSummary[] {
  const filtered =
    state.statusFilter === 'all'
      ? state.dossiers
      : state.dossiers.filter((entry) => entry.status === state.statusFilter)

  return sortDossiers(filtered, state.sortMode)
}

export const useDossierStore = create<DossierStore>()(
  immer((set, get) => ({
    // IPC calls live in store actions, never in React components.
    dossiers: [],
    eligibleFolders: [],
    isLoading: false,
    isDetailLoading: false,
    isSavingDetail: false,
    error: null,
    errorCode: null,
    notice: null,
    activeDossier: null,
    detailError: null,
    detailErrorCode: null,
    detailNotice: null,
    statusFilter: 'all',
    sortMode: getStoredSortMode() ?? 'alphabetical',
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
        state.notice = null
      })

      const result = await api.dossier.list()

      set((state) => {
        state.isLoading = false

        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.dossiers = sortDossiers(result.data, state.sortMode)
        state.errorCode = null
        state.error = null
      })
    },
    loadEligibleFolders: async () => {
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
        state.notice = null
      })

      const result = await api.dossier.listEligible()

      set((state) => {
        state.isLoading = false

        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.eligibleFolders = result.data.filter(isVisibleEligibleFolder)
        state.error = null
        state.errorCode = null
      })
    },
    openDetail: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

      set((state) => {
        state.isDetailLoading = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.open({ dossierId: id })

      set((state) => {
        state.isDetailLoading = false

        if (!result.success) {
          state.detailError = result.error
          state.detailErrorCode = result.code
          return
        }

        state.activeDossier = result.data
        state.dossiers = upsertDossierSummary(
          state.dossiers,
          toSummary(result.data),
          state.sortMode
        )
        state.detailError = null
        state.detailErrorCode = null
      })
    },
    loadDetail: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

      set((state) => {
        state.isDetailLoading = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.get({ dossierId: id })

      set((state) => {
        state.isDetailLoading = false

        if (!result.success) {
          state.detailError = result.error
          state.detailErrorCode = result.code
          return
        }

        state.activeDossier = result.data
        state.dossiers = upsertDossierSummary(
          state.dossiers,
          toSummary(result.data),
          state.sortMode
        )
        state.detailError = null
        state.detailErrorCode = null
      })
    },
    register: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isLoading = true
        state.error = null
        state.errorCode = null
        state.notice = null
      })

      const result = await api.dossier.register({ id })

      if (!result.success) {
        set((state) => {
          state.isLoading = false
          state.error = result.error
          state.errorCode = result.code
        })

        return false
      }

      set((state) => {
        state.isLoading = false

        state.dossiers = upsertDossierSummary(state.dossiers, result.data, state.sortMode)
        state.eligibleFolders = state.eligibleFolders.filter((entry) => entry.id !== id)
        state.notice = {
          kind: 'registered',
          dossierName: result.data.name
        }
        state.error = null
        state.errorCode = null
      })

      return true
    },
    saveDetail: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.update(input)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, 'saved')
      })

      return true
    },
    upsertKeyDate: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.upsertKeyDate(input)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, 'key-date-saved')
      })

      return true
    },
    deleteKeyDate: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.deleteKeyDate(input)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, 'key-date-deleted')
      })

      return true
    },
    upsertKeyReference: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.upsertKeyReference(input)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, 'key-reference-saved')
      })

      return true
    },
    deleteKeyReference: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.detailError = IPC_NOT_AVAILABLE_ERROR
          state.detailErrorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await api.dossier.deleteKeyReference(input)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, 'key-reference-deleted')
      })

      return true
    },
    unregister: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return false
      }

      set((state) => {
        state.isLoading = true
        state.error = null
        state.errorCode = null
        state.notice = null
      })

      const dossierName = get().dossiers.find((entry) => entry.id === id)?.name ?? id
      const result = await api.dossier.unregister({ id })

      if (!result.success) {
        set((state) => {
          state.isLoading = false
          state.error = result.error
          state.errorCode = result.code
        })

        return false
      }

      set((state) => {
        state.isLoading = false

        state.dossiers = state.dossiers.filter((entry) => entry.id !== id)
        if (state.activeDossier?.id === id) {
          state.activeDossier = null
          state.detailNotice = null
          state.detailError = null
          state.detailErrorCode = null
        }
        state.notice = {
          kind: 'unregistered',
          dossierName
        }
        state.error = null
        state.errorCode = null
      })

      return true
    },
    setStatusFilter: (filter) => {
      set((state) => {
        state.statusFilter = filter
      })
    },
    setSortMode: (mode) => {
      setStoredSortMode(mode)
      set((state) => {
        state.sortMode = mode
        state.dossiers = sortDossiers(state.dossiers, mode)
      })
    },
    clearNotice: () => {
      set((state) => {
        state.notice = null
      })
    },
    clearDetailNotice: () => {
      set((state) => {
        state.detailNotice = null
      })
    },
    reset: () => {
      set((state) => {
        state.dossiers = []
        state.eligibleFolders = []
        state.isLoading = false
        state.isDetailLoading = false
        state.isSavingDetail = false
        state.error = null
        state.errorCode = null
        state.notice = null
        state.activeDossier = null
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
        state.statusFilter = 'all'
        state.sortMode = 'alphabetical'
      })
    }
  }))
)
