// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  resolveOnboardingComplete,
  useOnboardingStore,
  WIZARD_STEP_IDS,
  type OnboardingProgress
} from '../onboardingStore'

const STORAGE_KEY = 'ordicab.onboarding.v1'

function freshProgress(): OnboardingProgress {
  return { completedAt: null, furthestStep: 'drive', deferred: [] }
}

function resetStore(): void {
  window.localStorage.clear()
  // Reset only the state fields (not a full replace) so the action functions
  // created at store construction time are preserved.
  useOnboardingStore.setState({ progress: freshProgress(), currentStep: 'drive' })
}

describe('onboardingStore step machine', () => {
  beforeEach(resetStore)

  it('exposes the steps in the expected order', () => {
    expect(WIZARD_STEP_IDS).toEqual(['drive', 'cabinet', 'catalogue', 'ai', 'dossier'])
  })

  it('advances and rewinds through steps, clamped at both ends', () => {
    const store = useOnboardingStore.getState()
    expect(store.currentStep).toBe('drive')

    store.next()
    expect(useOnboardingStore.getState().currentStep).toBe('cabinet')

    store.back()
    expect(useOnboardingStore.getState().currentStep).toBe('drive')

    // Cannot rewind before the first step.
    store.back()
    expect(useOnboardingStore.getState().currentStep).toBe('drive')
  })

  it('does not advance past the last step', () => {
    const store = useOnboardingStore.getState()
    store.goToStep('dossier')
    store.next()
    expect(useOnboardingStore.getState().currentStep).toBe('dossier')
  })

  it('tracks the furthest step reached', () => {
    useOnboardingStore.getState().goToStep('catalogue')
    expect(useOnboardingStore.getState().progress.furthestStep).toBe('catalogue')
    // Going back does not lower the furthest marker.
    useOnboardingStore.getState().back()
    expect(useOnboardingStore.getState().progress.furthestStep).toBe('catalogue')
  })

  it('records deferred steps and clears them on completion', () => {
    useOnboardingStore.getState().markStepDeferred('catalogue')
    expect(useOnboardingStore.getState().progress.deferred).toContain('catalogue')

    // Marking the same step complete removes it from the deferred set.
    useOnboardingStore.getState().markStepComplete('catalogue')
    expect(useOnboardingStore.getState().progress.deferred).not.toContain('catalogue')
  })

  it('does not duplicate a deferred step', () => {
    useOnboardingStore.getState().markStepDeferred('ai')
    useOnboardingStore.getState().markStepDeferred('ai')
    expect(useOnboardingStore.getState().progress.deferred).toEqual(['ai'])
  })
})

describe('onboardingStore completion + persistence', () => {
  beforeEach(resetStore)

  it('finishOnboarding sets completedAt and persists it', () => {
    useOnboardingStore.getState().finishOnboarding()

    const progress = useOnboardingStore.getState().progress
    expect(progress.completedAt).not.toBeNull()

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).completedAt).toBe(progress.completedAt)
  })

  it('reopenWizard clears completion and resumes at the first deferred step', () => {
    useOnboardingStore.getState().markStepDeferred('catalogue')
    useOnboardingStore.getState().finishOnboarding()
    expect(useOnboardingStore.getState().progress.completedAt).not.toBeNull()

    useOnboardingStore.getState().reopenWizard()
    expect(useOnboardingStore.getState().progress.completedAt).toBeNull()
    expect(useOnboardingStore.getState().currentStep).toBe('catalogue')
  })

  it('reopenWizard falls back to the first step when nothing was deferred', () => {
    useOnboardingStore.getState().finishOnboarding()
    useOnboardingStore.getState().reopenWizard()
    expect(useOnboardingStore.getState().currentStep).toBe('drive')
  })
})

describe('resolveOnboardingComplete (view gate + migration)', () => {
  it('is complete once completedAt is set, regardless of dossier count', () => {
    expect(
      resolveOnboardingComplete({ completedAt: '2026-01-01T00:00:00.000Z', furthestStep: 'dossier', deferred: [] }, 0)
    ).toBe(true)
  })

  it('fails open for an existing populated domain with no stored flag', () => {
    // Migration / corrupt-storage case: never trap a user who already has dossiers.
    expect(resolveOnboardingComplete(freshProgress(), 3)).toBe(true)
  })

  it('keeps a brand-new empty domain in the wizard', () => {
    expect(resolveOnboardingComplete(freshProgress(), 0)).toBe(false)
  })
})
