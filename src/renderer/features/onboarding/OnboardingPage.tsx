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
          <Card className="border-amber-200/25 bg-amber-950/30 p-5">
            <div className="warning-banner-body">
              <h4 className="text-lg font-semibold tracking-tight text-amber-50">
                Version expérimentale — Ne pas utiliser en production
              </h4>
              <p className="mt-3 text-sm leading-relaxed text-amber-100/90">
                Ce logiciel est une version bêta à des fins de test uniquement.{' '}
                <strong style={{ color: '#fde68a', fontWeight: 600 }}>
                  Ne l&apos;utilisez pas avec des données de travail réelles ou des dossiers de clients.
                </strong>{' '}
                Des bugs, pertes de données ou comportements inattendus peuvent survenir.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-amber-100/90">
                L&apos;utilisation des fonctionnalités d&apos;intelligence artificielle (Claude Cowork, etc.)
                peut impliquer la transmission de données vers des services tiers.{' '}
                <strong style={{ color: '#fde68a', fontWeight: 600 }}>
                  L&apos;utilisateur est seul responsable de la conformité au RGPD
                </strong>
                {' '}notamment en ce qui concerne le traitement de données à caractère personnel via
                des outils et abonnements IA.
              </p>
            </div>
          </Card>
        </div>

        <DomainOnboardingCard isLoading={isLoading} error={error} onSelectDomain={onSelectDomain} />
      </div>
    </motion.section>
  )
}
