import { useEffect, useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import type { InvoiceRecord } from '@shared/types'
import { Button, DialogShell, Field, Input, Select, Textarea } from '@renderer/components/ui'
import { formatEurosFromCents } from '@renderer/lib/billingFormatters'
import { useDossierStore } from '@renderer/stores/dossierStore'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { useTemplateStore } from '@renderer/stores/templateStore'

interface CorrectiveInvoiceDialogProps {
  invoice: InvoiceRecord
  onClose: () => void
  onCreated: (invoiceUuid: string) => void
  onOpenDossier?: (dossierId: string) => void | Promise<void>
}

function formatDateIso(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
      new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
    )
  } catch {
    return iso
  }
}

export function CorrectiveInvoiceDialog({
  invoice,
  onClose,
  onCreated,
  onOpenDossier
}: CorrectiveInvoiceDialogProps): React.JSX.Element {
  const templates = useTemplateStore((s) => s.templates)
  const loadTemplates = useTemplateStore((s) => s.load)
  const settings = useInvoiceStore((s) => s.settings)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)
  const createCorrectiveInvoice = useInvoiceStore((s) => s.createCorrectiveInvoice)
  const storeError = useInvoiceStore((s) => s.error)
  const loadDetail = useDossierStore((s) => s.loadDetail)
  const activeDossier = useDossierStore((s) => s.activeDossier)

  // Accept templates explicitly marked 'correctiveInvoice' plus generic
  // 'document'/unmarked ones so legacy/all-purpose templates remain usable here.
  const templatesForKind = useMemo(
    () =>
      templates.filter((tpl) => {
        const kind = tpl.documentKind ?? 'document'
        return kind === 'correctiveInvoice' || kind === 'document'
      }),
    [templates]
  )

  const [templateUuid, setTemplateId] = useState<string>('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [notes, setNotes] = useState('')
  const [issuedAt, setIssuedAt] = useState<string>(new Date().toISOString().slice(0, 10))
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    void loadTemplates()
    void loadSettings()
    void loadDetail(invoice.dossierId)
  }, [loadTemplates, loadSettings, loadDetail, invoice.dossierId])

  useEffect(() => {
    if (templateUuid && templatesForKind.some((t) => t.uuid === templateUuid)) return
    const defaultId = settings?.defaultCorrectiveInvoiceTemplateUuid
    if (defaultId && templatesForKind.some((t) => t.uuid === defaultId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTemplateId(defaultId)
    } else if (templatesForKind[0]) {
      setTemplateId(templatesForKind[0].uuid)
    }
  }, [templateUuid, templatesForKind, settings?.defaultCorrectiveInvoiceTemplateUuid])

  const draftItems = useMemo(() => {
    if (!activeDossier || activeDossier.slug !== invoice.dossierId) return []
    return activeDossier.billingItems.filter((item) => item.status === 'draft')
  }, [activeDossier, invoice.dossierId])

  useEffect(() => {
    if (draftItems.length === 0) return
    // Preselect all draft items the first time we see them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((prev) => {
      if (Object.keys(prev).length > 0) return prev
      return Object.fromEntries(draftItems.map((item) => [item.uuid, true]))
    })
  }, [draftItems])

  const selectedItems = useMemo(
    () => draftItems.filter((item) => selectedIds[item.uuid]),
    [draftItems, selectedIds]
  )

  const totals = useMemo(() => {
    const ht = selectedItems.reduce((acc, item) => acc + item.totalHtCents, 0)
    const ttc = selectedItems.reduce((acc, item) => acc + item.totalTtcCents, 0)
    return { ht, ttc }
  }, [selectedItems])

  async function submit(): Promise<void> {
    if (!templateUuid) {
      setLocalError('Sélectionnez un modèle.')
      return
    }
    if (!correctionReason.trim()) {
      setLocalError('Le motif de correction est obligatoire.')
      return
    }
    if (selectedItems.length === 0) {
      setLocalError('Sélectionnez au moins une prestation à facturer.')
      return
    }
    setLocalError(null)
    setIsSubmitting(true)
    const created = await createCorrectiveInvoice({
      dossierId: invoice.dossierId,
      originalInvoiceUuid: invoice.uuid,
      billingItemUuids: selectedItems.map((item) => item.uuid),
      templateUuid,
      issuedAt,
      correctionReason: correctionReason.trim(),
      notes: notes.trim() || undefined
    })
    setIsSubmitting(false)
    if (created) {
      onCreated(created.uuid)
      onClose()
    }
  }

  const { t } = useTranslation()
  const noDrafts = draftItems.length === 0

  return (
    <DialogShell onDismiss={onClose} size="lg">
      <div className="flex max-h-[85vh] flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {t('invoices.corrective_dialog_title', {
                defaultValue: 'Émettre une facture rectificative'
              })}
            </h2>
            <p className="text-xs text-ink-subtle">
              {t('invoices.corrective_dialog_subtitle', {
                number: invoice.number,
                date: formatDateIso(invoice.issuedAt),
                defaultValue: 'Rectifie la facture {{number}} du {{date}}'
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
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
              {t('invoices.corrective_dialog_info', {
                defaultValue:
                  "La facture rectificative reprend les prestations corrigées et marque la facture d'origine comme rectifiée. Pour annuler totalement, préférez un avoir."
              })}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Modèle">
                <Select
                  value={templateUuid}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={templatesForKind.length === 0}
                >
                  {templatesForKind.length === 0 ? (
                    <option value="">
                      {t('invoices.corrective_no_template_option', {
                        defaultValue: '— Aucun modèle rectificative —'
                      })}
                    </option>
                  ) : (
                    templatesForKind.map((tpl) => (
                      <option key={tpl.uuid} value={tpl.uuid}>
                        {tpl.name}
                      </option>
                    ))
                  )}
                </Select>
                {templatesForKind.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {t('invoices.corrective_no_template_hint', {
                      defaultValue:
                        'Aucun modèle rectificative configuré. Importez « Facture rectificative — Standard » depuis la bibliothèque.'
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

            <Field label="Motif de la correction">
              <Input
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Ex. Erreur de TVA, prestation manquante…"
                required
              />
            </Field>

            <fieldset className="rounded-2xl border border-hairline bg-white p-3">
              <legend className="px-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.corrective_items_legend', { defaultValue: 'Prestations à facturer' })}
              </legend>
              {noDrafts ? (
                <div className="space-y-2 py-2 text-sm text-ink-muted">
                  <p>
                    {t('invoices.corrective_no_drafts', {
                      defaultValue:
                        "Aucune prestation en brouillon dans ce dossier. Créez d'abord les nouvelles prestations correctives, puis revenez ici."
                    })}
                  </p>
                  {onOpenDossier ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onOpenDossier(invoice.dossierId)
                        onClose()
                      }}
                      className="text-aurora underline-offset-2 hover:underline"
                    >
                      {t('invoices.corrective_go_to_items', {
                        defaultValue: 'Aller aux prestations →'
                      })}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-[#efece4] bg-parchment-bright p-2 text-sm">
                    {draftItems.map((item) => {
                      const checked = Boolean(selectedIds[item.uuid])
                      return (
                        <li key={item.uuid}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSelectedIds((prev) => ({
                                  ...prev,
                                  [item.uuid]: e.target.checked
                                }))
                              }
                              className="h-4 w-4 accent-aurora"
                            />
                            <span className="w-24 shrink-0 text-xs tabular-nums text-ink-subtle">
                              {formatDateIso(item.date)}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            <span className="tabular-nums text-ink-muted">
                              {formatEurosFromCents(item.totalTtcCents)}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-3 flex justify-between border-t border-[#efece4] pt-2 text-sm font-semibold">
                    <span>{t('invoices.corrective_total_ttc', { defaultValue: 'Total TTC' })}</span>
                    <span className="tabular-nums">{formatEurosFromCents(totals.ttc)}</span>
                  </div>
                </>
              )}
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

          <footer className="flex justify-end gap-2 border-t border-hairline pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !templateUuid || noDrafts || selectedItems.length === 0}
            >
              {isSubmitting ? 'Génération…' : 'Émettre la facture rectificative'}
            </Button>
          </footer>
        </form>
      </div>
    </DialogShell>
  )
}
