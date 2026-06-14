import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import {
  type CabinetBillingCatalog,
  type DomainStatusSnapshot,
  type InvoiceCancelInput,
  type InvoiceCreateCorrectiveInput,
  type InvoiceCreateCreditNoteInput,
  type InvoiceArtifactResult,
  type InvoiceCreateInput,
  type InvoiceDocumentType,
  type InvoiceExportCsvInput,
  type InvoiceExportCsvResult,
  type InvoiceExportFecInput,
  type InvoiceExportFecResult,
  type InvoiceLine,
  type InvoiceMarkPaidInput,
  type InvoiceOriginalRef,
  type InvoicePartySnapshot,
  type InvoicePayment,
  type InvoicePaymentDeleteInput,
  type InvoicePaymentInput,
  type InvoicePaymentStatus,
  type InvoicePaymentUpdateInput,
  type InvoiceRecord,
  type InvoiceSettings,
  type InvoiceSettingsUpdateInput,
  IpcErrorCode,
  DEFAULT_INVOICE_SETTINGS,
  computeDueDateIso
} from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import { consumeNextInvoiceNumber } from '@shared/domain/invoiceNumbering'
import { buildFecExport } from '@shared/domain/fecExport'
import {
  buildInvoiceTemplateInputFromBillingItems,
  buildInvoiceTemplateInputFromRecord
} from './invoiceTemplateInput'
import { buildInvoiceHtml } from './invoicePdfRenderer'
import { cabinetBillingCatalogSchema, invoiceRecordSchema } from '@shared/validation'
import { loadAllRecords, loadRecord, saveRecord } from '../../lib/system/perFileStore'

import {
  getDomainCabinetBillingPath,
  getDomainInvoiceDocumentsPath,
  getDomainInvoiceRecordPath,
  getDomainInvoiceRecordsDirectoryPath
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'
import { entityToInvoiceIssuer } from '@shared/domain/invoiceIssuer'

import type { ContactService } from './contactService'
import type { DossierRegistryService } from './dossierRegistryService'
import type { EntityService } from './entityService'
import type { GenerateService } from './generateService'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface InvoiceService {
  list(): Promise<InvoiceRecord[]>
  get(invoiceUuid: string): Promise<InvoiceRecord>
  getSettings(): Promise<InvoiceSettings>
  updateSettings(input: InvoiceSettingsUpdateInput): Promise<InvoiceSettings>
  create(input: InvoiceCreateInput): Promise<InvoiceRecord>
  cancel(input: InvoiceCancelInput): Promise<InvoiceRecord>
  markPaid(input: InvoiceMarkPaidInput): Promise<InvoiceRecord>
  createCreditNote(input: InvoiceCreateCreditNoteInput): Promise<InvoiceRecord>
  createCorrectiveInvoice(input: InvoiceCreateCorrectiveInput): Promise<InvoiceRecord>
  addPayment(input: InvoicePaymentInput): Promise<InvoiceRecord>
  updatePayment(input: InvoicePaymentUpdateInput): Promise<InvoiceRecord>
  deletePayment(input: InvoicePaymentDeleteInput): Promise<InvoiceRecord>
  exportCsv(input: InvoiceExportCsvInput, outputPath: string): Promise<InvoiceExportCsvResult>
  exportFec(input: InvoiceExportFecInput, outputPath: string): Promise<InvoiceExportFecResult>
  /**
   * Resolves the DOCX path for an issued invoice and reports its integrity
   * (hash match against the value captured at issuance). The DOCX is the
   * editable working copy — its content may have drifted from the original
   * artifact and the integrity field surfaces that to the UI.
   */
  resolveDocumentAbsolutePath(invoiceUuid: string): Promise<InvoiceArtifactResult>
  /**
   * Resolves the PDF path for an issued invoice and reports its integrity.
   * The PDF is the frozen contractual artifact — eagerly generated at
   * issuance from the DOCX (template-faithful), hashed, and never silently
   * regenerated. If the file is missing on disk, a replacement is rendered
   * from the intact DOCX via `docxToPdf` (template-faithful), or from the
   * immutable record via `printHtmlToPdf` when the DOCX is tampered/missing
   * (generic layout), and the integrity is reported as `regenerated`.
   */
  resolvePdfAbsolutePath(invoiceUuid: string): Promise<InvoiceArtifactResult>
}

export class InvoiceServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'InvoiceServiceError'
  }
}

/**
 * Destinataire affiché sur les pièces de rétribution AJ : la CARPA règle la part
 * de l'État, le bénéficiaire de l'aide juridictionnelle n'est pas le débiteur.
 */
const CARPA_CLIENT_LABEL = 'CARPA — Aide juridictionnelle'

/**
 * Tags renseignés par le module facture au moment de la création (numéro consommé,
 * échéance calculée) : les valeurs d'aperçu hydratées dans le dialogue ne doivent
 * pas écraser les valeurs réelles du contexte.
 */
const AUTO_RESOLVED_INVOICE_TAG_PATHS = new Set([
  'invoice.number',
  'invoice.issuedAt',
  'invoice.dueAt'
])

function stripAutoResolvedInvoiceTagOverrides(
  overrides: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!overrides) return undefined
  return Object.fromEntries(
    Object.entries(overrides).filter(([path]) => !AUTO_RESOLVED_INVOICE_TAG_PATHS.has(path))
  )
}

export interface InvoiceServiceOptions {
  domainService: DomainServiceLike
  dossierRegistryService: DossierRegistryService
  generateService: GenerateService
  contactService: ContactService
  /** Source of truth for the invoice issuer identity (firm name, SIREN, VAT, IBAN, address). */
  entityService: EntityService
  /**
   * Renders an HTML string to a PDF written at `outputPath`. Used for the
   * generic fallback layout when no trustworthy DOCX exists. Optional; when
   * absent, `resolvePdfAbsolutePath` throws on that path. Wired by the
   * container using Electron's BrowserWindow + webContents.printToPDF.
   */
  printHtmlToPdf?: (html: string, outputPath: string) => Promise<void>
  /**
   * Converts the generated DOCX to a layout-faithful PDF written at
   * `outputPath`. Preferred over `printHtmlToPdf` whenever an intact DOCX is
   * on disk. Wired by the container via the hidden docx-preview window.
   */
  docxToPdf?: (docxAbsolutePath: string, outputPath: string) => Promise<void>
  now?: () => Date
}

function defaultSettings(now: () => Date): InvoiceSettings {
  const year = now().getFullYear()
  return {
    ...DEFAULT_INVOICE_SETTINGS,
    currentSequenceYear: year,
    creditNoteCurrentSequenceYear: year,
    correctiveInvoiceCurrentSequenceYear: year
  }
}

function sanitizeInvoiceDocumentBaseName(invoiceNumber: string): string {
  const normalized = Array.from(invoiceNumber.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character
  })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
  return normalized || 'facture'
}

function toPortableRelativePath(from: string, to: string): string {
  return relative(from, to).split('\\').join('/')
}

async function resolveInvoiceDocumentPath(
  domainPath: string,
  invoiceNumber: string
): Promise<string> {
  const directory = getDomainInvoiceDocumentsPath(domainPath)
  const baseName = sanitizeInvoiceDocumentBaseName(invoiceNumber)
  let candidate = join(directory, `${baseName}.docx`)
  let suffix = 2
  while (await pathExists(candidate)) {
    candidate = join(directory, `${baseName}-${suffix}.docx`)
    suffix += 1
  }
  return candidate
}

function documentSign(documentType: InvoiceDocumentType): 1 | -1 {
  return documentType === 'creditNote' ? -1 : 1
}

function computeVatBreakdown(lines: InvoiceLine[]): InvoiceRecord['vatBreakdown'] {
  const byRate = new Map<number, InvoiceRecord['vatBreakdown'][number]>()
  for (const line of lines) {
    const vatCents = Math.max(0, line.totalTtcCents - line.totalHtCents)
    const current = byRate.get(line.vatRateBasisPoints) ?? {
      vatRateBasisPoints: line.vatRateBasisPoints,
      taxableHtCents: 0,
      vatCents: 0,
      totalTtcCents: 0
    }
    current.taxableHtCents += line.totalHtCents
    current.vatCents += vatCents
    current.totalTtcCents += line.totalTtcCents
    byRate.set(line.vatRateBasisPoints, current)
  }
  return [...byRate.values()].sort((a, b) => a.vatRateBasisPoints - b.vatRateBasisPoints)
}

function computePaymentStatus(
  totalTtcCents: number,
  payments: InvoicePayment[]
): {
  paymentStatus: InvoicePaymentStatus
  paidAmountCents: number
  remainingAmountCents: number
} {
  const paidAmountCents = payments.reduce((acc, payment) => acc + payment.amountCents, 0)
  const remainingAmountCents = Math.max(0, totalTtcCents - paidAmountCents)
  const paymentStatus: InvoicePaymentStatus =
    paidAmountCents <= 0
      ? 'unpaid'
      : paidAmountCents < totalTtcCents
        ? 'partiallyPaid'
        : paidAmountCents === totalTtcCents
          ? 'paid'
          : 'overpaid'
  return { paymentStatus, paidAmountCents, remainingAmountCents }
}

function applyPaymentState(record: InvoiceRecord): InvoiceRecord {
  if (record.documentType === 'creditNote') {
    return {
      ...record,
      paymentStatus: 'paid',
      paidAmountCents: record.totalTtcCents,
      remainingAmountCents: 0,
      status: record.status === 'cancelled' ? record.status : 'paid'
    }
  }
  const totals = computePaymentStatus(record.totalTtcCents, record.payments)
  const status =
    record.status === 'cancelled' || record.status === 'corrected'
      ? record.status
      : totals.paymentStatus === 'unpaid'
        ? 'issued'
        : totals.paymentStatus
  return { ...record, ...totals, status }
}

function getSettingsForDocumentType(
  settings: InvoiceSettings,
  documentType: InvoiceDocumentType
): InvoiceSettings {
  if (documentType === 'creditNote') {
    return {
      ...settings,
      numberPattern: settings.creditNoteNumberPattern,
      nextSequence: settings.creditNoteNextSequence,
      currentSequenceYear: settings.creditNoteCurrentSequenceYear
    }
  }
  if (documentType === 'correctiveInvoice') {
    return {
      ...settings,
      numberPattern: settings.correctiveInvoiceNumberPattern,
      nextSequence: settings.correctiveInvoiceNextSequence,
      currentSequenceYear: settings.correctiveInvoiceCurrentSequenceYear
    }
  }
  if (documentType === 'stateRetribution') {
    return {
      ...settings,
      numberPattern: settings.stateRetributionNumberPattern,
      nextSequence: settings.stateRetributionNextSequence,
      currentSequenceYear: settings.stateRetributionCurrentSequenceYear
    }
  }
  return settings
}

function applyResolvedSettingsForDocumentType(
  settings: InvoiceSettings,
  documentType: InvoiceDocumentType,
  nextSettings: InvoiceSettings
): InvoiceSettings {
  if (documentType === 'creditNote') {
    return {
      ...settings,
      creditNoteNextSequence: nextSettings.nextSequence,
      creditNoteCurrentSequenceYear: nextSettings.currentSequenceYear
    }
  }
  if (documentType === 'correctiveInvoice') {
    return {
      ...settings,
      correctiveInvoiceNextSequence: nextSettings.nextSequence,
      correctiveInvoiceCurrentSequenceYear: nextSettings.currentSequenceYear
    }
  }
  if (documentType === 'stateRetribution') {
    return {
      ...settings,
      stateRetributionNextSequence: nextSettings.nextSequence,
      stateRetributionCurrentSequenceYear: nextSettings.currentSequenceYear
    }
  }
  return {
    ...settings,
    nextSequence: nextSettings.nextSequence,
    currentSequenceYear: nextSettings.currentSequenceYear
  }
}

function invoiceRef(record: InvoiceRecord): InvoiceOriginalRef {
  return { uuid: record.uuid, number: record.number, issuedAt: record.issuedAt }
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

async function sha256OfFile(absolutePath: string): Promise<string> {
  const buffer = await readFile(absolutePath)
  return createHash('sha256').update(buffer).digest('hex')
}

async function makeReadOnlyBestEffort(absolutePath: string): Promise<void> {
  try {
    await chmod(absolutePath, 0o444)
  } catch {
    // Filesystems that don't support chmod (some Windows FS, network mounts)
    // should not block issuance. The SHA-256 hash check is the real guarantee.
  }
}

interface FreezeArtifactsResult {
  docxSha256?: string
  pdfSha256?: string
  pdfAbsolutePath?: string
}

/**
 * Freezes the artifacts produced for an issued invoice. Hashes the DOCX,
 * eagerly renders the PDF from it (so the PDF mirrors the user-selected
 * template), hashes the PDF, and marks both files read-only on disk.
 *
 * The PDF render is best-effort: if `docxToPdf` is not wired (e.g. in
 * tests), only the DOCX hash is captured and the PDF will be generated
 * lazily on first open (still verified against this hash once produced).
 */
async function freezeIssuedArtifacts(args: {
  docxAbsolutePath: string
  pdfAbsolutePath: string
  docxToPdf?: (docxAbsolutePath: string, outputPath: string) => Promise<void>
}): Promise<FreezeArtifactsResult> {
  const result: FreezeArtifactsResult = {}
  try {
    result.docxSha256 = await sha256OfFile(args.docxAbsolutePath)
  } catch {
    // DOCX not on disk (test mocks, atypical generator). Integrity will be
    // reported as 'unknown' on later opens — but issuance itself succeeds.
    return result
  }
  if (args.docxToPdf) {
    try {
      await mkdir(dirname(args.pdfAbsolutePath), { recursive: true })
      await args.docxToPdf(args.docxAbsolutePath, args.pdfAbsolutePath)
      result.pdfSha256 = await sha256OfFile(args.pdfAbsolutePath)
      result.pdfAbsolutePath = args.pdfAbsolutePath
      await makeReadOnlyBestEffort(args.pdfAbsolutePath)
    } catch {
      // Eager PDF generation failed (docx-preview render, write error, …).
      // Don't fail issuance — the DOCX is the legal record. PDF can be
      // regenerated lazily later.
    }
  }
  await makeReadOnlyBestEffort(args.docxAbsolutePath)
  return result
}

export function createInvoiceService(options: InvoiceServiceOptions): InvoiceService {
  const { domainService, dossierRegistryService, generateService, contactService, entityService } =
    options
  const printHtmlToPdf = options.printHtmlToPdf
  const docxToPdf = options.docxToPdf
  const now = options.now ?? (() => new Date())

  // In-flight serialization queue, so two concurrent create()/cancel() calls
  // cannot race on the sequence counter.
  let queue: Promise<unknown> = Promise.resolve()
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn)
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  async function resolveDomainPath(): Promise<string> {
    const status = await domainService.getStatus()
    if (!status.registeredDomainPath) {
      throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
    }
    if (!status.isAvailable) {
      throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
    }
    return status.registeredDomainPath
  }

  async function loadCatalog(domainPath: string): Promise<CabinetBillingCatalog> {
    const catalogPath = getDomainCabinetBillingPath(domainPath)
    if (!(await pathExists(catalogPath))) {
      return { services: [], updatedAt: now().toISOString() }
    }
    const raw = await readFile(catalogPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const result = cabinetBillingCatalogSchema.safeParse(parsed)
    if (!result.success) {
      throw new InvoiceServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored cabinet billing catalog is invalid.'
      )
    }
    return result.data
  }

  async function saveCatalog(domainPath: string, catalog: CabinetBillingCatalog): Promise<void> {
    const validated = cabinetBillingCatalogSchema.parse(catalog)
    const catalogPath = getDomainCabinetBillingPath(domainPath)
    await mkdir(dirname(catalogPath), { recursive: true })
    await atomicWrite(catalogPath, `${JSON.stringify(validated, null, 2)}\n`)
  }

  async function loadInvoiceRecord(domainPath: string, id: string): Promise<InvoiceRecord | null> {
    return loadRecord(getDomainInvoiceRecordPath(domainPath, id), invoiceRecordSchema)
  }

  async function saveInvoiceRecord(domainPath: string, record: InvoiceRecord): Promise<void> {
    return saveRecord(
      getDomainInvoiceRecordsDirectoryPath(domainPath),
      getDomainInvoiceRecordPath(domainPath, record.uuid),
      record
    )
  }

  async function loadAllInvoiceRecords(domainPath: string): Promise<InvoiceRecord[]> {
    return loadAllRecords(getDomainInvoiceRecordsDirectoryPath(domainPath), invoiceRecordSchema)
  }

  /**
   * Floor for the next sequence number of `documentType`: one past the highest
   * already-issued value (scoped to the year when the series resets yearly).
   * Passed to consumeNextInvoiceNumber so numbering is crash-safe and never
   * reuses an issued number even if the persisted counter is stale.
   */
  function nextSequenceFloor(
    records: InvoiceRecord[],
    documentType: InvoiceRecord['documentType'],
    resetYearly: boolean,
    issuedAt: Date
  ): number {
    const year = issuedAt.getFullYear()
    const highestIssued = records
      .filter(
        (record) =>
          record.documentType === documentType && (!resetYearly || record.sequenceYear === year)
      )
      .reduce((max, record) => Math.max(max, record.sequenceValue), 0)
    return highestIssued + 1
  }

  function getSettingsFromCatalog(catalog: CabinetBillingCatalog): InvoiceSettings {
    return catalog.invoiceSettings ?? defaultSettings(now)
  }

  async function getSettings(): Promise<InvoiceSettings> {
    const domainPath = await resolveDomainPath()
    const catalog = await loadCatalog(domainPath)
    return getSettingsFromCatalog(catalog)
  }

  function applySettingsPatch(
    current: InvoiceSettings,
    patch: InvoiceSettingsUpdateInput
  ): InvoiceSettings {
    return {
      ...current,
      ...(patch.numberPattern !== undefined ? { numberPattern: patch.numberPattern } : {}),
      ...(patch.sequencePadding !== undefined ? { sequencePadding: patch.sequencePadding } : {}),
      ...(patch.resetSequenceYearly !== undefined
        ? { resetSequenceYearly: patch.resetSequenceYearly }
        : {}),
      ...(patch.nextSequence !== undefined ? { nextSequence: patch.nextSequence } : {}),
      ...(patch.creditNoteNumberPattern !== undefined
        ? { creditNoteNumberPattern: patch.creditNoteNumberPattern }
        : {}),
      ...(patch.creditNoteNextSequence !== undefined
        ? { creditNoteNextSequence: patch.creditNoteNextSequence }
        : {}),
      ...(patch.correctiveInvoiceNumberPattern !== undefined
        ? { correctiveInvoiceNumberPattern: patch.correctiveInvoiceNumberPattern }
        : {}),
      ...(patch.correctiveInvoiceNextSequence !== undefined
        ? { correctiveInvoiceNextSequence: patch.correctiveInvoiceNextSequence }
        : {}),
      ...(patch.defaultTemplateUuid !== undefined
        ? { defaultTemplateUuid: patch.defaultTemplateUuid ?? undefined }
        : {}),
      ...(patch.defaultCreditNoteTemplateUuid !== undefined
        ? { defaultCreditNoteTemplateUuid: patch.defaultCreditNoteTemplateUuid ?? undefined }
        : {}),
      ...(patch.defaultCorrectiveInvoiceTemplateUuid !== undefined
        ? {
            defaultCorrectiveInvoiceTemplateUuid:
              patch.defaultCorrectiveInvoiceTemplateUuid ?? undefined
          }
        : {}),
      ...(patch.legalFooter !== undefined ? { legalFooter: patch.legalFooter ?? undefined } : {}),
      ...(patch.defaultPaymentTerms !== undefined
        ? { defaultPaymentTerms: patch.defaultPaymentTerms ?? undefined }
        : {}),
      ...(patch.defaultDueDays !== undefined ? { defaultDueDays: patch.defaultDueDays } : {})
    }
  }

  return {
    list: async (): Promise<InvoiceRecord[]> => {
      const domainPath = await resolveDomainPath()
      const records = await loadAllInvoiceRecords(domainPath)
      return records.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    },

    get: async (invoiceUuid): Promise<InvoiceRecord> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceUuid)
      if (!found) {
        throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
      }
      return found
    },

    getSettings,

    updateSettings: async (input): Promise<InvoiceSettings> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const catalog = await loadCatalog(domainPath)
        const current = getSettingsFromCatalog(catalog)
        const merged = applySettingsPatch(current, input)
        const nextCatalog: CabinetBillingCatalog = {
          ...catalog,
          invoiceSettings: merged,
          updatedAt: now().toISOString()
        }
        await saveCatalog(domainPath, nextCatalog)
        return merged
      })
    },

    create: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()

        const dossier = await dossierRegistryService.getDossier({ dossierId: input.dossierId })

        const items = input.billingItemUuids.map((id) => {
          const found = dossier.billingItems.find((entry) => entry.uuid === id)
          if (!found) {
            throw new InvoiceServiceError(
              IpcErrorCode.NOT_FOUND,
              `Billing item ${id} was not found in dossier ${input.dossierId}.`
            )
          }
          if (found.status !== 'draft') {
            throw new InvoiceServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Billing item ${found.label} is already invoiced or cancelled.`
            )
          }
          return found
        })

        if (items.length === 0) {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Au moins une prestation doit être sélectionnée.'
          )
        }

        // La rétribution AJ (part de l'État réglée par la CARPA) n'est pas une facture
        // commerciale : on l'émet comme une pièce comptable distincte, numérotée à part
        // (RET-…) et exclue du chiffre d'affaires. On la déduit du type de prestation source.
        const isStateRetribution = items.every(
          (item) => item.sourceFeeAgreementBillingKind === 'stateRetribution'
        )
        const mixesStateRetribution =
          !isStateRetribution &&
          items.some((item) => item.sourceFeeAgreementBillingKind === 'stateRetribution')
        if (mixesStateRetribution) {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Une rétribution AJ (État) ne peut pas être regroupée avec d’autres prestations sur la même pièce.'
          )
        }
        const documentType: InvoiceDocumentType = isStateRetribution
          ? 'stateRetribution'
          : 'invoice'

        const catalog = await loadCatalog(domainPath)
        const settings = getSettingsFromCatalog(catalog)
        const issuedAtDate = input.issuedAt ? new Date(input.issuedAt) : now()
        if (isNaN(issuedAtDate.getTime())) {
          throw new InvoiceServiceError(IpcErrorCode.VALIDATION_FAILED, "Date d'émission invalide.")
        }
        const issuedAtIso = issuedAtDate.toISOString().slice(0, 10)
        const dueAtIso = input.dueAt ?? computeDueDateIso(issuedAtIso, settings.defaultDueDays)

        const documentTypeSettings = getSettingsForDocumentType(settings, documentType)
        const existingRecords = await loadAllInvoiceRecords(domainPath)
        let resolved
        try {
          resolved = consumeNextInvoiceNumber(
            documentTypeSettings,
            issuedAtDate,
            nextSequenceFloor(
              existingRecords,
              documentType,
              documentTypeSettings.resetSequenceYearly,
              issuedAtDate
            )
          )
        } catch (error) {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            error instanceof Error ? error.message : 'Pattern de numérotation invalide.'
          )
        }

        const activeFeeAgreement =
          dossier.feeAgreements.find((entry) => entry.isActive) ?? dossier.feeAgreements[0]
        const clientContactUuid = activeFeeAgreement?.clientContactUuid
        const contacts = await contactService.list(input.dossierId).catch(() => [])
        const clientContact = clientContactUuid
          ? contacts.find((c) => c.uuid === clientContactUuid)
          : contacts[0]
        const entityProfile = await entityService.get().catch(() => null)
        const issuerSnapshot: InvoicePartySnapshot = entityToInvoiceIssuer(entityProfile, settings)

        // Pour une rétribution AJ, le « débiteur » est la CARPA (qui règle la part de
        // l'État), pas le bénéficiaire de l'aide juridictionnelle.
        const clientLabel = isStateRetribution
          ? CARPA_CLIENT_LABEL
          : clientContact
            ? computeContactDisplayName(clientContact)
            : undefined
        const clientSnapshot: InvoicePartySnapshot | undefined = isStateRetribution
          ? { name: CARPA_CLIENT_LABEL }
          : clientContact
            ? {
                name: clientLabel,
                address: [clientContact.addressLine, clientContact.addressLine2]
                  .filter((part): part is string => Boolean(part && part.trim()))
                  .join('\n')
              }
            : undefined

        const lines: InvoiceLine[] = items.map((item) => ({
          billingItemUuid: item.uuid,
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
        const vatBreakdown = computeVatBreakdown(lines)

        const invoiceUuid = randomUUID()
        const nowIso = now().toISOString()
        const invoiceDocumentPath = await resolveInvoiceDocumentPath(domainPath, resolved.number)

        const record: InvoiceRecord = {
          uuid: invoiceUuid,
          documentType,
          number: resolved.number,
          sequenceYear: resolved.sequenceYear,
          sequenceValue: resolved.sequenceValue,
          issuedAt: issuedAtIso,
          dueAt: dueAtIso,
          dossierId: input.dossierId,
          dossierLabel: dossier.name,
          clientContactUuid: clientContact?.uuid,
          clientLabel,
          clientSnapshot,
          issuerSnapshot,
          templateUuid: input.templateUuid,
          totalHtCents,
          totalVatCents,
          totalTtcCents,
          vatBreakdown,
          status: 'issued',
          paymentStatus: 'unpaid',
          paidAmountCents: 0,
          remainingAmountCents: totalTtcCents,
          payments: [],
          originalInvoiceRefs: [],
          paymentTerms: settings.defaultPaymentTerms,
          lines,
          notes: input.notes,
          createdAt: nowIso,
          updatedAt: nowIso
        }

        // Generate the DOCX. Failures here abort the whole creation
        // (no number is consumed, no registry mutation).
        let documentResult
        try {
          documentResult = await generateService.generateDocument({
            dossierId: input.dossierId,
            templateUuid: input.templateUuid,
            outputPath: invoiceDocumentPath,
            filename: resolved.number,
            tagOverrides: stripAutoResolvedInvoiceTagOverrides(input.tagOverrides),
            primaryContactUuid: input.primaryContactUuid,
            contactRoleOverrides: input.contactRoleOverrides,
            invoiceContext: buildInvoiceTemplateInputFromBillingItems({
              items,
              dossier,
              contacts,
              issuer: issuerSnapshot,
              number: resolved.number,
              issuedAt: issuedAtIso,
              notes: input.notes,
              documentType,
              originalInvoiceRefs: [],
              paymentTerms: settings.defaultPaymentTerms,
              dueAt: dueAtIso,
              correctionReason: undefined
            })
          })
        } catch (error) {
          if (error instanceof Error) {
            throw new InvoiceServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Génération du document échouée : ${error.message}`
            )
          }
          throw error
        }

        record.generatedDocumentUuid = documentResult.documentUuid
        record.generatedDocumentName = documentResult.outputPath
          ? basename(documentResult.outputPath)
          : undefined
        record.generatedDocumentPath = documentResult.outputPath
          ? toPortableRelativePath(domainPath, documentResult.outputPath)
          : undefined

        if (documentResult.outputPath) {
          const frozen = await freezeIssuedArtifacts({
            docxAbsolutePath: documentResult.outputPath,
            pdfAbsolutePath: documentResult.outputPath.replace(/\.docx$/i, '.pdf'),
            docxToPdf
          })
          record.documentHashes = {
            docxSha256: frozen.docxSha256,
            pdfSha256: frozen.pdfSha256
          }
        }

        // Persist settings (consume sequence), invoice record, then mark billing
        // items invoiced. Order is deliberate: advancing the counter first means
        // a crash before the record is written leaves a GAP (a consumed number
        // with no invoice) rather than a DUPLICATE — a gap is the recoverable,
        // auditable failure under the no-gap rule, whereas two invoices sharing a
        // number is not. `nextSequenceFloor` (above) then guarantees the next
        // issuance never reuses an already-issued number, so the stale-counter
        // case is self-healing.
        const nextSettings: InvoiceSettings =
          input.rememberTemplateAsDefault && documentType === 'invoice'
            ? {
                ...applyResolvedSettingsForDocumentType(
                  settings,
                  documentType,
                  resolved.nextSettings
                ),
                defaultTemplateUuid: input.templateUuid
              }
            : applyResolvedSettingsForDocumentType(settings, documentType, resolved.nextSettings)
        const nextCatalog: CabinetBillingCatalog = {
          ...catalog,
          invoiceSettings: nextSettings,
          updatedAt: now().toISOString()
        }
        await saveCatalog(domainPath, nextCatalog)

        await saveInvoiceRecord(domainPath, record)

        await dossierRegistryService.markBillingItemsInvoiced({
          dossierId: input.dossierId,
          billingItemUuids: items.map((item) => item.uuid),
          invoiceUuid: record.uuid,
          invoiceNumber: record.number
        })

        return record
      })
    },

    cancel: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceUuid)
        if (!found) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        }
        if (found.status === 'cancelled') return found

        const nowIso = now().toISOString()
        const updated: InvoiceRecord = {
          ...found,
          status: 'cancelled',
          cancelledAt: nowIso,
          updatedAt: nowIso
        }
        await saveInvoiceRecord(domainPath, updated)
        return updated
      })
    },

    markPaid: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceUuid)
        if (!found) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        }
        if (found.documentType === 'creditNote') {
          // A credit note is never "paid" — mirror addPayment's guard so we
          // don't append a phantom full-amount payment that would then render
          // in the invoice's settlement block.
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Credit notes are not payable.'
          )
        }
        const existingPaid = found.payments.reduce((acc, payment) => acc + payment.amountCents, 0)
        const remaining = Math.max(0, found.totalTtcCents - existingPaid)
        if (remaining <= 0) return applyPaymentState(found)
        const nowIso = now().toISOString()
        const payment: InvoicePayment = {
          uuid: randomUUID(),
          paidAt: input.paidAt ?? nowIso.slice(0, 10),
          amountCents: remaining,
          method: 'transfer',
          createdAt: nowIso,
          updatedAt: nowIso
        }
        const updated = applyPaymentState({
          ...found,
          payments: [...found.payments, payment],
          paidAt: input.paidAt ?? nowIso.slice(0, 10),
          updatedAt: nowIso
        })
        await saveInvoiceRecord(domainPath, updated)
        return updated
      })
    },

    createCreditNote: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const original = await loadInvoiceRecord(domainPath, input.originalInvoiceUuid)
        if (!original) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Original invoice was not found.')
        }
        if (original.documentType === 'creditNote') {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Cannot create a credit note from another credit note.'
          )
        }

        const issuedAtDate = input.issuedAt ? new Date(input.issuedAt) : now()
        if (isNaN(issuedAtDate.getTime())) {
          throw new InvoiceServiceError(IpcErrorCode.VALIDATION_FAILED, "Date d'émission invalide.")
        }
        const issuedAtIso = issuedAtDate.toISOString().slice(0, 10)
        const catalog = await loadCatalog(domainPath)
        const settings = getSettingsFromCatalog(catalog)
        const creditNoteSettings = getSettingsForDocumentType(settings, 'creditNote')
        const existingRecords = await loadAllInvoiceRecords(domainPath)
        const resolved = consumeNextInvoiceNumber(
          creditNoteSettings,
          issuedAtDate,
          nextSequenceFloor(
            existingRecords,
            'creditNote',
            creditNoteSettings.resetSequenceYearly,
            issuedAtDate
          )
        )

        const creditSpecs = new Map(
          (input.lineCredits ?? []).map((line) => [line.billingItemUuid, line])
        )
        const sourceLines = input.lineCredits
          ? original.lines.filter((line) => creditSpecs.has(line.billingItemUuid))
          : original.lines
        if (sourceLines.length === 0) {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'At least one invoice line must be credited.'
          )
        }
        const lines: InvoiceLine[] = sourceLines.map((line) => {
          const spec = creditSpecs.get(line.billingItemUuid)
          const ratio =
            spec?.totalHtCents !== undefined && line.totalHtCents > 0
              ? spec.totalHtCents / line.totalHtCents
              : spec?.quantity !== undefined && line.quantity > 0
                ? spec.quantity / line.quantity
                : 1
          const clampedRatio = Math.min(1, Math.max(0, ratio))
          const quantity = spec?.quantity ?? Number((line.quantity * clampedRatio).toFixed(4))
          const totalHtCents = spec?.totalHtCents ?? Math.round(line.totalHtCents * clampedRatio)
          if (totalHtCents <= 0 || totalHtCents > line.totalHtCents) {
            throw new InvoiceServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Invalid credit amount for line ${line.label}.`
            )
          }
          const subtotalHtCents = Math.round(line.subtotalHtCents * clampedRatio)
          const discountHtCents = Math.max(0, subtotalHtCents - totalHtCents)
          // Derive the credited TTC from the original line's stored TTC, not by
          // re-applying the VAT rate to HT — otherwise a full credit can differ
          // from the invoice it reverses by a rounding cent and the avoir never
          // exactly cancels the original. Full credit → reuse the line TTC
          // verbatim; partial credit → prorate the line TTC by the HT share.
          const totalTtcCents =
            totalHtCents === line.totalHtCents
              ? line.totalTtcCents
              : Math.round(line.totalTtcCents * (totalHtCents / line.totalHtCents))
          return {
            ...line,
            quantity,
            subtotalHtCents,
            discountHtCents,
            totalHtCents,
            totalTtcCents
          }
        })
        const totalHtCents = lines.reduce((acc, line) => acc + line.totalHtCents, 0)
        const totalTtcCents = lines.reduce((acc, line) => acc + line.totalTtcCents, 0)
        const totalVatCents = totalTtcCents - totalHtCents
        const nowIso = now().toISOString()
        // A credit note carries the issuer of the invoice it cancels: reuse the original's
        // frozen snapshot, falling back to the live entity profile when absent.
        const issuerSnapshot: InvoicePartySnapshot =
          original.issuerSnapshot ??
          entityToInvoiceIssuer(await entityService.get().catch(() => null), settings)
        const record: InvoiceRecord = {
          uuid: randomUUID(),
          documentType: 'creditNote',
          number: resolved.number,
          sequenceYear: resolved.sequenceYear,
          sequenceValue: resolved.sequenceValue,
          issuedAt: issuedAtIso,
          dueAt: input.dueAt,
          dossierId: original.dossierId,
          dossierLabel: original.dossierLabel,
          clientContactUuid: original.clientContactUuid,
          clientLabel: original.clientLabel,
          clientSnapshot: original.clientSnapshot,
          issuerSnapshot,
          templateUuid: input.templateUuid,
          totalHtCents,
          totalVatCents,
          totalTtcCents,
          vatBreakdown: computeVatBreakdown(lines),
          status: 'paid',
          paymentStatus: 'paid',
          paidAmountCents: totalTtcCents,
          remainingAmountCents: 0,
          payments: [],
          originalInvoiceRefs: [invoiceRef(original)],
          correctionReason: input.reason,
          paymentTerms: original.paymentTerms,
          lines,
          notes: input.notes,
          createdAt: nowIso,
          updatedAt: nowIso
        }
        const invoiceDocumentPath = await resolveInvoiceDocumentPath(domainPath, resolved.number)
        const documentResult = await generateService.generateDocument({
          dossierId: original.dossierId,
          templateUuid: input.templateUuid,
          outputPath: invoiceDocumentPath,
          filename: resolved.number,
          invoiceContext: buildInvoiceTemplateInputFromRecord(record)
        })
        record.generatedDocumentUuid = documentResult.documentUuid
        record.generatedDocumentName = documentResult.outputPath
          ? basename(documentResult.outputPath)
          : undefined
        record.generatedDocumentPath = documentResult.outputPath
          ? toPortableRelativePath(domainPath, documentResult.outputPath)
          : undefined

        if (documentResult.outputPath) {
          const frozen = await freezeIssuedArtifacts({
            docxAbsolutePath: documentResult.outputPath,
            pdfAbsolutePath: documentResult.outputPath.replace(/\.docx$/i, '.pdf'),
            docxToPdf
          })
          record.documentHashes = {
            docxSha256: frozen.docxSha256,
            pdfSha256: frozen.pdfSha256
          }
        }

        await saveCatalog(domainPath, {
          ...catalog,
          invoiceSettings: applyResolvedSettingsForDocumentType(
            settings,
            'creditNote',
            resolved.nextSettings
          ),
          updatedAt: now().toISOString()
        })
        await saveInvoiceRecord(domainPath, record)
        return record
      })
    },

    createCorrectiveInvoice: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const original = await loadInvoiceRecord(domainPath, input.originalInvoiceUuid)
        if (!original) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Original invoice was not found.')
        }
        if (original.documentType === 'creditNote') {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Cannot correct a credit note with a corrective invoice.'
          )
        }

        const dossier = await dossierRegistryService.getDossier({ dossierId: input.dossierId })
        const items = input.billingItemUuids.map((id) => {
          const found = dossier.billingItems.find((entry) => entry.uuid === id)
          if (!found) {
            throw new InvoiceServiceError(
              IpcErrorCode.NOT_FOUND,
              `Billing item ${id} was not found.`
            )
          }
          if (found.status !== 'draft') {
            throw new InvoiceServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Billing item ${found.label} is already invoiced or cancelled.`
            )
          }
          return found
        })
        const issuedAtDate = input.issuedAt ? new Date(input.issuedAt) : now()
        if (isNaN(issuedAtDate.getTime())) {
          throw new InvoiceServiceError(IpcErrorCode.VALIDATION_FAILED, "Date d'émission invalide.")
        }
        const issuedAtIso = issuedAtDate.toISOString().slice(0, 10)
        const catalog = await loadCatalog(domainPath)
        const settings = getSettingsFromCatalog(catalog)
        const correctiveSettings = getSettingsForDocumentType(settings, 'correctiveInvoice')
        const existingRecords = await loadAllInvoiceRecords(domainPath)
        const resolved = consumeNextInvoiceNumber(
          correctiveSettings,
          issuedAtDate,
          nextSequenceFloor(
            existingRecords,
            'correctiveInvoice',
            correctiveSettings.resetSequenceYearly,
            issuedAtDate
          )
        )
        const contacts = await contactService.list(input.dossierId).catch(() => [])
        const clientContact = original.clientContactUuid
          ? contacts.find((contact) => contact.uuid === original.clientContactUuid)
          : contacts[0]
        const clientLabel =
          original.clientLabel ??
          (clientContact ? computeContactDisplayName(clientContact) : undefined)
        const clientSnapshot = original.clientSnapshot ?? {
          name: clientLabel,
          address: clientContact
            ? [clientContact.addressLine, clientContact.addressLine2]
                .filter((part): part is string => Boolean(part && part.trim()))
                .join('\n')
            : undefined
        }
        const issuerSnapshot: InvoicePartySnapshot = entityToInvoiceIssuer(
          await entityService.get().catch(() => null),
          settings
        )
        const lines: InvoiceLine[] = items.map((item) => ({
          billingItemUuid: item.uuid,
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
        const totalHtCents = lines.reduce((acc, line) => acc + line.totalHtCents, 0)
        const totalTtcCents = lines.reduce((acc, line) => acc + line.totalTtcCents, 0)
        const nowIso = now().toISOString()
        const record: InvoiceRecord = {
          uuid: randomUUID(),
          documentType: 'correctiveInvoice',
          number: resolved.number,
          sequenceYear: resolved.sequenceYear,
          sequenceValue: resolved.sequenceValue,
          issuedAt: issuedAtIso,
          dueAt: input.dueAt ?? computeDueDateIso(issuedAtIso, settings.defaultDueDays),
          dossierId: input.dossierId,
          dossierLabel: dossier.name,
          clientContactUuid: original.clientContactUuid ?? clientContact?.uuid,
          clientLabel,
          clientSnapshot,
          issuerSnapshot,
          templateUuid: input.templateUuid,
          totalHtCents,
          totalVatCents: totalTtcCents - totalHtCents,
          totalTtcCents,
          vatBreakdown: computeVatBreakdown(lines),
          status: 'issued',
          paymentStatus: 'unpaid',
          paidAmountCents: 0,
          remainingAmountCents: totalTtcCents,
          payments: [],
          originalInvoiceRefs: [invoiceRef(original)],
          correctionReason: input.correctionReason,
          paymentTerms: original.paymentTerms,
          lines,
          notes: input.notes,
          createdAt: nowIso,
          updatedAt: nowIso
        }
        const invoiceDocumentPath = await resolveInvoiceDocumentPath(domainPath, resolved.number)
        const documentResult = await generateService.generateDocument({
          dossierId: input.dossierId,
          templateUuid: input.templateUuid,
          outputPath: invoiceDocumentPath,
          filename: resolved.number,
          tagOverrides: stripAutoResolvedInvoiceTagOverrides(input.tagOverrides),
          primaryContactUuid: input.primaryContactUuid,
          contactRoleOverrides: input.contactRoleOverrides,
          invoiceContext: buildInvoiceTemplateInputFromRecord(record)
        })
        record.generatedDocumentUuid = documentResult.documentUuid
        record.generatedDocumentName = documentResult.outputPath
          ? basename(documentResult.outputPath)
          : undefined
        record.generatedDocumentPath = documentResult.outputPath
          ? toPortableRelativePath(domainPath, documentResult.outputPath)
          : undefined

        if (documentResult.outputPath) {
          const frozen = await freezeIssuedArtifacts({
            docxAbsolutePath: documentResult.outputPath,
            pdfAbsolutePath: documentResult.outputPath.replace(/\.docx$/i, '.pdf'),
            docxToPdf
          })
          record.documentHashes = {
            docxSha256: frozen.docxSha256,
            pdfSha256: frozen.pdfSha256
          }
        }

        await saveCatalog(domainPath, {
          ...catalog,
          invoiceSettings: applyResolvedSettingsForDocumentType(
            settings,
            'correctiveInvoice',
            resolved.nextSettings
          ),
          updatedAt: now().toISOString()
        })
        const correctedOriginal: InvoiceRecord = {
          ...original,
          status: 'corrected' as const,
          updatedAt: nowIso
        }
        await saveInvoiceRecord(domainPath, correctedOriginal)
        await saveInvoiceRecord(domainPath, record)
        await dossierRegistryService.markBillingItemsInvoiced({
          dossierId: input.dossierId,
          billingItemUuids: items.map((item) => item.uuid),
          invoiceUuid: record.uuid,
          invoiceNumber: record.number
        })
        return record
      })
    },

    addPayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceUuid)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        if (found.documentType === 'creditNote') {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Credit notes are not payable.'
          )
        }
        const nowIso = now().toISOString()
        const payment: InvoicePayment = {
          uuid: randomUUID(),
          paidAt: input.paidAt ?? nowIso.slice(0, 10),
          amountCents: input.amountCents,
          method: input.method ?? 'transfer',
          reference: input.reference,
          notes: input.notes,
          createdAt: nowIso,
          updatedAt: nowIso
        }
        const updated = applyPaymentState({
          ...found,
          payments: [...found.payments, payment],
          paidAt: payment.paidAt,
          updatedAt: nowIso
        })
        await saveInvoiceRecord(domainPath, updated)
        return updated
      })
    },

    updatePayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceUuid)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        if (!found.payments.some((payment) => payment.uuid === input.paymentUuid)) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Payment was not found.')
        }
        const nowIso = now().toISOString()
        const updated = applyPaymentState({
          ...found,
          payments: found.payments.map((payment) =>
            payment.uuid === input.paymentUuid
              ? {
                  ...payment,
                  paidAt: input.paidAt ?? payment.paidAt,
                  amountCents: input.amountCents,
                  method: input.method ?? payment.method,
                  reference: input.reference,
                  notes: input.notes,
                  updatedAt: nowIso
                }
              : payment
          ),
          updatedAt: nowIso
        })
        await saveInvoiceRecord(domainPath, updated)
        return updated
      })
    },

    deletePayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceUuid)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        const nowIso = now().toISOString()
        const updated = applyPaymentState({
          ...found,
          payments: found.payments.filter((payment) => payment.uuid !== input.paymentUuid),
          updatedAt: nowIso
        })
        await saveInvoiceRecord(domainPath, updated)
        return updated
      })
    },

    exportCsv: async (input, outputPath): Promise<InvoiceExportCsvResult> => {
      const domainPath = await resolveDomainPath()
      const allRecords = await loadAllInvoiceRecords(domainPath)
      const from = input.dateFrom ?? ''
      const to = input.dateTo ?? '9999-12-31'
      const invoices = allRecords.filter((invoice) => {
        if (!input.includeCancelled && invoice.status === 'cancelled') return false
        return invoice.issuedAt >= from && invoice.issuedAt <= to
      })
      const headers = [
        'type',
        'numero',
        'date',
        'dossier',
        'client',
        'statut',
        'statut_paiement',
        'ht',
        'tva',
        'ttc',
        'regle',
        'reste',
        'factures_origine'
      ]
      const rows = invoices.map((invoice) => {
        const sign = documentSign(invoice.documentType)
        return [
          invoice.documentType,
          invoice.number,
          invoice.issuedAt,
          invoice.dossierLabel,
          invoice.clientLabel ?? '',
          invoice.status,
          invoice.paymentStatus,
          sign * invoice.totalHtCents,
          sign * invoice.totalVatCents,
          sign * invoice.totalTtcCents,
          sign * invoice.paidAmountCents,
          sign * invoice.remainingAmountCents,
          invoice.originalInvoiceRefs.map((ref) => ref.number).join('|')
        ]
      })
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => csvCell(cell)).join(','))
        .join('\n')
      // Write to the user-chosen destination (a native save dialog resolves the
      // path in the handler), creating its parent directory if needed.
      await mkdir(dirname(outputPath), { recursive: true })
      await atomicWrite(outputPath, `${csv}\n`)
      return { canceled: false, outputPath, invoiceCount: invoices.length }
    },

    exportFec: async (input, outputPath): Promise<InvoiceExportFecResult> => {
      const domainPath = await resolveDomainPath()
      const allRecords = await loadAllInvoiceRecords(domainPath)
      const from = input.dateFrom ?? ''
      const to = input.dateTo ?? '9999-12-31'
      const invoices = allRecords.filter((invoice) => {
        if (!input.includeCancelled && invoice.status === 'cancelled') return false
        return invoice.issuedAt >= from && invoice.issuedAt <= to
      })
      const fec = buildFecExport(invoices)
      await mkdir(dirname(outputPath), { recursive: true })
      await atomicWrite(outputPath, `${fec}\r\n`)
      return { canceled: false, outputPath, invoiceCount: invoices.length }
    },

    resolveDocumentAbsolutePath: async (invoiceUuid): Promise<InvoiceArtifactResult> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceUuid)
      if (!found) {
        throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
      }
      if (!found.generatedDocumentPath) {
        throw new InvoiceServiceError(
          IpcErrorCode.NOT_FOUND,
          'No document was generated for this invoice.'
        )
      }
      const absolute = join(domainPath, found.generatedDocumentPath)
      if (!(await pathExists(absolute))) {
        throw new InvoiceServiceError(
          IpcErrorCode.NOT_FOUND,
          'Invoice document file is missing on disk.'
        )
      }
      const storedHash = found.documentHashes?.docxSha256
      if (!storedHash) {
        return { absolutePath: absolute, integrity: 'unknown' }
      }
      const currentHash = await sha256OfFile(absolute)
      return {
        absolutePath: absolute,
        integrity: currentHash === storedHash ? 'ok' : 'modified'
      }
    },

    resolvePdfAbsolutePath: async (invoiceUuid): Promise<InvoiceArtifactResult> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceUuid)
      if (!found) {
        throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
      }
      // PDF lives next to the DOCX (same basename, .pdf extension). When the
      // invoice was generated without a DOCX path (legacy / errored), fall
      // back to a stable name in the invoice documents folder so we still get
      // a deterministic path.
      const baseName = sanitizeInvoiceDocumentBaseName(found.number)
      const docxAbsolutePath = found.generatedDocumentPath
        ? join(domainPath, found.generatedDocumentPath)
        : undefined
      const pdfPath = docxAbsolutePath
        ? docxAbsolutePath.replace(/\.docx$/i, '.pdf')
        : join(getDomainInvoiceDocumentsPath(domainPath), `${baseName}.pdf`)
      const storedPdfHash = found.documentHashes?.pdfSha256
      const storedDocxHash = found.documentHashes?.docxSha256

      // 1. PDF already on disk → verify integrity against the hash captured
      //    at issuance. We never overwrite a cached PDF — even a mismatch is
      //    surfaced as `modified`, not "fix it for me".
      if (await pathExists(pdfPath)) {
        if (!storedPdfHash) {
          return { absolutePath: pdfPath, integrity: 'unknown' }
        }
        const currentHash = await sha256OfFile(pdfPath)
        return {
          absolutePath: pdfPath,
          integrity: currentHash === storedPdfHash ? 'ok' : 'modified'
        }
      }

      // 2. PDF missing → we must regenerate. Don't trust the DOCX unless its
      //    own hash is intact: a tampered DOCX would silently leak into the
      //    "replacement" PDF. The safe fallback is to re-render from the
      //    immutable JSON record (generic layout but contractually correct).
      //    Legacy invoices (DOCX without a stored hash) still get the
      //    template-faithful render, flagged as `unknown`.
      await mkdir(dirname(pdfPath), { recursive: true })
      let useDocx = false
      if (docxAbsolutePath && (await pathExists(docxAbsolutePath))) {
        useDocx = storedDocxHash ? (await sha256OfFile(docxAbsolutePath)) === storedDocxHash : true
      }
      try {
        if (useDocx) {
          if (!docxToPdf) {
            throw new InvoiceServiceError(
              IpcErrorCode.FILE_SYSTEM_ERROR,
              'PDF rendering is not available.'
            )
          }
          await docxToPdf(docxAbsolutePath!, pdfPath)
        } else {
          if (!printHtmlToPdf) {
            throw new InvoiceServiceError(
              IpcErrorCode.FILE_SYSTEM_ERROR,
              'PDF rendering is not available.'
            )
          }
          await printHtmlToPdf(buildInvoiceHtml(found), pdfPath)
        }
      } catch (error) {
        if (error instanceof InvoiceServiceError) throw error
        throw new InvoiceServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          `Génération du PDF échouée : ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return {
        absolutePath: pdfPath,
        integrity: storedPdfHash ? 'regenerated' : 'unknown'
      }
    }
  }
}
