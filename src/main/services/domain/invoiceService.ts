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
  DEFAULT_INVOICE_SETTINGS
} from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import { consumeNextInvoiceNumber } from '@shared/domain/invoiceNumbering'
import {
  buildInvoiceTemplateInputFromBillingItems,
  buildInvoiceTemplateInputFromRecord
} from './invoiceTemplateInput'
import { buildInvoiceHtml, buildInvoiceHtmlFromDocx } from './invoicePdfRenderer'
import {
  cabinetBillingCatalogSchema,
  invoiceIndexSchema,
  invoiceRecordSchema
} from '@shared/validation'
import type { InvoiceIndex, InvoiceIndexEntry } from '@shared/validation'
import {
  loadAllRecords,
  loadIndex,
  loadRecord,
  saveIndex,
  saveRecord
} from '../../lib/system/perFileStore'

import {
  getDomainCabinetBillingPath,
  getDomainInvoiceDocumentsPath,
  getDomainInvoiceIndexPath,
  getDomainInvoiceRecordPath,
  getDomainInvoiceRecordsDirectoryPath
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'
import type { ContactService } from './contactService'
import type { DossierRegistryService } from './dossierRegistryService'
import type { GenerateService } from './generateService'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface InvoiceService {
  list(): Promise<InvoiceRecord[]>
  get(invoiceId: string): Promise<InvoiceRecord>
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
  exportCsv(input: InvoiceExportCsvInput): Promise<InvoiceExportCsvResult>
  /**
   * Resolves the DOCX path for an issued invoice and reports its integrity
   * (hash match against the value captured at issuance). The DOCX is the
   * editable working copy — its content may have drifted from the original
   * artifact and the integrity field surfaces that to the UI.
   */
  resolveDocumentAbsolutePath(invoiceId: string): Promise<InvoiceArtifactResult>
  /**
   * Resolves the PDF path for an issued invoice and reports its integrity.
   * The PDF is the frozen contractual artifact — eagerly generated at
   * issuance from the DOCX (template-faithful), hashed, and never silently
   * regenerated. If the file is missing on disk, a replacement is rendered
   * from the immutable record (template fidelity may drift) and the
   * integrity is reported as `regenerated`. Requires a `printHtmlToPdf`
   * injection to render replacements.
   */
  resolvePdfAbsolutePath(invoiceId: string): Promise<InvoiceArtifactResult>
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

export interface InvoiceServiceOptions {
  domainService: DomainServiceLike
  dossierRegistryService: DossierRegistryService
  generateService: GenerateService
  contactService: ContactService
  /**
   * Renders an HTML string to a PDF written at `outputPath`. Optional; when
   * absent, `resolvePdfAbsolutePath` throws. Wired by the container using
   * Electron's BrowserWindow + webContents.printToPDF.
   */
  printHtmlToPdf?: (html: string, outputPath: string) => Promise<void>
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
  return {
    ...settings,
    nextSequence: nextSettings.nextSequence,
    currentSequenceYear: nextSettings.currentSequenceYear
  }
}

function invoiceRef(record: InvoiceRecord): InvoiceOriginalRef {
  return { id: record.id, number: record.number, issuedAt: record.issuedAt }
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
 * The PDF render is best-effort: if `printHtmlToPdf` is not wired (e.g. in
 * tests), only the DOCX hash is captured and the PDF will be generated
 * lazily on first open (still verified against this hash once produced).
 */
async function freezeIssuedArtifacts(args: {
  docxAbsolutePath: string
  pdfAbsolutePath: string
  invoiceNumber: string
  printHtmlToPdf?: (html: string, outputPath: string) => Promise<void>
}): Promise<FreezeArtifactsResult> {
  const result: FreezeArtifactsResult = {}
  try {
    result.docxSha256 = await sha256OfFile(args.docxAbsolutePath)
  } catch {
    // DOCX not on disk (test mocks, atypical generator). Integrity will be
    // reported as 'unknown' on later opens — but issuance itself succeeds.
    return result
  }
  if (args.printHtmlToPdf) {
    try {
      await mkdir(dirname(args.pdfAbsolutePath), { recursive: true })
      const html = await buildInvoiceHtmlFromDocx(args.docxAbsolutePath, args.invoiceNumber)
      await args.printHtmlToPdf(html, args.pdfAbsolutePath)
      result.pdfSha256 = await sha256OfFile(args.pdfAbsolutePath)
      result.pdfAbsolutePath = args.pdfAbsolutePath
      await makeReadOnlyBestEffort(args.pdfAbsolutePath)
    } catch {
      // Eager PDF generation failed (mammoth conversion, write error, …).
      // Don't fail issuance — the DOCX is the legal record. PDF can be
      // regenerated lazily later from `buildInvoiceHtml(record)`.
    }
  }
  await makeReadOnlyBestEffort(args.docxAbsolutePath)
  return result
}

export function createInvoiceService(options: InvoiceServiceOptions): InvoiceService {
  const { domainService, dossierRegistryService, generateService, contactService } = options
  const printHtmlToPdf = options.printHtmlToPdf
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

  const EMPTY_INVOICE_INDEX: InvoiceIndex = { invoices: [], updatedAt: now().toISOString() }

  async function loadInvoiceIndex(domainPath: string): Promise<InvoiceIndex> {
    return loadIndex(
      getDomainInvoiceIndexPath(domainPath),
      invoiceIndexSchema,
      EMPTY_INVOICE_INDEX,
      () => {
        throw new InvoiceServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Stored invoice index is invalid.'
        )
      }
    )
  }

  async function saveInvoiceIndex(domainPath: string, index: InvoiceIndex): Promise<void> {
    return saveIndex(getDomainInvoiceIndexPath(domainPath), index)
  }

  async function loadInvoiceRecord(domainPath: string, id: string): Promise<InvoiceRecord | null> {
    return loadRecord(getDomainInvoiceRecordPath(domainPath, id), invoiceRecordSchema)
  }

  async function saveInvoiceRecord(domainPath: string, record: InvoiceRecord): Promise<void> {
    return saveRecord(
      getDomainInvoiceRecordsDirectoryPath(domainPath),
      getDomainInvoiceRecordPath(domainPath, record.id),
      record
    )
  }

  async function updateIndexEntry(
    domainPath: string,
    record: InvoiceRecord,
    op: 'upsert' | 'remove' = 'upsert'
  ): Promise<void> {
    const index = await loadInvoiceIndex(domainPath)
    const entry: InvoiceIndexEntry = {
      id: record.id,
      number: record.number,
      dossierId: record.dossierId,
      status: record.status,
      paymentStatus: record.paymentStatus,
      totalTtcCents: record.totalTtcCents,
      documentType: record.documentType,
      issuedAt: record.issuedAt,
      updatedAt: record.updatedAt
    }
    const filtered = index.invoices.filter((e) => e.id !== record.id)
    await saveInvoiceIndex(domainPath, {
      ...index,
      invoices: op === 'upsert' ? [...filtered, entry] : filtered,
      updatedAt: now().toISOString()
    })
  }

  async function loadAllInvoiceRecords(domainPath: string): Promise<InvoiceRecord[]> {
    return loadAllRecords(getDomainInvoiceRecordsDirectoryPath(domainPath), invoiceRecordSchema)
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
      ...(patch.defaultTemplateId !== undefined
        ? { defaultTemplateId: patch.defaultTemplateId ?? undefined }
        : {}),
      ...(patch.defaultCreditNoteTemplateId !== undefined
        ? { defaultCreditNoteTemplateId: patch.defaultCreditNoteTemplateId ?? undefined }
        : {}),
      ...(patch.defaultCorrectiveInvoiceTemplateId !== undefined
        ? {
            defaultCorrectiveInvoiceTemplateId:
              patch.defaultCorrectiveInvoiceTemplateId ?? undefined
          }
        : {}),
      ...(patch.issuerName !== undefined ? { issuerName: patch.issuerName ?? undefined } : {}),
      ...(patch.issuerAddress !== undefined
        ? { issuerAddress: patch.issuerAddress ?? undefined }
        : {}),
      ...(patch.issuerSiret !== undefined ? { issuerSiret: patch.issuerSiret ?? undefined } : {}),
      ...(patch.issuerVatNumber !== undefined
        ? { issuerVatNumber: patch.issuerVatNumber ?? undefined }
        : {}),
      ...(patch.issuerIban !== undefined ? { issuerIban: patch.issuerIban ?? undefined } : {}),
      ...(patch.legalFooter !== undefined ? { legalFooter: patch.legalFooter ?? undefined } : {})
    }
  }

  return {
    list: async (): Promise<InvoiceRecord[]> => {
      const domainPath = await resolveDomainPath()
      const records = await loadAllInvoiceRecords(domainPath)
      return records.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    },

    get: async (invoiceId): Promise<InvoiceRecord> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceId)
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

        const items = input.billingItemIds.map((id) => {
          const found = dossier.billingItems.find((entry) => entry.id === id)
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

        const catalog = await loadCatalog(domainPath)
        const settings = getSettingsFromCatalog(catalog)
        const issuedAtDate = input.issuedAt ? new Date(input.issuedAt) : now()
        if (isNaN(issuedAtDate.getTime())) {
          throw new InvoiceServiceError(IpcErrorCode.VALIDATION_FAILED, "Date d'émission invalide.")
        }
        const issuedAtIso = issuedAtDate.toISOString().slice(0, 10)

        let resolved
        try {
          resolved = consumeNextInvoiceNumber(
            getSettingsForDocumentType(settings, 'invoice'),
            issuedAtDate
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
        const clientLabel = clientContact ? computeContactDisplayName(clientContact) : undefined
        const issuerSnapshot: InvoicePartySnapshot = {
          name: settings.issuerName,
          address: settings.issuerAddress,
          siret: settings.issuerSiret,
          vatNumber: settings.issuerVatNumber,
          iban: settings.issuerIban,
          legalFooter: settings.legalFooter
        }
        const clientSnapshot: InvoicePartySnapshot | undefined = clientContact
          ? {
              name: clientLabel,
              address: [clientContact.addressLine, clientContact.addressLine2]
                .filter((part): part is string => Boolean(part && part.trim()))
                .join('\n')
            }
          : undefined

        const lines: InvoiceLine[] = items.map((item) => ({
          billingItemId: item.id,
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

        const invoiceId = randomUUID()
        const nowIso = now().toISOString()
        const invoiceDocumentPath = await resolveInvoiceDocumentPath(domainPath, resolved.number)

        const record: InvoiceRecord = {
          id: invoiceId,
          documentType: 'invoice',
          number: resolved.number,
          sequenceYear: resolved.sequenceYear,
          sequenceValue: resolved.sequenceValue,
          issuedAt: issuedAtIso,
          dossierId: input.dossierId,
          dossierLabel: dossier.name,
          clientContactUuid: clientContact?.uuid,
          clientLabel,
          clientSnapshot,
          issuerSnapshot,
          templateId: input.templateId,
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
            templateId: input.templateId,
            outputPath: invoiceDocumentPath,
            filename: resolved.number,
            tagOverrides: input.tagOverrides,
            primaryContactId: input.primaryContactId,
            contactRoleOverrides: input.contactRoleOverrides,
            invoiceContext: buildInvoiceTemplateInputFromBillingItems({
              items,
              dossier,
              contacts,
              settings: resolved.nextSettings,
              number: resolved.number,
              issuedAt: issuedAtIso,
              notes: input.notes,
              documentType: 'invoice',
              originalInvoiceRefs: [],
              paymentTerms: settings.defaultPaymentTerms,
              dueAt: undefined,
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
            invoiceNumber: record.number,
            printHtmlToPdf
          })
          record.documentHashes = {
            docxSha256: frozen.docxSha256,
            pdfSha256: frozen.pdfSha256
          }
        }

        // Persist settings (consume sequence), invoice record, default template,
        // and mark billing items as invoiced. Order matters: if any of these fail
        // after the doc has been generated we still want a coherent state.
        const nextSettings: InvoiceSettings = input.rememberTemplateAsDefault
          ? {
              ...applyResolvedSettingsForDocumentType(settings, 'invoice', resolved.nextSettings),
              defaultTemplateId: input.templateId
            }
          : applyResolvedSettingsForDocumentType(settings, 'invoice', resolved.nextSettings)
        const nextCatalog: CabinetBillingCatalog = {
          ...catalog,
          invoiceSettings: nextSettings,
          updatedAt: now().toISOString()
        }
        await saveCatalog(domainPath, nextCatalog)

        await saveInvoiceRecord(domainPath, record)
        await updateIndexEntry(domainPath, record)

        await dossierRegistryService.markBillingItemsInvoiced({
          dossierId: input.dossierId,
          billingItemIds: items.map((item) => item.id),
          invoiceId: record.id,
          invoiceNumber: record.number
        })

        return record
      })
    },

    cancel: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceId)
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
        await updateIndexEntry(domainPath, updated)
        return updated
      })
    },

    markPaid: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceId)
        if (!found) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        }
        const existingPaid = found.payments.reduce((acc, payment) => acc + payment.amountCents, 0)
        const remaining = Math.max(0, found.totalTtcCents - existingPaid)
        if (remaining <= 0) return applyPaymentState(found)
        const nowIso = now().toISOString()
        const payment: InvoicePayment = {
          id: randomUUID(),
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
        await updateIndexEntry(domainPath, updated)
        return updated
      })
    },

    createCreditNote: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const original = await loadInvoiceRecord(domainPath, input.originalInvoiceId)
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
        const resolved = consumeNextInvoiceNumber(
          getSettingsForDocumentType(settings, 'creditNote'),
          issuedAtDate
        )

        const creditSpecs = new Map(
          (input.lineCredits ?? []).map((line) => [line.billingItemId, line])
        )
        const sourceLines = input.lineCredits
          ? original.lines.filter((line) => creditSpecs.has(line.billingItemId))
          : original.lines
        if (sourceLines.length === 0) {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'At least one invoice line must be credited.'
          )
        }
        const lines: InvoiceLine[] = sourceLines.map((line) => {
          const spec = creditSpecs.get(line.billingItemId)
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
          const totalTtcCents = Math.round(totalHtCents * (1 + line.vatRateBasisPoints / 10_000))
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
        const record: InvoiceRecord = {
          id: randomUUID(),
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
          issuerSnapshot: original.issuerSnapshot ?? {
            name: settings.issuerName,
            address: settings.issuerAddress,
            siret: settings.issuerSiret,
            vatNumber: settings.issuerVatNumber,
            iban: settings.issuerIban,
            legalFooter: settings.legalFooter
          },
          templateId: input.templateId,
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
          templateId: input.templateId,
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
            invoiceNumber: record.number,
            printHtmlToPdf
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
        await updateIndexEntry(domainPath, record)
        return record
      })
    },

    createCorrectiveInvoice: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const original = await loadInvoiceRecord(domainPath, input.originalInvoiceId)
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
        const items = input.billingItemIds.map((id) => {
          const found = dossier.billingItems.find((entry) => entry.id === id)
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
        const resolved = consumeNextInvoiceNumber(
          getSettingsForDocumentType(settings, 'correctiveInvoice'),
          issuedAtDate
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
        const issuerSnapshot: InvoicePartySnapshot = {
          name: settings.issuerName,
          address: settings.issuerAddress,
          siret: settings.issuerSiret,
          vatNumber: settings.issuerVatNumber,
          iban: settings.issuerIban,
          legalFooter: settings.legalFooter
        }
        const lines: InvoiceLine[] = items.map((item) => ({
          billingItemId: item.id,
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
          id: randomUUID(),
          documentType: 'correctiveInvoice',
          number: resolved.number,
          sequenceYear: resolved.sequenceYear,
          sequenceValue: resolved.sequenceValue,
          issuedAt: issuedAtIso,
          dueAt: input.dueAt,
          dossierId: input.dossierId,
          dossierLabel: dossier.name,
          clientContactUuid: original.clientContactUuid ?? clientContact?.uuid,
          clientLabel,
          clientSnapshot,
          issuerSnapshot,
          templateId: input.templateId,
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
          templateId: input.templateId,
          outputPath: invoiceDocumentPath,
          filename: resolved.number,
          tagOverrides: input.tagOverrides,
          primaryContactId: input.primaryContactId,
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
            invoiceNumber: record.number,
            printHtmlToPdf
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
        await updateIndexEntry(domainPath, correctedOriginal)
        await saveInvoiceRecord(domainPath, record)
        await updateIndexEntry(domainPath, record)
        await dossierRegistryService.markBillingItemsInvoiced({
          dossierId: input.dossierId,
          billingItemIds: items.map((item) => item.id),
          invoiceId: record.id,
          invoiceNumber: record.number
        })
        return record
      })
    },

    addPayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceId)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        if (found.documentType === 'creditNote') {
          throw new InvoiceServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Credit notes are not payable.'
          )
        }
        const nowIso = now().toISOString()
        const payment: InvoicePayment = {
          id: randomUUID(),
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
        await updateIndexEntry(domainPath, updated)
        return updated
      })
    },

    updatePayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceId)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        if (!found.payments.some((payment) => payment.id === input.paymentId)) {
          throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Payment was not found.')
        }
        const nowIso = now().toISOString()
        const updated = applyPaymentState({
          ...found,
          payments: found.payments.map((payment) =>
            payment.id === input.paymentId
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
        await updateIndexEntry(domainPath, updated)
        return updated
      })
    },

    deletePayment: async (input): Promise<InvoiceRecord> => {
      return withLock(async () => {
        const domainPath = await resolveDomainPath()
        const found = await loadInvoiceRecord(domainPath, input.invoiceId)
        if (!found) throw new InvoiceServiceError(IpcErrorCode.NOT_FOUND, 'Invoice was not found.')
        const nowIso = now().toISOString()
        const updated = applyPaymentState({
          ...found,
          payments: found.payments.filter((payment) => payment.id !== input.paymentId),
          updatedAt: nowIso
        })
        await saveInvoiceRecord(domainPath, updated)
        await updateIndexEntry(domainPath, updated)
        return updated
      })
    },

    exportCsv: async (input): Promise<InvoiceExportCsvResult> => {
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
      const directory = getDomainInvoiceDocumentsPath(domainPath)
      await mkdir(directory, { recursive: true })
      const filename = `export-facturation-${now().toISOString().slice(0, 10)}.csv`
      const outputPath = join(directory, filename)
      await atomicWrite(outputPath, `${csv}\n`)
      return {
        outputPath,
        relativePath: toPortableRelativePath(domainPath, outputPath),
        invoiceCount: invoices.length
      }
    },

    resolveDocumentAbsolutePath: async (invoiceId): Promise<InvoiceArtifactResult> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceId)
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

    resolvePdfAbsolutePath: async (invoiceId): Promise<InvoiceArtifactResult> => {
      const domainPath = await resolveDomainPath()
      const found = await loadInvoiceRecord(domainPath, invoiceId)
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
      if (!printHtmlToPdf) {
        throw new InvoiceServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          'PDF rendering is not available.'
        )
      }
      await mkdir(dirname(pdfPath), { recursive: true })
      let html: string
      if (docxAbsolutePath && (await pathExists(docxAbsolutePath)) && storedDocxHash) {
        const docxCurrentHash = await sha256OfFile(docxAbsolutePath)
        html =
          docxCurrentHash === storedDocxHash
            ? await buildInvoiceHtmlFromDocx(docxAbsolutePath, found.number)
            : buildInvoiceHtml(found)
      } else if (docxAbsolutePath && (await pathExists(docxAbsolutePath)) && !storedDocxHash) {
        // Legacy invoice (no hash) — give the user the template-faithful
        // render but flag the result as `unknown`.
        html = await buildInvoiceHtmlFromDocx(docxAbsolutePath, found.number)
      } else {
        html = buildInvoiceHtml(found)
      }
      try {
        await printHtmlToPdf(html, pdfPath)
      } catch (error) {
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
