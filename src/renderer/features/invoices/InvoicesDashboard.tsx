import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DossierBillingItem, InvoiceRecord, InvoiceStatus } from '@shared/types'
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

interface InvoicesDashboardProps {
  onOpenDossier: (id: string) => void | Promise<void>
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

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  issued: 'Émise',
  partiallyPaid: 'Partielle',
  paid: 'Payée',
  overpaid: 'Trop payé',
  cancelled: 'Annulée',
  corrected: 'Rectifiée'
}
const STATUS_STYLE: Record<InvoiceStatus, string> = {
  issued: 'bg-sky-50 text-sky-700 border-sky-200',
  partiallyPaid: 'bg-amber-50 text-amber-700 border-amber-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overpaid: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  corrected: 'bg-indigo-50 text-indigo-700 border-indigo-200'
}

type StatusFilter = 'all' | InvoiceStatus

export function InvoicesDashboard({ onOpenDossier }: InvoicesDashboardProps): React.JSX.Element {
  const { t } = useTranslation()
  const invoices = useInvoiceStore((s) => s.invoices)
  const unbilledGroups = useInvoiceStore((s) => s.unbilledGroups)
  const isLoading = useInvoiceStore((s) => s.isLoading)
  const isLoadingUnbilled = useInvoiceStore((s) => s.isLoadingUnbilled)
  const error = useInvoiceStore((s) => s.error)
  const load = useInvoiceStore((s) => s.load)
  const loadUnbilled = useInvoiceStore((s) => s.loadUnbilled)
  const markPaid = useInvoiceStore((s) => s.markPaid)
  const addPayment = useInvoiceStore((s) => s.addPayment)
  const cancel = useInvoiceStore((s) => s.cancel)
  const exportCsv = useInvoiceStore((s) => s.exportCsv)
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
    const totalIssuedHt = active.reduce(
      (acc, e) => acc + (e.documentType === 'creditNote' ? -e.totalHtCents : e.totalHtCents),
      0
    )
    const totalIssuedTtc = active.reduce(
      (acc, e) => acc + (e.documentType === 'creditNote' ? -e.totalTtcCents : e.totalTtcCents),
      0
    )
    const totalPaidTtc = yearInvoices
      .filter((e) => e.documentType !== 'creditNote')
      .reduce((acc, e) => acc + e.paidAmountCents, 0)
    const totalPendingTtc = yearInvoices
      .filter((e) => e.documentType !== 'creditNote')
      .reduce((acc, e) => acc + e.remainingAmountCents, 0)
    return { totalIssuedHt, totalIssuedTtc, totalPaidTtc, totalPendingTtc }
  }, [list, currentYear])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((entry) => {
      if (statusFilter !== 'all' && entry.status !== statusFilter) return false
      if (!q) return true
      return (
        entry.number.toLowerCase().includes(q) ||
        entry.dossierLabel.toLowerCase().includes(q) ||
        (entry.clientLabel ?? '').toLowerCase().includes(q)
      )
    })
  }, [list, statusFilter, search])

  const unbilled = unbilledGroups ?? []
  const unbilledTotalTtc = unbilled.reduce((acc, g) => acc + g.totalTtcCents, 0)
  const unbilledCount = unbilled.reduce((acc, g) => acc + g.items.length, 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <SectionHeader
        badge={t('invoices.badge', { defaultValue: 'Factures' })}
        count={
          invoices && !isLoading
            ? t('invoices.count', { count: list.length, defaultValue: '{{count}} factures' })
            : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={`CA ${currentYear} HT`} value={formatCents(kpis.totalIssuedHt)} />
        <KpiCard label={`CA ${currentYear} TTC`} value={formatCents(kpis.totalIssuedTtc)} />
        <KpiCard label="Encaissé TTC" value={formatCents(kpis.totalPaidTtc)} accent="emerald" />
        <KpiCard label="En attente TTC" value={formatCents(kpis.totalPendingTtc)} accent="amber" />
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1a1a1a]">
            {t('invoices.dashboard_unbilled_title', { defaultValue: 'Prestations non facturées' })}
            {unbilledCount > 0
              ? ` — ${unbilledCount} prestation(s), ${formatCents(unbilledTotalTtc)} TTC`
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
                if (result) window.alert(`Export généré : ${result.relativePath}`)
              }}
              className="text-xs text-aurora underline-offset-2 hover:underline"
            >
              {t('invoices.dashboard_export_csv', { defaultValue: 'Export CSV' })}
            </button>
          </div>
        </div>
        {isLoadingUnbilled && !unbilledGroups ? (
          <p className="text-sm text-[#8a8a85]">
            {t('invoices.dashboard_loading', { defaultValue: 'Chargement…' })}
          </p>
        ) : unbilled.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#e5e3da] bg-white p-3 text-sm text-[#5c5c5a]">
            {t('invoices.dashboard_unbilled_empty', {
              defaultValue: 'Aucune prestation en attente de facturation.'
            })}
          </p>
        ) : (
          <ListContainer>
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
            <ul className="divide-y divide-deep-space">
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
        <p className="text-sm text-[#8a8a85]">
          {t('invoices.dashboard_loading', { defaultValue: 'Chargement…' })}
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#e5e3da] bg-white p-3 text-sm text-[#5c5c5a]">
          {t('invoices.dashboard_invoices_empty', {
            defaultValue: 'Aucune facture ne correspond aux filtres.'
          })}
        </p>
      ) : (
        <ListContainer>
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
            <span className="w-24 text-center">
              {t('invoices.dashboard_col_status', { defaultValue: 'Statut' })}
            </span>
            <span className="w-16 text-right">
              {t('invoices.dashboard_col_actions', { defaultValue: 'Actions' })}
            </span>
          </ColumnHeader>
          <ul className="divide-y divide-deep-space">
            {filtered.map((invoice) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                onOpenDossier={onOpenDossier}
                onPreview={() => setPreviewInvoice(invoice)}
                onMarkPaid={() => void markPaid({ invoiceId: invoice.id })}
                onAddPayment={() => {
                  const raw = window.prompt(
                    'Montant du règlement TTC (€)',
                    String(invoice.remainingAmountCents / 100)
                  )
                  const amount = raw ? Math.round(Number(raw.replace(',', '.')) * 100) : 0
                  if (amount > 0) void addPayment({ invoiceId: invoice.id, amountCents: amount })
                }}
                onCreateCreditNote={() => setCreditNoteInvoice(invoice)}
                onCorrect={() => setCorrectiveInvoice(invoice)}
                onCancel={() => {
                  if (window.confirm(`Annuler la facture ${invoice.number} ?`)) {
                    void cancel({ invoiceId: invoice.id })
                  }
                }}
              />
            ))}
          </ul>
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
    <li className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#fbf9f4]">
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => void onOpenDossier(group.dossierId)}
          className="block w-full truncate text-left text-sm font-medium text-aurora underline-offset-2 hover:underline"
        >
          {group.dossierName}
        </button>
      </span>
      <span className="w-24 text-right text-sm tabular-nums text-[#5c5c5a]">
        {group.items.length}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-[#5c5c5a]">
        {formatCents(group.totalHtCents)}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-[#1a1a1a]">
        {formatCents(group.totalTtcCents)}
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

interface KpiCardProps {
  label: string
  value: string
  accent?: 'emerald' | 'amber'
}

function KpiCard({ label, value, accent }: KpiCardProps): React.JSX.Element {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'amber'
        ? 'text-amber-700'
        : 'text-[#1a1a1a]'
  return (
    <div className="rounded-2xl border border-[#e5e3da] bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-widest text-[#8a8a85]">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${accentClass}`}>{value}</p>
    </div>
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
      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[#fbf9f4] focus:bg-[#fbf9f4] focus:outline-none"
    >
      <span className="w-32 shrink-0 text-sm font-medium tabular-nums text-[#1a1a1a]">
        {invoice.number}
      </span>
      <span className="w-28 shrink-0 text-sm tabular-nums text-[#5c5c5a]">
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
          <span className="block truncate text-xs text-[#8a8a85]">{invoice.clientLabel}</span>
        ) : null}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-[#5c5c5a]">
        {formatCents(invoice.totalHtCents)}
      </span>
      <span className="w-28 text-right text-sm tabular-nums text-[#1a1a1a]">
        {formatCents(invoice.totalTtcCents)}
      </span>
      <span className="w-24 text-center">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[invoice.status]}`}
        >
          {STATUS_LABEL[invoice.status]}
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
