import { Button, Card } from '@renderer/components/ui'
import type { AsyncVoidAction } from '@renderer/features/actions'
import { useTranslation } from 'react-i18next'

interface DomainOnboardingCardProps {
  isLoading: boolean
  error: string | null
  onSelectDomain: AsyncVoidAction
}

export function DomainOnboardingCard({
  isLoading,
  error,
  onSelectDomain
}: DomainOnboardingCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const steps = [
    {
      number: '1',
      title: t('domain.setup_step_choose_title')
    },
    {
      number: '2',
      title: t('domain.setup_step_bootstrap_title')
    },
    {
      number: '3',
      title: t('domain.setup_step_resume_title')
    }
  ]

  return (
    <Card className="mx-auto w-full max-w-3xl space-y-8 border-white/[0.12] bg-[linear-gradient(90deg,rgba(255,255,255,0.06),rgba(125,211,252,0.07),transparent),linear-gradient(180deg,rgba(10,18,32,0.78),rgba(8,15,27,0.72))] p-5 shadow-[0_28px_80px_rgba(2,6,23,0.32)] md:p-6">
      <div>
        <h2 className="text-balance text-xl font-semibold leading-snug text-slate-50 md:text-2xl">
          {t('domain.setup_title')}
        </h2>
        <p className="mt-2 max-w-2xl text-pretty text-base leading-relaxed text-slate-400">
          {t('domain.setup_summary_onboarding')}
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-300/40 bg-rose-300/15 px-4 py-3 text-base text-rose-100">
          <p className="text-[11px] uppercase tracking-[0.18em] opacity-80">
            {t('domain.error_label_action_required')}
          </p>
          <p className="mt-1">
            {t('domain.error_prefix_runtime')}: {error}
          </p>
        </div>
      ) : null}

      <div className="space-y-3 border-l border-white/10 pl-4">
        {steps.map((step) => (
          <div key={step.number} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aurora/15 text-xs font-semibold text-aurora-soft">
              {step.number}
            </span>
            <span className="text-base leading-relaxed text-slate-300">{step.title}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Button
          className="ord-button-primary h-auto w-full"
          onClick={() => void onSelectDomain()}
          disabled={isLoading}
        >
          {t('domain.onboarding_action_select')}
        </Button>
        <p className="text-sm leading-5 text-slate-500">{t('domain.setup_hint')}</p>
      </div>
    </Card>
  )
}
