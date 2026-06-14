import { useState } from 'react'

import { useTranslation } from 'react-i18next'

import {
  INVOICE_PAYMENT_METHOD_VALUES,
  type InvoicePaymentMethod,
  type InvoiceRecord
} from '@shared/types'
import { Button, DialogShell, Field, Input, Select, Textarea } from '@renderer/components/ui'
import {
  formatEurosFromCents,
  formatMoneyInput,
  parseEurosToCents
} from '@renderer/lib/billingFormatters'
import { paymentMethodLabel } from '@renderer/lib/domainLabels'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'

interface PaymentDialogProps {
  invoice: InvoiceRecord
  onClose: () => void
}

export function PaymentDialog({ invoice, onClose }: PaymentDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const addPayment = useInvoiceStore((s) => s.addPayment)
  const storeError = useInvoiceStore((s) => s.error)

  const [amount, setAmount] = useState(() => formatMoneyInput(invoice.remainingAmountCents))
  const [paidAt, setPaidAt] = useState<string>(new Date().toISOString().slice(0, 10))
  const [method, setMethod] = useState<InvoicePaymentMethod>('transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    const amountCents = parseEurosToCents(amount)
    if (typeof amountCents !== 'number' || amountCents <= 0) {
      setLocalError(
        t('invoices.payment_dialog_amount_error', {
          defaultValue: 'Saisissez un montant valide supérieur à zéro (ex. 150,00).'
        })
      )
      return
    }
    if (!paidAt) {
      setLocalError(
        t('invoices.payment_dialog_date_error', {
          defaultValue: 'Saisissez la date du règlement.'
        })
      )
      return
    }
    setLocalError(null)
    setIsSubmitting(true)
    const updated = await addPayment({
      invoiceUuid: invoice.uuid,
      amountCents,
      paidAt,
      method,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined
    })
    setIsSubmitting(false)
    if (updated) onClose()
  }

  return (
    <DialogShell onDismiss={onClose} size="md">
      <div className="flex flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {t('invoices.payment_dialog_title', { defaultValue: 'Ajouter un règlement' })}
            </h2>
            <p className="text-xs text-ink-subtle">
              {t('invoices.payment_dialog_subtitle', {
                number: invoice.number,
                remaining: formatEurosFromCents(invoice.remainingAmountCents),
                defaultValue: 'Facture {{number}} — solde restant {{remaining}} TTC'
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-subtle hover:text-ink"
            aria-label="Fermer"
          >
            ✕
          </button>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('invoices.payment_dialog_amount', { defaultValue: 'Montant TTC (€)' })}>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                autoFocus
                required
              />
            </Field>
            <Field label={t('invoices.payment_dialog_date', { defaultValue: 'Date du règlement' })}>
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('invoices.payment_dialog_method', { defaultValue: 'Mode de paiement' })}
            >
              <Select
                value={method}
                onChange={(e) => setMethod(e.target.value as InvoicePaymentMethod)}
              >
                {INVOICE_PAYMENT_METHOD_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {paymentMethodLabel(value, t)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('invoices.payment_dialog_reference', {
                defaultValue: 'Référence (optionnel)'
              })}
            >
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ex. numéro de chèque, libellé du virement…"
              />
            </Field>
          </div>

          <Field label={t('invoices.payment_dialog_notes', { defaultValue: 'Notes (optionnel)' })}>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Information complémentaire…"
            />
          </Field>

          {(localError || storeError) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError ?? storeError}
            </p>
          )}

          <footer className="flex justify-end gap-2 border-t border-hairline pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t('invoices.payment_dialog_submitting', { defaultValue: 'Enregistrement…' })
                : t('invoices.payment_dialog_submit', { defaultValue: 'Enregistrer le règlement' })}
            </Button>
          </footer>
        </form>
      </div>
    </DialogShell>
  )
}
