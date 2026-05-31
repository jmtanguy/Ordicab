/**
 * Shared types for the background document indexing pipeline.
 *
 * The main process owns the queue and emits snapshots over IPC; the renderer
 * holds a Zustand store mirroring those snapshots to drive a discreet badge,
 * a per-dossier "x / y indexed" summary, and the "Indexing state" modal.
 */

export type IndexingReason =
  | 'initial-registration'
  | 'file-add'
  | 'file-change'
  | 'startup-catchup'
  | 'manual-reindex'

export interface DossierIndexingStatus {
  /** Number of jobs queued for this dossier and not yet started. */
  pending: number
  /** Number of jobs currently being processed for this dossier. */
  running: number
  /** Number of documents whose embeddings are up to date. */
  indexed: number
  /** Total extractable documents in the dossier (the denominator). */
  extractable: number
  /** When the most recent failure for this dossier occurred (ISO timestamp). */
  lastErrorAt: string | null
  /** Last error message — surfaced only inside the IndexingStateDialog. */
  lastErrorMessage: string | null
}

export interface IndexingStatusSnapshot {
  /** Per-dossier counters. Dossiers with zero activity are still listed so the renderer can display "N / N indexed" stably. */
  dossiers: Record<string, DossierIndexingStatus>
  /** Aggregated counters for the global badge. */
  totals: { pending: number; running: number; errored: number }
}

/**
 * Emitted once when the initial batch for a freshly-registered dossier
 * finishes — drives the single "Indexing complete: N documents" toast.
 * `runStartupCatchUp` does NOT emit this (silent at boot).
 */
export interface IndexingDossierInitialCompleteEvent {
  dossierId: string
  totalIndexed: number
  durationMs: number
}

export interface IndexingReindexDossierInput {
  dossierId: string
  /** 'soft' re-runs the hash-check; only changed docs are re-extracted. 'hard' wipes the content cache first, forcing a full rebuild. */
  mode?: 'soft' | 'hard'
}
