import { useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import type { InvoiceRecord } from '@shared/types'
import { Button, DialogShell, Field, Input, Select, Textarea } from '@renderer/components/ui'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

interface CreditNoteDialogProps {
  invoice: InvoiceRecord
  onClose: () => void
  onCreated: (invoiceId: string) => void
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

type Mode = 'total' | 'partial'

export function CreditNoteDialog({
  invoice,
  onClose,
  onCreated
}: CreditNoteDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const templates = useTemplateStore((s) => s.templates)
  const loadTemplates = useTemplateStore((s) => s.load)
  const settings = useInvoiceStore((s) => s.settings)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)
  const createCreditNote = useInvoiceStore((s) => s.createCreditNote)
  const storeError = useInvoiceStore((s) => s.error)

  // Accept templates explicitly marked 'creditNote' plus generic 'document'/unmarked
  // ones so legacy/all-purpose templates remain usable here.
  const templatesForKind = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'creditNote' || kind === 'document'
      }),
    [templates]
  )

  const [templateId, setTemplateId] = useState<string>('')
  const [reason, setReason] = useState('Correction de facturation')
  const [notes, setNotes] = useState('')
  const [issuedAt, setIssuedAt] = useState<string>(new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState<Mode>('total')
  const [selectedLines, setSelectedLines] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(invoice.lines.map((line) => [line.billingItemId, true]))
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    void loadTemplates()
    void loadSettings()
  }, [loadTemplates, loadSettings])

  useEffect(() => {
    if (templateId && templatesForKind.some((t) => t.id === templateId)) return
    const defaultId = settings?.defaultCreditNoteTemplateId
    if (defaultId && templatesForKind.some((t) => t.id === defaultId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTemplateId(defaultId)
    } else if (templatesForKind[0]) {
      setTemplateId(templatesForKind[0].id)
    }
  }, [templateId, templatesForKind, settings?.defaultCreditNoteTemplateId])

  const selectedLineList = useMemo(
    () => invoice.lines.filter((line) => selectedLines[line.billingItemId]),
    [invoice.lines, selectedLines]
  )

  const totals = useMemo(() => {
    const lines = mode === 'total' ? invoice.lines : selectedLineList
    const ht = lines.reduce((acc, line) => acc + line.totalHtCents, 0)
    const ttc = lines.reduce((acc, line) => acc + line.totalTtcCents, 0)
    return { ht, ttc }
  }, [mode, invoice.lines, selectedLineList])

  async function submit(): Promise<void> {
    if (!templateId) {
      setLocalError('Sélectionnez un modèle.')
      return
    }
    if (!reason.trim()) {
      setLocalError("Le motif de l'avoir est obligatoire.")
      return
    }
    if (mode === 'partial' && selectedLineList.length === 0) {
      setLocalError('Sélectionnez au moins une ligne à créditer.')
      return
    }
    setLocalError(null)
    setIsSubmitting(true)
    const created = await createCreditNote({
      originalInvoiceId: invoice.id,
      templateId,
      issuedAt,
      reason: reason.trim(),
      notes: notes.trim() || undefined,
      lineCredits:
        mode === 'partial'
          ? selectedLineList.map((line) => ({ billingItemId: line.billingItemId }))
          : undefined
    })
    setIsSubmitting(false)
    if (created) {
      onCreated(created.id)
      onClose()
    }
  }

  return (
    <DialogShell onDismiss={onClose} size="lg">
      <div className="flex max-h-[85vh] flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#1a1a1a]">
              {t('invoices.credit_note_dialog_title', { defaultValue: 'Émettre un avoir' })}
            </h2>
            <p className="text-xs text-[#8a8a85]">
              {t('invoices.credit_note_dialog_subtitle', {
                number: invoice.number,
                total: formatCents(invoice.totalTtcCents),
                defaultValue: 'Pour la facture {{number}} — {{total}} TTC'
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-[#8a8a85] hover:text-[#1a1a1a]"
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
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Modèle">
                <Select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={templatesForKind.length === 0}
                >
                  {templatesForKind.length === 0 ? (
                    <option value="">
                      {t('invoices.credit_note_no_template_option', {
                        defaultValue: "— Aucun modèle d'avoir —"
                      })}
                    </option>
                  ) : (
                    templatesForKind.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))
                  )}
                </Select>
                {templatesForKind.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {t('invoices.credit_note_no_template_hint', {
                      defaultValue:
                        "Aucun modèle d'avoir configuré. Importez « Avoir — Standard » depuis la bibliothèque."
                    })}
                  </p>
                ) : null}
              </Field>
              <Field label="Date d'émission">
                <Input
                  type="date"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="Motif de l'avoir">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex. Erreur de facturation, remise commerciale…"
                required
              />
            </Field>

            <fieldset className="rounded-2xl border border-[#e5e3da] bg-white p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-[#8a8a85]">
                {t('invoices.credit_note_scope_legend', { defaultValue: "Portée de l'avoir" })}
              </legend>
              <div className="flex gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="credit-mode"
                    checked={mode === 'total'}
                    onChange={() => setMode('total')}
                    className="accent-aurora"
                  />
                  {t('invoices.credit_note_mode_total', { defaultValue: 'Avoir total' })}
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="credit-mode"
                    checked={mode === 'partial'}
                    onChange={() => setMode('partial')}
                    className="accent-aurora"
                  />
                  {t('invoices.credit_note_mode_partial', {
                    defaultValue: 'Avoir partiel (par ligne)'
                  })}
                </label>
              </div>

              {mode === 'partial' ? (
                <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-[#efece4] bg-[#fbf9f4] p-2 text-sm">
                  {invoice.lines.map((line) => {
                    const checked = Boolean(selectedLines[line.billingItemId])
                    return (
                      <li key={line.billingItemId}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setSelectedLines((prev) => ({
                                ...prev,
                                [line.billingItemId]: e.target.checked
                              }))
                            }
                            className="h-4 w-4 accent-aurora"
                          />
                          <span className="min-w-0 flex-1 truncate">{line.label}</span>
                          <span className="tabular-nums text-[#5c5c5a]">
                            {formatCents(line.totalTtcCents)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              ) : null}

              <div className="mt-3 flex justify-between border-t border-[#efece4] pt-2 text-sm font-semibold">
                <span>
                  {t('invoices.credit_note_amount_ttc', { defaultValue: 'Montant avoir TTC' })}
                </span>
                <span className="tabular-nums">{formatCents(totals.ttc)}</span>
              </div>
            </fieldset>

            <Field label="Notes (optionnel)">
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Information complémentaire…"
              />
            </Field>
          </div>

          {(localError || storeError) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError ?? storeError}
            </p>
          )}

          <footer className="flex justify-end gap-2 border-t border-[#e5e3da] pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button type="submit" disabled={isSubmitting || !templateId}>
              {isSubmitting ? 'Génération…' : "Émettre l'avoir"}
            </Button>
          </footer>
        </form>
      </div>
    </DialogShell>
  )
}
