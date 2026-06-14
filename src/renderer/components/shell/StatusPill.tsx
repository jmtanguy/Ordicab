import { cn } from '@renderer/lib/utils'

type StatusVariant = 'loading' | 'ready' | 'error'

const statusClasses: Record<StatusVariant, string> = {
  loading: 'border-hairline bg-parchment text-ink-muted',
  ready: 'border-success-border bg-success-tint text-success-deep',
  error: 'border-destructive-border bg-destructive-tint text-destructive'
}

interface StatusPillProps {
  label: string
  value: string
  status: StatusVariant
}

export function StatusPill({ label, value, status }: StatusPillProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex min-w-48 flex-col gap-1 rounded-xl border px-4 py-3',
        statusClasses[status]
      )}
    >
      <span className="text-xs uppercase tracking-[0.18em] opacity-80">{label}</span>
      <strong className="text-sm md:text-base">{value}</strong>
    </div>
  )
}
