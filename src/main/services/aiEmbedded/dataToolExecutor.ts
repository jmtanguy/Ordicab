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
  DossierServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import { SEMANTIC_SEARCH_EXACT_MATCH_SCORE } from '../../lib/aiEmbedded/embeddings/semanticSearchService'

// ── Service interfaces ────────────────────────────────────────────────────────
// All service interfaces (DocumentServiceLike, DossierServiceLike, etc.) are imported from aiCommandDispatcher

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DataToolHistoryEntry {
  toolName: string
  args: Record<string, unknown>
  result: string
  toolCallId: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DOCUMENT_LIST_TOOL_MAX_CHARS = 12_000

// ── Pure helpers ──────────────────────────────────────────────────────────────

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldKeepStructuralEntityField(key: string): boolean {
  return key === 'id' || key === 'uuid'
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
    dossiers.find((d) => d.id === ref || d.uuid === ref)?.id ??
    dossiers.find((d) => d.id.toLowerCase() === normalized || d.uuid?.toLowerCase() === normalized)
      ?.id
  )
}

export function buildManagedFieldsToolResult(entityProfile: EntityProfile | null): string {
  const managedFields = normalizeManagedFieldsConfig(
    entityProfile?.managedFields,
    entityProfile?.profession
  )
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
      profession: entityProfile?.profession ?? null,
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

export function buildDocumentListToolResult(documents: DocumentRecord[]): string {
  const summarized = documents.map((doc) => ({
    documentId: doc.uuid ?? doc.id,
    filename: doc.filename,
    modifiedAt: doc.modifiedAt,
    hasMetadata: !!(doc.description || doc.tags.length > 0)
  }))

  const fullResult = JSON.stringify({ documents: summarized })
  if (fullResult.length <= DOCUMENT_LIST_TOOL_MAX_CHARS) return fullResult

  const truncatedDocuments: Array<{
    documentId: string
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
 * Pseudonymize the result of a batchable action tool (contact_upsert, contact_delete, etc.)
 * before feeding it back to the LLM.
 *
 * Only human-readable strings are pseudonymized.
 * Structural fields (success, contactId, dossierId, templateId, entity.id/uuid) are UUIDs
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
    // contact_upsert (and similar) may return `entity` with real saved values,
    // including nested `customFields` / arrays. Pseudonymize every nested string
    // so the tool result can safely be fed back to the LLM. Keep only entity
    // `id` / `uuid` verbatim: those are structural handles needed by later tool
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
 * such as `dossier.keyDate.audience.long`; pseudonymizing those would inject
 * PII markers into the keys, which the LLM then echoes back as `tagOverrides`
 * keys in `document_generate`. Keep them verbatim so paths round-trip cleanly.
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
  try {
    const parsed = JSON.parse(jsonResult) as unknown

    async function processDoc(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
      const out: Record<string, unknown> = { ...doc }
      if (typeof out.filename === 'string') out.filename = await pseudonymize(out.filename)
      if (typeof out.description === 'string') out.description = await pseudonymize(out.description)
      if (Array.isArray(out.tags)) {
        out.tags = await Promise.all(
          out.tags.map((t) => (typeof t === 'string' ? pseudonymize(t) : Promise.resolve(t)))
        )
      }
      return out
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.query === 'string') obj.query = await pseudonymize(obj.query)
      if (Array.isArray(obj.documents)) {
        obj.documents = await Promise.all(
          obj.documents.map((d) =>
            typeof d === 'object' && d !== null
              ? processDoc(d as Record<string, unknown>)
              : Promise.resolve(d)
          )
        )
      }
      if (typeof obj.document === 'object' && obj.document !== null) {
        obj.document = await processDoc(obj.document as Record<string, unknown>)
      }
      if (Array.isArray(obj.matches)) {
        obj.matches = await Promise.all(
          obj.matches.map(async (m) => {
            if (typeof m !== 'object' || m === null) return m
            const match = m as Record<string, unknown>
            const out: Record<string, unknown> = { ...match }
            if (typeof out.filename === 'string') out.filename = await pseudonymize(out.filename)
            if (typeof out.excerpt === 'string') out.excerpt = await pseudonymize(out.excerpt)
            return out
          })
        )
      }
      return JSON.stringify(obj)
    }
  } catch {
    // fall through
  }
  return jsonResult
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

/**
 * Exact-substring hits are deliberately boosted above the cosine-similarity
 * range [-1, 1]. Keep the threshold aligned with semanticSearchService so a
 * perfect vector hit (score 1.0) is still labelled as semantic, not exact.
 */
const DOCUMENT_SEARCH_EXACT_MATCH_THRESHOLD = SEMANTIC_SEARCH_EXACT_MATCH_SCORE
const DOCUMENT_SEARCH_MAX_HITS = 8

function classifyDocumentSearchMatchType(score: number): 'exact' | 'semantic' {
  return score >= DOCUMENT_SEARCH_EXACT_MATCH_THRESHOLD ? 'exact' : 'semantic'
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

  const sorted = [...result.hits].sort((left, right) => right.score - left.score)

  // First pass: one best hit per document, to show breadth across the dossier.
  const diversified: typeof sorted = []
  const alreadyIncluded = new Set<string>()
  const perDocumentCount = new Map<string, number>()
  for (const hit of sorted) {
    if (perDocumentCount.has(hit.documentId)) continue
    perDocumentCount.set(hit.documentId, 1)
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
      perDocumentCount.set(hit.documentId, (perDocumentCount.get(hit.documentId) ?? 0) + 1)
      if (diversified.length >= DOCUMENT_SEARCH_MAX_HITS) break
    }
  }

  diversified.sort((left, right) => right.score - left.score)

  const matches = diversified.map((hit) => ({
    documentId: hit.documentId,
    filename: hit.filename,
    excerpt: hit.snippet,
    score: Number(hit.score.toFixed(3)),
    matchType: classifyDocumentSearchMatchType(hit.score),
    charStart: hit.charStart,
    charEnd: hit.charEnd
  }))

  return JSON.stringify({
    query: result.query,
    matches
  })
}

function hitKey(hit: { documentId: string; charStart: number; charEnd: number }): string {
  return `${hit.documentId}:${hit.charStart}:${hit.charEnd}`
}

export function resolveContactRecord(
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
    return resolveDossierRef(requestedRef, dossiers) ?? requestedRef
  }

  private async _dispatch(toolName: string, args: Record<string, unknown>): Promise<string> {
    const { contactService, templateService, documentService, dossierService, entityProfile } =
      this.deps

    if (toolName === 'managed_fields_get') {
      return buildManagedFieldsToolResult(entityProfile)
    }

    if (toolName === 'template_list') {
      const allTemplates = await templateService.list().catch(() => [])
      return JSON.stringify({ templates: allTemplates })
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
      const contactId = typeof args.contactId === 'string' ? args.contactId : ''
      const all = await contactService.list(targetDossierId).catch(() => [] as ContactRecord[])
      const contact = resolveContactRecord(all, contactId)
      return contact
        ? JSON.stringify({ contact })
        : JSON.stringify({ error: `Contact not found: ${contactId}` })
    }

    if (toolName === 'document_list') {
      const docs = await documentService
        .listDocuments({ dossierId: targetDossierId })
        .catch(() => [] as DocumentRecord[])
      return buildDocumentListToolResult(docs)
    }

    if (toolName === 'document_get') {
      const documentId = typeof args.documentId === 'string' ? args.documentId : ''
      const docs = await documentService
        .listDocuments({ dossierId: targetDossierId })
        .catch(() => [] as DocumentRecord[])
      const doc = docs.find((d) => d.id === documentId || d.uuid === documentId)
      if (!doc) return JSON.stringify({ error: `Document not found: ${documentId}` })

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
        return JSON.stringify({ dossier: detail })
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

    return JSON.stringify({ error: `Unknown data tool: ${toolName}` })
  }
}
