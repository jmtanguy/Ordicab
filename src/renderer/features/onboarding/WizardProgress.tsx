import { useTranslation } from 'react-i18next'

import { WIZARD_STEP_IDS, type WizardStepId } from '@renderer/stores'

type StepState = 'done' | 'current' | 'deferred' | 'pending'

interface WizardProgressProps {
  currentStep: WizardStepId
  furthestStep: WizardStepId
  deferred: WizardStepId[]
}

const STEP_LABEL_KEYS: Record<WizardStepId, string> = {
  drive: 'onboarding.step_drive_label',
  cabinet: 'onboarding.step_cabinet_label',
  catalogue: 'onboarding.step_catalogue_label',
  ai: 'onboarding.step_ai_label',
  dossier: 'onboarding.step_dossier_label'
}

const STEP_DEFAULT_LABELS: Record<WizardStepId, string> = {
  drive: 'Drive',
  cabinet: 'Cabinet',
  catalogue: 'Catalogue',
  ai: 'IA',
  dossier: 'Premier dossier'
}

function indexOf(step: WizardStepId): number {
  return WIZARD_STEP_IDS.indexOf(step)
}

function computeState(
  step: WizardStepId,
  currentStep: WizardStepId,
  furthestStep: WizardStepId,
  deferred: WizardStepId[]
): StepState {
  if (step === currentStep) return 'current'
  if (deferred.includes(step)) return 'deferred'
  // A step strictly before the furthest reached point (and not the current one)
  // counts as visited/done.
  if (indexOf(step) < indexOf(furthestStep)) return 'done'
  return 'pending'
}

const CIRCLE_STYLES: Record<StepState, string> = {
  done: 'bg-success-tint text-success-deep border-[#cfe3c4]',
  current: 'bg-aurora/15 text-aurora border-aurora/30',
  deferred: 'bg-warning-tint text-warning border-warning-border',
  pending: 'bg-white text-ink-subtle border-hairline'
}

const LABEL_STYLES: Record<StepState, string> = {
  done: 'text-success-deep',
  current: 'text-ink font-medium',
  deferred: 'text-warning',
  pending: 'text-ink-subtle'
}

export function WizardProgress({
  currentStep,
  furthestStep,
  deferred
}: WizardProgressProps): React.JSX.Element {
  const { t } = useTranslation()
  const currentIndex = indexOf(currentStep)

  return (
    <nav
      aria-label={t('onboarding.progress_step_label', {
        current: currentIndex + 1,
        total: WIZARD_STEP_IDS.length,
        defaultValue: `Étape ${currentIndex + 1} sur ${WIZARD_STEP_IDS.length}`
      })}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      {WIZARD_STEP_IDS.map((step, index) => {
        const state = computeState(step, currentStep, furthestStep, deferred)
        const label = t(STEP_LABEL_KEYS[step], { defaultValue: STEP_DEFAULT_LABELS[step] })
        return (
          <div key={step} className="flex items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition ${CIRCLE_STYLES[state]}`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span className={`text-sm leading-none ${LABEL_STYLES[state]}`}>
                {label}
                {state === 'deferred' ? (
                  <span className="ml-1 text-[10px] uppercase tracking-wide">
                    · {t('onboarding.deferred_badge', { defaultValue: 'Passé' })}
                  </span>
                ) : null}
              </span>
            </div>
            {index < WIZARD_STEP_IDS.length - 1 ? (
              <span aria-hidden className="mx-1 h-px w-5 bg-hairline" />
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
