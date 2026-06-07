import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '@renderer/components/ui'
import { AiDialog } from '@renderer/features/settings/AiSettings'

import { StepShell } from './StepShell'

interface AiStepProps {
  /** Called when the user finishes configuring (or closes) the AI dialog. */
  onComplete: () => void
}

/**
 * Step 4 — optional AI assistant. Reuses the exported {@link AiDialog}. Configuring AI
 * is never required to use the app, so this step is clearly marked optional and is also
 * skippable from the wizard footer.
 */
export function AiStep({ onComplete }: AiStepProps): React.JSX.Element {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <StepShell
      title={t('onboarding.ai_step_title', { defaultValue: 'Assistant IA (optionnel)' })}
      description={t('onboarding.ai_step_hint', {
        defaultValue: 'Activez un assistant IA si vous le souhaitez. Cette étape est facultative.'
      })}
      badge={t('onboarding.step_ai_optional_badge', { defaultValue: 'Optionnel' })}
    >
      <Card className="space-y-4 p-5">
        <Button type="button" variant="ghost" onClick={() => setDialogOpen(true)}>
          {t('settings.aiSettings', { defaultValue: 'Configurer l’IA' })}
        </Button>
      </Card>

      <AiDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          onComplete()
        }}
      />
    </StepShell>
  )
}
