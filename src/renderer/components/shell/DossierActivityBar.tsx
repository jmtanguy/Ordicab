import { useReducedMotion } from 'framer-motion'

import { cn } from '@renderer/lib/utils'

/**
 * A single ongoing background action shown in the dossier card's "actions en
 * cours" area. Generic on purpose: extraction/indexing is the first action
 * wired, but generation, export, etc. can be appended later without touching
 * this component.
 */
export interface ActivityItem {
  id: string
  label: string
  current: number
  total: number
  tone?: 'progress' | 'error'
}

/**
 * Renders a compact progress strip per ongoing action below the dossier
 * status. Renders nothing when there is no activity, so the card stays
 * unchanged at rest.
 */
export function DossierActivityBar({
  activities
}: {
  activities: ActivityItem[]
}): React.JSX.Element | null {
  const reduceMotion = useReducedMotion()

  if (activities.length === 0) return null

  return (
    <div className="mt-1.5 space-y-1.5 pl-3.5">
      {activities.map((activity) => {
        const percent =
          activity.total > 0 ? Math.round((activity.current / activity.total) * 100) : 0

        return (
          <div key={activity.id}>
            <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span className="min-w-0 truncate">{activity.label}</span>
              <span className="shrink-0 tabular-nums">
                {activity.current} / {activity.total}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-parchment-dim">
              <div
                className={cn(
                  'h-full rounded-full',
                  activity.tone === 'error' ? 'bg-warning' : 'bg-aurora',
                  reduceMotion ? null : 'transition-all duration-200'
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
