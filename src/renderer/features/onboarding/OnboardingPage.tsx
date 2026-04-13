import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { Card } from '@renderer/components/ui'
import { StatusPill } from '@renderer/components/shell/StatusPill'
import ordicabLogo from '../../../../resources/ordicab-logo.png'

import { DomainOnboardingCard } from './DomainOnboardingCard'

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
      className="overflow-hidden rounded-[2rem] border border-white/[0.12] bg-[linear-gradient(180deg,rgba(10,18,32,0.76),rgba(7,14,26,0.7))] shadow-[0_34px_110px_rgba(2,6,23,0.34)]"
      initial={reduceMotion ? undefined : { opacity: 0, y: 18 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={reduceMotion ? undefined : { duration: 0.45, ease: 'easeOut' }}
    >
      <div className="relative border-b border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.06),rgba(125,211,252,0.07),transparent)] px-6 py-5 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3.5">
            <OrdicabBrandMark alt={t('shell.brand_name')} />
            <div>
              <h1 className="text-3xl font-semibold tracking-wide text-slate-50">
                {t('shell.brand_name')}
              </h1>
              <p className="mt-1 text-xs tracking-[0.14em] uppercase text-slate-400">
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

      <div className="relative grid items-start gap-6 px-6 py-6 md:px-8 md:py-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.92fr)] lg:gap-8">
        <div className="flex flex-col gap-10 self-center">
          <div>
            <h2 className="text-pretty text-3xl font-semibold leading-snug text-slate-50 md:text-[2rem]">
              {t('onboarding.hero_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-pretty text-base leading-relaxed text-slate-400 md:text-lg">
              {t('onboarding.hero_summary')}
            </p>
          </div>

          <div className="grid gap-3">
            <Card className="border-white/10 bg-white/4 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-aurora-soft/80">
                {t('shell.teaser_card_local_label')}
              </p>
              <p className="mt-2 text-base leading-relaxed text-slate-300">
                {t('shell.teaser_card_local_body')}
              </p>
            </Card>
          </div>
        </div>

        <DomainOnboardingCard isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
      </div>
    </motion.section>
  )
}
