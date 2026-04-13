import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EntityProfile, OrdicabAPI } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { useEntityStore } from '../entityStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createEntityProfile(overrides: Partial<EntityProfile> = {}): EntityProfile {
  return {
    firmName: 'Cabinet Martin',
    address: '12 rue de la Paix, 75001 Paris',
    vatNumber: 'FR12345678901',
    phone: '+33 1 02 03 04 05',
    email: 'contact@example.com',
    ...overrides
  }
}

describe('entityStore', () => {
  beforeEach(() => {
    useEntityStore.setState(useEntityStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('loads the entity profile through the preload bridge', async () => {
    const get = vi.fn(async () => ({
      success: true as const,
      data: createEntityProfile()
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get,
        update: vi.fn()
      }
    } as unknown as OrdicabAPI

    await useEntityStore.getState().load()

    expect(get).toHaveBeenCalledTimes(1)
    expect(useEntityStore.getState().profile).toEqual(createEntityProfile())
    expect(useEntityStore.getState().isLoading).toBe(false)
    expect(useEntityStore.getState().errorCode).toBeNull()
  })

  it('saves the entity profile and keeps the latest server payload', async () => {
    const update = vi.fn(async () => ({
      success: true as const,
      data: createEntityProfile({
        firmName: 'Cabinet Martin & Associes',
        email: 'office@example.com'
      })
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get: vi.fn(),
        update
      }
    } as unknown as OrdicabAPI

    await useEntityStore.getState().save({
      firmName: 'Cabinet Martin & Associes',
      email: 'office@example.com',
      address: '',
      vatNumber: '',
      phone: ''
    })

    expect(update).toHaveBeenCalledWith({
      firmName: 'Cabinet Martin & Associes',
      email: 'office@example.com',
      address: '',
      vatNumber: '',
      phone: ''
    })
    expect(useEntityStore.getState().profile).toEqual(
      createEntityProfile({
        firmName: 'Cabinet Martin & Associes',
        email: 'office@example.com'
      })
    )
    expect(useEntityStore.getState().errorCode).toBeNull()
  })

  it('surfaces API failures on load and save', async () => {
    const get = vi.fn(async () => ({
      success: false as const,
      error: 'Domain unavailable',
      code: IpcErrorCode.NOT_FOUND
    }))
    const update = vi.fn(async () => ({
      success: false as const,
      error: 'Save failed',
      code: IpcErrorCode.FILE_SYSTEM_ERROR
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get,
        update
      }
    } as unknown as OrdicabAPI

    await useEntityStore.getState().load()
    expect(useEntityStore.getState().error).toBe('Domain unavailable')
    expect(useEntityStore.getState().errorCode).toBe(IpcErrorCode.NOT_FOUND)

    await useEntityStore.getState().save({
      firmName: 'Cabinet Martin',
      address: '',
      vatNumber: '',
      phone: '',
      email: ''
    })
    expect(useEntityStore.getState().error).toBe('Save failed')
    expect(useEntityStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)
  })
})
