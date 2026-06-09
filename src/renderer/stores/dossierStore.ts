import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import {
  type DossierBillingItemDeleteInput,
  type DossierBillingItemUpsertInput,
  type DossierFeeAgreementArchiveInput,
  type DossierFeeAgreementDeleteInput,
  type DossierFeeAgreementSetActiveInput,
  type DossierFeeAgreementUpsertInput,
  type DossierKeyDateDeleteInput,
  type DossierKeyDateUpsertInput,
  type DossierKeyReferenceDeleteInput,
  type DossierKeyReferenceUpsertInput,
  type DossierNoteDeleteInput,
  type DossierNoteUpsertInput,
  type DossierSetupLegalAidInput,
  type DossierSetupLegalAidResult,
  type DossierUpdateLegalAidInput,
  IpcErrorCode,
  type DossierDetail,
  type DossierEligibleFolder,
  type DossierStatus,
  type DossierSummary,
  type IpcResult,
  type KeyDate
} from '@shared/types'

import { getOrdicabApi, requireApi, safeLocalStorageGet, safeLocalStorageSet } from './ipc'

interface DossierNotice {
  kind: 'registered' | 'unregistered'
  dossierName: string
}

interface DossierDetailNotice {
  kind:
    | 'key-date-saved'
    | 'key-date-deleted'
    | 'fee-agreement-saved'
    | 'fee-agreement-deleted'
    | 'fee-agreement-archived'
    | 'fee-agreement-activated'
    | 'billing-item-saved'
    | 'billing-item-deleted'
    | 'key-reference-saved'
    | 'key-reference-deleted'
    | 'note-saved'
    | 'note-deleted'
    | 'legal-aid-saved'
    | 'legal-aid-configured'
  dossierName: string
}

export type DossierStatusFilter = 'all' | DossierStatus
export type DossierSortMode = 'alphabetical' | 'next-key-date' | 'last-opened'
export type DossierViewMode = 'cards' | 'table'

export interface ChronologyEntry {
  dossierId: string
  dossierName: string
  keyDate: KeyDate
  /**
   * UUIDs of the billing items that source this key date. Empty when the date
   * has not been billed yet. Stored as an array (rather than a boolean) so the
   * UI can navigate from a chronology row to the underlying billing item(s).
   */
  billingItemIds: string[]
}

const DOSSIER_SORT_MODE_STORAGE_KEY = 'dossiers-sort-mode'
const DOSSIER_VIEW_MODE_STORAGE_KEY = 'dossiers-view-mode'
const DOSSIER_STATUS_FILTER_STORAGE_KEY = 'dossiers-status-filter'

interface DossierStoreState {
  dossiers: DossierSummary[]
  eligibleFolders: DossierEligibleFolder[]
  isLoading: boolean
  isEligibleLoading: boolean
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
  viewMode: DossierViewMode
  chronologyEntries: ChronologyEntry[] | null
  isChronologyLoading: boolean
}

interface DossierStoreActions {
  load: () => Promise<void>
  loadEligibleFolders: () => Promise<void>
  openDetail: (id: string) => Promise<void>
  loadDetail: (id: string) => Promise<void>
  register: (id: string) => Promise<boolean>
  create: (name: string) => Promise<boolean>
  upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  upsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  deleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  archiveFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<boolean>
  setActiveFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<boolean>
  upsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  deleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<boolean>
  upsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  deleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  upsertNote: (input: DossierNoteUpsertInput) => Promise<boolean>
  deleteNote: (input: DossierNoteDeleteInput) => Promise<boolean>
  updateLegalAid: (input: DossierUpdateLegalAidInput) => Promise<boolean>
  setupLegalAid: (input: DossierSetupLegalAidInput) => Promise<DossierSetupLegalAidResult | null>
  unregister: (id: string) => Promise<boolean>
  setStatusFilter: (filter: DossierStatusFilter) => void
  setSortMode: (mode: DossierSortMode) => void
  setViewMode: (mode: DossierViewMode) => void
  loadChronology: () => Promise<void>
  clearNotice: () => void
  clearError: () => void
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
  const value = safeLocalStorageGet(DOSSIER_SORT_MODE_STORAGE_KEY)
  if (value === 'alphabetical' || value === 'next-key-date' || value === 'last-opened') return value
  return null
}

function setStoredSortMode(mode: DossierSortMode): void {
  safeLocalStorageSet(DOSSIER_SORT_MODE_STORAGE_KEY, mode)
}

function getStoredViewMode(): DossierViewMode | null {
  const value = safeLocalStorageGet(DOSSIER_VIEW_MODE_STORAGE_KEY)
  if (value === 'cards' || value === 'table') return value
  return null
}

function setStoredViewMode(mode: DossierViewMode): void {
  safeLocalStorageSet(DOSSIER_VIEW_MODE_STORAGE_KEY, mode)
}

function getStoredStatusFilter(): DossierStatusFilter | null {
  const value = safeLocalStorageGet(DOSSIER_STATUS_FILTER_STORAGE_KEY)
  if (
    value === 'all' ||
    value === 'active' ||
    value === 'pending' ||
    value === 'completed' ||
    value === 'archived'
  )
    return value
  return null
}

function setStoredStatusFilter(filter: DossierStatusFilter): void {
  safeLocalStorageSet(DOSSIER_STATUS_FILTER_STORAGE_KEY, filter)
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
  immer((set, get) => {
    async function saveDossierDetail(
      request: (
        api: NonNullable<ReturnType<typeof requireApi>>
      ) => Promise<IpcResult<DossierDetail>>,
      kind: DossierDetailNotice['kind']
    ): Promise<boolean> {
      const api = requireApi(set, { errorKey: 'detailError', codeKey: 'detailErrorCode' })
      if (!api) return false

      set((state) => {
        state.isSavingDetail = true
        state.detailError = null
        state.detailErrorCode = null
        state.detailNotice = null
      })

      const result = await request(api)

      if (!result.success) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError = result.error
          state.detailErrorCode = result.code
        })

        return false
      }

      set((state) => {
        applySavedDetail(state, result.data, kind)
      })

      return true
    }

    return {
      // IPC calls live in store actions, never in React components.
      dossiers: [],
      eligibleFolders: [],
      isLoading: false,
      isEligibleLoading: false,
      isDetailLoading: false,
      isSavingDetail: false,
      error: null,
      errorCode: null,
      notice: null,
      activeDossier: null,
      detailError: null,
      detailErrorCode: null,
      detailNotice: null,
      statusFilter: getStoredStatusFilter() ?? 'all',
      sortMode: getStoredSortMode() ?? 'alphabetical',
      viewMode: getStoredViewMode() ?? 'table',
      chronologyEntries: null,
      isChronologyLoading: false,
      load: async () => {
        const api = requireApi(set)
        if (!api) return

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
        const api = requireApi(set)
        if (!api) return

        set((state) => {
          state.isEligibleLoading = true
          state.error = null
          state.errorCode = null
          state.notice = null
        })

        const result = await api.dossier.listEligible()

        set((state) => {
          state.isEligibleLoading = false

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
        const api = requireApi(set, { errorKey: 'detailError', codeKey: 'detailErrorCode' })
        if (!api) return

        set((state) => {
          state.isDetailLoading = true
          state.detailError = null
          state.detailErrorCode = null
          state.detailNotice = null
          state.chronologyEntries = null
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
        const api = requireApi(set, { errorKey: 'detailError', codeKey: 'detailErrorCode' })
        if (!api) return

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
        const api = requireApi(set)
        if (!api) return false

        set((state) => {
          state.isEligibleLoading = true
          state.error = null
          state.errorCode = null
          state.notice = null
        })

        const result = await api.dossier.register({ id })

        if (!result.success) {
          set((state) => {
            state.isEligibleLoading = false
            state.error = result.error
            state.errorCode = result.code
          })

          return false
        }

        set((state) => {
          state.isEligibleLoading = false

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
      create: async (name) => {
        const api = requireApi(set)
        if (!api) return false

        set((state) => {
          state.isEligibleLoading = true
          state.error = null
          state.errorCode = null
          state.notice = null
        })

        const result = await api.dossier.create({ name })

        if (!result.success) {
          set((state) => {
            state.isEligibleLoading = false
            state.error = result.error
            state.errorCode = result.code
          })

          return false
        }

        set((state) => {
          state.isEligibleLoading = false

          state.dossiers = upsertDossierSummary(state.dossiers, result.data, state.sortMode)
          state.notice = {
            kind: 'registered',
            dossierName: result.data.name
          }
          state.error = null
          state.errorCode = null
        })

        return true
      },
      upsertKeyDate: (input) =>
        saveDossierDetail((api) => api.dossier.upsertKeyDate(input), 'key-date-saved'),
      deleteKeyDate: (input) =>
        saveDossierDetail((api) => api.dossier.deleteKeyDate(input), 'key-date-deleted'),
      upsertFeeAgreement: (input) =>
        saveDossierDetail((api) => api.dossier.upsertFeeAgreement(input), 'fee-agreement-saved'),
      deleteFeeAgreement: (input) =>
        saveDossierDetail((api) => api.dossier.deleteFeeAgreement(input), 'fee-agreement-deleted'),
      archiveFeeAgreement: (input) =>
        saveDossierDetail(
          (api) => api.dossier.archiveFeeAgreement(input),
          'fee-agreement-archived'
        ),
      setActiveFeeAgreement: (input) =>
        saveDossierDetail(
          (api) => api.dossier.setActiveFeeAgreement(input),
          'fee-agreement-activated'
        ),
      upsertBillingItem: (input) =>
        saveDossierDetail((api) => api.dossier.upsertBillingItem(input), 'billing-item-saved'),
      deleteBillingItem: (input) =>
        saveDossierDetail((api) => api.dossier.deleteBillingItem(input), 'billing-item-deleted'),
      upsertNote: (input) =>
        saveDossierDetail((api) => api.dossier.upsertNote(input), 'note-saved'),
      deleteNote: (input) =>
        saveDossierDetail((api) => api.dossier.deleteNote(input), 'note-deleted'),
      upsertKeyReference: (input) =>
        saveDossierDetail((api) => api.dossier.upsertKeyReference(input), 'key-reference-saved'),
      deleteKeyReference: (input) =>
        saveDossierDetail((api) => api.dossier.deleteKeyReference(input), 'key-reference-deleted'),
      updateLegalAid: (input) =>
        saveDossierDetail((api) => api.dossier.updateLegalAid(input), 'legal-aid-saved'),
      setupLegalAid: async (input) => {
        const api = requireApi(set, { errorKey: 'detailError', codeKey: 'detailErrorCode' })
        if (!api) return null

        set((state) => {
          state.isSavingDetail = true
          state.detailError = null
          state.detailErrorCode = null
          state.detailNotice = null
        })

        const result = await api.dossier.setupLegalAid(input)

        if (!result.success) {
          set((state) => {
            state.isSavingDetail = false
            state.detailError = result.error
            state.detailErrorCode = result.code
          })
          return null
        }

        // L'orchestration a créé convention/factures/documents/échéances :
        // on recharge le détail pour refléter le nouvel état.
        const refreshed = await api.dossier.get({ dossierId: input.dossierId })
        set((state) => {
          state.isSavingDetail = false
          if (refreshed.success) {
            applySavedDetail(state, refreshed.data, 'legal-aid-configured')
          } else {
            state.detailNotice = {
              kind: 'legal-aid-configured',
              dossierName: state.activeDossier?.name ?? ''
            }
          }
        })
        return result.data
      },
      unregister: async (id) => {
        const api = requireApi(set)
        if (!api) return false

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
        setStoredStatusFilter(filter)
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
      setViewMode: (mode) => {
        setStoredViewMode(mode)
        set((state) => {
          state.viewMode = mode
        })
      },
      loadChronology: async () => {
        const api = getOrdicabApi()
        if (!api) return

        const nonClosedDossiers = get().dossiers.filter(
          (d) => d.status !== 'completed' && d.status !== 'archived'
        )

        set((state) => {
          state.isChronologyLoading = true
        })

        const results = await Promise.all(
          nonClosedDossiers.map(async (d) => {
            const result = await api.dossier.get({ dossierId: d.id })
            return { dossier: d, result }
          })
        )

        const entries: ChronologyEntry[] = []
        for (const { dossier, result } of results) {
          if (!result.success) continue
          const billingItemIdsByKeyDate = new Map<string, string[]>()
          for (const item of result.data.billingItems) {
            if (!item.sourceKeyDateId) continue
            const existing = billingItemIdsByKeyDate.get(item.sourceKeyDateId)
            if (existing) {
              existing.push(item.id)
            } else {
              billingItemIdsByKeyDate.set(item.sourceKeyDateId, [item.id])
            }
          }
          for (const keyDate of result.data.keyDates) {
            entries.push({
              dossierId: dossier.id,
              dossierName: result.data.name,
              keyDate,
              billingItemIds: billingItemIdsByKeyDate.get(keyDate.id) ?? []
            })
          }
        }

        entries.sort((a, b) => {
          const dateCompare = b.keyDate.date.localeCompare(a.keyDate.date)
          if (dateCompare !== 0) return dateCompare
          const timeA = a.keyDate.time ?? '00:00'
          const timeB = b.keyDate.time ?? '00:00'
          return timeB.localeCompare(timeA)
        })

        set((state) => {
          state.chronologyEntries = entries
          state.isChronologyLoading = false
        })
      },
      clearNotice: () => {
        set((state) => {
          state.notice = null
        })
      },
      clearError: () => {
        set((state) => {
          state.error = null
          state.errorCode = null
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
          state.isEligibleLoading = false
          state.isDetailLoading = false
          state.isSavingDetail = false
          state.error = null
          state.errorCode = null
          state.notice = null
          state.activeDossier = null
          state.detailError = null
          state.detailErrorCode = null
          state.detailNotice = null
          state.statusFilter = getStoredStatusFilter() ?? 'all'
          state.sortMode = getStoredSortMode() ?? 'alphabetical'
          state.viewMode = getStoredViewMode() ?? 'table'
          state.chronologyEntries = null
          state.isChronologyLoading = false
        })
      }
    }
  })
)
