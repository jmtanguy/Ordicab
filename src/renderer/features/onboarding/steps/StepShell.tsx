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
          <h2 className="text-xl font-semibold leading-snug text-[#1a1a1a] md:text-2xl">{title}</h2>
          {badge ? (
            <span className="rounded-full border border-[#e5e3da] bg-[#f4f3ee] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#8a8a85]">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-[#5c5c5a]">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  )
}
