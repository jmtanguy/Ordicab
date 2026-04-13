import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/lib/utils'
import ordicabLogo from '../../../../resources/ordicab-logo.png'

export type TopNavTab = 'dossiers' | 'modeles' | 'delegated' | 'parametres'

type StatusVariant = 'loading' | 'ready' | 'error'

interface TopNavProps {
  activeTab: TopNavTab
  domainStatus: StatusVariant
  domainStatusLabel: string
  versionLabel: string
  onTabChange: (tab: TopNavTab) => void
}

export function TopNav({ activeTab, versionLabel, onTabChange }: TopNavProps): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const { t } = useTranslation()
  const brandName = t('shell.brand_name')
  const normalizedVersionLabel = versionLabel.startsWith(`${brandName} `)
    ? versionLabel.slice(brandName.length + 1)
    : versionLabel

  const tabs: { id: TopNavTab; label: string }[] = [
    { id: 'dossiers', label: t('nav.tab_dossiers') },
    { id: 'modeles', label: t('nav.tab_modeles') },
    { id: 'delegated', label: t('nav.delegatedReference') },
    { id: 'parametres', label: t('nav.tab_parametres') }
  ]

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tabIndex: number
  ): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }

    event.preventDefault()

    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (tabIndex + direction + tabs.length) % tabs.length
    onTabChange(tabs[nextIndex].id)
  }

  return (
    <header className="sticky top-0 z-50 h-14 w-full border-b border-white/[0.08] bg-[rgba(6,13,26,0.88)] backdrop-blur-xl">
      <div className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={ordicabLogo}
            alt={t('shell.brand_name')}
            className="h-8 w-8 shrink-0 object-contain"
          />
          <span className="truncate text-xl font-semibold tracking-tight text-slate-100">
            {t('shell.brand_name')}
          </span>
          <span className="shrink-0 text-xs font-medium text-slate-400">
            {normalizedVersionLabel}
          </span>
        </div>

        <nav
          role="tablist"
          aria-label={t('shell.brand_name')}
          className="justify-self-center rounded-full border border-white/[0.10] bg-white/[0.04] p-1"
        >
          <div className="flex items-center gap-1">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className="group relative isolate rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
              >
                {activeTab === tab.id ? (
                  <motion.span
                    layoutId="nav-capsule"
                    className="absolute inset-0 -z-10 rounded-full bg-aurora/20 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }
                    }
                  />
                ) : null}

                <span
                  className={cn(
                    'relative z-10',
                    activeTab === tab.id
                      ? 'text-aurora'
                      : 'text-slate-400 group-hover:text-slate-200'
                  )}
                >
                  {tab.label}
                </span>
              </button>
            ))}
          </div>
        </nav>

        <div className="flex items-center justify-self-end gap-2 text-right"></div>
      </div>
    </header>
  )
}
