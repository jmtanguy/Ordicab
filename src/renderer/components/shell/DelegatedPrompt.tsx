import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/lib/utils'

interface DelegatedPromptProps {
  prompt: string
  label?: string
  className?: string
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

export function DelegatedPrompt({
  prompt,
  label,
  className
}: DelegatedPromptProps): React.JSX.Element {
  const { t } = useTranslation()
  const prefersReducedMotion = useReducedMotion()
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const panelId = useId()
  const resetCopyTimeoutRef = useRef<number | null>(null)

  const resolvedLabel = label ?? t('delegated.addViaClaude')
  const copyLabel = copied ? t('delegated.copied') : t('delegated.copyPrompt')

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

    await navigator.clipboard.writeText(prompt)
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
    <section
      className={cn(
        'rounded-2xl border border-cyan-400/15 bg-slate-950/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        className
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={t('delegated.togglePromptSection', { label: resolvedLabel })}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/70">
            {t('delegated.badge')}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-50">{resolvedLabel}</p>
        </div>
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-transform',
            isOpen && 'rotate-180'
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { type: 'spring', duration: 0.25, bounce: 0.15 }
            }
            style={{ overflow: 'hidden' }}
          >
            <div className="border-t border-white/10 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {t('delegated.promptLabel')}
                </p>
                <button
                  type="button"
                  aria-label={copyLabel}
                  onClick={() => {
                    void handleCopy()
                  }}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full border transition',
                    copied
                      ? 'border-emerald-400/35 bg-emerald-400/12 text-emerald-300'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/40 hover:text-cyan-100'
                  )}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>

              <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/65 p-4 text-sm leading-6 text-slate-100">
                {prompt}
              </pre>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
