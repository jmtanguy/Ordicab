import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InvoiceRecord, InvoiceStatus } from '@shared/types'
import { invoiceStatusLabel } from '@renderer/lib/domainLabels'
import { useInvoiceStore } from '@renderer/stores/invoiceStore'
import { CorrectiveInvoiceDialog } from '@renderer/features/invoices/CorrectiveInvoiceDialog'
import { CreditNoteDialog } from '@renderer/features/invoices/CreditNoteDialog'
import { InvoicePreviewDialog } from '@renderer/features/invoices/InvoicePreviewDialog'
import { InvoiceRowActions } from '@renderer/features/invoices/InvoiceRowActions'
import { KpiPanel } from '@renderer/features/invoices/KpiPanel'

import { ColumnHeader, ListContainer, SectionHeader } from './sectionLayout'

interface DossierInvoicesSectionProps {
  dossierId: string
  onChangeSection: (section: 'prestations') => void
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
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

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  issued: 'bg-sky-50 text-sky-700 border-sky-200',
  partiallyPaid: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overpaid: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  corrected: 'bg-indigo-50 text-indigo-700 border-indigo-200'
}

export function DossierInvoicesSection({
  dossierId,
  onChangeSection
}: DossierInvoicesSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const invoices = useInvoiceStore((s) => s.invoices)
  const isLoading = useInvoiceStore((s) => s.isLoading)
  const error = useInvoiceStore((s) => s.error)
  const load = useInvoiceStore((s) => s.load)
  const markPaid = useInvoiceStore((s) => s.markPaid)
  const addPayment = useInvoiceStore((s) => s.addPayment)
  const cancel = useInvoiceStore((s) => s.cancel)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)

  const [previewInvoice, setPreviewInvoice] = useState<InvoiceRecord | null>(null)
  const [creditNoteInvoice, setCreditNoteInvoice] = useState<InvoiceRecord | null>(null)
  const [correctiveInvoice, setCorrectiveInvoice] = useState<InvoiceRecord | null>(null)

  useEffect(() => {
    void load()
    void loadSettings()
  }, [load, loadSettings])

  const dossierInvoices = useMemo(
    () =>
      (invoices ?? [])
        .filter((entry) => entry.dossierId === dossierId)
        .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)),
    [invoices, dossierId]
  )

  const totals = useMemo(() => {
    const active = dossierInvoices.filter((entry) => entry.status !== 'cancelled')
    // La rétribution AJ (part de l'État, réglée par la CARPA) est suivie à part,
    // hors chiffre d'affaires commercial.
    const commercial = active.filter((entry) => entry.documentType !== 'stateRetribution')
    const legalAid = active.filter((entry) => entry.documentType === 'stateRetribution')
    return {
      issuedHt: commercial.reduce(
        (acc, entry) =>
          acc + (entry.documentType === 'creditNote' ? -entry.totalHtCents : entry.totalHtCents),
        0
      ),
      issuedTtc: commercial.reduce(
        (acc, entry) =>
          acc + (entry.documentType === 'creditNote' ? -entry.totalTtcCents : entry.totalTtcCents),
        0
      ),
      paidTtc: commercial
        .filter((entry) => entry.documentType !== 'creditNote')
        .reduce((acc, entry) => acc + entry.paidAmountCents, 0),
      pendingTtc: commercial
        .filter((entry) => entry.documentType !== 'creditNote')
        .reduce((acc, entry) => acc + entry.remainingAmountCents, 0),
      legalAidIssuedTtc: legalAid.reduce((acc, entry) => acc + entry.totalTtcCents, 0),
      legalAidPaidTtc: legalAid.reduce((acc, entry) => acc + entry.paidAmountCents, 0),
      legalAidPendingTtc: legalAid.reduce((acc, entry) => acc + entry.remainingAmountCents, 0)
    }
  }, [dossierInvoices])

  const collectionPct =
    totals.issuedTtc > 0 ? Math.round((totals.paidTtc / totals.issuedTtc) * 100) : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <SectionHeader
        badge={t('dossiers.invoices_badge', { defaultValue: 'Factures' })}
        count={dossierInvoices.length || null}
      />

      {error ? (
        <p className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div
        className={`grid shrink-0 grid-cols-1 gap-3 ${
          totals.legalAidIssuedTtc > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        <KpiPanel
          title={t('dossiers.invoices_kpi_revenue_title', {
            defaultValue: "Chiffre d'affaires du dossier"
          })}
          value={formatCents(totals.issuedHt)}
          caption={t('invoices.kpi_revenue_ht', { defaultValue: 'HT' })}
          rows={[
            {
              label: t('invoices.kpi_revenue_ttc', { defaultValue: 'TTC' }),
              value: formatCents(totals.issuedTtc)
            }
          ]}
        />
        <KpiPanel
          title={t('dossiers.invoices_kpi_collections_title', { defaultValue: 'Encaissements' })}
          value={formatCents(totals.paidTtc)}
          valueAccent="emerald"
          caption={
            collectionPct != null
              ? t('invoices.kpi_collections_caption', {
                  pct: collectionPct,
                  defaultValue: `encaissés · ${collectionPct} % du CA TTC`
                })
              : t('invoices.kpi_collections_caption_no_pct', { defaultValue: 'encaissés' })
          }
          progress={collectionPct}
          rows={[
            {
              label: t('invoices.kpi_pending', { defaultValue: 'En attente' }),
              value: formatCents(totals.pendingTtc),
              accent: totals.pendingTtc > 0 ? 'amber' : undefined
            }
          ]}
        />
        {totals.legalAidIssuedTtc > 0 ? (
          <KpiPanel
            title={t('dossiers.invoices_kpi_aj_title', {
              defaultValue: 'Aide juridictionnelle'
            })}
            value={formatCents(totals.legalAidIssuedTtc)}
            caption={t('invoices.kpi_aj_issued_caption', { defaultValue: 'émise' })}
            rows={[
              {
                label: t('invoices.kpi_aj_paid', { defaultValue: 'Encaissée CARPA' }),
                value: formatCents(totals.legalAidPaidTtc),
                accent: 'emerald'
              },
              {
                label: t('invoices.kpi_aj_pending', { defaultValue: 'À recouvrer' }),
                value: formatCents(totals.legalAidPendingTtc),
                accent: totals.legalAidPendingTtc > 0 ? 'amber' : undefined
              }
            ]}
          />
        ) : null}
      </div>

      {isLoading && !invoices ? (
        <p className="shrink-0 text-sm text-ink-subtle">
          {t('common.loading', { defaultValue: 'Chargement…' })}
        </p>
      ) : dossierInvoices.length === 0 ? (
        <div className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink-muted">
          {t('dossiers.invoices_empty', {
            defaultValue:
              'Aucune facture pour ce dossier. Générez-en une depuis la section Prestations.'
          })}
          <button
            type="button"
            onClick={() => onChangeSection('prestations')}
            className="ml-2 text-aurora underline-offset-2 hover:underline"
          >
            {t('dossiers.invoices_empty_cta', { defaultValue: 'Aller aux prestations →' })}
          </button>
        </div>
      ) : (
        <ListContainer>
          <div className="flex h-full flex-col">
            <ColumnHeader>
              <span className="w-32 shrink-0">
                {t('dossiers.invoices_col_number', { defaultValue: 'N°' })}
              </span>
              <span className="w-28 shrink-0">
                {t('dossiers.invoices_col_date', { defaultValue: 'Date' })}
              </span>
              <span className="min-w-0 flex-1">
                {t('dossiers.invoices_col_client', { defaultValue: 'Client' })}
              </span>
              <span className="w-28 shrink-0 text-right">
                {t('dossiers.invoices_col_total_ht', { defaultValue: 'HT' })}
              </span>
              <span className="w-28 shrink-0 text-right">
                {t('dossiers.invoices_col_total_ttc', { defaultValue: 'TTC' })}
              </span>
              <span className="w-32 shrink-0 text-center">
                {t('dossiers.invoices_col_status', { defaultValue: 'Statut' })}
              </span>
              <span className="w-16 shrink-0 text-right">
                {t('dossiers.invoices_col_actions', { defaultValue: 'Actions' })}
              </span>
            </ColumnHeader>

            <ul className="min-h-0 flex-1 divide-y divide-deep-space overflow-y-auto">
              {dossierInvoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.uuid}
                  invoice={invoice}
                  onPreview={() => setPreviewInvoice(invoice)}
                  onMarkPaid={() => void markPaid({ invoiceUuid: invoice.uuid })}
                  onAddPayment={() => {
                    const raw = window.prompt(
                      'Montant du règlement TTC (€)',
                      String(invoice.remainingAmountCents / 100)
                    )
                    const amount = raw ? Math.round(Number(raw.replace(',', '.')) * 100) : 0
                    if (amount > 0)
                      void addPayment({ invoiceUuid: invoice.uuid, amountCents: amount })
                  }}
                  onCreateCreditNote={() => setCreditNoteInvoice(invoice)}
                  onCorrect={() => setCorrectiveInvoice(invoice)}
                  onCancel={() => {
                    if (window.confirm(`Annuler la facture ${invoice.number} ?`)) {
                      void cancel({ invoiceUuid: invoice.uuid })
                    }
                  }}
                />
              ))}
            </ul>
          </div>
        </ListContainer>
      )}

      {previewInvoice ? (
        <InvoicePreviewDialog invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      ) : null}

      {creditNoteInvoice ? (
        <CreditNoteDialog
          invoice={creditNoteInvoice}
          onClose={() => setCreditNoteInvoice(null)}
          onCreated={() => {
            void load()
          }}
        />
      ) : null}

      {correctiveInvoice ? (
        <CorrectiveInvoiceDialog
          invoice={correctiveInvoice}
          onClose={() => setCorrectiveInvoice(null)}
          onCreated={() => {
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

interface InvoiceRowProps {
  invoice: InvoiceRecord
  onPreview: () => void
  onMarkPaid: () => void
  onAddPayment: () => void
  onCreateCreditNote: () => void
  onCorrect: () => void
  onCancel: () => void
}

function InvoiceRow({
  invoice,
  onPreview,
  onMarkPaid,
  onAddPayment,
  onCreateCreditNote,
  onCorrect,
  onCancel
}: InvoiceRowProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li
      role="button"
      tabIndex={0}
      aria-label={`Voir le détail de la facture ${invoice.number}`}
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPreview()
        }
      }}
      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-parchment-bright focus:bg-parchment-bright focus:outline-none"
    >
      <span className="w-32 shrink-0 text-sm font-medium tabular-nums text-ink">
        {invoice.number}
        {invoice.documentType === 'stateRetribution' ? (
          <span className="mt-0.5 block text-[10px] font-normal uppercase tracking-wide text-violet-600">
            {t('invoices.legal_aid_badge', { defaultValue: 'Rétribution AJ' })}
          </span>
        ) : null}
      </span>
      <span className="w-28 shrink-0 text-sm tabular-nums text-ink-muted">
        {formatDateIso(invoice.issuedAt)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{invoice.clientLabel ?? '—'}</span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-ink-muted">
        {formatCents(invoice.totalHtCents)}
      </span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-ink">
        {formatCents(invoice.totalTtcCents)}
      </span>
      <span className="w-32 shrink-0 text-center">
        <span
          className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[invoice.status]}`}
        >
          {invoiceStatusLabel(invoice.status, t)}
        </span>
      </span>
      <div className="w-16 shrink-0">
        <InvoiceRowActions
          invoice={invoice}
          onMarkPaid={onMarkPaid}
          onAddPayment={onAddPayment}
          onCreateCreditNote={onCreateCreditNote}
          onCorrect={onCorrect}
          onCancel={onCancel}
        />
      </div>
    </li>
  )
}
