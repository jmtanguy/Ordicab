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

function CopyablePromptFiche({
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
    <div className="flex h-full flex-col gap-4 p-6 [animation:fiche-in_220ms_ease-out]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-ink">{name}</h3>
          <p className="text-sm leading-6 text-ink-muted">{description}</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('delegated.reference.copyOperationPrompt', { name })}
          className="shrink-0 gap-2 rounded-full border border-hairline bg-parchment px-3 text-ink hover:bg-aurora/10"
          onClick={() => {
            void handleCopy()
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? t('delegated.copied') : t('delegated.copyPrompt')}</span>
        </Button>
      </div>

      {/* The prompt reads like a fiche bristol: faint ruling + legal-pad margin. */}
      <pre className="whitespace-pre-wrap rounded-xl border border-hairline border-l-2 border-l-aurora/40 bg-white bg-[repeating-linear-gradient(transparent,transparent_23px,rgba(15,122,138,0.05)_24px)] p-4 pl-5 text-sm leading-6 text-ink">
        {prompt}
      </pre>
    </div>
  )
}

interface PromptBinderOperation {
  id: string
  name: string
  description: string
  prompt: string
}

/**
 * « Classeur à intercalaires » — the nine prompt templates presented as a
 * single index card behind a row of numbered file-divider tabs, instead of a
 * page-flooding grid. Tabs are a real ARIA tablist (arrow keys cycle), the
 * deck of remaining fiches peeks out behind the active card.
 */
function PromptBinder({ operations }: { operations: PromptBinderOperation[] }): React.JSX.Element {
  const { t } = useTranslation()
  const [activeIndex, setActiveIndex] = useState(0)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const count = operations.length
  const active = operations[Math.min(activeIndex, count - 1)]
  if (!active) return <></>

  const select = (index: number): void => {
    const next = (index + count) % count
    setActiveIndex(next)
    tabRefs.current[next]?.focus()
  }

  const handleTablistKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      select(activeIndex + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      select(activeIndex - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      select(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      select(count - 1)
    }
  }

  return (
    <div>
      {/* Intercalaires — overlapping folder tabs, active one merges into the card */}
      <div
        role="tablist"
        aria-label={t('delegated.reference.title')}
        onKeyDown={handleTablistKeyDown}
        className="relative z-10 -mb-px flex items-end gap-0 overflow-x-auto pl-3 pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {operations.map((operation, index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={operation.id}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={`prompt-tab-${operation.id}`}
              aria-selected={isActive}
              aria-controls={`prompt-fiche-${operation.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => select(index)}
              title={operation.name}
              className={`-ml-px flex max-w-[11rem] shrink-0 items-center gap-1.5 truncate rounded-t-xl border border-hairline-strong px-3 text-xs font-medium transition-all first:ml-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45 ${
                isActive
                  ? 'z-10 border-b-white bg-white py-2.5 text-ink shadow-[0_-6px_14px_rgba(10,92,104,0.08)]'
                  : 'mt-1.5 border-b-hairline-strong bg-parchment-dim py-1.5 text-ink-muted hover:-translate-y-0.5 hover:bg-parchment hover:text-ink'
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  isActive ? 'bg-aurora text-white' : 'bg-hairline-strong/60 text-ink-muted'
                }`}
              >
                {index + 1}
              </span>
              <span className="truncate">{operation.name}</span>
            </button>
          )
        })}
      </div>

      {/* The deck: two slightly fanned fiches peeking behind the active card */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-2 -bottom-2 top-2 rotate-[0.5deg] rounded-2xl border border-hairline bg-white/55"
        />
        <div
          aria-hidden
          className="absolute inset-x-1 -bottom-1 top-1 -rotate-[0.35deg] rounded-2xl border border-hairline bg-white/75"
        />

        <div
          key={active.id}
          role="tabpanel"
          id={`prompt-fiche-${active.id}`}
          aria-labelledby={`prompt-tab-${active.id}`}
          className="relative rounded-2xl rounded-tl-none border border-hairline-strong bg-white shadow-[0_18px_40px_rgba(10,92,104,0.10)]"
        >
          <CopyablePromptFiche
            name={active.name}
            description={active.description}
            prompt={active.prompt}
          />

          {/* Fiche footer: counter + prev/next */}
          <div className="flex items-center justify-between border-t border-hairline px-6 py-3">
            <span className="text-xs tabular-nums text-ink-muted">
              {t('delegated.reference.ficheCounter', {
                current: activeIndex + 1,
                total: count,
                defaultValue: 'Fiche {{current}} / {{total}}'
              })}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => select(activeIndex - 1)}
                aria-label={t('delegated.reference.prevFiche', {
                  defaultValue: 'Fiche précédente'
                })}
                className="rounded-full border border-hairline p-1.5 text-ink-muted transition hover:bg-aurora/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M9.5 3.5 5 8l4.5 4.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => select(activeIndex + 1)}
                aria-label={t('delegated.reference.nextFiche', { defaultValue: 'Fiche suivante' })}
                className="rounded-full border border-hairline p-1.5 text-ink-muted transition hover:bg-aurora/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/45"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M6.5 3.5 11 8l-4.5 4.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {showPlaceholderNotice ? (
        <AlertBanner tone="warning">{t('delegated.reference.noDomain')}</AlertBanner>
      ) : null}

      <Card className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t('delegated.offline.title')}</h2>
          <p className="max-w-3xl text-sm leading-6 text-ink">{t('delegated.offline.subtitle')}</p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-ink-muted">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((step) => (
            <li key={step}>{t(`delegated.offline.${step}`)}</li>
          ))}
        </ol>
      </Card>

      <PromptBinder
        operations={operations.map((operation) => ({
          id: operation.id,
          name: operation.name,
          description: operation.description,
          prompt: operation.buildPrompt(context)
        }))}
      />
    </section>
  )
}
