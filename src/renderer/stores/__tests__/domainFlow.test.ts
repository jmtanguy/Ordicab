import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DomainStatusSnapshot, OrdicabAPI } from '../../../shared/types'

import { useDomainStore } from '../domainStore'
import { useOnboardingStore } from '../onboardingStore'
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
    // The onboarding store is a localStorage-backed singleton; reset only its
    // state fields (not a full replace) so a completedAt set by one test does
    // not leak into the next, while keeping its action functions intact.
    useOnboardingStore.setState({
      progress: { completedAt: null, furthestStep: 'drive', deferred: [] },
      currentStep: 'drive'
    })
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

  it('keeps a fresh empty domain in the onboarding wizard until completed', async () => {
    installApiStub({
      statusSnapshots: [{ registeredDomainPath: '/tmp/domain', isAvailable: true, dossierCount: 0 }]
    })

    const status = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(status)

    // Domain is available but the wizard is not finished and there are no dossiers,
    // so the user stays in onboarding (the guided wizard).
    expect(useUiStore.getState().activeView).toBe('onboarding')
  })

  it('routes to the dashboard once onboarding is completed', async () => {
    installApiStub({
      statusSnapshots: [{ registeredDomainPath: '/tmp/domain', isAvailable: true, dossierCount: 0 }]
    })

    const status = await useDomainStore.getState().refreshStatus()
    useUiStore.getState().applyDomainStatus(status)
    expect(useUiStore.getState().activeView).toBe('onboarding')

    useUiStore.getState().completeOnboardingAndEnterDashboard()
    expect(useUiStore.getState().activeView).toBe('dashboard')
    expect(useOnboardingStore.getState().progress.completedAt).not.toBeNull()

    // A subsequent status poll must not bounce the user back to onboarding.
    useUiStore.getState().applyDomainStatus(useDomainStore.getState().snapshot)
    expect(useUiStore.getState().activeView).toBe('dashboard')
  })
})
