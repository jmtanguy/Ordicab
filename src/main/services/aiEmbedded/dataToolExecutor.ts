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
import type { EntityProfile } from '@renderer/schemas/entity'
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
 * Only the human-readable `feedback` string is pseudonymized.
 * Structural fields (success, contactId, dossierId, templateId, entity.id/uuid) are UUIDs
 * or booleans that must round-trip verbatim so the LLM can reference them in subsequent calls.
 */
export function pseudonymizeActionToolResult(
  jsonResult: string,
  pseudonymize: (s: string) => string
): string {
  try {
    const parsed = JSON.parse(jsonResult) as unknown
    if (typeof parsed !== 'object' || parsed === null) return jsonResult
    const obj = parsed as Record<string, unknown>
    if (typeof obj.feedback === 'string') {
      obj.feedback = pseudonymize(obj.feedback)
    }
    return JSON.stringify(obj)
  } catch {
    // fall through
  }
  return jsonResult
}

export function pseudonymizeDocumentToolResult(
  jsonResult: string,
  pseudonymize: (s: string) => string
): string {
  try {
    const parsed = JSON.parse(jsonResult) as unknown

    function processDoc(doc: Record<string, unknown>): Record<string, unknown> {
      const out: Record<string, unknown> = { ...doc }
      if (typeof out.filename === 'string') out.filename = pseudonymize(out.filename)
      if (typeof out.description === 'string') out.description = pseudonymize(out.description)
      if (Array.isArray(out.tags)) {
        out.tags = out.tags.map((t) => (typeof t === 'string' ? pseudonymize(t) : t))
      }
      return out
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      if (Array.isArray(obj.documents)) {
        obj.documents = obj.documents.map((d) =>
          typeof d === 'object' && d !== null ? processDoc(d as Record<string, unknown>) : d
        )
      }
      if (typeof obj.document === 'object' && obj.document !== null) {
        obj.document = processDoc(obj.document as Record<string, unknown>)
      }
      if (Array.isArray(obj.matches)) {
        obj.matches = obj.matches.map((m) => {
          if (typeof m !== 'object' || m === null) return m
          const match = m as Record<string, unknown>
          const out: Record<string, unknown> = { ...match }
          if (typeof out.filename === 'string') out.filename = pseudonymize(out.filename)
          if (typeof out.excerpt === 'string') out.excerpt = pseudonymize(out.excerpt)
          return out
        })
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
        const docs = await documentService
          .listDocuments({ dossierId: targetDossierId })
          .catch(() => [] as DocumentRecord[])
        const dossierRoot = await documentService.resolveRegisteredDossierRoot({
          dossierId: targetDossierId
        })
        const { getDossierContentCachePath } = await import('../../lib/ordicab/ordicabPaths')
        const { searchDocuments } = await import('../../lib/aiEmbedded/documentSearchService')
        const cacheDir = getDossierContentCachePath(dossierRoot)
        const searchResult = await searchDocuments(query, docs, dossierRoot, cacheDir)
        return JSON.stringify(searchResult)
      } catch (err) {
        return JSON.stringify({
          error: `document_search failed: ${err instanceof Error ? err.message : 'unknown error'}`
        })
      }
    }

    return JSON.stringify({ error: `Unknown data tool: ${toolName}` })
  }
}
