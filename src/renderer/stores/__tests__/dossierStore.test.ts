import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  IpcErrorCode,
  type DossierDetail,
  type DossierSummary,
  type OrdicabAPI
} from '@shared/types'

import { useDossierStore } from '../dossierStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createDossier(options: Partial<DossierSummary> = {}): DossierSummary {
  return {
    id: 'Client Alpha',
    name: 'Client Alpha',
    status: 'active',
    type: '',
    updatedAt: '2026-03-13T09:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    ...options
  }
}

function createDossierDetail(options: Partial<DossierDetail> = {}): DossierDetail {
  return {
    ...createDossier(options),
    registeredAt: '2026-03-13T08:30:00.000Z',
    feeAgreements: [],
    billingItems: [],
    keyDates: [],
    keyReferences: [],
    notes: [],
    ...options
  }
}

describe('dossier store', () => {
  beforeEach(() => {
    useDossierStore.setState(useDossierStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('loads eligible folders and updates the dashboard immediately after registration', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({
          success: true as const,
          data: [
            {
              id: '.ordicab-configuration',
              name: '.ordicab-configuration',
              path: '/tmp/domain/.ordicab-configuration'
            },
            { id: 'Client Alpha', name: 'Client Alpha', path: '/tmp/domain/Client Alpha' }
          ]
        })),
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        deleteKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().loadEligibleFolders()
    expect(useDossierStore.getState().eligibleFolders).toEqual([
      { id: 'Client Alpha', name: 'Client Alpha', path: '/tmp/domain/Client Alpha' }
    ])

    await useDossierStore.getState().register('Client Alpha')

    expect(useDossierStore.getState().dossiers).toEqual([createDossier()])
    expect(useDossierStore.getState().notice).toEqual({
      kind: 'registered',
      dossierName: 'Client Alpha'
    })
  })

  it('surfaces duplicate-registration feedback without creating a duplicate dossier', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({
          success: false as const,
          error: 'This dossier is already registered.',
          code: IpcErrorCode.INVALID_INPUT
        })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        deleteKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    await useDossierStore.getState().register('Client Alpha')

    expect(useDossierStore.getState().dossiers).toEqual([createDossier()])
    expect(useDossierStore.getState().error).toBe('This dossier is already registered.')
  })

  it('removes dossiers from the dashboard immediately after unregister', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        deleteKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    await useDossierStore.getState().unregister('Client Alpha')

    expect(useDossierStore.getState().dossiers).toEqual([])
    expect(useDossierStore.getState().notice).toEqual({
      kind: 'unregistered',
      dossierName: 'Client Alpha'
    })
  })

  it('opens detail through dossier.open and merges the opened dossier back into the dashboard list', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({
            status: 'pending',
            type: 'Civil litigation',
            lastOpenedAt: '2026-03-13T09:05:00.000Z'
          })
        })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        deleteKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    await useDossierStore.getState().openDetail('Client Alpha')

    expect(useDossierStore.getState().activeDossier).toMatchObject({
      id: 'Client Alpha',
      status: 'pending',
      type: 'Civil litigation'
    })
    expect(useDossierStore.getState().dossiers).toEqual([
      createDossier({
        status: 'pending',
        type: 'Civil litigation',
        lastOpenedAt: '2026-03-13T09:05:00.000Z'
      })
    ])
    expect(api.dossier.open).toHaveBeenCalledWith({ dossierId: 'Client Alpha' })
    expect(api.dossier.get).not.toHaveBeenCalled()
  })

  it('loads detail through dossier.get without updating last-opened state', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({ lastOpenedAt: '2026-03-13T09:05:00.000Z' })
        })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({ lastOpenedAt: '2026-03-13T09:05:00.000Z' })
        })),
        upsertKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        deleteKeyDate: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail()
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    await useDossierStore.getState().loadDetail('Client Alpha')

    expect(useDossierStore.getState().activeDossier).toMatchObject({
      id: 'Client Alpha',
      lastOpenedAt: '2026-03-13T09:05:00.000Z'
    })
    expect(api.dossier.get).toHaveBeenCalledWith({ dossierId: 'Client Alpha' })
    expect(api.dossier.open).not.toHaveBeenCalled()
  })

  it('keeps key date and key reference mutations in the active dossier and dashboard summary', async () => {
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        unregister: vi.fn(async () => ({ success: true as const, data: null })),
        get: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        upsertKeyDate: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({
            nextUpcomingKeyDate: '2026-03-18',
            keyDates: [
              {
                id: 'kd-1',
                dossierId: 'Client Alpha',
                label: 'Hearing',
                date: '2026-03-18'
              }
            ]
          })
        })),
        deleteKeyDate: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({
            nextUpcomingKeyDate: null,
            keyDates: []
          })
        })),
        upsertKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({
            keyReferences: [
              {
                id: 'kr-1',
                dossierId: 'Client Alpha',
                label: 'Case number',
                value: 'RG 26/001'
              }
            ]
          })
        })),
        deleteKeyReference: vi.fn(async () => ({
          success: true as const,
          data: createDossierDetail({
            keyReferences: []
          })
        }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    await useDossierStore.getState().loadDetail('Client Alpha')
    await useDossierStore
      .getState()
      .upsertKeyDate({ dossierId: 'Client Alpha', label: 'Hearing', date: '2026-03-18' })

    expect(useDossierStore.getState().activeDossier?.nextUpcomingKeyDate).toBe('2026-03-18')
    expect(useDossierStore.getState().detailNotice).toEqual({
      kind: 'key-date-saved',
      dossierName: 'Client Alpha'
    })
    expect(useDossierStore.getState().dossiers[0]?.nextUpcomingKeyDate).toBe('2026-03-18')

    await useDossierStore.getState().upsertKeyReference({
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/001'
    })

    expect(useDossierStore.getState().activeDossier?.keyReferences).toEqual([
      {
        id: 'kr-1',
        dossierId: 'Client Alpha',
        label: 'Case number',
        value: 'RG 26/001'
      }
    ])

    await useDossierStore.getState().deleteKeyDate({ dossierId: 'Client Alpha', keyDateId: 'kd-1' })
    await useDossierStore
      .getState()
      .deleteKeyReference({ dossierId: 'Client Alpha', keyReferenceId: 'kr-1' })

    expect(useDossierStore.getState().activeDossier?.keyDates).toEqual([])
    expect(useDossierStore.getState().activeDossier?.keyReferences).toEqual([])
    expect(useDossierStore.getState().dossiers[0]?.nextUpcomingKeyDate).toBeNull()
  })

  it('adds a freshly created dossier to the dashboard immediately', async () => {
    const created = createDossier({ id: 'Client Gamma', name: 'Client Gamma' })
    const create = vi.fn(async () => ({ success: true as const, data: created }))
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        create,
        unregister: vi.fn(async () => ({ success: true as const, data: null }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    const ok = await useDossierStore.getState().create('Client Gamma')

    expect(ok).toBe(true)
    expect(create).toHaveBeenCalledWith({ name: 'Client Gamma' })
    expect(useDossierStore.getState().dossiers).toEqual([created])
    expect(useDossierStore.getState().notice).toEqual({
      kind: 'registered',
      dossierName: 'Client Gamma'
    })
  })

  it('surfaces create failures without touching the dashboard list', async () => {
    const create = vi.fn(async () => ({
      success: false as const,
      error: 'A folder with this name already exists.',
      code: IpcErrorCode.INVALID_INPUT
    }))
    const api = {
      dossier: {
        listEligible: vi.fn(async () => ({ success: true as const, data: [] })),
        list: vi.fn(async () => ({ success: true as const, data: [createDossier()] })),
        open: vi.fn(async () => ({ success: true as const, data: createDossierDetail() })),
        register: vi.fn(async () => ({ success: true as const, data: createDossier() })),
        create,
        unregister: vi.fn(async () => ({ success: true as const, data: null }))
      }
    } as unknown as OrdicabAPI

    ;(globalThis as MutableGlobal).ordicabAPI = api

    await useDossierStore.getState().load()
    const ok = await useDossierStore.getState().create('Client Alpha')

    expect(ok).toBe(false)
    expect(useDossierStore.getState().dossiers).toEqual([createDossier()])
    expect(useDossierStore.getState().error).toBe('A folder with this name already exists.')
    expect(useDossierStore.getState().errorCode).toBe(IpcErrorCode.INVALID_INPUT)
  })
})
