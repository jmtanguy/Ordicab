import * as React from 'react'

import { Button } from './button'
import { DialogShell } from './dialog'

export interface ConfirmDialogProps {
  title: string
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel: string
  /** `danger` renders the confirm button in the destructive red used by row actions. */
  tone?: 'default' | 'danger'
  isBusy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  isBusy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <DialogShell onDismiss={onCancel} size="md" aria-label={title}>
      <div className="flex flex-col gap-4">
        <header>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </header>
        <footer className="flex justify-end gap-2 border-t border-hairline pt-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={isBusy}
            className={
              tone === 'danger' ? 'bg-destructive text-white hover:bg-[#822727]' : undefined
            }
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </DialogShell>
  )
}
