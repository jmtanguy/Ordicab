import { useMemo, useState } from 'react'

import { useTranslation } from 'react-i18next'

import type { InvoiceArtifactIntegrity, InvoiceRecord } from '@shared/types'
import { Button, DialogShell } from '@renderer/components/ui'
import { formatEurosFromCents } from '@renderer/lib/billingFormatters'
import { paymentMethodLabel } from '@renderer/lib/domainLabels'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'

interface InvoicePreviewDialogProps {
  invoice: InvoiceRecord
  onClose: () => void
}

function formatDateIso(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
      new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
    )
  } catch {
    return iso
  }
}

function formatVatRate(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)} %`
}

const DOCUMENT_TYPE_LABEL: Record<InvoiceRecord['documentType'], string> = {
  invoice: 'Facture',
  creditNote: 'Avoir',
  correctiveInvoice: 'Facture rectificative',
  stateRetribution: 'Rétribution AJ (État)'
}

export function InvoicePreviewDialog({
  invoice,
  onClose
}: InvoicePreviewDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const openDocument = useInvoiceStore((s) => s.openDocument)
  const openPdf = useInvoiceStore((s) => s.openPdf)
  const [isOpeningPdf, setIsOpeningPdf] = useState(false)
  const [integrityNotice, setIntegrityNotice] = useState<{
    target: 'docx' | 'pdf'
    integrity: InvoiceArtifactIntegrity
  } | null>(null)

  const sign = invoice.documentType === 'creditNote' ? -1 : 1
  const totalsLabel = useMemo(
    () => ({
      ht: formatEurosFromCents(sign * invoice.totalHtCents),
      vat: formatEurosFromCents(sign * invoice.totalVatCents),
      ttc: formatEurosFromCents(sign * invoice.totalTtcCents),
      paid: formatEurosFromCents(invoice.paidAmountCents),
      remaining: formatEurosFromCents(invoice.remainingAmountCents)
    }),
    [invoice, sign]
  )

  const hasDocument = Boolean(invoice.generatedDocumentPath)

  return (
    <DialogShell onDismiss={onClose} size="xl">
      <div className="flex max-h-[85vh] flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">
              {DOCUMENT_TYPE_LABEL[invoice.documentType]}
            </p>
            <h2 className="text-lg font-semibold text-ink">{invoice.number}</h2>
            <p className="text-xs text-ink-subtle">
              {t('invoices.preview_issued_on', {
                date: formatDateIso(invoice.issuedAt),
                defaultValue: 'Émise le {{date}}'
              })}
              {invoice.dueAt ? ` · Échéance ${formatDateIso(invoice.dueAt)}` : ''}
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

        {integrityNotice ? (
          <IntegrityBanner notice={integrityNotice} onDismiss={() => setIntegrityNotice(null)} />
        ) : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <PartyCard title="Émetteur" snapshot={invoice.issuerSnapshot} />
            <PartyCard
              title="Client"
              snapshot={invoice.clientSnapshot}
              fallbackName={invoice.clientLabel}
            />
          </section>

          <section className="rounded-2xl border border-hairline bg-white">
            <div className="flex h-9 items-center gap-3 border-b border-deep-space bg-parchment-bright px-4 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
              <span className="w-24 shrink-0">
                {t('invoices.preview_col_date', { defaultValue: 'Date' })}
              </span>
              <span className="min-w-0 flex-1">
                {t('invoices.preview_col_service', { defaultValue: 'Prestation' })}
              </span>
              <span className="w-16 shrink-0 text-right">
                {t('invoices.preview_col_qty', { defaultValue: 'Qté' })}
              </span>
              <span className="w-24 shrink-0 text-right">
                {t('invoices.preview_col_unit_ht', { defaultValue: 'PU HT' })}
              </span>
              <span className="w-28 shrink-0 text-right">
                {t('invoices.preview_col_ht', { defaultValue: 'HT' })}
              </span>
              <span className="w-16 shrink-0 text-right">
                {t('invoices.preview_col_vat', { defaultValue: 'TVA' })}
              </span>
              <span className="w-28 text-right">
                {t('invoices.preview_col_ttc', { defaultValue: 'TTC' })}
              </span>
            </div>
            <ul className="divide-y divide-[#efece4]">
              {invoice.lines.map((line) => (
                <li key={line.billingItemUuid} className="flex items-start gap-3 px-4 py-2 text-sm">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-ink-subtle">
                    {formatDateIso(line.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{line.label}</span>
                    {line.description ? (
                      <span className="block truncate text-xs text-ink-subtle">
                        {line.description}
                      </span>
                    ) : null}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">
                    {line.quantity}
                    {line.quantityUnit === 'hours' ? ' h' : ''}
                  </span>
                  <span className="w-24 shrink-0 text-right tabular-nums text-ink-muted">
                    {formatEurosFromCents(line.unitPriceHtCents)}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-ink-muted">
                    {formatEurosFromCents(sign * line.totalHtCents)}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">
                    {formatVatRate(line.vatRateBasisPoints)}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-ink">
                    {formatEurosFromCents(sign * line.totalTtcCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-hairline bg-white p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.preview_vat_breakdown', { defaultValue: 'Ventilation TVA' })}
              </p>
              {invoice.vatBreakdown.length === 0 ? (
                <p className="text-sm text-ink-subtle">—</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {invoice.vatBreakdown.map((entry) => (
                    <li
                      key={entry.vatRateBasisPoints}
                      className="flex items-center justify-between tabular-nums"
                    >
                      <span className="text-ink-muted">
                        {t('invoices.preview_vat_line', {
                          rate: formatVatRate(entry.vatRateBasisPoints),
                          base: formatEurosFromCents(sign * entry.taxableHtCents),
                          defaultValue: 'TVA {{rate}} sur {{base}}'
                        })}
                      </span>
                      <span className="text-ink">
                        {formatEurosFromCents(sign * entry.vatCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border border-hairline bg-white p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.preview_totals', { defaultValue: 'Totaux' })}
              </p>
              <dl className="space-y-1 text-sm tabular-nums">
                <Row label="Total HT" value={totalsLabel.ht} />
                <Row label="TVA" value={totalsLabel.vat} />
                <Row label="Total TTC" value={totalsLabel.ttc} strong />
                {invoice.documentType !== 'creditNote' ? (
                  <>
                    <Row label="Encaissé" value={totalsLabel.paid} accent="emerald" />
                    <Row label="Solde restant" value={totalsLabel.remaining} accent="amber" />
                  </>
                ) : null}
              </dl>
            </div>
          </section>

          {invoice.payments.length > 0 ? (
            <section className="rounded-2xl border border-hairline bg-white p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.preview_payments', { defaultValue: 'Règlements' })}
              </p>
              <ul className="divide-y divide-[#efece4] text-sm">
                {invoice.payments.map((payment) => (
                  <li key={payment.uuid} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="tabular-nums text-ink-muted">
                      {formatDateIso(payment.paidAt)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {paymentMethodLabel(payment.method, t)}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </span>
                    <span className="tabular-nums text-emerald-700">
                      {formatEurosFromCents(payment.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {invoice.originalInvoiceRefs.length > 0 ? (
            <section className="rounded-2xl border border-hairline bg-white p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.preview_original_invoices', { defaultValue: "Factures d'origine" })}
              </p>
              <p className="text-ink">
                {invoice.originalInvoiceRefs.map((ref) => ref.number).join(', ')}
              </p>
              {invoice.correctionReason ? (
                <p className="mt-1 text-xs text-ink-muted">
                  {t('invoices.preview_correction_reason', {
                    reason: invoice.correctionReason,
                    defaultValue: 'Motif : {{reason}}'
                  })}
                </p>
              ) : null}
            </section>
          ) : null}

          {invoice.notes ? (
            <section className="rounded-2xl border border-hairline bg-white p-3 text-sm text-ink">
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
                {t('invoices.preview_notes', { defaultValue: 'Notes' })}
              </p>
              <p className="whitespace-pre-wrap">{invoice.notes}</p>
            </section>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-hairline pt-3">
          <p className="text-xs text-ink-subtle">
            {invoice.generatedDocumentName ?? 'Aucun document généré'}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('invoices.preview_close', { defaultValue: 'Fermer' })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isOpeningPdf}
              onClick={async () => {
                setIsOpeningPdf(true)
                try {
                  const outcome = await openPdf({ invoiceUuid: invoice.uuid })
                  if (outcome && outcome.integrity !== 'ok') {
                    setIntegrityNotice({ target: 'pdf', integrity: outcome.integrity })
                  } else if (outcome) {
                    setIntegrityNotice(null)
                  }
                } finally {
                  setIsOpeningPdf(false)
                }
              }}
            >
              {isOpeningPdf ? 'Génération PDF…' : 'Ouvrir le PDF'}
            </Button>
            <Button
              type="button"
              disabled={!hasDocument}
              onClick={async () => {
                const outcome = await openDocument({ invoiceUuid: invoice.uuid })
                if (outcome && outcome.integrity !== 'ok') {
                  setIntegrityNotice({ target: 'docx', integrity: outcome.integrity })
                } else if (outcome) {
                  setIntegrityNotice(null)
                }
              }}
            >
              {t('invoices.preview_open_docx', { defaultValue: 'Ouvrir le DOCX' })}
            </Button>
          </div>
        </footer>
      </div>
    </DialogShell>
  )
}

interface PartyCardProps {
  title: string
  snapshot?: {
    name?: string
    address?: string
    siret?: string
    vatNumber?: string
    iban?: string
  }
  fallbackName?: string
}

function PartyCard({ title, snapshot, fallbackName }: PartyCardProps): React.JSX.Element {
  const name = snapshot?.name ?? fallbackName
  return (
    <div className="rounded-2xl border border-hairline bg-white p-3 text-sm">
      <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-ink-subtle">
        {title}
      </p>
      <p className="font-medium text-ink">{name ?? '—'}</p>
      {snapshot?.address ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{snapshot.address}</p>
      ) : null}
      {snapshot?.siret ? (
        <p className="mt-1 text-xs text-ink-muted">
          {'SIRET'} {snapshot.siret}
        </p>
      ) : null}
      {snapshot?.vatNumber ? (
        <p className="text-xs text-ink-muted">
          {'TVA'} {snapshot.vatNumber}
        </p>
      ) : null}
      {snapshot?.iban ? (
        <p className="text-xs text-ink-muted">
          {'IBAN'} {snapshot.iban}
        </p>
      ) : null}
    </div>
  )
}

interface RowProps {
  label: string
  value: string
  strong?: boolean
  accent?: 'emerald' | 'amber'
}

interface IntegrityBannerProps {
  notice: { target: 'docx' | 'pdf'; integrity: InvoiceArtifactIntegrity }
  onDismiss: () => void
}

function IntegrityBanner({ notice, onDismiss }: IntegrityBannerProps): React.JSX.Element {
  const targetLabel = notice.target === 'pdf' ? 'PDF' : 'DOCX'
  const isError = notice.integrity === 'modified'
  const tone = isError
    ? 'border-red-300 bg-red-50 text-red-800'
    : 'border-amber-300 bg-amber-50 text-amber-800'
  const message =
    notice.integrity === 'modified'
      ? `Le fichier ${targetLabel} a été modifié après l'émission de la facture. La facture émise reste immuable : le ${targetLabel} ouvert ne correspond plus au document archivé. Pour corriger une facture, émettez un avoir ou une facture rectificative.`
      : notice.integrity === 'regenerated'
        ? `Le ${targetLabel} original était introuvable et a été régénéré à partir du record immuable. La mise en page peut différer de la version archivée à l'émission.`
        : `Cette facture a été émise avant l'introduction du contrôle d'intégrité : l'authenticité du ${targetLabel} ne peut pas être vérifiée.`
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-2xl border px-3 py-2 text-xs ${tone}`}
    >
      <span aria-hidden className="mt-0.5 text-base leading-none">
        {isError ? '⚠' : 'ℹ'}
      </span>
      <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-current opacity-70 hover:opacity-100"
        aria-label="Masquer l'avertissement"
      >
        ✕
      </button>
    </div>
  )
}

function Row({ label, value, strong, accent }: RowProps): React.JSX.Element {
  const accentClass =
    accent === 'emerald' ? 'text-emerald-700' : accent === 'amber' ? 'text-amber-700' : 'text-ink'
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={accentClass}>{value}</dd>
    </div>
  )
}
