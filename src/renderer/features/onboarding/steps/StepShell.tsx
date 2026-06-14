interface StepShellProps {
  title: string
  description?: string
  /** Optional badge shown next to the title (e.g. "Optionnel"). */
  badge?: string
  children: React.ReactNode
}

/** Consistent header + body framing for a wizard step. */
export function StepShell({
  title,
  description,
  badge,
  children
}: StepShellProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold leading-snug text-ink md:text-2xl">{title}</h2>
          {badge ? (
            <span className="rounded-full border border-hairline bg-parchment px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
