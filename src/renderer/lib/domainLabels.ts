import type { useTranslation } from 'react-i18next'

import type {
  BillingItemStatus,
  BillingType,
  DossierStatus,
  FeeAgreementStatus,
  InvoicePaymentMethod,
  InvoiceStatus
} from '@shared/types'

/** Translation function as returned by `useTranslation()` in components. */
export type TranslateFn = ReturnType<typeof useTranslation>['t']

const INVOICE_STATUS_DEFAULT_LABEL: Record<InvoiceStatus, string> = {
  issued: 'Émise',
  partiallyPaid: 'Partielle',
  paid: 'Payée',
  overpaid: 'Trop payé',
  cancelled: 'Annulée',
  corrected: 'Rectifiée'
}

const PAYMENT_METHOD_DEFAULT_LABEL: Record<InvoicePaymentMethod, string> = {
  transfer: 'Virement',
  card: 'Carte',
  cash: 'Espèces',
  check: 'Chèque',
  other: 'Autre'
}

const FEE_AGREEMENT_STATUS_DEFAULT_LABEL: Record<FeeAgreementStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  signed: 'Signée'
}

const BILLING_ITEM_STATUS_DEFAULT_LABEL: Record<BillingItemStatus, string> = {
  draft: 'À facturer',
  billed: 'Facturée',
  cancelled: 'Annulée'
}

const BILLING_TYPE_DEFAULT_LABEL: Record<BillingType, string> = {
  flat: 'Forfait',
  hourly: 'Horaire',
  mixed: 'Mixte'
}

export function invoiceStatusLabel(status: InvoiceStatus, t: TranslateFn): string {
  return t(`invoices.status_${status}`, { defaultValue: INVOICE_STATUS_DEFAULT_LABEL[status] })
}

export function paymentMethodLabel(method: InvoicePaymentMethod, t: TranslateFn): string {
  return t(`invoices.payment_method_${method}`, {
    defaultValue: PAYMENT_METHOD_DEFAULT_LABEL[method]
  })
}

export function feeAgreementStatusLabel(status: FeeAgreementStatus, t: TranslateFn): string {
  return t(`dossiers.fee_agreement_status_${status}`, {
    defaultValue: FEE_AGREEMENT_STATUS_DEFAULT_LABEL[status]
  })
}

export function billingItemStatusLabel(status: BillingItemStatus, t: TranslateFn): string {
  return t(`dossiers.billing_item_status_${status}`, {
    defaultValue: BILLING_ITEM_STATUS_DEFAULT_LABEL[status]
  })
}

export function billingTypeLabel(type: BillingType, t: TranslateFn): string {
  return t(`cabinet.billing_type.${type}`, { defaultValue: BILLING_TYPE_DEFAULT_LABEL[type] })
}

export function dossierStatusLabel(status: DossierStatus, t: TranslateFn): string {
  return t(`dossiers.status_${status}`)
}
