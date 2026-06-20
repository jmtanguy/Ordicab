/**
 * dataToolExecutor — handles all data tool calls within the AI agent loop.
 *
 * Data tools are intermediate tools whose results are fed back to the LLM.
 * This module owns:
 *   - The dispatch table (one handler per tool name)
 *   - Helpers used exclusively by data tool handlers
 *   - The call history (used later by text_generate prompt building)
 *
 * Called by: aiService (via DataToolExecutor.execute())
 */
import { join } from 'node:path'

import type { ContactRecord, DocumentRecord, DossierSummary } from '@shared/types'
import {
  JUDILIBRE_JURISDICTION_VALUES,
  JUDILIBRE_SORT_VALUES,
  LEGIFRANCE_FIELD_VALUES,
  LEGIFRANCE_FOND_VALUES,
  LEGIFRANCE_SEARCH_TYPE_VALUES,
  LEGIFRANCE_SORT_VALUES,
  type JudilibreJurisdiction,
  type JudilibreSort,
  type LegifranceField,
  type LegifranceFond,
  type LegifranceSearchType,
  type LegifranceSort
} from '@shared/types'
import type { EntityProfile } from '@shared/validation/entity'
import {
  getContactManagedFieldValue,
  getManagedFieldKey,
  normalizeManagedFieldsConfig
} from '@shared/managedFields'
import { roleToTagKey } from '@shared/contactRoles'

import type {
  ContactServiceLike,
  TemplateServiceLike,
  DocumentServiceLike,
  DossierServiceLike,
  InvoiceServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import type { LegalService } from '../legal/legalService'

// ── Service interfaces ────────────────────────────────────────────────────────
// All service interfaces (DocumentServiceLike, DossierServiceLike, etc.) are imported from aiCommandDispatcher

// ── Types ─────────────────────────────────────────────────────────────────────

type NoteKindArg = 'note' | 'todo' | 'idea' | 'to_verify' | 'ai_log'
type NoteStatusArg = 'open' | 'done'

export interface DataToolHistoryEntry {
  toolName: string
  args: Record<string, unknown>
  result: string
  toolCallId: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOCUMENT_LIST_TOOL_MAX_CHARS = 12_000

function formatEurosFromCents(cents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(cents / 100)
}

function addEuroDisplayFields(out: Record<string, unknown>, key: string, cents: number): void {
  const stem = key.slice(0, -'Cents'.length)
  const formatted = formatEurosFromCents(cents)
  out[`${stem}Euros`] = formatted
  out[`${stem}Display`] = formatted
}

function enrichMoneyFieldsForAi(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => enrichMoneyFieldsForAi(item))
  if (!isJsonRecord(value)) return value

  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = enrichMoneyFieldsForAi(child)
    if (key.endsWith('Cents') && typeof child === 'number') {
      addEuroDisplayFields(out, key, child)
    }
  }

  if (
    typeof out.totalHtCents === 'number' &&
    typeof out.totalTtcCents === 'number' &&
    typeof out.totalVatCents !== 'number'
  ) {
    const totalVatCents = Math.max(0, out.totalTtcCents - out.totalHtCents)
    out.totalVatCents = totalVatCents
    addEuroDisplayFields(out, 'totalVatCents', totalVatCents)
  }

  return out
}

type MoneySummary = {
  count: number
  totalHtCents: number
  totalVatCents: number
  totalTtcCents: number
}

type InvoiceMoneySummary = MoneySummary & {
  paidAmountCents: number
  remainingAmountCents: number
}

function emptyMoneySummary(): MoneySummary {
  return {
    count: 0,
    totalHtCents: 0,
    totalVatCents: 0,
    totalTtcCents: 0
  }
}

function emptyInvoiceMoneySummary(): InvoiceMoneySummary {
  return {
    ...emptyMoneySummary(),
    paidAmountCents: 0,
    remainingAmountCents: 0
  }
}

function addMoney(summary: MoneySummary, source: Record<string, unknown>): void {
  const totalHtCents = typeof source.totalHtCents === 'number' ? source.totalHtCents : 0
  const totalTtcCents = typeof source.totalTtcCents === 'number' ? source.totalTtcCents : 0
  const totalVatCents =
    typeof source.totalVatCents === 'number'
      ? source.totalVatCents
      : Math.max(0, totalTtcCents - totalHtCents)

  summary.count += 1
  summary.totalHtCents += totalHtCents
  summary.totalVatCents += totalVatCents
  summary.totalTtcCents += totalTtcCents
}

function addInvoiceMoney(summary: InvoiceMoneySummary, source: Record<string, unknown>): void {
  addMoney(summary, source)
  summary.paidAmountCents += typeof source.paidAmountCents === 'number' ? source.paidAmountCents : 0
  summary.remainingAmountCents +=
    typeof source.remainingAmountCents === 'number' ? source.remainingAmountCents : 0
}

function buildDossierFinancialSummary(
  billingItems: unknown[],
  invoices: unknown[]
): Record<string, unknown> {
  const billingByStatus = {
    draft: emptyMoneySummary(),
    billed: emptyMoneySummary(),
    cancelled: emptyMoneySummary()
  }
  const billingTotal = emptyMoneySummary()

  for (const item of billingItems) {
    if (!isJsonRecord(item)) continue
    addMoney(billingTotal, item)
    const status = typeof item.status === 'string' ? item.status : ''
    if (status === 'draft' || status === 'billed' || status === 'cancelled') {
      addMoney(billingByStatus[status], item)
    }
  }

  const invoicesByStatus: Record<string, InvoiceMoneySummary> = {}
  const invoicesByPaymentStatus: Record<string, InvoiceMoneySummary> = {}
  const invoiceTotal = emptyInvoiceMoneySummary()

  for (const invoice of invoices) {
    if (!isJsonRecord(invoice)) continue
    addInvoiceMoney(invoiceTotal, invoice)

    const status = typeof invoice.status === 'string' ? invoice.status : 'unknown'
    invoicesByStatus[status] ??= emptyInvoiceMoneySummary()
    addInvoiceMoney(invoicesByStatus[status], invoice)

    const paymentStatus =
      typeof invoice.paymentStatus === 'string' ? invoice.paymentStatus : 'unknown'
    invoicesByPaymentStatus[paymentStatus] ??= emptyInvoiceMoneySummary()
    addInvoiceMoney(invoicesByPaymentStatus[paymentStatus], invoice)
  }

  return {
    billingItems: {
      totals: billingTotal,
      byStatus: billingByStatus,
      unbilled: billingByStatus.draft,
      billed: billingByStatus.billed
    },
    invoices: {
      totals: invoiceTotal,
      byStatus: invoicesByStatus,
      byPaymentStatus: invoicesByPaymentStatus
    },
    totals: {
      unbilledHtCents: billingByStatus.draft.totalHtCents,
      unbilledVatCents: billingByStatus.draft.totalVatCents,
      unbilledTtcCents: billingByStatus.draft.totalTtcCents,
      invoicedHtCents: invoiceTotal.totalHtCents,
      invoicedVatCents: invoiceTotal.totalVatCents,
      invoicedTtcCents: invoiceTotal.totalTtcCents,
      paidAmountCents: invoiceTotal.paidAmountCents,
      remainingAmountCents: invoiceTotal.remainingAmountCents
    }
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldKeepStructuralEntityField(key: string): boolean {
  return key === 'id' || key === 'uuid' || key.endsWith('Uuid')
}

async function pseudonymizeNestedStringsAsync(
  value: unknown,
  pseudonymize: (s: string) => Promise<string>,
  preserveStructuralIds = false
): Promise<unknown> {
  if (typeof value === 'string') return value.length > 0 ? pseudonymize(value) : value
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => pseudonymizeNestedStringsAsync(item, pseudonymize)))
  }
  if (!isJsonRecord(value)) return value

  const out: Record<string, unknown> = { ...value }
  for (const [key, child] of Object.entries(out)) {
    if (preserveStructuralIds && shouldKeepStructuralEntityField(key)) continue
    out[key] = await pseudonymizeNestedStringsAsync(child, pseudonymize)
  }
  return out
}

export function resolveDossierRef(
  ref: string | undefined,
  dossiers: DossierSummary[]
): string | undefined {
  if (!ref) return undefined
  const normalized = ref.trim().toLowerCase()
  if (!normalized) return undefined
  return (
    dossiers.find((d) => d.slug === ref || d.uuid === ref)?.slug ??
    dossiers.find(
      (d) => d.slug.toLowerCase() === normalized || d.uuid?.toLowerCase() === normalized
    )?.slug
  )
}

function buildManagedFieldsToolResult(entityProfile: EntityProfile | null): string {
  const managedFields = normalizeManagedFieldsConfig(entityProfile?.managedFields)
  const contactFieldMap = new Map(
    managedFields.contacts.map((field) => [getManagedFieldKey(field), field])
  )
  const defaultContactFieldKeys = managedFields.contacts.map((field) => getManagedFieldKey(field))
  const roleSpecificFieldEntries = managedFields.contactRoles.flatMap((role) => {
    const roleFieldKeys = managedFields.contactRoleFields[roleToTagKey(role)] ?? []
    if (roleFieldKeys.length === 0) return []

    const hasSameFieldsAsDefault =
      roleFieldKeys.length === defaultContactFieldKeys.length &&
      roleFieldKeys.every((fieldKey, index) => fieldKey === defaultContactFieldKeys[index])

    if (hasSameFieldsAsDefault) return []

    const roleFields = roleFieldKeys
      .map((fieldKey) => contactFieldMap.get(fieldKey))
      .filter((field): field is NonNullable<typeof field> => Boolean(field))
      .map((field) => ({ label: field.label, type: field.type }))

    if (roleFields.length === 0) return []
    return [[role, roleFields] as const]
  })

  return JSON.stringify({
    managedFields: {
      contactRoles: managedFields.contactRoles,
      contactFields: managedFields.contacts.map((field) => ({
        label: field.label,
        type: field.type
      })),
      keyDateFields: managedFields.keyDates.map((field) => ({
        label: field.label,
        type: field.type
      })),
      keyReferenceFields: managedFields.keyReferences.map((field) => ({
        label: field.label,
        type: field.type
      })),
      ...(roleSpecificFieldEntries.length > 0
        ? { contactRoleFields: Object.fromEntries(roleSpecificFieldEntries) }
        : {})
    }
  })
}

function buildEntityProfileToolResult(entityProfile: EntityProfile | null): string {
  if (!entityProfile) {
    return JSON.stringify({ entity: null })
  }

  return JSON.stringify({
    entity: {
      firmName: entityProfile.firmName,
      gender: entityProfile.gender ?? null,
      firstName: entityProfile.firstName ?? null,
      lastName: entityProfile.lastName ?? null,
      addressLine: entityProfile.addressLine ?? null,
      addressLine2: entityProfile.addressLine2 ?? null,
      zipCode: entityProfile.zipCode ?? null,
      city: entityProfile.city ?? null,
      country: entityProfile.country ?? null,
      address: entityProfile.address ?? null,
      vatNumber: entityProfile.vatNumber ?? null,
      phone: entityProfile.phone ?? null,
      email: entityProfile.email ?? null
    }
  })
}

function buildDocumentListToolResult(documents: DocumentRecord[]): string {
  const summarized = documents.map((doc) => ({
    documentUuid: doc.uuid,
    filename: doc.filename,
    modifiedAt: doc.modifiedAt,
    hasMetadata: !!(doc.description || doc.tags.length > 0)
  }))

  const fullResult = JSON.stringify({ documents: summarized })
  if (fullResult.length <= DOCUMENT_LIST_TOOL_MAX_CHARS) return fullResult

  const truncatedDocuments: Array<{
    documentUuid: string
    filename: string
    modifiedAt: string
    hasMetadata: boolean
  }> = []

  for (const doc of summarized) {
    const candidate = JSON.stringify({
      warning: `document_list truncated to ${truncatedDocuments.length + 1}/${summarized.length} documents to fit the provider context window`,
      totalDocuments: summarized.length,
      documents: [...truncatedDocuments, doc]
    })
    if (candidate.length > DOCUMENT_LIST_TOOL_MAX_CHARS) break
    truncatedDocuments.push(doc)
  }

  return JSON.stringify({
    warning: `document_list truncated to ${truncatedDocuments.length}/${summarized.length} documents to fit the provider context window`,
    totalDocuments: summarized.length,
    documents: truncatedDocuments
  })
}

/**
 * Pseudonymize the result of a batchable action tool (contact_create, contact_update, contact_delete, etc.)
 * before feeding it back to the LLM.
 *
 * Only human-readable strings are pseudonymized.
 * Structural fields (success, contactUuid, dossierId, templateUuid, entity.id/uuid) are UUIDs
 * or booleans that must round-trip verbatim so the LLM can reference them in subsequent calls.
 */
export async function pseudonymizeActionToolResultAsync(
  jsonResult: string,
  pseudonymize: (s: string) => Promise<string>
): Promise<string> {
  try {
    const parsed = JSON.parse(jsonResult) as unknown
    if (typeof parsed !== 'object' || parsed === null) return jsonResult
    const obj = parsed as Record<string, unknown>
    if (typeof obj.feedback === 'string') {
      obj.feedback = await pseudonymize(obj.feedback)
    }
    // contact_create/contact_update (and similar) may return `entity` with real saved values,
    // including nested `customFields` / arrays. Pseudonymize every nested string
    // so the tool result can safely be fed back to the LLM. Keep only entity
    // `id` / `uuid` / `*Uuid` cross-references verbatim: those are structural handles needed by later tool
    // calls, and changing them would break round-trip behavior.
    if (isJsonRecord(obj.entity)) {
      obj.entity = await pseudonymizeNestedStringsAsync(obj.entity, pseudonymize, true)
    }
    return JSON.stringify(obj)
  } catch {
    // fall through
  }
  return jsonResult
}

/**
 * Pseudonymize the result of document_analyze before feeding it back to the LLM.
 * Shape: { uuid, rawContent, totalChars, charsReturned } or { error }.
 * Only free-text fields (`rawContent`, `error`) are pseudonymized; `uuid` must
 * round-trip verbatim so the LLM can reuse it in subsequent calls.
 */
export async function pseudonymizeAnalyzeToolResultAsync(
  jsonResult: string,
  pseudonymize: (s: string) => Promise<string>
): Promise<string> {
  try {
    const parsed = JSON.parse(jsonResult) as unknown
    if (typeof parsed !== 'object' || parsed === null) return jsonResult
    const obj = parsed as Record<string, unknown>
    if (typeof obj.rawContent === 'string') {
      obj.rawContent = await pseudonymize(obj.rawContent)
    }
    if (typeof obj.error === 'string') {
      obj.error = await pseudonymize(obj.error)
    }
    return JSON.stringify(obj)
  } catch {
    // fall through
  }
  return jsonResult
}

/**
 * Pseudonymize the result of template_list before feeding it back to the LLM.
 * Shape: { templates: TemplateRecord[] } where each record has structural fields
 * (id, macros[], hasDocxSource, updatedAt) and human-readable fields (name,
 * description, tags, content). The `macros` array holds template path strings
 * such as `dossier.keyDate.audience.long`; pseudonymizing those could alter
 * the keys, which the LLM then echoes back as `tagOverrides` keys in
 * `document_generate`. Keep them verbatim so paths round-trip cleanly.
 */
export async function pseudonymizeTemplateListResultAsync(
  jsonResult: string,
  pseudonymize: (s: string) => Promise<string>
): Promise<string> {
  try {
    const parsed = JSON.parse(jsonResult) as unknown
    if (typeof parsed !== 'object' || parsed === null) return jsonResult
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.templates)) {
      obj.templates = await Promise.all(
        obj.templates.map(async (t) => {
          if (typeof t !== 'object' || t === null) return t
          const tpl = t as Record<string, unknown>
          const out: Record<string, unknown> = { ...tpl }
          if (typeof out.name === 'string') out.name = await pseudonymize(out.name)
          if (typeof out.description === 'string') {
            out.description = await pseudonymize(out.description)
          }
          if (typeof out.content === 'string') out.content = await pseudonymize(out.content)
          if (Array.isArray(out.tags)) {
            out.tags = await Promise.all(
              out.tags.map((tag) =>
                typeof tag === 'string' ? pseudonymize(tag) : Promise.resolve(tag)
              )
            )
          }
          // out.macros is intentionally left as-is — see jsdoc above.
          return out
        })
      )
      return JSON.stringify(obj)
    }
  } catch {
    // fall through
  }
  return jsonResult
}

export async function pseudonymizeDocumentToolResultAsync(
  jsonResult: string,
  pseudonymize: (s: string) => Promise<string>
): Promise<string> {
  const MALFORMED_TOOL_RESULT_ERROR = JSON.stringify({
    error: 'Document tool returned a malformed result.'
  })

  async function pseudonymizeStringArrayAsync(values: unknown[]): Promise<unknown[]> {
    return Promise.all(
      values.map((value) => (typeof value === 'string' ? pseudonymize(value) : value))
    )
  }

  async function pseudonymizeFieldsAsync(
    record: Record<string, unknown>,
    options: { stringFields?: string[]; stringArrayFields?: string[] }
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { ...record }

    for (const field of options.stringFields ?? []) {
      if (typeof out[field] === 'string') {
        out[field] = await pseudonymize(out[field] as string)
      }
    }

    for (const field of options.stringArrayFields ?? []) {
      if (Array.isArray(out[field])) {
        out[field] = await pseudonymizeStringArrayAsync(out[field] as unknown[])
      }
    }

    return out
  }

  async function pseudonymizeDocumentRecordAsync(
    record: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return pseudonymizeFieldsAsync(record, {
      stringFields: ['filename', 'description'],
      stringArrayFields: ['tags']
    })
  }

  async function pseudonymizeMatchRecordAsync(
    record: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return pseudonymizeFieldsAsync(record, {
      stringFields: ['filename', 'excerpt']
    })
  }

  function isFlatDocumentToolResult(record: Record<string, unknown>): boolean {
    return (
      !Array.isArray(record.documents) &&
      !Array.isArray(record.matches) &&
      !isJsonRecord(record.document) &&
      (typeof record.filename === 'string' ||
        typeof record.description === 'string' ||
        Array.isArray(record.tags))
    )
  }

  try {
    const parsed = JSON.parse(jsonResult) as unknown
    if (!isJsonRecord(parsed)) return MALFORMED_TOOL_RESULT_ERROR

    const obj = isFlatDocumentToolResult(parsed)
      ? await pseudonymizeDocumentRecordAsync(parsed)
      : { ...parsed }

    if (typeof obj.error === 'string') {
      obj.error = await pseudonymize(obj.error)
    }
    if (typeof obj.query === 'string') {
      obj.query = await pseudonymize(obj.query)
    }
    if (Array.isArray(obj.documents)) {
      obj.documents = await Promise.all(
        obj.documents.map((document) =>
          isJsonRecord(document) ? pseudonymizeDocumentRecordAsync(document) : document
        )
      )
    }
    if (isJsonRecord(obj.document)) {
      obj.document = await pseudonymizeDocumentRecordAsync(obj.document)
    }
    if (Array.isArray(obj.matches)) {
      obj.matches = await Promise.all(
        obj.matches.map((match) =>
          isJsonRecord(match) ? pseudonymizeMatchRecordAsync(match) : match
        )
      )
    }

    return JSON.stringify(obj)
  } catch {
    return MALFORMED_TOOL_RESULT_ERROR
  }
}

// ── Contact search helpers ────────────────────────────────────────────────────

function normalizeSearchText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function splitSearchTokens(value: string | undefined): string[] {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean)
}

function buildContactSearchHaystacks(contact: ContactRecord): string[] {
  const fullName = [
    contact.title,
    contact.firstName,
    getContactManagedFieldValue(contact, 'additionalFirstNames'),
    contact.lastName
  ]
    .filter(Boolean)
    .join(' ')

  return [
    contact.uuid,
    contact.displayName,
    fullName,
    `${contact.firstName ?? ''} ${contact.lastName ?? ''}`,
    getContactManagedFieldValue(contact, 'additionalFirstNames'),
    getContactManagedFieldValue(contact, 'maidenName'),
    contact.role,
    contact.institution,
    contact.email,
    contact.phone,
    contact.information
  ]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
}

const DOCUMENT_SEARCH_MAX_HITS = 8

function enumValue<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

function isoDateValue(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function trimmedStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// Match type comes straight from the hybrid search's matchKind: 'keyword' =
// the document literally contains the query term (exact), anything else is a
// meaning-based (semantic) suggestion. We no longer infer it from the numeric
// score — keyword and vector hits now live on different score scales (word
// count vs cosine), so a score threshold would misclassify them.
function classifyDocumentSearchMatchType(matchKind: string | undefined): 'exact' | 'semantic' {
  return matchKind === 'keyword' ? 'exact' : 'semantic'
}

/**
 * Execute the hybrid document_search tool via documentService.semanticSearch
 * (which combines exact-substring matches + embedding cosine similarity, see
 * semanticSearchService.searchDossier). Diversifies results so the LLM sees
 * one best chunk per document before backfilling with additional chunks from
 * the same document, and labels each match with its confidence score.
 */
export async function runDocumentSearch(args: {
  documentService: DocumentServiceLike
  dossierId: string
  query: string
}): Promise<string> {
  const { documentService, dossierId, query } = args

  const result = await documentService.semanticSearch({
    dossierId,
    query,
    // Request a wider pool than we surface so the diversification pass has
    // material to work with — otherwise the vector side can hoard all slots
    // on a single document whose chunks all look similar to the query.
    topK: DOCUMENT_SEARCH_MAX_HITS * 2
  })

  // Order keyword (exact) hits before semantic ones — they are the reliable
  // signal — then by score within each lane. Mixing the two raw scores in one
  // numeric sort is meaningless (word-count vs cosine live on different scales).
  const laneRank = (h: (typeof result.hits)[number]): number => (h.matchKind === 'keyword' ? 0 : 1)
  const sorted = [...result.hits].sort(
    (left, right) => laneRank(left) - laneRank(right) || right.score - left.score
  )

  // First pass: one best hit per document, to show breadth across the dossier.
  const diversified: typeof sorted = []
  const alreadyIncluded = new Set<string>()
  const perDocumentCount = new Map<string, number>()
  for (const hit of sorted) {
    if (perDocumentCount.has(hit.documentPath)) continue
    perDocumentCount.set(hit.documentPath, 1)
    diversified.push(hit)
    alreadyIncluded.add(hitKey(hit))
    if (diversified.length >= DOCUMENT_SEARCH_MAX_HITS) break
  }

  // Second pass: backfill remaining slots with the next best chunks overall.
  if (diversified.length < DOCUMENT_SEARCH_MAX_HITS) {
    for (const hit of sorted) {
      if (alreadyIncluded.has(hitKey(hit))) continue
      diversified.push(hit)
      alreadyIncluded.add(hitKey(hit))
      perDocumentCount.set(hit.documentPath, (perDocumentCount.get(hit.documentPath) ?? 0) + 1)
      if (diversified.length >= DOCUMENT_SEARCH_MAX_HITS) break
    }
  }

  diversified.sort((left, right) => laneRank(left) - laneRank(right) || right.score - left.score)

  const matches = diversified.map((hit) => ({
    documentPath: hit.documentPath,
    filename: hit.filename,
    excerpt: hit.snippet,
    matchType: classifyDocumentSearchMatchType(hit.matchKind),
    // Score is a cosine similarity only for semantic hits; for keyword (exact)
    // hits it is an internal word-count, not meaningful to the model — so report
    // it only for semantic matches.
    ...(hit.matchKind === 'keyword' ? {} : { score: Number(hit.score.toFixed(3)) }),
    charStart: hit.charStart,
    charEnd: hit.charEnd,
    ...(hit.page !== undefined ? { page: hit.page } : {})
  }))

  return JSON.stringify({
    query: result.query,
    matches
  })
}

function hitKey(hit: { documentPath: string; charStart: number; charEnd: number }): string {
  return `${hit.documentPath}:${hit.charStart}:${hit.charEnd}`
}

function resolveContactRecord(
  contacts: ContactRecord[],
  rawIdentifier: unknown
): ContactRecord | undefined {
  const raw = typeof rawIdentifier === 'string' ? rawIdentifier.trim() : ''
  if (!raw) return undefined

  const normalized = normalizeSearchText(raw)
  const tokens = splitSearchTokens(raw)

  return (
    contacts.find((contact) => contact.uuid === raw) ??
    contacts.find((contact) => normalizeSearchText(contact.uuid) === normalized) ??
    contacts.find((contact) => normalizeSearchText(contact.uuid).includes(normalized)) ??
    contacts.find((contact) =>
      buildContactSearchHaystacks(contact).some(
        (haystack) => haystack === normalized || haystack.includes(normalized)
      )
    ) ??
    contacts.find((contact) =>
      buildContactSearchHaystacks(contact).some(
        (haystack) => tokens.length > 0 && tokens.every((token) => haystack.includes(token))
      )
    )
  )
}

// ── DataToolExecutor ──────────────────────────────────────────────────────────

export interface DataToolExecutorDeps {
  dossierId: string | null
  dossiers: DossierSummary[]
  contactService: ContactServiceLike
  templateService: TemplateServiceLike
  documentService: DocumentServiceLike
  dossierService: DossierServiceLike
  invoiceService: InvoiceServiceLike
  legalService?: LegalService
  entityProfile: EntityProfile | null
}

export class DataToolExecutor {
  readonly history: DataToolHistoryEntry[] = []

  constructor(private readonly deps: DataToolExecutorDeps) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    const result = await this._dispatch(toolName, args)
    this.history.push({
      toolName,
      args,
      result,
      toolCallId: `${toolName}_${this.history.length}`
    })
    return result
  }

  private _resolveTargetDossierId(args: Record<string, unknown>): string {
    const { dossierId, dossiers } = this.deps
    const requestedRef = typeof args.dossierId === 'string' ? args.dossierId : (dossierId ?? '')
    const resolved = resolveDossierRef(requestedRef, dossiers)
    if (resolved) return resolved
    // Small models routinely mistype 36-char UUIDs when echoing the active-context id
    // back into a tool call. If the requested ref doesn't match any known dossier and
    // we hold a trusted active id, fall back to it instead of silently querying with
    // a hallucinated value.
    if (dossierId && dossierId !== requestedRef) {
      return resolveDossierRef(dossierId, dossiers) ?? dossierId
    }
    return requestedRef
  }

  private async _dispatch(toolName: string, args: Record<string, unknown>): Promise<string> {
    const {
      contactService,
      templateService,
      documentService,
      dossierService,
      invoiceService,
      legalService,
      entityProfile
    } = this.deps

    if (toolName === 'entity_get') {
      return buildEntityProfileToolResult(entityProfile)
    }

    if (toolName === 'managed_fields_get') {
      return buildManagedFieldsToolResult(entityProfile)
    }

    if (toolName === 'template_list') {
      const allTemplates = await templateService.list().catch(() => [])
      return JSON.stringify({ templates: allTemplates })
    }

    if (toolName === 'dossier_list') {
      return JSON.stringify({
        dossiers: this.deps.dossiers.map((d) => ({
          dossierId: d.uuid,
          name: d.name,
          status: d.status,
          type: d.type
        }))
      })
    }

    if (toolName === 'invoice_list') {
      const rawFilterDossierId = typeof args.dossierId === 'string' ? args.dossierId.trim() : ''
      const filterDossierId = rawFilterDossierId
        ? (resolveDossierRef(rawFilterDossierId, this.deps.dossiers) ?? rawFilterDossierId)
        : ''
      const all = await invoiceService.list().catch(() => [])
      const filtered = filterDossierId
        ? all.filter((inv) => inv.dossierId === filterDossierId)
        : all
      return JSON.stringify(
        enrichMoneyFieldsForAi({
          invoices: filtered.map((inv) => ({
            invoiceUuid: inv.uuid,
            number: inv.number,
            documentType: inv.documentType,
            dossierId: inv.dossierId,
            dossierLabel: inv.dossierLabel,
            clientLabel: inv.clientLabel,
            issuedAt: inv.issuedAt,
            dueAt: inv.dueAt,
            totalTtcCents: inv.totalTtcCents,
            remainingAmountCents: inv.remainingAmountCents,
            status: inv.status,
            paymentStatus: inv.paymentStatus
          }))
        })
      )
    }

    if (toolName === 'invoice_get') {
      const invoiceUuid = typeof args.invoiceUuid === 'string' ? args.invoiceUuid.trim() : ''
      if (!invoiceUuid) return JSON.stringify({ error: 'invoiceUuid is required.' })
      const invoice = await invoiceService.get(invoiceUuid).catch(() => null)
      if (!invoice) return JSON.stringify({ error: `Invoice not found: ${invoiceUuid}` })
      return JSON.stringify(enrichMoneyFieldsForAi({ invoice }))
    }

    if (toolName === 'legal_search_legifrance') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.searchLegifrance({
          recherche: typeof args.recherche === 'string' ? args.recherche : '',
          // Leave fond/typeChamp/typeRecherche unset when the model omits them so
          // the service can auto-detect article citations (→ NUM_ARTICLE/CODE_DATE)
          // and otherwise default to a relevance UN_DES_MOTS search. Forcing 'ALL'
          // here would disable that detection.
          fond: enumValue<LegifranceFond>(LEGIFRANCE_FOND_VALUES, args.fond),
          typeChamp: enumValue<LegifranceField>(LEGIFRANCE_FIELD_VALUES, args.typeChamp),
          typeRecherche: enumValue<LegifranceSearchType>(
            LEGIFRANCE_SEARCH_TYPE_VALUES,
            args.typeRecherche
          ),
          code: typeof args.code === 'string' ? args.code : undefined,
          dateDebut: isoDateValue(args.dateDebut),
          dateFin: isoDateValue(args.dateFin),
          tri: enumValue<LegifranceSort>(LEGIFRANCE_SORT_VALUES, args.tri),
          pageTaille: typeof args.pageTaille === 'number' ? args.pageTaille : 10
        })
      )
    }

    if (toolName === 'legal_consult_legifrance') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.consultLegifrance({
          id: typeof args.id === 'string' ? args.id : ''
        })
      )
    }

    if (toolName === 'legal_search_judilibre') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.searchJudilibre({
          recherche: typeof args.recherche === 'string' ? args.recherche : undefined,
          juridiction: enumValue<JudilibreJurisdiction>(
            JUDILIBRE_JURISDICTION_VALUES,
            args.juridiction
          ),
          chambre: trimmedStringValue(args.chambre),
          theme: trimmedStringValue(args.theme),
          dateDebut: isoDateValue(args.dateDebut),
          dateFin: isoDateValue(args.dateFin),
          tri: enumValue<JudilibreSort>(JUDILIBRE_SORT_VALUES, args.tri),
          nombreResultats: typeof args.nombreResultats === 'number' ? args.nombreResultats : 10
        })
      )
    }

    if (toolName === 'legal_taxonomy_judilibre') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.taxonomyJudilibre({
          taxonomyId: trimmedStringValue(args.taxonomyId),
          contextValue: trimmedStringValue(args.contextValue),
          key: trimmedStringValue(args.key),
          value: trimmedStringValue(args.value)
        })
      )
    }

    if (toolName === 'legal_consult_judilibre') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.consultJudilibre({
          decisionId: typeof args.decisionId === 'string' ? args.decisionId : ''
        })
      )
    }

    if (toolName === 'legal_verify_references') {
      if (!legalService) return JSON.stringify({ error: 'Legal search service is unavailable.' })
      return JSON.stringify(
        await legalService.verifyReferences({
          text: typeof args.text === 'string' ? args.text : ''
        })
      )
    }

    const targetDossierId = this._resolveTargetDossierId(args)

    if (!targetDossierId) {
      return JSON.stringify({ error: 'No active dossier.' })
    }

    if (toolName === 'contact_lookup') {
      const all = await contactService.list(targetDossierId).catch(() => [] as ContactRecord[])
      return JSON.stringify({ contacts: all })
    }

    if (toolName === 'contact_get') {
      const contactUuid = typeof args.contactUuid === 'string' ? args.contactUuid : ''
      const all = await contactService.list(targetDossierId).catch(() => [] as ContactRecord[])
      const contact = resolveContactRecord(all, contactUuid)
      return contact
        ? JSON.stringify({ contact })
        : JSON.stringify({ error: `Contact not found: ${contactUuid}` })
    }

    if (toolName === 'document_list') {
      const docs = await documentService
        .listDocuments({ dossierId: targetDossierId })
        .catch(() => [] as DocumentRecord[])
      return buildDocumentListToolResult(docs)
    }

    if (toolName === 'document_get') {
      const documentUuid = typeof args.documentUuid === 'string' ? args.documentUuid : ''
      const docs = await documentService
        .listDocuments({ dossierId: targetDossierId })
        .catch(() => [] as DocumentRecord[])
      const doc = docs.find((d) => d.uuid === documentUuid || d.path === documentUuid)
      if (!doc) return JSON.stringify({ error: `Document not found: ${documentUuid}` })

      let totalChars = 0
      let totalLines = 0
      try {
        const dossierRoot = await documentService.resolveRegisteredDossierRoot({
          dossierId: targetDossierId
        })
        const absolutePath = join(dossierRoot, doc.relativePath)
        const { readCachedDocumentText } =
          await import('../../lib/aiEmbedded/documentContentService')
        const { getDossierContentCachePath } = await import('../../lib/ordicab/ordicabPaths')
        const cacheDir = getDossierContentCachePath(dossierRoot)
        const cached = await readCachedDocumentText(absolutePath, cacheDir)
        if (cached) {
          totalChars = cached.text.length
          totalLines = cached.text.split('\n').length
        }
      } catch {
        // non-fatal — stats remain 0 if text not yet extracted
      }
      return JSON.stringify({
        uuid: doc.uuid,
        filename: doc.filename,
        description: doc.description,
        tags: doc.tags,
        totalChars,
        totalLines
      })
    }

    if (toolName === 'dossier_get') {
      try {
        const detail = await dossierService.getDossier({ dossierId: targetDossierId })
        const invoices = await invoiceService.list().catch(() => [])
        const dossierInvoices = invoices.filter((invoice) => invoice.dossierId === targetDossierId)
        return JSON.stringify(
          enrichMoneyFieldsForAi({
            dossier: {
              ...detail,
              invoices: dossierInvoices,
              financialSummary: buildDossierFinancialSummary(detail.billingItems, dossierInvoices)
            }
          })
        )
      } catch {
        return JSON.stringify({ error: `Dossier not found: ${targetDossierId}` })
      }
    }

    if (toolName === 'document_search') {
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!query) return JSON.stringify({ error: 'query is required.' })

      try {
        return await runDocumentSearch({
          documentService,
          dossierId: targetDossierId,
          query
        })
      } catch (err) {
        return JSON.stringify({
          error: `document_search failed: ${err instanceof Error ? err.message : 'unknown error'}`
        })
      }
    }

    if (toolName === 'note_search') {
      // Empty query (or the "*" wildcard) is intentional: it lists ALL notes in
      // the dossier (optionally filtered by kind/status) — used for "synthèse /
      // liste des notes". A focused query runs hybrid keyword + semantic search.
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const kind = typeof args.kind === 'string' ? (args.kind as NoteKindArg) : undefined
      const status = typeof args.status === 'string' ? (args.status as NoteStatusArg) : undefined

      try {
        const hits = await dossierService.searchNotes({
          dossierId: targetDossierId,
          query,
          kind,
          status
        })
        return JSON.stringify({
          notes: hits.map((hit) => ({
            noteUuid: hit.noteUuid,
            title: hit.title,
            kind: hit.kind,
            status: hit.status,
            excerpt: hit.snippet,
            // When true, `excerpt` is only the start of the note: call note_get
            // with this noteUuid to read the full content before relying on it.
            truncated: hit.truncated === true,
            matchType: hit.matchKind === 'keyword' ? 'exact' : 'semantic'
          }))
        })
      } catch (err) {
        return JSON.stringify({
          error: `note_search failed: ${err instanceof Error ? err.message : 'unknown error'}`
        })
      }
    }

    if (toolName === 'note_get') {
      const noteUuid = typeof args.noteUuid === 'string' ? args.noteUuid.trim() : ''
      if (!noteUuid) return JSON.stringify({ error: 'noteUuid is required.' })

      try {
        // ⚠️ PERF / KNOWN DEBT: reading ONE note by id, but getDossier loads the
        // WHOLE dossier (contacts, key dates, references, billing items, fee
        // agreements…) and loadNotes() reads EVERY *.json in the notes/ dir —
        // so this is O(all notes + full dossier) to fetch a single record.
        // Fine at today's volume (a handful to a few dozen notes per dossier,
        // local disk, rare call — only when a truncated note's tail matters).
        // If notes grow to hundreds per dossier, add a targeted
        // dossierService.getNote({ dossierId, noteUuid }) that reads the single
        // file via getDossierNoteRecordPath(dossierPath, noteUuid) and call it
        // here instead — O(1 file). See dossierRegistryService.ts (saveNote
        // already uses that direct path).
        const detail = await dossierService.getDossier({ dossierId: targetDossierId })
        const note = detail.notes.find((entry) => entry.uuid === noteUuid)
        if (!note) return JSON.stringify({ error: `Note not found: ${noteUuid}` })
        return JSON.stringify({
          note: {
            noteUuid: note.uuid,
            title: note.title,
            content: note.content,
            kind: note.kind,
            status: note.status,
            tags: note.tags ?? [],
            pinned: note.pinned === true,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt
          }
        })
      } catch {
        return JSON.stringify({ error: `Dossier not found: ${targetDossierId}` })
      }
    }

    return JSON.stringify({ error: `Unknown data tool: ${toolName}` })
  }
}
