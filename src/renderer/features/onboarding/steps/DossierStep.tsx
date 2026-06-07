import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '@renderer/components/ui'
import { FolderPickerDialog } from '@renderer/features/dossiers/FolderPickerDialog'
import { useDossierStore } from '@renderer/stores'

import { StepShell } from './StepShell'

interface DossierStepProps {
  /** Called once a dossier is registered or created. */
  onComplete: () => void
}

/**
 * Step 5 — register or create the first dossier. Reuses {@link FolderPickerDialog},
 * sourcing its data/handlers from the dossier store. When no eligible subfolders exist,
 * the picker shows its own empty state and create path; the wizard footer also offers
 * "Passer" so the user is never stuck.
 */
export function DossierStep({ onComplete }: DossierStepProps): React.JSX.Element {
  const { t } = useTranslation()
  const eligibleFolders = useDossierStore((state) => state.eligibleFolders)
  const isEligibleLoading = useDossierStore((state) => state.isEligibleLoading)
  const loadEligibleFolders = useDossierStore((state) => state.loadEligibleFolders)
  const register = useDossierStore((state) => state.register)
  const create = useDossierStore((state) => state.create)
  const error = useDossierStore((state) => state.error)
  const errorCode = useDossierStore((state) => state.errorCode)
  const clearError = useDossierStore((state) => state.clearError)

  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    void loadEligibleFolders()
  }, [loadEligibleFolders])

  const hasEligible = eligibleFolders.length > 0

  return (
    <StepShell
      title={t('onboarding.dossier_step_title', { defaultValue: 'Enregistrer un premier dossier' })}
    >
      <Card className="space-y-4 p-5">
        <p className="text-sm text-[#5c5c5a]">
          {hasEligible
            ? t('dossiers.picker_summary', {
                defaultValue: 'Choisissez un sous-dossier existant à enregistrer, ou créez-en un.'
              })
            : t('onboarding.dossier_step_empty_hint', {
                defaultValue: 'Aucun sous-dossier détecté. Créez-en un ou passez cette étape.'
              })}
        </p>
        <Button type="button" onClick={() => setPickerOpen(true)} disabled={isEligibleLoading}>
          {t('dossiers.register_action', { defaultValue: 'Enregistrer un dossier' })}
        </Button>
      </Card>

      <FolderPickerDialog
        open={pickerOpen}
        isLoading={isEligibleLoading}
        eligibleFolders={eligibleFolders}
        onLoadEligibleFolders={loadEligibleFolders}
        onRegister={async (id) => {
          const ok = await register(id)
          if (ok) onComplete()
          return ok
        }}
        onCreate={async (name) => {
          const ok = await create(name)
          if (ok) onComplete()
          return ok
        }}
        createError={error}
        createErrorCode={errorCode}
        onClearError={clearError}
        onDismiss={() => setPickerOpen(false)}
      />
    </StepShell>
  )
}
