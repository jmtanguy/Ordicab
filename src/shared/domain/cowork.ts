/**
 * Claude Cowork export — pseudonymized workspace for a dossier.
 *
 * Flow: cowork:export builds `<dossier>/Cowork/` (dossier.md synthesis,
 * documents/*.md pseudonymized extracts, CLAUDE.md instructions, resultats/
 * left untouched), persisting the PII mapping under the dossier's .ordicab/.
 * Claude Cowork works on that folder and writes deliverables to resultats/;
 * cowork:reimport reverts the fake identities back to the originals and saves
 * the files as regular dossier documents.
 */

export interface CoworkExportResult {
  exportPath: string
  exportedAt: string
  /** Documents exported as pseudonymized Markdown. */
  documentCount: number
  /** Documents listed in the inventory but not exported (no extractable text). */
  unextractedCount: number
  noteCount: number
}

export interface CoworkReimportedFile {
  filename: string
  /** Path relative to the dossier root where the de-pseudonymized file landed. */
  relativePath: string
}

export interface CoworkReimportResult {
  imported: CoworkReimportedFile[]
  /** Non-text results (docx…) left in resultats/ for manual handling. */
  manual: Array<{ filename: string }>
}

export interface CoworkStatus {
  exportPath: string
  /** ISO date of the last export, or null when the dossier was never exported. */
  lastExportAt: string | null
  /** Files waiting in resultats/ (excluding already-imported ones). */
  pendingResultCount: number
}

export interface CoworkExportProgress {
  dossierId: string
  /** 1-based index of the document being processed. */
  current: number
  total: number
  filename: string
}
