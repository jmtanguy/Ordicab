/**
 * Rédaction assistée — drafting session orchestration.
 *
 * A session lives under <dossierRoot>/.ordicab/redaction/<sessionId>/:
 *   session.json   — RedactionSession (append-only event journal + cursor)
 *   base.docx      — immutable starting document (never rewritten)
 *   current.docx   — cache of the fold of base.docx + events[0..cursor)
 *
 * Every mutation is persisted (atomicWrite) before the IPC call returns, so
 * autosave is intrinsic. Undo/redo moves the cursor and replays the journal
 * from base.docx — the fold is deterministic because each event stores its
 * dateIso and revision ids are re-seeded from the document's current max.
 */

import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import HTMLToDOCX from 'html-to-docx'

import type {
  RedactionChatMessage,
  RedactionCommitInput,
  RedactionCommitResult,
  RedactionCreateInput,
  RedactionDecision,
  RedactionEvent,
  RedactionOperation,
  RedactionOutlineEntry,
  RedactionParagraphSummary,
  RedactionPendingOp,
  RedactionSession,
  RedactionSessionSummary,
  RedactionSnapshot,
  RedactionUpdateMetaInput
} from '@shared/domain/redaction'
import type { DocumentRecord } from '@shared/domain/document'
import { IpcErrorCode } from '@shared/types'

import { atomicWrite } from '../../lib/system/atomicWrite'
import { GenerateServiceError } from './generateService'
import { computeDiff } from './compare/diffEngine'
import {
  applyOperationsToContent,
  applyRevisionDecision,
  extractIndexedTextFromContent,
  paragraphRunsToHtml,
  parseTopLevelParagraphs,
  readDocumentXml,
  rebuildDocxWithDocumentXml,
  type AugmentParagraph
} from './documentAugmentService'

// ============================================================================
// Dependencies
// ============================================================================

export interface RedactionDocumentServiceLike {
  resolveRegisteredDossierRoot(input: { dossierId: string }): Promise<string>
  listDocuments(input: { dossierId: string }): Promise<DocumentRecord[]>
}

export interface RedactionGenerateServiceLike {
  generateDocument(input: {
    dossierId: string
    templateUuid: string
    tagOverrides?: Record<string, string>
    primaryContactUuid?: string
    contactRoleOverrides?: Record<string, string>
    outputPath?: string
  }): Promise<{ outputPath: string }>
}

export interface RedactionEntityServiceLike {
  get(): Promise<{ firmName: string; firstName?: string; lastName?: string } | null>
  getDefaultTemplatePath(): Promise<string>
}

export interface RedactionSessionServiceOptions {
  documentService: RedactionDocumentServiceLike
  generateService: RedactionGenerateServiceLike
  entityService: RedactionEntityServiceLike
  now?: () => Date
}

export interface RedactionApplyOpsMeta {
  author: string
  authorKind: 'ai' | 'user'
  chatTurnId?: string
}

export interface RedactionSessionService {
  listSessions(dossierId: string): Promise<RedactionSessionSummary[]>
  createSession(input: RedactionCreateInput): Promise<RedactionSnapshot>
  getSnapshot(dossierId: string, sessionId: string): Promise<RedactionSnapshot>
  applyOps(
    dossierId: string,
    sessionId: string,
    operations: RedactionOperation[],
    meta: RedactionApplyOpsMeta
  ): Promise<RedactionSnapshot>
  manualEdit(
    dossierId: string,
    sessionId: string,
    operations: RedactionOperation[]
  ): Promise<RedactionSnapshot>
  decideOp(
    dossierId: string,
    sessionId: string,
    opId: string,
    decision: RedactionDecision
  ): Promise<RedactionSnapshot>
  undo(dossierId: string, sessionId: string): Promise<RedactionSnapshot>
  redo(dossierId: string, sessionId: string): Promise<RedactionSnapshot>
  updateMeta(input: RedactionUpdateMetaInput): Promise<RedactionSnapshot>
  syncChat(dossierId: string, sessionId: string, chat: RedactionChatMessage[]): Promise<void>
  persistConversation(
    dossierId: string,
    sessionId: string,
    runtimeHistory: unknown[],
    piiLedger: unknown[]
  ): Promise<void>
  getConversationState(
    dossierId: string,
    sessionId: string
  ): Promise<{ runtimeHistory: unknown[]; piiLedger: unknown[] } | null>
  /** Fresh start: clears the displayed chat AND the persisted runtime history/PII ledger. */
  resetConversation(dossierId: string, sessionId: string): Promise<void>
  getIndexedText(
    dossierId: string,
    sessionId: string
  ): Promise<{ paragraphs: Array<{ index: number; text: string }>; previewText: string }>
  commit(input: RedactionCommitInput): Promise<RedactionCommitResult>
  discard(dossierId: string, sessionId: string): Promise<void>
}

/** conversationId format used by the drafting page: redaction:<dossierId>:<sessionId>. */
export function buildRedactionConversationId(dossierId: string, sessionId: string): string {
  return `redaction:${dossierId}:${sessionId}`
}

export function parseRedactionConversationId(
  conversationId: string
): { dossierId: string; sessionId: string } | null {
  if (!conversationId.startsWith('redaction:')) return null
  const rest = conversationId.slice('redaction:'.length)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0) return null
  return { dossierId: rest.slice(0, lastColon), sessionId: rest.slice(lastColon + 1) }
}

// ============================================================================
// Helpers
// ============================================================================

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SESSION_ID_PATTERN = /^[a-f0-9]{8}$/i

/** The renderer must ask the lawyer for an explicit overwrite confirmation. */
export class RedactionOriginalChangedError extends Error {
  readonly code = IpcErrorCode.INTEGRITY_CONFLICT

  constructor() {
    super('The original document has changed since this drafting session started.')
    this.name = 'RedactionOriginalChangedError'
  }
}

function dataUrl(buffer: Uint8Array): string {
  return `data:${DOCX_MIME};base64,${Buffer.from(buffer).toString('base64')}`
}

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function normalizeDocxFilename(input: string | undefined, fallback: string): string {
  const raw = (input || fallback).trim() || 'document'
  const withoutExtension = raw.replace(/\.docx$/i, '')
  const safe = withoutExtension
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${safe || 'document'}.docx`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function uniqueOutputPath(dir: string, filename: string): Promise<string> {
  const extension = extname(filename) || '.docx'
  const stem = basename(filename, extension)
  const first = join(dir, `${stem}${extension}`)
  if (!(await pathExists(first))) return first
  for (let i = 2; i <= 99; i += 1) {
    const next = join(dir, `${stem}-${i}${extension}`)
    if (!(await pathExists(next))) return next
  }
  return join(dir, `${stem}-${randomUUID().slice(0, 8)}${extension}`)
}

async function blankDocxBuffer(): Promise<Uint8Array> {
  const output = await HTMLToDOCX(
    '<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><p></p></body></html>',
    undefined,
    {
      creator: 'Ordicab',
      font: 'Aptos',
      fontSize: 22,
      lang: 'fr-FR'
    }
  )
  if (output instanceof Uint8Array) return output
  if (typeof Blob !== 'undefined' && output instanceof Blob) {
    return new Uint8Array(await output.arrayBuffer())
  }
  return new Uint8Array(output as ArrayBuffer)
}

function parseParagraphAlignment(
  pPrXml: string
): 'left' | 'center' | 'right' | 'justify' | undefined {
  const value = pPrXml.match(/<w:jc w:val="([^"]+)"/)?.[1]
  switch (value) {
    case 'center':
      return 'center'
    case 'right':
    case 'end':
      return 'right'
    case 'both':
    case 'distribute':
      return 'justify'
    case 'left':
    case 'start':
      return 'left'
    default:
      return undefined
  }
}

const HEADING_STYLE_PATTERN = /<w:pStyle w:val="(?:Heading|Titre)([1-9])"/i
const TITLE_STYLE_PATTERN = /<w:pStyle w:val="(?:Title|Titre)"/i

function buildOutline(paragraphs: AugmentParagraph[]): RedactionOutlineEntry[] {
  const outline: RedactionOutlineEntry[] = []
  for (const paragraph of paragraphs) {
    if (!paragraph.text.trim()) continue
    const headingMatch = paragraph.pPrXml.match(HEADING_STYLE_PATTERN)
    if (headingMatch) {
      outline.push({
        paragraphIndex: paragraph.index,
        level: Number.parseInt(headingMatch[1] ?? '1', 10),
        text: paragraph.text
      })
      continue
    }
    if (TITLE_STYLE_PATTERN.test(paragraph.pPrXml)) {
      outline.push({ paragraphIndex: paragraph.index, level: 0, text: paragraph.text })
    }
  }
  return outline
}

// ============================================================================
// Fold: base.docx + events[0..cursor) → current document state
// ============================================================================

interface FoldState {
  content: Uint8Array
  /** operation.id → w:id values (recomputed deterministically on each fold). */
  opRevisionIds: Map<string, number[]>
  /** Latest applied decision per operation. */
  decisions: Map<string, RedactionDecision>
  /** Applied ops in journal order, with their event. */
  appliedOps: Array<{ eventId: string; authorKind: 'ai' | 'user'; operation: RedactionOperation }>
}

function foldEvents(base: Uint8Array, events: RedactionEvent[], cursor: number): FoldState {
  let content = base
  const opRevisionIds = new Map<string, number[]>()
  const decisions = new Map<string, RedactionDecision>()
  const appliedOps: FoldState['appliedOps'] = []

  for (const event of events.slice(0, cursor)) {
    if (event.kind === 'ops') {
      const result = applyOperationsToContent(content, event.operations, {
        author: event.author,
        dateIso: event.dateIso
      })
      content = result.docxBuffer
      for (const [opId, revIds] of result.opRevisionIds) {
        opRevisionIds.set(opId, revIds)
      }
      for (const operation of event.operations) {
        appliedOps.push({ eventId: event.id, authorKind: event.authorKind, operation })
      }
    } else {
      const revIds = opRevisionIds.get(event.opId)
      if (!revIds || revIds.length === 0) continue
      const documentXml = applyRevisionDecision(readDocumentXml(content), revIds, event.decision)
      content = rebuildDocxWithDocumentXml(content, documentXml)
      decisions.set(event.opId, event.decision)
    }
  }

  return { content, opRevisionIds, decisions, appliedOps }
}

// ============================================================================
// Service
// ============================================================================

export function createRedactionSessionService(
  options: RedactionSessionServiceOptions
): RedactionSessionService {
  const now = options.now ?? (() => new Date())
  const sessionLocks = new Map<string, Promise<void>>()

  /** Serialize every read-modify-write sequence for one drafting session. */
  async function withSessionLock<T>(
    dossierId: string,
    sessionId: string,
    work: () => Promise<T>
  ): Promise<T> {
    const key = `${dossierId}:${sessionId}`
    const previous = (sessionLocks.get(key) ?? Promise.resolve()).catch(() => undefined)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => gate)
    sessionLocks.set(key, queued)

    await previous
    try {
      return await work()
    } finally {
      release?.()
      if (sessionLocks.get(key) === queued) sessionLocks.delete(key)
    }
  }

  async function redactionRoot(dossierId: string): Promise<string> {
    const dossierRoot = await options.documentService.resolveRegisteredDossierRoot({ dossierId })
    return join(dossierRoot, '.ordicab', 'redaction')
  }

  async function sessionPaths(
    dossierId: string,
    sessionId: string
  ): Promise<{
    dossierRoot: string
    dir: string
    sessionJson: string
    base: string
    current: string
  }> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error('Invalid drafting session id.')
    }
    const dossierRoot = await options.documentService.resolveRegisteredDossierRoot({ dossierId })
    const dir = join(dossierRoot, '.ordicab', 'redaction', sessionId)
    return {
      dossierRoot,
      dir,
      sessionJson: join(dir, 'session.json'),
      base: join(dir, 'base.docx'),
      current: join(dir, 'current.docx')
    }
  }

  async function loadSession(sessionJsonPath: string): Promise<RedactionSession> {
    const session = JSON.parse(await readFile(sessionJsonPath, 'utf8')) as RedactionSession
    if (session.schemaVersion !== 1) {
      throw new Error(`Unsupported redaction session schema: ${String(session.schemaVersion)}`)
    }
    return session
  }

  async function saveSession(sessionJsonPath: string, session: RedactionSession): Promise<void> {
    await atomicWrite(sessionJsonPath, JSON.stringify(session, null, 2))
  }

  async function buildSnapshot(
    dossierId: string,
    session: RedactionSession,
    persistCurrent: boolean
  ): Promise<RedactionSnapshot> {
    const paths = await sessionPaths(dossierId, session.sessionId)
    const base = await readFile(paths.base)
    const fold = foldEvents(base, session.events, session.cursor)

    if (persistCurrent) {
      await atomicWrite(paths.current, fold.content)
    }

    const currentXml = readDocumentXml(fold.content)
    const paragraphs = parseTopLevelParagraphs(currentXml)
    const baseParagraphs = parseTopLevelParagraphs(readDocumentXml(base))

    const baseText = baseParagraphs.map((p) => p.text).join('\n\n')
    const currentText = paragraphs.map((p) => p.text).join('\n\n')
    const { blocks: diffBlocks } = computeDiff(baseText, currentText)

    const paragraphSummaries: RedactionParagraphSummary[] = paragraphs.map((p) => ({
      index: p.index,
      text: p.text,
      html: paragraphRunsToHtml(p.rawXml),
      alignment: parseParagraphAlignment(p.pPrXml)
    }))

    const pendingOps: RedactionPendingOp[] = fold.appliedOps.map(
      ({ eventId, authorKind, operation }) => ({
        opId: operation.id,
        eventId,
        op: operation.op,
        index: operation.index,
        anchorIndex: operation.anchorIndex,
        text: operation.text,
        rationale: operation.rationale,
        legalRefs: operation.legalRefs,
        authorKind,
        decision: fold.decisions.get(operation.id) ?? 'keep_tracked'
      })
    )

    return {
      session,
      previewDataUrl: dataUrl(fold.content),
      diffBlocks,
      outline: buildOutline(paragraphs),
      paragraphs: paragraphSummaries,
      pendingOps,
      canUndo: session.cursor > 0,
      canRedo: session.cursor < session.events.length
    }
  }

  async function mutateSession(
    dossierId: string,
    sessionId: string,
    mutate: (session: RedactionSession) => void
  ): Promise<RedactionSnapshot> {
    const paths = await sessionPaths(dossierId, sessionId)
    const session = await loadSession(paths.sessionJson)
    if (session.status !== 'active') {
      throw new Error('This drafting session has already been saved.')
    }
    mutate(session)
    session.updatedAt = now().toISOString()
    const snapshot = await buildSnapshot(dossierId, session, true)
    await saveSession(paths.sessionJson, session)
    return snapshot
  }

  async function resolveDossierDocument(
    dossierId: string,
    source: { sourceDocumentUuid?: string; sourceDocumentPath?: string }
  ): Promise<{ absolutePath: string; relativePath: string }> {
    const documents = await options.documentService.listDocuments({ dossierId })
    const record = documents.find(
      (doc) =>
        (source.sourceDocumentUuid && doc.uuid === source.sourceDocumentUuid) ||
        (source.sourceDocumentPath && doc.relativePath === source.sourceDocumentPath)
    )
    if (!record) {
      throw new Error('Source document was not found in the dossier.')
    }
    if (!/\.docx$/i.test(record.filename)) {
      throw new Error('Only .docx documents can be edited in the drafting workspace.')
    }
    // DocumentRecord.path is dossier-relative (documentService fills it from
    // relativePath) — always anchor it to the dossier root.
    const dossierRoot = await options.documentService.resolveRegisteredDossierRoot({ dossierId })
    return {
      absolutePath: join(dossierRoot, record.relativePath),
      relativePath: record.relativePath
    }
  }

  function validateOperations(operations: RedactionOperation[], paragraphCount: number): void {
    const targeted = new Set<number>()
    for (const op of operations) {
      const target = op.op === 'replace' || op.op === 'delete' ? op.index : op.anchorIndex
      if (target === undefined || target < 0 || target >= paragraphCount) {
        throw new Error(
          `Operation ${op.op} targets paragraph ${String(target)} but the document has ${paragraphCount} paragraphs (0..${paragraphCount - 1}).`
        )
      }
      if (op.op === 'replace' || op.op === 'delete') {
        if (targeted.has(target)) {
          throw new Error(
            `Two operations target paragraph ${target} in the same batch; split them into successive turns.`
          )
        }
        targeted.add(target)
      }
    }
  }

  async function resolveUserAuthor(): Promise<string> {
    try {
      const entity = await options.entityService.get()
      if (entity) {
        const fullName = [entity.firstName, entity.lastName].filter(Boolean).join(' ').trim()
        return fullName || entity.firmName || 'Utilisateur'
      }
    } catch {
      // fall through to the default author
    }
    return 'Utilisateur'
  }

  return {
    async listSessions(dossierId) {
      const root = await redactionRoot(dossierId)
      let entries: string[]
      try {
        entries = await readdir(root)
      } catch {
        return []
      }

      const summaries: RedactionSessionSummary[] = []
      for (const entry of entries) {
        try {
          const session = await loadSession(join(root, entry, 'session.json'))
          summaries.push({
            sessionId: session.sessionId,
            dossierId: session.dossierId,
            title: session.title,
            docKind: session.docKind,
            status: session.status,
            updatedAt: session.updatedAt,
            createdAt: session.createdAt
          })
        } catch {
          // Skip unreadable session directories
        }
      }

      summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return summaries
    },

    async createSession(input) {
      const timestamp = now().toISOString()
      const sessionId = randomUUID().slice(0, 8)
      const paths = await sessionPaths(input.dossierId, sessionId)
      await mkdir(paths.dir, { recursive: true })

      let saveMode: RedactionSession['saveMode'] = 'new_file'
      let originalDocRelPath: string | undefined

      switch (input.source.type) {
        case 'blank': {
          await atomicWrite(paths.base, await blankDocxBuffer())
          break
        }
        case 'entity_default': {
          const templatePath = await options.entityService.getDefaultTemplatePath()
          await copyFile(templatePath, paths.base)
          break
        }
        case 'template': {
          if (!input.source.templateUuid) throw new Error('templateUuid is required.')
          const generateInput = {
            dossierId: input.dossierId,
            templateUuid: input.source.templateUuid,
            tagOverrides: input.tagOverrides,
            primaryContactUuid: input.primaryContactUuid,
            contactRoleOverrides: input.contactRoleOverrides,
            outputPath: paths.base
          }
          try {
            await options.generateService.generateDocument(generateInput)
          } catch (error) {
            const unresolved =
              error instanceof GenerateServiceError ? error.unresolvedTags : undefined
            if (!unresolved || unresolved.length === 0) throw error
            // Unresolved routines must not fail the wizard: keep them visible
            // as literal {{tag}} placeholders, to be filled during drafting.
            const literalPlaceholders = Object.fromEntries(
              unresolved.map((path) => [path, `{{${path}}}`])
            )
            await options.generateService.generateDocument({
              ...generateInput,
              tagOverrides: { ...input.tagOverrides, ...literalPlaceholders }
            })
          }
          break
        }
        case 'copy': {
          const resolved = await resolveDossierDocument(input.dossierId, input.source)
          await copyFile(resolved.absolutePath, paths.base)
          break
        }
        case 'edit_existing': {
          const resolved = await resolveDossierDocument(input.dossierId, input.source)
          await copyFile(resolved.absolutePath, paths.base)
          saveMode = 'replace_original'
          originalDocRelPath = resolved.relativePath
          break
        }
      }

      const base = await readFile(paths.base)
      await atomicWrite(paths.current, base)

      const session: RedactionSession = {
        schemaVersion: 1,
        sessionId,
        dossierId: input.dossierId,
        title: input.title.trim() || 'Document',
        targetFilename: normalizeDocxFilename(input.targetFilename, input.title),
        docKind: input.docKind,
        source: input.source,
        saveMode,
        originalDocRelPath,
        sourceContentHash: sha256(base),
        events: [],
        cursor: 0,
        chat: [],
        runtimeHistory: [],
        piiLedger: [],
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      }

      await saveSession(paths.sessionJson, session)
      return buildSnapshot(input.dossierId, session, false)
    },

    async getSnapshot(dossierId, sessionId) {
      return withSessionLock(dossierId, sessionId, async () => {
        const paths = await sessionPaths(dossierId, sessionId)
        const session = await loadSession(paths.sessionJson)
        return buildSnapshot(dossierId, session, true)
      })
    },

    async applyOps(dossierId, sessionId, operations, meta) {
      return withSessionLock(dossierId, sessionId, async () => {
        const paths = await sessionPaths(dossierId, sessionId)
        const session = await loadSession(paths.sessionJson)
        if (session.status !== 'active') {
          throw new Error('This drafting session has already been saved.')
        }

        // Validate against the paragraph count of the CURRENT fold
        const base = await readFile(paths.base)
        const fold = foldEvents(base, session.events, session.cursor)
        const paragraphCount = parseTopLevelParagraphs(readDocumentXml(fold.content)).length
        validateOperations(operations, paragraphCount)

        // A new mutation invalidates the redo tail
        session.events = session.events.slice(0, session.cursor)
        session.events.push({
          kind: 'ops',
          id: randomUUID().slice(0, 8),
          author: meta.author,
          authorKind: meta.authorKind,
          dateIso: now().toISOString(),
          operations,
          chatTurnId: meta.chatTurnId
        })
        session.cursor = session.events.length
        session.updatedAt = now().toISOString()

        const snapshot = await buildSnapshot(dossierId, session, true)
        await saveSession(paths.sessionJson, session)
        return snapshot
      })
    },

    async manualEdit(dossierId, sessionId, operations) {
      const author = await resolveUserAuthor()
      return this.applyOps(dossierId, sessionId, operations, { author, authorKind: 'user' })
    },

    async decideOp(dossierId, sessionId, opId, decision) {
      return withSessionLock(dossierId, sessionId, () =>
        mutateSession(dossierId, sessionId, (session) => {
          const opExists = session.events
            .slice(0, session.cursor)
            .some((event) => event.kind === 'ops' && event.operations.some((op) => op.id === opId))
          if (!opExists) {
            throw new Error(`Operation ${opId} was not found in the applied journal.`)
          }
          session.events = session.events.slice(0, session.cursor)
          session.events.push({
            kind: 'decision',
            id: randomUUID().slice(0, 8),
            opId,
            decision,
            dateIso: now().toISOString()
          })
          session.cursor = session.events.length
        })
      )
    },

    async undo(dossierId, sessionId) {
      return withSessionLock(dossierId, sessionId, () =>
        mutateSession(dossierId, sessionId, (session) => {
          if (session.cursor === 0) throw new Error('Nothing to undo.')
          session.cursor -= 1
        })
      )
    },

    async redo(dossierId, sessionId) {
      return withSessionLock(dossierId, sessionId, () =>
        mutateSession(dossierId, sessionId, (session) => {
          if (session.cursor >= session.events.length) throw new Error('Nothing to redo.')
          session.cursor += 1
        })
      )
    },

    async updateMeta(input) {
      return withSessionLock(input.dossierId, input.sessionId, () =>
        mutateSession(input.dossierId, input.sessionId, (session) => {
          if (input.title !== undefined) session.title = input.title
          if (input.targetFilename !== undefined) {
            session.targetFilename = normalizeDocxFilename(input.targetFilename, session.title)
          }
          if (input.docKind !== undefined) session.docKind = input.docKind
          if (input.saveMode !== undefined) {
            if (input.saveMode === 'replace_original' && !session.originalDocRelPath) {
              throw new Error('This session has no original document to replace.')
            }
            session.saveMode = input.saveMode
          }
        })
      )
    },

    async syncChat(dossierId, sessionId, chat) {
      await withSessionLock(dossierId, sessionId, async () => {
        const paths = await sessionPaths(dossierId, sessionId)
        const session = await loadSession(paths.sessionJson)
        if (session.status !== 'active') return
        session.chat = chat
        session.updatedAt = now().toISOString()
        await saveSession(paths.sessionJson, session)
      })
    },

    async persistConversation(dossierId, sessionId, runtimeHistory, piiLedger) {
      try {
        await withSessionLock(dossierId, sessionId, async () => {
          const paths = await sessionPaths(dossierId, sessionId)
          const session = await loadSession(paths.sessionJson)
          if (session.status !== 'active') return
          session.runtimeHistory = runtimeHistory
          session.piiLedger = piiLedger
          session.updatedAt = now().toISOString()
          await saveSession(paths.sessionJson, session)
        })
      } catch (error) {
        // Best-effort: losing the runtime history only degrades resume quality.
        console.warn('[redaction] failed to persist conversation state:', error)
      }
    },

    async resetConversation(dossierId, sessionId) {
      await withSessionLock(dossierId, sessionId, async () => {
        const paths = await sessionPaths(dossierId, sessionId)
        const session = await loadSession(paths.sessionJson)
        if (session.status !== 'active') {
          throw new Error('This drafting session has already been saved.')
        }
        session.chat = []
        session.runtimeHistory = []
        session.piiLedger = []
        session.updatedAt = now().toISOString()
        await saveSession(paths.sessionJson, session)
      })
    },

    async getConversationState(dossierId, sessionId) {
      try {
        const paths = await sessionPaths(dossierId, sessionId)
        const session = await loadSession(paths.sessionJson)
        return { runtimeHistory: session.runtimeHistory, piiLedger: session.piiLedger }
      } catch {
        return null
      }
    },

    async getIndexedText(dossierId, sessionId) {
      const paths = await sessionPaths(dossierId, sessionId)
      const session = await loadSession(paths.sessionJson)
      const base = await readFile(paths.base)
      const fold = foldEvents(base, session.events, session.cursor)
      const { paragraphs, previewText } = extractIndexedTextFromContent(fold.content)
      return {
        paragraphs: paragraphs.map((p) => ({ index: p.index, text: p.text })),
        previewText
      }
    },

    async commit(input) {
      return withSessionLock(input.dossierId, input.sessionId, async () => {
        const paths = await sessionPaths(input.dossierId, input.sessionId)
        const session = await loadSession(paths.sessionJson)
        if (session.status !== 'active') {
          throw new Error('This drafting session has already been saved.')
        }
        const base = await readFile(paths.base)
        const fold = foldEvents(base, session.events, session.cursor)

        // Apply the final decisions on ops still pending (default keep_tracked)
        let documentXml = readDocumentXml(fold.content)
        if (input.finalDecisions) {
          for (const [opId, decision] of Object.entries(input.finalDecisions)) {
            if (decision === 'keep_tracked') continue
            if (fold.decisions.has(opId)) continue
            const revIds = fold.opRevisionIds.get(opId)
            if (!revIds || revIds.length === 0) continue
            documentXml = applyRevisionDecision(documentXml, revIds, decision)
          }
        }
        const finalBuffer = rebuildDocxWithDocumentXml(fold.content, documentXml)

        const filename = normalizeDocxFilename(input.filename, session.targetFilename)
        let outputPath: string
        if (session.saveMode === 'replace_original') {
          if (!session.originalDocRelPath) {
            throw new Error('This session has no original document to replace.')
          }
          outputPath = join(paths.dossierRoot, session.originalDocRelPath)
          const currentOriginal = await readFile(outputPath)
          if (!input.forceReplace && sha256(currentOriginal) !== session.sourceContentHash) {
            throw new RedactionOriginalChangedError()
          }
        } else {
          outputPath = await uniqueOutputPath(paths.dossierRoot, filename)
        }

        await atomicWrite(outputPath, finalBuffer)

        session.status = 'saved'
        session.updatedAt = now().toISOString()
        await saveSession(paths.sessionJson, session)

        return { outputPath, filename: basename(outputPath) }
      })
    },

    async discard(dossierId, sessionId) {
      await withSessionLock(dossierId, sessionId, async () => {
        const paths = await sessionPaths(dossierId, sessionId)
        await rm(paths.dir, { recursive: true, force: true })
      })
    }
  }
}
