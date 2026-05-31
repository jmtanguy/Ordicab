import { cn } from '@renderer/lib/utils'

type StatusVariant = 'loading' | 'ready' | 'error'

const statusClasses: Record<StatusVariant, string> = {
  loading: 'border-[#e5e3da] bg-[#f4f3ee] text-[#5c5c5a]',
  ready: 'border-[#cfe0c5] bg-[#f1f7ec] text-[#3c6132]',
  error: 'border-[#e8c7c7] bg-[#fbf0f0] text-[#9c2f2f]'
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
