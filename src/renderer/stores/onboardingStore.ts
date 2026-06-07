import { create } from 'zustand'

import { safeLocalStorageGet, safeLocalStorageSet } from './ipc'

/**
 * Ordered first-run wizard steps. `drive` is the only hard prerequisite
 * (no domain → app is unusable); every later step can be deferred ("Passer").
 */
export const WIZARD_STEP_IDS = ['drive', 'cabinet', 'catalogue', 'ai', 'dossier'] as const
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number]

const FIRST_STEP: WizardStepId = 'drive'
const LAST_STEP: WizardStepId = 'dossier'

export interface OnboardingProgress {
  /** ISO timestamp once the wizard is finished or skipped to the dashboard. Non-null ⇒ the view gate routes to the dashboard. */
  completedAt: string | null
  /** Furthest step reached, used to resume if the app is relaunched mid-wizard. */
  furthestStep: WizardStepId
  /** Steps the user explicitly skipped via "Passer". */
  deferred: WizardStepId[]
}

const ONBOARDING_STORAGE_KEY = 'ordicab.onboarding.v1'

function stepIndex(step: WizardStepId): number {
  const index = WIZARD_STEP_IDS.indexOf(step)
  return index < 0 ? 0 : index
}

/** Returns the step at `index`, clamped to the valid range. */
function stepAt(index: number): WizardStepId {
  const clamped = Math.max(0, Math.min(index, WIZARD_STEP_IDS.length - 1))
  return WIZARD_STEP_IDS[clamped] ?? FIRST_STEP
}

function isWizardStep(value: unknown): value is WizardStepId {
  return typeof value === 'string' && (WIZARD_STEP_IDS as readonly string[]).includes(value)
}

/**
 * Default for a brand-new (empty) profile: wizard not yet completed, parked on
 * the first step. Existing installs are handled by the migration path in
 * {@link loadStoredProgress} / {@link resolveOnboardingComplete}, which fail
 * open so a populated domain is never trapped in the wizard.
 */
function freshProgress(): OnboardingProgress {
  return { completedAt: null, furthestStep: FIRST_STEP, deferred: [] }
}

function sanitizeProgress(raw: unknown): OnboardingProgress {
  if (!raw || typeof raw !== 'object') return freshProgress()
  const value = raw as Partial<OnboardingProgress>

  const completedAt =
    typeof value.completedAt === 'string' && value.completedAt.length > 0 ? value.completedAt : null

  const furthestStep = isWizardStep(value.furthestStep) ? value.furthestStep : FIRST_STEP

  const deferred = Array.isArray(value.deferred)
    ? [...new Set(value.deferred)].filter(isWizardStep)
    : []

  return { completedAt, furthestStep, deferred }
}

function loadStoredProgress(): OnboardingProgress {
  const raw = safeLocalStorageGet(ONBOARDING_STORAGE_KEY)
  if (!raw) return freshProgress()
  try {
    return sanitizeProgress(JSON.parse(raw))
  } catch {
    return freshProgress()
  }
}

function persistProgress(progress: OnboardingProgress): void {
  safeLocalStorageSet(ONBOARDING_STORAGE_KEY, JSON.stringify(progress))
}

/**
 * Whether the view gate should treat onboarding as done. Fails OPEN: a domain
 * that already holds dossiers is considered onboarded even if the flag is
 * absent (existing users upgrading from a build without this key, corrupt
 * storage, or storage unavailable under tests). Brand-new empty domains
 * (`dossierCount === 0`) only count as complete once `completedAt` is set.
 */
export function resolveOnboardingComplete(
  progress: OnboardingProgress,
  dossierCount: number
): boolean {
  if (progress.completedAt != null) return true
  return dossierCount > 0
}

interface OnboardingStoreState {
  progress: OnboardingProgress
  currentStep: WizardStepId
}

interface OnboardingStoreActions {
  /** Records a step as done and advances `furthestStep`. Does not move `currentStep`. */
  markStepComplete: (step: WizardStepId) => void
  /** Records a deferred ("Passer") step. */
  markStepDeferred: (step: WizardStepId) => void
  goToStep: (step: WizardStepId) => void
  next: () => void
  back: () => void
  /** Flips the gate: persists `completedAt` so the wizard never reappears. */
  finishOnboarding: () => void
  /** Re-runs the guided flow from Settings: clears completion and resumes at the first unfinished/deferred step. */
  reopenWizard: () => void
  /** Resets transient step position (e.g. a fresh domain selection) without clearing completion. */
  resetForDomainChange: () => void
}

type OnboardingStore = OnboardingStoreState & OnboardingStoreActions

function bumpFurthest(progress: OnboardingProgress, step: WizardStepId): WizardStepId {
  return stepIndex(step) > stepIndex(progress.furthestStep) ? step : progress.furthestStep
}

export const useOnboardingStore = create<OnboardingStore>()((set, get) => ({
  progress: loadStoredProgress(),
  currentStep: loadStoredProgress().furthestStep,
  markStepComplete: (step) => {
    set((state) => {
      const progress = {
        ...state.progress,
        furthestStep: bumpFurthest(state.progress, step),
        deferred: state.progress.deferred.filter((s) => s !== step)
      }
      persistProgress(progress)
      return { progress }
    })
  },
  markStepDeferred: (step) => {
    set((state) => {
      if (state.progress.deferred.includes(step)) return state
      const progress = {
        ...state.progress,
        furthestStep: bumpFurthest(state.progress, step),
        deferred: [...state.progress.deferred, step]
      }
      persistProgress(progress)
      return { progress }
    })
  },
  goToStep: (step) => {
    set((state) => {
      const progress = { ...state.progress, furthestStep: bumpFurthest(state.progress, step) }
      persistProgress(progress)
      return { currentStep: step, progress }
    })
  },
  next: () => {
    const { currentStep } = get()
    get().goToStep(stepAt(stepIndex(currentStep) + 1))
  },
  back: () => {
    const { currentStep } = get()
    set({ currentStep: stepAt(stepIndex(currentStep) - 1) })
  },
  finishOnboarding: () => {
    set((state) => {
      const progress = {
        ...state.progress,
        completedAt: new Date().toISOString(),
        furthestStep: LAST_STEP
      }
      persistProgress(progress)
      return { progress }
    })
  },
  reopenWizard: () => {
    set((state) => {
      const progress = { ...state.progress, completedAt: null }
      persistProgress(progress)
      // Resume at the first step that is neither completed-past nor deferred-resolved;
      // simplest robust choice is the first deferred step, else the first step.
      const resumeStep = state.progress.deferred
        .slice()
        .sort((a, b) => stepIndex(a) - stepIndex(b))[0]
      return { progress, currentStep: resumeStep ?? FIRST_STEP }
    })
  },
  resetForDomainChange: () => {
    set({ currentStep: FIRST_STEP })
  }
}))
