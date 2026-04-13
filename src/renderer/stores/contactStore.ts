import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DossierScopedQuery
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface ContactStoreState {
  contactsByDossierId: Record<string, ContactRecord[]>
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface ContactStoreActions {
  load: (input: DossierScopedQuery) => Promise<void>
  upsert: (input: ContactUpsertInput) => Promise<void>
  remove: (input: ContactDeleteInput) => Promise<void>
  invalidate: (dossierId: string) => void
}

type ContactStore = ContactStoreState & ContactStoreActions

function compareContacts(left: ContactRecord, right: ContactRecord): number {
  const leftDisplayName = computeContactDisplayName(left)
  const rightDisplayName = computeContactDisplayName(right)

  const byName = leftDisplayName.localeCompare(rightDisplayName, undefined, {
    sensitivity: 'base'
  })

  if (byName !== 0) {
    return byName
  }

  const byRole = (left.role ?? '').localeCompare(right.role ?? '', undefined, {
    sensitivity: 'base'
  })

  if (byRole !== 0) {
    return byRole
  }

  return left.uuid.localeCompare(right.uuid)
}

function sortContacts(contacts: ContactRecord[]): ContactRecord[] {
  return [...contacts].sort(compareContacts)
}

export const useContactStore = create<ContactStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    contactsByDossierId: {},
    isLoading: false,
    error: null,
    errorCode: null,
    load: async (input) => {
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

      const result = await api.contact.list(input)

      set((state) => {
        state.isLoading = false
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.contactsByDossierId[input.dossierId] = sortContacts(result.data)
        state.errorCode = null
      })
    },
    upsert: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

      const result = await api.contact.upsert(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        const current = state.contactsByDossierId[input.dossierId] ?? []
        const nextContacts = [...current]
        const index = nextContacts.findIndex((entry) => entry.uuid === result.data.uuid)

        if (index >= 0) {
          nextContacts[index] = result.data
        } else {
          nextContacts.push(result.data)
        }

        state.contactsByDossierId[input.dossierId] = sortContacts(nextContacts)
        state.error = null
        state.errorCode = null
      })
    },
    invalidate: (dossierId) => {
      set((state) => {
        delete state.contactsByDossierId[dossierId]
      })
    },
    remove: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = IpcErrorCode.NOT_FOUND
        })
        return
      }

      const result = await api.contact.delete(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        const current = state.contactsByDossierId[input.dossierId] ?? []
        state.contactsByDossierId[input.dossierId] = sortContacts(
          current.filter((entry) => entry.uuid !== input.contactUuid)
        )
        state.error = null
        state.errorCode = null
      })
    }
  }))
)
