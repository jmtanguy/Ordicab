import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AlertBanner, Button, Card } from '@renderer/components/ui'

import { DELEGATED_OPERATIONS, type DelegatedContext } from './promptTemplates'

interface DelegatedReferenceProps {
  entityName: string | null
  sampleDossierName: string | null
}

interface CopyablePromptCardProps {
  description: string
  name: string
  prompt: string
}

function CopyIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="3" width="8" height="10" rx="1.5" />
      <path d="M3 11.5V5.5C3 4.67 3.67 4 4.5 4H5" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  )
}

function CopyablePromptCard({
  description,
  name,
  prompt
}: CopyablePromptCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const resetCopyTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetCopyTimeoutRef.current !== null) {
        window.clearTimeout(resetCopyTimeoutRef.current)
      }
    }
  }, [])

  async function handleCopy(): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      return
    }

    setCopied(true)

    if (resetCopyTimeoutRef.current !== null) {
      window.clearTimeout(resetCopyTimeoutRef.current)
    }

    resetCopyTimeoutRef.current = window.setTimeout(() => {
      setCopied(false)
      resetCopyTimeoutRef.current = null
    }, 1500)
  }

  return (
    <Card className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-slate-50">{name}</h3>
          <p className="text-sm leading-6 text-slate-300">{description}</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('delegated.reference.copyOperationPrompt', { name })}
          className="shrink-0 gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-slate-100 hover:bg-cyan-400/10"
          onClick={() => {
            void handleCopy()
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? t('delegated.copied') : t('delegated.copyPrompt')}</span>
        </Button>
      </div>

      <pre className="mt-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm leading-6 text-slate-100">
        {prompt}
      </pre>
    </Card>
  )
}

export function DelegatedReference({
  entityName,
  sampleDossierName
}: DelegatedReferenceProps): React.JSX.Element {
  const { t } = useTranslation()
  const context: DelegatedContext = {
    entityName,
    sampleDossierName
  }
  const operations = [...DELEGATED_OPERATIONS].sort((left, right) => left.priority - right.priority)
  const showPlaceholderNotice = !context.entityName && !context.sampleDossierName

  return (
    <section className="mx-auto flex min-h-[calc(100vh-8.5rem)] w-full max-w-6xl flex-col gap-6">
      <Card className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
            {t('delegated.badge')}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-50">
            {t('delegated.reference.title')}
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            {t('delegated.reference.subtitle')}
          </p>
        </div>

        {showPlaceholderNotice ? (
          <AlertBanner tone="warning">{t('delegated.reference.noDomain')}</AlertBanner>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-50">{t('delegated.offline.title')}</h2>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            {t('delegated.offline.subtitle')}
          </p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-400">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((step) => (
            <li key={step}>{t(`delegated.offline.${step}`)}</li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {operations.map((operation) => (
          <CopyablePromptCard
            key={operation.id}
            name={operation.name}
            description={operation.description}
            prompt={operation.buildPrompt(context)}
          />
        ))}
      </div>
    </section>
  )
}
