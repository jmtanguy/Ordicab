import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DossierBillingItem, InvoiceRecord, InvoiceStatus } from '@shared/types'
import { ConfirmDialog } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { formatEurosFromCents } from '@renderer/lib/billingFormatters'
import { invoiceStatusLabel } from '@renderer/lib/domainLabels'
import { useInvoiceStore, type UnbilledDossierGroup } from '@renderer/stores/invoiceStore'

import {
  ColumnHeader,
  ListContainer,
  PillSelect,
  SearchField,
  SectionHeader
} from '../dossiers/sectionLayout'
import { CorrectiveInvoiceDialog } from './CorrectiveInvoiceDialog'
import { CreditNoteDialog } from './CreditNoteDialog'
import { InvoiceCreationDialog } from './InvoiceCreationDialog'
import { InvoicePreviewDialog } from './InvoicePreviewDialog'
import { InvoiceRowActions } from './InvoiceRowActions'
import { KpiPanel } from './KpiPanel'
import { PaymentDialog } from './PaymentDialog'
import { computeOverdueInfo } from './overdue'

interface InvoicesDashboardProps {
  onOpenDossier: (id: string) => void | Promise<void>
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

type StatusFilter = 'all' | 'overdue' | InvoiceStatus

export function InvoicesDashboard({ onOpenDossier }: InvoicesDashboardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const invoices = useInvoiceStore((s) => s.invoices)
  const unbilledGroups = useInvoiceStore((s) => s.unbilledGroups)
  const isLoading = useInvoiceStore((s) => s.isLoading)
  const isLoadingUnbilled = useInvoiceStore((s) => s.isLoadingUnbilled)
  const error = useInvoiceStore((s) => s.error)
  const load = useInvoiceStore((s) => s.load)
  const loadUnbilled = useInvoiceStore((s) => s.loadUnbilled)
  const markPaid = useInvoiceStore((s) => s.markPaid)
  const cancel = useInvoiceStore((s) => s.cancel)
  const exportCsv = useInvoiceStore((s) => s.exportCsv)
  const exportFec = useInvoiceStore((s) => s.exportFec)
  const loadSettings = useInvoiceStore((s) => s.loadSettings)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [invoiceDialog, setInvoiceDialog] = useState<{
    dossierId: string
    items: DossierBillingItem[]
  } | null>(null)
  const [previewInvoice, setPreviewInvoice] = useState<InvoiceRecord | null>(null)
  const [creditNoteInvoice, setCreditNoteInvoice] = useState<InvoiceRecord | null>(null)
  const [correctiveInvoice, setCorrectiveInvoice] = useState<InvoiceRecord | null>(null)
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceRecord | null>(null)
  const [cancelInvoice, setCancelInvoice] = useState<InvoiceRecord | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    void load()
    void loadUnbilled()
    void loadSettings()
  }, [load, loadUnbilled, loadSettings])

  const list = useMemo(() => invoices ?? [], [invoices])
  const currentYear = new Date().getFullYear()
  const kpis = useMemo(() => {
    const yearInvoices = list.filter((entry) => entry.sequenceYear === currentYear)
    const active = yearInvoices.filter((e) => e.status !== 'cancelled')
    // La rétribution AJ (part de l'État, réglée par la CARPA) n'est pas un produit
    // commercial : elle est suivie à part et exclue du chiffre d'affaires.
    const commercial = active.filter((e) => e.documentType !== 'stateRetribution')
    const totalIssuedHt = commercial.reduce(
      (acc, e) => acc + (e.documentType === 'creditNote' ? -e.totalHtCents : e.totalHtCents),
      0
    )
    const totalIssuedTtc = commercial.reduce(
      (acc, e) => acc + (e.documentType === 'creditNote' ? -e.totalTtcCents : e.totalTtcCents),
      0
    )
    const totalPaidTtc = yearInvoices
      .filter((e) => e.documentType !== 'creditNote' && e.documentType !== 'stateRetribution')
      .reduce((acc, e) => acc + e.paidAmountCents, 0)
    const totalPendingTtc = yearInvoices
      .filter((e) => e.documentType !== 'creditNote' && e.documentType !== 'stateRetribution')
      .reduce((acc, e) => acc + e.remainingAmountCents, 0)
    // Rétribution AJ : montant émis, encaissé (CARPA) et restant à recouvrer.
    const legalAid = active.filter((e) => e.documentType === 'stateRetribution')
    const legalAidIssuedTtc = legalAid.reduce((acc, e) => acc + e.totalTtcCents, 0)
    const legalAidPaidTtc = legalAid.reduce((acc, e) => acc + e.paidAmountCents, 0)
    const legalAidPendingTtc = legalAid.reduce((acc, e) => acc + e.remainingAmountCents, 0)
    // Échu non payé : toutes années confondues, une facture en retard reste à relancer.
    const overdueTtc = list
      .filter((e) => computeOverdueInfo(e))
      .reduce((acc, e) => acc + e.remainingAmountCents, 0)
    return {
      totalIssuedHt,
      totalIssuedTtc,
      totalPaidTtc,
      totalPendingTtc,
      overdueTtc,
      legalAidIssuedTtc,
      legalAidPaidTtc,
      legalAidPendingTtc
    }
  }, [list, currentYear])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((entry) => {
      if (statusFilter === 'overdue') {
        if (!computeOverdueInfo(entry)) return false
      } else if (statusFilter !== 'all' && entry.status !== statusFilter) {
        return false
      }
      if (!q) return true
      return (
        entry.number.toLowerCase().includes(q) ||
        entry.dossierLabel.toLowerCase().includes(q) ||
        (entry.clientLabel ?? '').toLowerCase().includes(q)
      )
    })
  }, [list, statusFilter, search])

  const collectionPct =
    kpis.totalIssuedTtc > 0 ? Math.round((kpis.totalPaidTtc / kpis.totalIssuedTtc) * 100) : null

  const unbilled = unbilledGroups ?? []
  const unbilledTotalTtc = unbilled.reduce((acc, g) => acc + g.totalTtcCents, 0)
  const unbilledCount = unbilled.reduce((acc, g) => acc + g.items.length, 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <SectionHeader
        badge={t('invoices.badge', { defaultValue: 'Factures' })}
        count={
          invoices && !isLoading
            ? t('invoices.count', { count: list.length, defaultValue: '{{count}} factures' })
            : null
        }
      />

      <div
        className={`grid grid-cols-1 gap-3 ${
          kpis.legalAidIssuedTtc > 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
        }`}
      >
        <KpiPanel
          title={t('invoices.kpi_revenue_title', {
            year: currentYear,
            defaultValue: `Chiffre d'affaires ${currentYear}`
          })}
          value={formatEurosFromCents(kpis.totalIssuedHt)}
          caption={t('invoices.kpi_revenue_ht', { defaultValue: 'HT' })}
          rows={[
            {
              label: t('invoices.kpi_revenue_ttc', { defaultValue: 'TTC' }),
              value: formatEurosFromCents(kpis.totalIssuedTtc)
            }
          ]}
        />
        <KpiPanel
          title={t('invoices.kpi_collections_title', {
            year: currentYear,
            defaultValue: `Encaissements ${currentYear}`
          })}
          value={formatEurosFromCents(kpis.totalPaidTtc)}
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
              value: formatEurosFromCents(kpis.totalPendingTtc),
              accent: 'amber'
            },
            {
              label: t('invoices.dashboard_kpi_overdue', { defaultValue: 'Échu impayé' }),
              value: formatEurosFromCents(kpis.overdueTtc),
              accent: kpis.overdueTtc > 0 ? 'red' : undefined
            }
          ]}
        />
        {kpis.legalAidIssuedTtc > 0 ? (
          <KpiPanel
            title={t('invoices.kpi_aj_title', {
              year: currentYear,
              defaultValue: `Aide juridictionnelle ${currentYear}`
            })}
            value={formatEurosFromCents(kpis.legalAidIssuedTtc)}
            caption={t('invoices.kpi_aj_issued_caption', { defaultValue: 'émise' })}
            rows={[
              {
                label: t('invoices.kpi_aj_paid', { defaultValue: 'Encaissée CARPA' }),
                value: formatEurosFromCents(kpis.legalAidPaidTtc),
                accent: 'emerald'
              },
              {
                label: t('invoices.kpi_aj_pending', { defaultValue: 'À recouvrer' }),
                value: formatEurosFromCents(kpis.legalAidPendingTtc),
                accent: kpis.legalAidPendingTtc > 0 ? 'amber' : undefined
              }
            ]}
          />
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="flex min-h-0 shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">
            {t('invoices.dashboard_unbilled_title', { defaultValue: 'Prestations non facturées' })}
            {unbilledCount > 0
              ? ` — ${unbilledCount} prestation(s), ${formatEurosFromCents(unbilledTotalTtc)} TTC`
              : ''}
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void loadUnbilled()}
              className="text-xs text-aurora underline-offset-2 hover:underline"
            >
              {t('invoices.dashboard_refresh', { defaultValue: 'Actualiser' })}
            </button>
            <button
              type="button"
              onClick={async () => {
                const result = await exportCsv({})
                if (result?.canceled) return
                if (result?.outputPath) {
                  showToast(
                    t('invoices.dashboard_export_success', {
                      path: result.outputPath,
                      defaultValue: 'Export généré : {{path}}'
                    }),
                    'success'
                  )
                } else {
                  showToast(
                    t('invoices.dashboard_export_error', {
                      defaultValue: "Échec de l'export CSV."
                    }),
                    'error'
                  )
                }
              }}
              className="text-xs text-aurora underline-offset-2 hover:underline"
            >
              {t('invoices.dashboard_export_csv', { defaultValue: 'Export CSV' })}
            </button>
            <button
              type="button"
              onClick={async () => {
                const result = await exportFec({})
                if (result?.canceled) return
                if (result?.outputPath) {
                  showToast(
                    t('invoices.dashboard_export_fec_success', {
                      path: result.outputPath,
                      defaultValue: 'FEC généré : {{path}}'
                    }),
                    'success'
                  )
                } else {
                  showToast(
                    t('invoices.dashboard_export_fec_error', {
                      defaultValue: "Échec de l'export FEC."
                    }),
                    'error'
                  )
                }
              }}
              className="text-xs text-aurora underline-offset-2 hover:underline"
            >
              {t('invoices.dashboard_export_fec', { defaultValue: 'Export FEC' })}
            </button>
          </div>
        </div>
        {isLoadingUnbilled && !unbilledGroups ? (
          <p className="text-sm text-ink-subtle">
            {t('invoices.dashboard_loading', { defaultValue: 'Chargement…' })}
          </p>
        ) : unbilled.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline bg-white p-3 text-sm text-ink-muted">
            {t('invoices.dashboard_unbilled_empty', {
              defaultValue: 'Aucune prestation en attente de facturation.'
            })}
          </p>
        ) : (
          <ListContainer className="max-h-[34vh] flex-none">
            <div className="flex h-full flex-col">
              <ColumnHeader>
                <span className="flex-1">
                  {t('invoices.dashboard_col_dossier', { defaultValue: 'Dossier' })}
                </span>
                <span className="w-24 text-right">
                  {t('invoices.dashboard_col_services', { defaultValue: 'Prestations' })}
                </span>
                <span className="w-28 text-right">
                  {t('invoices.dashboard_col_total_ht', { defaultValue: 'Total HT' })}
                </span>
                <span className="w-28 text-right">
                  {t('invoices.dashboard_col_total_ttc', { defaultValue: 'Total TTC' })}
                </span>
                <span className="w-32 text-right">
                  {t('invoices.dashboard_col_actions', { defaultValue: 'Actions' })}
                </span>
              </ColumnHeader>
              <ul className="min-h-0 flex-1 divide-y divide-deep-space overflow-y-auto">
                {unbilled.map((group) => (
                  <UnbilledRow
                    key={group.dossierId}
                    group={group}
                    onOpenDossier={onOpenDossier}
                    onGenerateInvoice={() =>
                      setInvoiceDialog({ dossierId: group.dossierId, items: group.items })
                    }
                  />
                ))}
              </ul>
            </div>
          </ListContainer>
        )}
      </section>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <SearchField
          id="invoices-search"
          value={search}
          onChange={setSearch}
          placeholder="Rechercher (numéro, dossier, client)…"
          ariaLabel="Rechercher dans les factures"
        />
        <PillSelect<StatusFilter>
          id="invoices-status-filter"
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Filtrer par statut"
        >
          <option value="all">
            {t('invoices.dashboard_filter_all', { defaultValue: 'Tous les statuts' })}
          </option>
          <option value="issued">
            {t('invoices.dashboard_filter_issued', { defaultValue: 'Émises' })}
          </option>
          <option value="partiallyPaid">
            {t('invoices.dashboard_filter_partial', { defaultValue: 'Partiellement payées' })}
          </option>
          <option value="overdue">
            {t('invoices.dashboard_filter_overdue', { defaultValue: 'En retard' })}
          </option>
          <option value="paid">
            {t('invoices.dashboard_filter_paid', { defaultValue: 'Payées' })}
          </option>
          <option value="overpaid">
            {t('invoices.dashboard_filter_overpaid', { defaultValue: 'Trop payées' })}
          </option>
          <option value="cancelled">
            {t('invoices.dashboard_filter_cancelled', { defaultValue: 'Annulées' })}
          </option>
          <option value="corrected">
            {t('invoices.dashboard_filter_corrected', { defaultValue: 'Rectifiées' })}
          </option>
        </PillSelect>
      </div>

      {isLoading && !invoices ? (
        <p className="text-sm text-ink-subtle">
          {t('invoices.dashboard_loading', { defaultValue: 'Chargement…' })}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-3 text-sm text-ink-muted">
          {t('invoices.dashboard_invoices_empty', {
            defaultValue: 'Aucune facture ne correspond aux filtres.'
          })}
        </p>
      ) : (
        <ListContainer>
          <div className="flex h-full flex-col">
            <ColumnHeader>
              <span className="w-32 shrink-0">
                {t('invoices.dashboard_col_number', { defaultValue: 'N°' })}
              </span>
              <span className="w-28 shrink-0">
                {t('invoices.dashboard_col_date', { defaultValue: 'Date' })}
              </span>
              <span className="flex-1">
                {t('invoices.dashboard_col_dossier_client', { defaultValue: 'Dossier / Client' })}
              </span>
              <span className="w-28 text-right">
                {t('invoices.dashboard_col_ht', { defaultValue: 'HT' })}
              </span>
              <span className="w-28 text-right">
                {t('invoices.dashboard_col_ttc', { defaultValue: 'TTC' })}
              </span>
              <span className="w-32 shrink-0 text-center">
                {t('invoices.dashboard_col_status', { defaultValue: 'Statut' })}
              </span>
              <span className="w-16 text-right">
                {t('invoices.dashboard_col_actions', { defaultValue: 'Actions' })}
              </span>
            </ColumnHeader>
            <ul className="min-h-0 flex-1 divide-y divide-deep-space overflow-y-auto">
              {filtered.map((invoice) => (
                <InvoiceRow
                  key={invoice.uuid}
                  invoice={invoice}
                  onOpenDossier={onOpenDossier}
                  onPreview={() => setPreviewInvoice(invoice)}
                  onMarkPaid={() => void markPaid({ invoiceUuid: invoice.uuid })}
                  onAddPayment={() => setPaymentInvoice(invoice)}
                  onCreateCreditNote={() => setCreditNoteInvoice(invoice)}
                  onCorrect={() => setCorrectiveInvoice(invoice)}
                  onCancel={() => setCancelInvoice(invoice)}
                />
              ))}
            </ul>
          </div>
        </ListContainer>
      )}

      {invoiceDialog ? (
        <InvoiceCreationDialog
          dossierId={invoiceDialog.dossierId}
          selectedItems={invoiceDialog.items}
          onClose={() => setInvoiceDialog(null)}
          onCreated={() => {
            void loadUnbilled()
          }}
        />
      ) : null}

      {previewInvoice ? (
        <InvoicePreviewDialog invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      ) : null}

      {paymentInvoice ? (
        <PaymentDialog invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} />
      ) : null}

      {cancelInvoice ? (
        <ConfirmDialog
          title={t('invoices.cancel_confirm_title', {
            number: cancelInvoice.number,
            defaultValue: 'Annuler la facture {{number}} ?'
          })}
          description={t('invoices.cancel_confirm_description', {
            defaultValue: 'La facture sera marquée comme annulée. Cette action est irréversible.'
          })}
          confirmLabel={t('invoices.cancel_confirm_action', {
            defaultValue: 'Annuler la facture'
          })}
          cancelLabel={t('invoices.cancel_confirm_keep', { defaultValue: 'Conserver' })}
          tone="danger"
          isBusy={isCancelling}
          onConfirm={() => {
            void (async () => {
              setIsCancelling(true)
              const done = await cancel({ invoiceUuid: cancelInvoice.uuid })
              setIsCancelling(false)
              if (done) setCancelInvoice(null)
            })()
          }}
          onCancel={() => setCancelInvoice(null)}
        />
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
            void loadUnbilled()
          }}
          onOpenDossier={onOpenDossier}
        />
      ) : null}
    </div>
  )
}

interface UnbilledRowProps {
  group: UnbilledDossierGroup
  onOpenDossier: (id: string) => void | Promise<void>
  onGenerateInvoice: () => void
}

function UnbilledRow({
  group,
  onOpenDossier,
  onGenerateInvoice
}: UnbilledRowProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-parchment-bright">
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => void onOpenDossier(group.dossierId)}
          className="block w-full truncate text-left text-sm font-medium text-aurora underline-offset-2 hover:underline"
        >
          {group.dossierName}
        </button>
      </span>
      <span className="w-24 text-right text-sm tabular-nums text-ink-muted">
        {group.items.length}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-ink-muted">
        {formatEurosFromCents(group.totalHtCents)}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-ink">
        {formatEurosFromCents(group.totalTtcCents)}
      </span>
      <span className="w-32 text-right text-xs">
        <button
          type="button"
          onClick={onGenerateInvoice}
          className="text-aurora underline-offset-2 hover:underline"
        >
          {t('invoices.dashboard_generate_invoice', { defaultValue: 'Générer la facture' })}
        </button>
      </span>
    </li>
  )
}

interface InvoiceRowProps {
  invoice: InvoiceRecord
  onOpenDossier: (id: string) => void | Promise<void>
  onPreview: () => void
  onMarkPaid: () => void
  onAddPayment: () => void
  onCreateCreditNote: () => void
  onCorrect: () => void
  onCancel: () => void
}

function InvoiceRow({
  invoice,
  onOpenDossier,
  onPreview,
  onMarkPaid,
  onAddPayment,
  onCreateCreditNote,
  onCorrect,
  onCancel
}: InvoiceRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const overdue = computeOverdueInfo(invoice)
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
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            void onOpenDossier(invoice.dossierId)
          }}
          className="block truncate text-left text-sm font-medium text-aurora underline-offset-2 hover:underline"
        >
          {invoice.dossierLabel}
        </button>
        {invoice.clientLabel ? (
          <span className="block truncate text-xs text-ink-subtle">{invoice.clientLabel}</span>
        ) : null}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-ink-muted">
        {formatEurosFromCents(invoice.totalHtCents)}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-ink">
        {formatEurosFromCents(invoice.totalTtcCents)}
      </span>
      <span className="w-32 shrink-0 text-center">
        <span
          className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[invoice.status]}`}
        >
          {invoiceStatusLabel(invoice.status, t)}
        </span>
        {overdue ? (
          <span className="mt-0.5 inline-block whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
            {t('invoices.overdue_badge', {
              count: overdue.daysOverdue,
              defaultValue: 'En retard · {{count}} j'
            })}
          </span>
        ) : null}
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
