/**
 * CoworkPage — dedicated dossier section for the pseudonymized Claude Cowork
 * workflow ("Recherche et IA" nav group). Hosts the export/reimport card plus
 * the step-by-step explanation of the round trip. The page scrolls on its own
 * (content can exceed the viewport).
 */
import { useTranslation } from 'react-i18next'

import { Card } from '@renderer/components/ui'

import { CoworkPanel } from './CoworkPanel'
import { DelegatedReference } from './DelegatedReference'

interface CoworkPageProps {
  dossierId: string
  entityName: string | null
  sampleDossierName: string | null
}

export function CoworkPage({
  dossierId,
  entityName,
  sampleDossierName
}: CoworkPageProps): React.JSX.Element {
  const { t } = useTranslation()

  const steps = [
    { title: t('cowork.step1Title'), body: t('cowork.step1Body') },
    { title: t('cowork.step2Title'), body: t('cowork.step2Body') },
    { title: t('cowork.step3Title'), body: t('cowork.step3Body') },
    { title: t('cowork.step4Title'), body: t('cowork.step4Body') }
  ]

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{t('cowork.pageTitle')}</h2>
          <p className="mt-1 text-sm text-ink-muted">{t('cowork.pageSubtitle')}</p>
        </div>

        <CoworkPanel dossierId={dossierId} />

        <Card>
          <h3 className="text-sm font-semibold text-ink">{t('cowork.howItWorks')}</h3>
          <ol className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-aurora/10 text-xs font-semibold text-aurora">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{step.title}</p>
                  <p className="text-xs text-ink-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink">{t('cowork.privacyTitle')}</h3>
          <p className="mt-2 text-xs text-ink-muted">{t('cowork.privacyBody')}</p>
        </Card>

        {/* Copyable prompt reference for the delegated Claude workflow. */}
        <DelegatedReference entityName={entityName} sampleDossierName={sampleDossierName} />
      </div>
    </div>
  )
}
