import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContactRecord, OrdicabAPI } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { useContactStore } from '../contactStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createContact(options: Partial<ContactRecord> = {}): ContactRecord {
  return {
    uuid: 'contact-1',
    dossierId: 'dos-1',
    firstName: 'Camille',
    lastName: 'Martin',
    role: 'Client',
    ...options
  }
}

describe('contactStore', () => {
  beforeEach(() => {
    useContactStore.setState(useContactStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('loads contacts sorted by name, and surfaces API failures on load and upsert', async () => {
    // success load
    const list = vi.fn(async () => ({
      success: true as const,
      data: [
        createContact({
          uuid: 'contact-2',
          firstName: 'Zoé',
          lastName: 'Martin',
          institution: 'Martin SARL'
        }),
        createContact({ uuid: 'contact-1', firstName: 'Alex', lastName: 'Roche', role: 'Witness' })
      ]
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      contact: { list, upsert: vi.fn(), delete: vi.fn() }
    } as unknown as OrdicabAPI
    await useContactStore.getState().load({ dossierId: 'dos-1' })
    expect(list).toHaveBeenCalledWith({ dossierId: 'dos-1' })
    expect(useContactStore.getState().contactsByDossierId['dos-1']).toEqual([
      createContact({ uuid: 'contact-1', firstName: 'Alex', lastName: 'Roche', role: 'Witness' }),
      createContact({
        uuid: 'contact-2',
        firstName: 'Zoé',
        lastName: 'Martin',
        institution: 'Martin SARL'
      })
    ])
    expect(useContactStore.getState().errorCode).toBeNull()

    // load failure
    useContactStore.setState(useContactStore.getInitialState(), true)
    ;(globalThis as MutableGlobal).ordicabAPI = {
      contact: {
        list: vi.fn(async () => ({
          success: false as const,
          error: 'Domain unavailable',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        })),
        upsert: vi.fn(),
        delete: vi.fn()
      }
    } as unknown as OrdicabAPI
    await useContactStore.getState().load({ dossierId: 'dos-1' })
    expect(useContactStore.getState().error).toBe('Domain unavailable')
    expect(useContactStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)
    expect(useContactStore.getState().isLoading).toBe(false)
    expect(useContactStore.getState().contactsByDossierId['dos-1']).toBeUndefined()

    // upsert failure
    useContactStore.setState(useContactStore.getInitialState(), true)
    ;(globalThis as MutableGlobal).ordicabAPI = {
      contact: {
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        upsert: vi.fn(async () => ({
          success: false as const,
          error: 'Contact not found',
          code: IpcErrorCode.NOT_FOUND
        })),
        delete: vi.fn()
      }
    } as unknown as OrdicabAPI
    await useContactStore.getState().upsert({
      id: 'missing-id',
      dossierId: 'dos-1',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client'
    })
    expect(useContactStore.getState().error).toBe('Contact not found')
    expect(useContactStore.getState().errorCode).toBe(IpcErrorCode.NOT_FOUND)
  })

  it('upsert inserts and updates contacts while keeping alphabetical order', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        success: true as const,
        data: createContact({
          uuid: 'contact-2',
          firstName: 'Zoé',
          lastName: 'Martin',
          institution: 'Martin SARL'
        })
      })
      .mockResolvedValueOnce({
        success: true as const,
        data: createContact({
          uuid: 'contact-1',
          firstName: 'Alex',
          lastName: 'Roche',
          role: 'Lead client',
          addressLine: '12 rue de la Paix'
        })
      })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      contact: {
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        upsert,
        delete: vi.fn()
      }
    } as unknown as OrdicabAPI
    useContactStore.setState({
      contactsByDossierId: {
        'dos-1': [
          createContact({ uuid: 'contact-1', firstName: 'Alex', lastName: 'Roche', role: 'Client' })
        ]
      },
      isLoading: false,
      error: null,
      errorCode: null
    })

    await useContactStore.getState().upsert({
      dossierId: 'dos-1',
      firstName: 'Zoé',
      lastName: 'Martin',
      role: 'Client',
      institution: 'Martin SARL'
    })
    await useContactStore.getState().upsert({
      id: 'contact-1',
      dossierId: 'dos-1',
      firstName: 'Alex',
      lastName: 'Roche',
      role: 'Lead client',
      addressLine: '12 rue de la Paix'
    })

    expect(useContactStore.getState().contactsByDossierId['dos-1']).toEqual([
      createContact({
        uuid: 'contact-1',
        firstName: 'Alex',
        lastName: 'Roche',
        role: 'Lead client',
        addressLine: '12 rue de la Paix'
      }),
      createContact({
        uuid: 'contact-2',
        firstName: 'Zoé',
        lastName: 'Martin',
        institution: 'Martin SARL'
      })
    ])
  })

  it('remove deletes the matching contact, re-sorts, and surfaces API failures', async () => {
    const remove = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: null })
      .mockResolvedValueOnce({
        success: false as const,
        error: 'Delete failed',
        code: IpcErrorCode.FILE_SYSTEM_ERROR
      })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      contact: {
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        upsert: vi.fn(),
        delete: remove
      }
    } as unknown as OrdicabAPI
    useContactStore.setState({
      contactsByDossierId: {
        'dos-1': [
          createContact({ uuid: 'contact-3', firstName: 'Zoé', lastName: 'Martin' }),
          createContact(),
          createContact({
            uuid: 'contact-2',
            firstName: 'Alex',
            lastName: 'Roche',
            role: 'Witness'
          })
        ]
      },
      isLoading: false,
      error: null,
      errorCode: null
    })

    await useContactStore.getState().remove({ dossierId: 'dos-1', contactUuid: 'contact-1' })
    expect(useContactStore.getState().contactsByDossierId['dos-1']).toEqual([
      createContact({ uuid: 'contact-2', firstName: 'Alex', lastName: 'Roche', role: 'Witness' }),
      createContact({ uuid: 'contact-3', firstName: 'Zoé', lastName: 'Martin' })
    ])

    await useContactStore.getState().remove({ dossierId: 'dos-1', contactUuid: 'contact-2' })
    expect(useContactStore.getState().error).toBe('Delete failed')
    expect(useContactStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)
  })
})
