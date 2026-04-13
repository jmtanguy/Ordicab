import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DomainStatusSnapshot, OrdicabAPI } from '../../../shared/types'

import { useDomainStore } from '../domainStore'
import { useUiStore } from '../uiStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function installApiStub(options: {
  statusSnapshots: DomainStatusSnapshot[]
  selectionResult?: { selectedPath: string | null }
}): void {
  const statusQueue = [...options.statusSnapshots]

  const api = {
    app: {
      version: vi.fn(async () => ({
        success: true as const,
        data: { name: 'Ordicab', version: '1.0.0' }
      })),
      openExternal: vi.fn(async () => ({ success: true as const, data: null })),
      openFolder: vi.fn(async () => ({ success: true as const, data: null }))
    },
    domain: {
      select: vi.fn(async () => ({
        success: true as const,
        data: options.selectionResult ?? { selectedPath: null }
      })),
      status: vi.fn(async () => ({
        success: true as const,
        data: statusQueue.length > 1 ? statusQueue.shift()! : statusQueue[0]
      }))
    }
  } as unknown as OrdicabAPI

  ;(globalThis as MutableGlobal).ordicabAPI = api
}

describe('domain flow state transitions', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState(), true)
    useDomainStore.setState(useDomainStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('routes first launch to onboarding when no domain is configured', async () => {
    installApiStub({
      statusSnapshots: [{ registeredDomainPath: null, isAvailable: false, dossierCount: 0 }]
    })

    const status = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(status)

    expect(useUiStore.getState().activeView).toBe('onboarding')
  })

  it('routes relaunch with existing domain to dashboard', async () => {
    installApiStub({
      statusSnapshots: [{ registeredDomainPath: '/tmp/domain', isAvailable: true, dossierCount: 4 }]
    })

    const status = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(status)

    expect(useUiStore.getState().activeView).toBe('dashboard')
  })

  it('routes unavailable configured domain back to onboarding', async () => {
    installApiStub({
      statusSnapshots: [
        { registeredDomainPath: '/tmp/domain', isAvailable: false, dossierCount: 0 }
      ]
    })

    const status = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(status)

    expect(useUiStore.getState().activeView).toBe('onboarding')
  })

  it('returns to dashboard after change-domain selection succeeds', async () => {
    installApiStub({
      selectionResult: { selectedPath: '/tmp/domain-b' },
      statusSnapshots: [
        { registeredDomainPath: '/tmp/domain-a', isAvailable: false, dossierCount: 0 },
        { registeredDomainPath: '/tmp/domain-b', isAvailable: true, dossierCount: 2 }
      ]
    })

    const initialStatus = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(initialStatus)
    expect(useUiStore.getState().activeView).toBe('onboarding')

    await useDomainStore.getState().selectDomain()
    useUiStore.getState().applyDomainStatus(useDomainStore.getState().snapshot)

    expect(useUiStore.getState().activeView).toBe('dashboard')
    expect(useDomainStore.getState().snapshot.registeredDomainPath).toBe('/tmp/domain-b')
  })
})
