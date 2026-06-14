import { useTranslation } from 'react-i18next'

import { formatElapsed, useTimerElapsedMs, useTimerStore } from '@renderer/stores/timerStore'

/**
 * Persistent sidebar footer showing the running billable timer. Pinned below
 * the sliding navigation panels so it stays visible wherever the user goes,
 * and clickable to jump back to the timed dossier's billing section.
 */
export function TimerIndicator({
  onOpen
}: {
  onOpen: (dossierId: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const timer = useTimerStore((state) => state.timer)
  const elapsedMs = useTimerElapsedMs()

  if (!timer || elapsedMs === null) return null

  return (
    <button
      type="button"
      onClick={() => onOpen(timer.dossierId)}
      aria-label={t('timer.indicator_label', { defaultValue: 'Chronomètre en cours' })}
      title={t('timer.indicator_open_hint', {
        defaultValue: 'Revenir aux prestations de {{name}}',
        name: timer.dossierName
      })}
      className="flex w-full shrink-0 items-center gap-2.5 border-t border-hairline bg-parchment-bright px-4 py-2.5 text-left transition hover:bg-parchment-dim"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          timer.isPaused ? 'bg-hairline-strong' : 'animate-pulse bg-aurora'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{timer.dossierName}</span>
        {timer.isPaused ? (
          <span className="block text-[10px] uppercase tracking-[0.08em] text-ink-subtle">
            {t('timer.paused_badge', { defaultValue: 'En pause' })}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-ink-muted">
        {formatElapsed(elapsedMs)}
      </span>
    </button>
  )
}
