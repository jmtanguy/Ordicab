import type {
  DossierBillingItem,
  DossierDetail,
  InvoiceRecord,
  InvoiceLineTemplateInput,
  InvoiceSettings,
  InvoiceTemplateInput
} from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import type { ContactRecord } from '@shared/validation'

/**
 * Builds the {{invoice.*}} template context payload from billing items + dossier + cabinet
 * settings. Reused by `InvoiceService.create` (with a consumed invoice number) and by
 * `GenerateService.previewInvoiceDocx` (with a preview-only number).
 */
export function buildInvoiceTemplateInputFromBillingItems(args: {
  items: DossierBillingItem[]
  dossier: { feeAgreements: DossierDetail['feeAgreements'] }
  contacts: ContactRecord[]
  settings: InvoiceSettings
  number: string
  issuedAt: string
  documentType?: InvoiceTemplateInput['documentType']
  dueAt?: string
  paymentTerms?: string
  correctionReason?: string
  originalInvoiceRefs?: InvoiceTemplateInput['originalInvoiceRefs']
  notes?: string
}): InvoiceTemplateInput {
  const {
    items,
    dossier,
    contacts,
    settings,
    number,
    issuedAt,
    notes,
    documentType,
    dueAt,
    paymentTerms,
    correctionReason,
    originalInvoiceRefs
  } = args

  const activeFeeAgreement =
    dossier.feeAgreements.find((entry) => entry.isActive) ?? dossier.feeAgreements[0]
  const clientContactUuid = activeFeeAgreement?.clientContactUuid
  const clientContact = clientContactUuid
    ? contacts.find((c) => c.uuid === clientContactUuid)
    : contacts[0]
  const clientLabel = clientContact ? computeContactDisplayName(clientContact) : undefined

  const lines: InvoiceLineTemplateInput[] = items.map((item) => ({
    date: item.date,
    label: item.label,
    description: item.description,
    quantity: item.quantity,
    quantityUnit: item.quantityUnit,
    unitPriceHtCents: item.unitPriceHtCents,
    discountHtCents: item.discountHtCents,
    subtotalHtCents: item.subtotalHtCents,
    totalHtCents: item.totalHtCents,
    vatRateBasisPoints: item.vatRateBasisPoints,
    totalTtcCents: item.totalTtcCents
  }))
  const totalHtCents = lines.reduce((acc, l) => acc + l.totalHtCents, 0)
  const totalTtcCents = lines.reduce((acc, l) => acc + l.totalTtcCents, 0)
  const totalVatCents = totalTtcCents - totalHtCents

  return {
    documentType: documentType ?? 'invoice',
    number,
    issuedAt,
    dueAt,
    paymentTerms,
    correctionReason,
    originalInvoiceRefs: originalInvoiceRefs ?? [],
    notes,
    totalHtCents,
    totalVatCents,
    totalTtcCents,
    lines,
    client: { displayName: clientLabel },
    issuer: {
      name: settings.issuerName,
      address: settings.issuerAddress,
      siret: settings.issuerSiret,
      vatNumber: settings.issuerVatNumber,
      iban: settings.issuerIban,
      legalFooter: settings.legalFooter
    }
  }
}

export function buildInvoiceTemplateInputFromRecord(record: InvoiceRecord): InvoiceTemplateInput {
  const lines: InvoiceLineTemplateInput[] = record.lines.map((line) => ({
    date: line.date,
    label: line.label,
    description: line.description,
    quantity: line.quantity,
    quantityUnit: line.quantityUnit,
    unitPriceHtCents: line.unitPriceHtCents,
    discountHtCents: line.discountHtCents,
    subtotalHtCents: line.subtotalHtCents,
    totalHtCents: line.totalHtCents,
    vatRateBasisPoints: line.vatRateBasisPoints,
    totalTtcCents: line.totalTtcCents
  }))
  return {
    documentType: record.documentType,
    number: record.number,
    issuedAt: record.issuedAt,
    dueAt: record.dueAt,
    paymentTerms: record.paymentTerms,
    correctionReason: record.correctionReason,
    originalInvoiceRefs: record.originalInvoiceRefs,
    notes: record.notes,
    totalHtCents: record.totalHtCents,
    totalVatCents: record.totalVatCents,
    totalTtcCents: record.totalTtcCents,
    lines,
    client: {
      displayName: record.clientSnapshot?.name ?? record.clientLabel,
      address: record.clientSnapshot?.address
    },
    issuer: {
      name: record.issuerSnapshot?.name,
      address: record.issuerSnapshot?.address,
      siret: record.issuerSnapshot?.siret,
      vatNumber: record.issuerSnapshot?.vatNumber,
      iban: record.issuerSnapshot?.iban,
      legalFooter: record.issuerSnapshot?.legalFooter
    }
  }
}
