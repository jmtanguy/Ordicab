import type { AsyncVoidAction } from '@renderer/features/actions'

import { DomainOnboardingCard } from '../DomainOnboardingCard'

interface DriveStepProps {
  isLoading: boolean
  error: string | null
  /** Triggers the native folder picker. The wizard advances once a domain becomes available. */
  onSelectDomain: AsyncVoidAction
}

/**
 * Step 1 — connect the working Drive folder. This is the only hard prerequisite,
 * so it has no "Passer" affordance. Reuses {@link DomainOnboardingCard} verbatim.
 */
export function DriveStep({ isLoading, error, onSelectDomain }: DriveStepProps): React.JSX.Element {
  return (
    <DomainOnboardingCard isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
  )
}
