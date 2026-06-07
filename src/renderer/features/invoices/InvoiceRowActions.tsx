import { useEffect, useRef, useState } from 'react'

import type { InvoiceRecord } from '@shared/types'
import { cn } from '@renderer/lib/utils'
import { PencilIcon } from '@renderer/features/dossiers/sectionLayout'

interface InvoiceRowActionsProps {
  invoice: InvoiceRecord
  onMarkPaid: () => void
  onAddPayment: () => void
  onCreateCreditNote: () => void
  onCorrect: () => void
  onCancel: () => void
}

type ActionTone = 'default' | 'emerald' | 'amber' | 'indigo' | 'danger'

interface ActionItem {
  key: string
  label: string
  tone: ActionTone
  onClick: () => void
}

/**
 * Compact action menu shown on each invoice row. The row itself opens the
 * preview on click; this component only exposes the state-changing actions
 * (settle, correct, cancel) behind a single pencil button so the row stays
 * uncluttered and the available actions are spelled out as readable labels.
 */
export function InvoiceRowActions({
  invoice,
  onMarkPaid,
  onAddPayment,
  onCreateCreditNote,
  onCorrect,
  onCancel
}: InvoiceRowActionsProps): React.JSX.Element | null {
  const canSettle =
    invoice.documentType !== 'creditNote' &&
    invoice.status !== 'cancelled' &&
    invoice.status !== 'corrected' &&
    invoice.remainingAmountCents > 0
  // Une rétribution AJ (part de l'État) ne peut donner lieu ni à un avoir ni à une
  // facture rectificative : ce ne sont pas des factures commerciales.
  const canCorrect =
    invoice.documentType !== 'creditNote' &&
    invoice.documentType !== 'stateRetribution' &&
    invoice.status !== 'cancelled'
  const canCancel =
    invoice.status !== 'cancelled' &&
    invoice.status !== 'corrected' &&
    invoice.paidAmountCents === 0

  const items: ActionItem[] = []
  if (canSettle) {
    items.push({
      key: 'mark-paid',
      label: 'Marquer comme payée',
      tone: 'emerald',
      onClick: onMarkPaid
    })
    items.push({
      key: 'add-payment',
      label: 'Ajouter un règlement',
      tone: 'emerald',
      onClick: onAddPayment
    })
  }
  if (canCorrect) {
    items.push({
      key: 'credit-note',
      label: 'Émettre un avoir',
      tone: 'amber',
      onClick: onCreateCreditNote
    })
    items.push({
      key: 'corrective',
      label: 'Facture rectificative',
      tone: 'indigo',
      onClick: onCorrect
    })
  }
  if (canCancel) {
    items.push({
      key: 'cancel',
      label: 'Annuler la facture',
      tone: 'danger',
      onClick: onCancel
    })
  }

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handleMouseDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div
      className="flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div ref={containerRef} className="relative inline-flex">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Actions"
          title="Actions"
          onClick={() => setOpen((value) => !value)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#5c5c5a] transition hover:bg-aurora/10 hover:text-aurora focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40"
        >
          <PencilIcon />
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-8 z-30 w-56 overflow-hidden rounded-xl border border-[#e5e3da] bg-white shadow-lg"
          >
            {items.map((item) => (
              <MenuItem
                key={item.key}
                label={item.label}
                tone={item.tone}
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const TONE_TEXT: Record<ActionTone, string> = {
  default: 'text-[#1a1a1a]',
  emerald: 'text-emerald-700',
  amber: 'text-amber-700',
  indigo: 'text-indigo-700',
  danger: 'text-[#9c2f2f]'
}

const TONE_HOVER: Record<ActionTone, string> = {
  default: 'hover:bg-[#fbf9f4]',
  emerald: 'hover:bg-emerald-50',
  amber: 'hover:bg-amber-50',
  indigo: 'hover:bg-indigo-50',
  danger: 'hover:bg-[#fbf0f0]'
}

interface MenuItemProps {
  label: string
  tone: ActionTone
  onClick: () => void
}

function MenuItem({ label, tone, onClick }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center px-3 py-2 text-left text-sm font-medium transition focus:outline-none focus-visible:bg-aurora/10',
        TONE_TEXT[tone],
        TONE_HOVER[tone]
      )}
    >
      {label}
    </button>
  )
}
