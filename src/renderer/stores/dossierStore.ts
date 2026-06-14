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
  type DossierUpdateInput,
  type DossierUpdateLegalAidInput,
  type GeneralKeyDate,
  type GeneralKeyDateDeleteInput,
  type GeneralKeyDateUpsertInput,
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
    | 'dossier-saved'
    | 'legal-aid-saved'
    | 'legal-aid-configured'
  dossierName: string
}

export type DossierStatusFilter = 'all' | DossierStatus
export type DossierSortMode = 'alphabetical' | 'next-key-date' | 'last-opened'
export type DossierViewMode = 'cards' | 'table'

/**
 * Sentinel `dossierId` used for « hors dossier » (general) events. Kept stable so
 * the reminder scan's dedupe key stays consistent across reloads.
 */
export const GENERAL_EVENT_DOSSIER_ID = '__general__'

export interface ChronologyEntry {
  dossierId: string
  dossierName: string
  keyDate: KeyDate | GeneralKeyDate
  /**
   * UUIDs of the billing items that source this key date. Empty when the date
   * has not been billed yet. Stored as an array (rather than a boolean) so the
   * UI can navigate from a chronology row to the underlying billing item(s).
   */
  billingItemUuids: string[]
  /** True for « hors dossier » events not attached to any dossier. */
  isGeneral?: boolean
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
  updateDossier: (input: DossierUpdateInput) => Promise<boolean>
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
  /**
   * Met à jour une échéance de dossier depuis la chronologie d'accueil
   * (glisser-déposer du calendrier) : pas de notice détail, mais rafraîchit la
   * chronologie et resynchronise le détail si ce dossier est ouvert.
   */
  updateChronologyKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  /** Supprime une échéance de dossier depuis la chronologie (pendant de {@link updateChronologyKeyDate}). */
  deleteChronologyKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  upsertGeneralKeyDate: (input: GeneralKeyDateUpsertInput) => Promise<boolean>
  deleteGeneralKeyDate: (input: GeneralKeyDateDeleteInput) => Promise<boolean>
  /**
   * Enregistre un événement depuis le dialogue unifié : création, édition, ou
   * déplacement (changement de dossier, y compris bascule dossier↔hors-dossier).
   * `null` = « hors dossier ». Un déplacement n'a lieu que pour un événement
   * existant dont le rattachement change ; sinon c'est un simple upsert.
   */
  saveChronologyEvent: (input: {
    fromDossierId: string | null
    toDossierId: string | null
    fields: GeneralKeyDateUpsertInput
  }) => Promise<boolean>
  clearNotice: () => void
  clearError: () => void
  clearDetailNotice: () => void
  reset: () => void
}

type DossierStore = DossierStoreState & DossierStoreActions

function isVisibleEligibleFolder(entry: DossierEligibleFolder): boolean {
  return !entry.name.startsWith('.') && !entry.slug.startsWith('.')
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
  return sortDossiers([dossier, ...dossiers.filter((entry) => entry.slug !== dossier.slug)], mode)
}

function toSummary(dossier: DossierDetail): DossierSummary {
  return {
    slug: dossier.slug,
    uuid: dossier.uuid,
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

      let result: IpcResult<DossierDetail>
      try {
        result = await request(api)
      } catch (error) {
        set((state) => {
          state.isSavingDetail = false
          state.detailError =
            error instanceof Error ? error.message : 'Unable to save dossier detail.'
          state.detailErrorCode = IpcErrorCode.UNKNOWN
        })

        return false
      }

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

        const result = await api.dossier.register({ slug: id })

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
          state.eligibleFolders = state.eligibleFolders.filter((entry) => entry.slug !== id)
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
      updateDossier: (input) =>
        saveDossierDetail((api) => {
          if (typeof api.dossier.update !== 'function') {
            return Promise.resolve({
              success: false as const,
              error:
                "La mise à jour générale du dossier n'est pas disponible. Redémarrez l'application pour recharger le bridge Electron.",
              code: IpcErrorCode.NOT_IMPLEMENTED
            })
          }

          return api.dossier.update(input)
        }, 'dossier-saved'),
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

        const dossierName = get().dossiers.find((entry) => entry.slug === id)?.name ?? id
        const result = await api.dossier.unregister({ slug: id })

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

          state.dossiers = state.dossiers.filter((entry) => entry.slug !== id)
          if (state.activeDossier?.slug === id) {
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

        const [results, generalResult] = await Promise.all([
          Promise.all(
            nonClosedDossiers.map(async (d) => {
              const result = await api.dossier.get({ dossierId: d.slug })
              return { dossier: d, result }
            })
          ),
          api.dossier.listGeneralKeyDates()
        ])

        const entries: ChronologyEntry[] = []

        if (generalResult.success) {
          for (const keyDate of generalResult.data) {
            entries.push({
              dossierId: GENERAL_EVENT_DOSSIER_ID,
              dossierName: '',
              keyDate,
              billingItemUuids: [],
              isGeneral: true
            })
          }
        }

        for (const { dossier, result } of results) {
          if (!result.success) continue
          const billingItemIdsByKeyDate = new Map<string, string[]>()
          for (const item of result.data.billingItems) {
            if (!item.sourceKeyDateUuid) continue
            const existing = billingItemIdsByKeyDate.get(item.sourceKeyDateUuid)
            if (existing) {
              existing.push(item.uuid)
            } else {
              billingItemIdsByKeyDate.set(item.sourceKeyDateUuid, [item.uuid])
            }
          }
          for (const keyDate of result.data.keyDates) {
            entries.push({
              dossierId: dossier.slug,
              dossierName: result.data.name,
              keyDate,
              billingItemUuids: billingItemIdsByKeyDate.get(keyDate.uuid) ?? []
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
      updateChronologyKeyDate: async (input) => {
        const api = requireApi(set)
        if (!api) return false

        const result = await api.dossier.upsertKeyDate(input)

        if (!result.success) {
          set((state) => {
            state.error = result.error
            state.errorCode = result.code
          })
          return false
        }

        set((state) => {
          if (state.activeDossier?.slug === input.dossierId) {
            state.activeDossier = result.data
            state.dossiers = upsertDossierSummary(
              state.dossiers,
              toSummary(result.data),
              state.sortMode
            )
          }
        })

        await get().loadChronology()
        return true
      },
      deleteChronologyKeyDate: async (input) => {
        const api = requireApi(set)
        if (!api) return false

        const result = await api.dossier.deleteKeyDate(input)

        if (!result.success) {
          set((state) => {
            state.error = result.error
            state.errorCode = result.code
          })
          return false
        }

        set((state) => {
          if (state.activeDossier?.slug === input.dossierId) {
            state.activeDossier = result.data
            state.dossiers = upsertDossierSummary(
              state.dossiers,
              toSummary(result.data),
              state.sortMode
            )
          }
        })

        await get().loadChronology()
        return true
      },
      upsertGeneralKeyDate: async (input) => {
        const api = requireApi(set)
        if (!api) return false

        const result = await api.dossier.upsertGeneralKeyDate(input)

        if (!result.success) {
          set((state) => {
            state.error = result.error
            state.errorCode = result.code
          })
          return false
        }

        await get().loadChronology()
        return true
      },
      deleteGeneralKeyDate: async (input) => {
        const api = requireApi(set)
        if (!api) return false

        const result = await api.dossier.deleteGeneralKeyDate(input)

        if (!result.success) {
          set((state) => {
            state.error = result.error
            state.errorCode = result.code
          })
          return false
        }

        await get().loadChronology()
        return true
      },
      saveChronologyEvent: async ({ fromDossierId, toDossierId, fields }) => {
        const isMove = Boolean(fields.uuid) && fromDossierId !== toDossierId
        if (!isMove) {
          return toDossierId === null
            ? get().upsertGeneralKeyDate(fields)
            : get().updateChronologyKeyDate({ ...fields, dossierId: toDossierId })
        }

        const api = requireApi(set)
        if (!api) return false

        const result = await api.dossier.moveKeyDate({
          keyDateUuid: fields.uuid as string,
          fromDossierId,
          toDossierId,
          label: fields.label,
          date: fields.date,
          time: fields.time,
          duration: fields.duration,
          tags: fields.tags,
          isClosed: fields.isClosed,
          note: fields.note
        })

        if (!result.success) {
          set((state) => {
            state.error = result.error
            state.errorCode = result.code
          })
          return false
        }

        // Le déplacement touche la source et la cible : resynchronise le dossier
        // ouvert s'il est l'un des deux.
        const activeSlug = get().activeDossier?.slug
        if (activeSlug && (activeSlug === fromDossierId || activeSlug === toDossierId)) {
          const detail = await api.dossier.get({ dossierId: activeSlug })
          if (detail.success) {
            set((state) => {
              state.activeDossier = detail.data
              state.dossiers = upsertDossierSummary(
                state.dossiers,
                toSummary(detail.data),
                state.sortMode
              )
            })
          }
        }

        await get().loadChronology()
        return true
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
