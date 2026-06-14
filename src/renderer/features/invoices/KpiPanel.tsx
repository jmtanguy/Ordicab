export type KpiAccent = 'emerald' | 'amber' | 'red'

const KPI_ACCENT_CLASS: Record<KpiAccent, string> = {
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-red-700'
}

export interface KpiRowData {
  label: string
  value: string
  accent?: KpiAccent
}

export interface KpiPanelProps {
  title: string
  value: string
  valueAccent?: KpiAccent
  caption?: string
  progress?: number | null
  rows: KpiRowData[]
}

export function KpiPanel({
  title,
  value,
  valueAccent,
  caption,
  progress,
  rows
}: KpiPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-2xl border border-hairline bg-white p-4">
      <p className="text-xs font-medium text-ink-subtle">{title}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          valueAccent ? KPI_ACCENT_CLASS[valueAccent] : 'text-ink'
        }`}
      >
        {value}
      </p>
      {caption ? <p className="text-xs text-ink-subtle">{caption}</p> : null}
      {progress != null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-parchment">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      ) : null}
      {/* Spacer : ancre la zone des lignes en bas pour aligner le séparateur entre cards */}
      <div className="min-h-3 flex-1" />
      {/* min-h = hauteur de 2 lignes (1 bordure + 12 padding + 2×24 lignes + 6 interligne) */}
      <div className="min-h-16.75 space-y-1.5 border-t border-hairline pt-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-muted">{row.label}</span>
            <span
              className={`text-sm font-medium tabular-nums ${
                row.accent ? KPI_ACCENT_CLASS[row.accent] : 'text-ink'
              }`}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
