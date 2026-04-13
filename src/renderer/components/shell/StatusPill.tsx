import { cn } from '@renderer/lib/utils'

type StatusVariant = 'loading' | 'ready' | 'error'

const statusClasses: Record<StatusVariant, string> = {
  loading: 'border-sky-300/40 bg-sky-300/15 text-sky-100',
  ready: 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100',
  error: 'border-rose-300/40 bg-rose-300/15 text-rose-100'
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
