import { Button, DialogShell } from '@renderer/components/ui'

interface EulaDialogProps {
  open: boolean
  title: string
  summary: string
  acceptLabel: string
  loadingLabel: string
  content: string
  version: string
  error: string | null
  isSubmitting: boolean
  onAccept: () => Promise<void>
}

export function EulaDialog({
  open,
  title,
  summary,
  acceptLabel,
  loadingLabel,
  content,
  version,
  error,
  isSubmitting,
  onAccept
}: EulaDialogProps): React.JSX.Element | null {
  if (!open) {
    return null
  }

  return (
    <DialogShell aria-label={title} size="lg">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
        <p className="text-sm text-slate-300">{summary}</p>
        <p className="text-xs uppercase tracking-[0.12em] text-slate-400">EULA {version}</p>

        <div className="max-h-[48vh] overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-4">
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">
            {content}
          </pre>
        </div>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              void onAccept()
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? loadingLabel : acceptLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  )
}
