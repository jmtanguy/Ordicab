/**
 * Rédaction assistée — AI-assisted drafting of Word documents in a dossier.
 *
 * A drafting session keeps the document as a native .docx. Every change (AI
 * or manual) is a batch of paragraph operations applied as native Word
 * tracked revisions (<w:ins>/<w:del>). The session persists an append-only
 * event journal; the current document is a deterministic fold of the
 * immutable base.docx plus the journal up to `cursor` — which is what makes
 * undo/redo a cursor move and autosave intrinsic (every event is written to
 * disk before the IPC call returns).
 */
import type { DiffBlock } from './compare'

export type RedactionDocKind = 'conclusions' | 'courrier' | 'relance' | 'information' | 'autre'

/** Vocabulary carried over from the recovered artifact WIP. */
export type RedactionSaveMode = 'new_file' | 'replace_original'

/** keep_tracked is the implicit default: no decision event recorded. */
export type RedactionDecision = 'accept' | 'reject'

export type RedactionOpType = 'insert_after' | 'insert_before' | 'replace' | 'delete'

export type RedactionSourceType = 'blank' | 'entity_default' | 'template' | 'copy' | 'edit_existing'

export interface RedactionSource {
  type: RedactionSourceType
  templateUuid?: string
  sourceDocumentUuid?: string
  /** Relative to the dossier root (copy / edit_existing). */
  sourceDocumentPath?: string
}

export interface RedactionCitation {
  type: 'document' | 'legal'
  label: string
  documentUuid?: string
  legalRef?: string
}

export interface RedactionOperation {
  id: string
  op: RedactionOpType
  /** Paragraph indices refer to the CURRENT document at the time of the batch. */
  anchorIndex?: number
  index?: number
  text?: string
  /**
   * Rich content (minimal HTML: strong/em/u) for manual edits — preserves the
   * character formatting of the paragraph. Takes precedence over `text`.
   */
  html?: string
  rationale?: string
  legalRefs?: string[]
  citations?: RedactionCitation[]
}

export interface RedactionOpsEvent {
  kind: 'ops'
  id: string
  author: string
  authorKind: 'ai' | 'user'
  dateIso: string
  operations: RedactionOperation[]
  /** Chat message that produced this batch, when AI-authored. */
  chatTurnId?: string
}

export interface RedactionDecisionEvent {
  kind: 'decision'
  id: string
  opId: string
  decision: RedactionDecision
  dateIso: string
}

export type RedactionEvent = RedactionOpsEvent | RedactionDecisionEvent

export interface RedactionChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  createdAt: string
  /** Journal event applied by this assistant turn, if any. */
  eventId?: string
}

export interface RedactionSession {
  schemaVersion: 1
  sessionId: string
  dossierId: string
  title: string
  targetFilename: string
  docKind: RedactionDocKind
  source: RedactionSource
  saveMode: RedactionSaveMode
  /** Dossier-relative path of the document replaced on save (replace_original). */
  originalDocRelPath?: string
  /** Hash of base.docx — divergence guard for edit_existing. */
  sourceContentHash: string
  /** Append-only journal. */
  events: RedactionEvent[]
  /** events[0..cursor) are applied; undo/redo moves this cursor. */
  cursor: number
  /** Conversation as displayed (clear text). */
  chat: RedactionChatMessage[]
  /** AiChatHistoryEntry[] — pseudonymized runtime history for resume. */
  runtimeHistory: unknown[]
  /** PII mapping snapshot entries backing runtimeHistory decoding. */
  piiLedger: unknown[]
  status: 'active' | 'saved'
  createdAt: string
  updatedAt: string
}

export interface RedactionSessionSummary {
  sessionId: string
  dossierId: string
  title: string
  docKind: RedactionDocKind
  status: 'active' | 'saved'
  updatedAt: string
  createdAt: string
}

export interface RedactionOutlineEntry {
  paragraphIndex: number
  /** 1..9 from Heading styles; 0 for the title style. */
  level: number
  text: string
}

export interface RedactionParagraphSummary {
  index: number
  text: string
  /** Minimal HTML (strong/em/u) of the paragraph, for the rich editor. */
  html: string
  /** Paragraph alignment (w:jc), so the editor can mirror the document. */
  alignment?: 'left' | 'center' | 'right' | 'justify'
}

export interface RedactionPendingOp {
  opId: string
  eventId: string
  op: RedactionOpType
  index?: number
  anchorIndex?: number
  text?: string
  rationale?: string
  legalRefs?: string[]
  authorKind: 'ai' | 'user'
  decision: RedactionDecision | 'keep_tracked'
}

/** Returned by every mutating IPC call — the full state the page renders. */
export interface RedactionSnapshot {
  session: RedactionSession
  /** data-URL (base64) of current.docx for docx-preview. */
  previewDataUrl: string
  diffBlocks: DiffBlock[]
  outline: RedactionOutlineEntry[]
  paragraphs: RedactionParagraphSummary[]
  pendingOps: RedactionPendingOp[]
  canUndo: boolean
  canRedo: boolean
}

export interface RedactionCreateInput {
  dossierId: string
  title: string
  docKind: RedactionDocKind
  source: RedactionSource
  targetFilename?: string
  /** template source: resolved tag values collected by the wizard. */
  tagOverrides?: Record<string, string>
  primaryContactUuid?: string
  contactRoleOverrides?: Record<string, string>
}

export interface RedactionManualEditInput {
  dossierId: string
  sessionId: string
  operations: RedactionOperation[]
}

export interface RedactionDecideOpInput {
  dossierId: string
  sessionId: string
  opId: string
  decision: RedactionDecision
}

export interface RedactionUpdateMetaInput {
  dossierId: string
  sessionId: string
  title?: string
  targetFilename?: string
  docKind?: RedactionDocKind
  saveMode?: RedactionSaveMode
}

export interface RedactionCommitInput {
  dossierId: string
  sessionId: string
  /** Remaining pending ops default to keep_tracked (visible revisions in Word). */
  finalDecisions?: Record<string, RedactionDecision | 'keep_tracked'>
  filename?: string
  /** Explicit confirmation after detecting a newer version of the original file. */
  forceReplace?: boolean
}

export interface RedactionCommitResult {
  outputPath: string
  filename: string
}
