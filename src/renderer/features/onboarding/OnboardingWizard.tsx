import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui'
import type { AsyncVoidAction } from '@renderer/features/actions'
import {
  useOnboardingStore,
  useUiStore,
  WIZARD_STEP_IDS,
  type WizardStepId
} from '@renderer/stores'

import { WizardProgress } from './WizardProgress'
import { AiStep } from './steps/AiStep'
import { CabinetStep } from './steps/CabinetStep'
import { CatalogueStep } from './steps/CatalogueStep'
import { DossierStep } from './steps/DossierStep'
import { DriveStep } from './steps/DriveStep'

interface OnboardingWizardProps {
  isLoading: boolean
  error: string | null
  /** Triggers the native domain folder picker. AppShell advances the wizard on success. */
  onSelectDomain: AsyncVoidAction
}

function lastStep(): WizardStepId {
  return WIZARD_STEP_IDS[WIZARD_STEP_IDS.length - 1] ?? 'dossier'
}

export function OnboardingWizard({
  isLoading,
  error,
  onSelectDomain
}: OnboardingWizardProps): React.JSX.Element {
  const { t } = useTranslation()
  const currentStep = useOnboardingStore((state) => state.currentStep)
  const progress = useOnboardingStore((state) => state.progress)
  const markStepComplete = useOnboardingStore((state) => state.markStepComplete)
  const markStepDeferred = useOnboardingStore((state) => state.markStepDeferred)
  const next = useOnboardingStore((state) => state.next)
  const back = useOnboardingStore((state) => state.back)
  const completeOnboardingAndEnterDashboard = useUiStore(
    (state) => state.completeOnboardingAndEnterDashboard
  )
  const exitOnboardingToDashboard = useUiStore((state) => state.exitOnboardingToDashboard)

  const isFirstStep = currentStep === WIZARD_STEP_IDS[0]
  const isLastStep = currentStep === lastStep()

  // Drive is the only mandatory step; it cannot be skipped or stepped past manually.
  const canSkip = !isFirstStep

  const advance = (): void => {
    if (isLastStep) {
      completeOnboardingAndEnterDashboard()
    } else {
      next()
    }
  }

  // A step reports success here; record completion then move on (or finish).
  const handleStepComplete = (): void => {
    markStepComplete(currentStep)
    advance()
  }

  const handleSkip = (): void => {
    markStepDeferred(currentStep)
    advance()
  }

  const renderStep = (): React.JSX.Element => {
    switch (currentStep) {
      case 'drive':
        return <DriveStep isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
      case 'cabinet':
        return <CabinetStep onComplete={handleStepComplete} />
      case 'catalogue':
        return <CatalogueStep onComplete={handleStepComplete} />
      case 'ai':
        return <AiStep onComplete={handleStepComplete} />
      case 'dossier':
        return <DossierStep onComplete={handleStepComplete} />
      default:
        return <DriveStep isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <WizardProgress
            currentStep={currentStep}
            furthestStep={progress.furthestStep}
            deferred={progress.deferred}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={exitOnboardingToDashboard}
          className="shrink-0"
        >
          {t('onboarding.action_exit', { defaultValue: 'Quitter' })}
        </Button>
      </div>

      <div className="min-h-0">{renderStep()}</div>

      {/* The Drive step owns its own primary action (folder picker) and auto-advances,
          so the wizard footer only appears from step 2 onward. */}
      {!isFirstStep ? (
        <div className="flex items-center justify-between gap-2 border-t border-[#e5e3da] pt-4">
          <Button type="button" variant="ghost" onClick={back}>
            {t('onboarding.action_back', { defaultValue: 'Retour' })}
          </Button>
          <div className="flex items-center gap-2">
            {canSkip ? (
              <Button type="button" variant="ghost" onClick={handleSkip}>
                {t('onboarding.action_skip', { defaultValue: 'Passer' })}
              </Button>
            ) : null}
            <Button type="button" onClick={advance}>
              {isLastStep
                ? t('onboarding.action_finish', { defaultValue: 'Terminer' })
                : t('onboarding.action_next', { defaultValue: 'Suivant' })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
