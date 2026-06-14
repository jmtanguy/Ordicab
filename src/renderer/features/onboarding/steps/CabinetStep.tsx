import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '@renderer/components/ui'
import { EntityDialog } from '@renderer/features/domain/EntityPanel'
import { useEntityStore } from '@renderer/stores'

import { StepShell } from './StepShell'

interface CabinetStepProps {
  /** Called once the cabinet profile has a firm name (the only required field). */
  onComplete: () => void
}

/**
 * Step 2 — cabinet identity. Reuses the existing self-contained {@link EntityDialog}
 * (it owns its own validation, save, toast and Escape handling). We detect success by
 * watching the entity store's `profile.firmName`, mirroring how the dialog reports success.
 */
export function CabinetStep({ onComplete }: CabinetStepProps): React.JSX.Element {
  const { t } = useTranslation()
  const profile = useEntityStore((state) => state.profile)
  const loadProfile = useEntityStore((state) => state.load)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const hasFirmName = Boolean(profile?.firmName)

  return (
    <StepShell
      title={t('onboarding.cabinet_step_title', { defaultValue: 'Informations du cabinet' })}
      description={t('onboarding.cabinet_step_hint', {
        defaultValue:
          "Seul le nom du cabinet est requis. L'IBAN, l'adresse et le SIREN sont utiles pour vos factures et conventions."
      })}
    >
      <Card className="space-y-4 p-5">
        {hasFirmName ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">{profile?.firmName}</p>
            <p className="text-sm text-ink-muted">{t('entity.section_summary')}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('entity.emptyHint')}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setDialogOpen(true)}>
            {hasFirmName ? t('entity.editButton') : t('entity.form.firmName')}
          </Button>
          {hasFirmName ? (
            <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs font-medium text-success-deep">
              ✓
            </span>
          ) : null}
        </div>
      </Card>

      <EntityDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false)
          // The dialog only persists on a successful save, so re-read and, if a firm
          // name now exists, mark the step complete (the wizard then advances).
          if (useEntityStore.getState().profile?.firmName) {
            onComplete()
          }
        }}
      />
    </StepShell>
  )
}
