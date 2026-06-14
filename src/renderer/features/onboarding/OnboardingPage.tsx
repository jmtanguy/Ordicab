import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { Card } from '@renderer/components/ui'
import { StatusPill } from '@renderer/components/shell/StatusPill'
import ordicabLogo from '../../../../resources/ordicab-logo.png'

import { OnboardingWizard } from './OnboardingWizard'

interface OnboardingPageProps {
  versionLabel: string
  domainStatus: 'loading' | 'ready' | 'error'
  isLoading: boolean
  error: string | null
  onSelectDomain: () => Promise<void>
}

function OrdicabBrandMark({ alt }: { alt: string }): React.JSX.Element {
  return <img src={ordicabLogo} alt={alt} className="h-14 w-14 object-contain" />
}

export function OnboardingPage({
  versionLabel,
  domainStatus,
  isLoading,
  error,
  onSelectDomain
}: OnboardingPageProps): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const { t } = useTranslation()

  return (
    <motion.section
      className="overflow-hidden rounded-4xl border border-hairline bg-white shadow-[0_24px_60px_rgba(0,0,0,0.08)]"
      initial={reduceMotion ? undefined : { opacity: 0, y: 18 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={reduceMotion ? undefined : { duration: 0.45, ease: 'easeOut' }}
    >
      <div className="relative border-b border-hairline bg-parchment px-6 py-5 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3.5">
            <OrdicabBrandMark alt={t('shell.brand_name')} />
            <div>
              <h1 className="text-3xl font-semibold tracking-wide text-ink">
                {t('shell.brand_name')}
              </h1>
              <p className="mt-1 text-xs tracking-[0.14em] uppercase text-ink-subtle">
                {t('shell.header_release_badge')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              label={t('shell.status_label_version')}
              value={`${versionLabel}`}
              status={domainStatus}
            />
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6 md:px-8 md:py-7">
        <Card className="border-warning-border bg-warning-tint p-5">
          <div className="warning-banner-body">
            <h4 className="text-lg font-semibold tracking-tight text-warning-deep">
              {t('onboarding.beta_warning_title')}
            </h4>
            <p className="mt-3 text-sm leading-relaxed text-warning-deep">
              {t('onboarding.beta_warning_body1_prefix')}{' '}
              <strong className="font-semibold text-[#5c4500]">
                {t('onboarding.beta_warning_body1_strong')}
              </strong>{' '}
              {t('onboarding.beta_warning_body1_suffix')}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-warning-deep">
              {t('onboarding.beta_warning_body2_prefix')}{' '}
              <strong className="font-semibold text-[#5c4500]">
                {t('onboarding.beta_warning_body2_strong')}
              </strong>{' '}
              {t('onboarding.beta_warning_body2_suffix')}
            </p>
          </div>
        </Card>

        <OnboardingWizard isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
      </div>
    </motion.section>
  )
}
