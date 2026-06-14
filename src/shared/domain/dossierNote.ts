/**
 * Dossier notes — the lawyer's pense-bête / TODO / reflection log.
 *
 * A note is a free-form, dossier-scoped record: a reminder, a task to do, an
 * idea, a supposition to verify, or a log of an AI research/reflection step
 * worth keeping for later. Notes are taggable, support full CRUD, and are
 * driven equally by the manual UI and by the AI assistant (note_* tools).
 *
 * Unlike key dates (which model dated events), notes carry no date semantics —
 * just `kind`, an optional todo `status`, free tags, and a pinned flag. Their
 * text (title + content) is indexed with the shared bge-m3 embedding model so
 * notes are searchable both by keyword/tag and semantically, exactly like
 * documents.
 */

/** What a note represents. `ai_log` flags an AI-authored research/reflection trace. */
export const NOTE_KIND_VALUES = ['note', 'todo', 'idea', 'to_verify', 'ai_log'] as const
export type DossierNoteKind = (typeof NOTE_KIND_VALUES)[number]

/** Todo lifecycle. Only meaningful for actionable notes (typically `kind: 'todo'`). */
export const NOTE_STATUS_VALUES = ['open', 'done'] as const
export type DossierNoteStatus = (typeof NOTE_STATUS_VALUES)[number]

/** Who created the note: the lawyer via the UI, or the AI assistant. */
export const NOTE_SOURCE_VALUES = ['user', 'ai'] as const
export type DossierNoteSource = (typeof NOTE_SOURCE_VALUES)[number]

export interface DossierNote {
  uuid: string
  dossierId: string
  title: string
  /** Plain text / light markdown. Kept prefix-free so embeddings stay clean. */
  content: string
  kind: DossierNoteKind
  status?: DossierNoteStatus
  /** Free-form tags (ad hoc), not the constrained key-date tag enum. */
  tags?: string[]
  pinned?: boolean
  source?: DossierNoteSource
  createdAt: string
  updatedAt: string
}

export interface DossierNoteUpsertInput {
  uuid?: string
  dossierId: string
  title: string
  content: string
  kind?: DossierNoteKind
  status?: DossierNoteStatus
  tags?: string[]
  pinned?: boolean
  source?: DossierNoteSource
}

export interface DossierNoteDeleteInput {
  dossierId: string
  noteUuid: string
}
