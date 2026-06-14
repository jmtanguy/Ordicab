/**
 * Pièces cotées — numbered exhibits attached to a dossier.
 *
 * Each pièce receives a permanent, dossier-scoped number on creation
 * (max + 1). Numbers are never reused or reshuffled, even after removal
 * (French procedural practice: the bordereau numbering is continuous and
 * definitive for the whole procedure, including appeal). The bundle and
 * bordereau are always rendered in numeric order.
 */
export type PieceStampPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PieceRecord {
  /** Stable identifier of the cotation entry itself. */
  uuid: string
  /** Permanent number, unique within the dossier, never reused. */
  pieceNumber: number
  /** Stable uuid of the source document (survives rename/move). */
  documentUuid: string
  /** Filename snapshot for display when the source disappears. */
  sourceFilename: string
  /** Intitulé shown on the bordereau (neutral, descriptive). */
  title: string
  /** Date of the pièce itself (YYYY-MM-DD), shown on the bordereau. */
  pieceDate?: string
  /** Optional short summary shown with the index entry. */
  summary?: string
  addedAt: string
  /** Set the first time a bordereau including this pièce is generated. */
  communicatedAt?: string
}

export interface PieceAddItem {
  documentUuid: string
  title: string
  pieceDate?: string
  summary?: string
}

export interface PieceAddInput {
  dossierId: string
  /** Numbers are assigned following the array order. */
  items: PieceAddItem[]
}

export interface PieceUpdateInput {
  dossierId: string
  pieceUuid: string
  title: string
  pieceDate?: string
  summary?: string
}

export interface PieceRemoveInput {
  dossierId: string
  pieceUuid: string
}

export interface PieceGenerateOutputs {
  /** Single merged PDF: index pages followed by all stamped pièces. */
  bundle: boolean
  /** Standalone bordereau PDF (annexed to conclusions / RPVA). */
  bordereau: boolean
  /** One stamped PDF per pièce, named "Pièce n°X - intitulé.pdf". */
  individual: boolean
}

export interface PieceGenerateHeader {
  juridiction?: string
  rg?: string
  /** Free text, e.g. "Pour : X / Contre : Y". */
  parties?: string
  /** Place used in "Fait à {place}, le {date}". */
  place?: string
}

export interface PieceGenerateInput {
  dossierId: string
  outputs: PieceGenerateOutputs
  header?: PieceGenerateHeader
  /**
   * Date portée sur le bordereau (« Fait à …, le … ») et le dossier de sortie
   * (YYYY-MM-DD). Préremplie au dimanche de la semaine en cours (fin de
   * semaine) ; défaut service : aujourd'hui.
   */
  bordereauDate?: string
}

export type PieceGeneratedFileKind = 'bundle' | 'bordereau' | 'piece'

export interface PieceGenerateResult {
  /** Folder holding the generated files, relative to the dossier root. */
  outputFolderRelativePath: string
  files: Array<{
    kind: PieceGeneratedFileKind
    relativePath: string
    pieceNumber?: number
  }>
  failed: Array<{ pieceNumber: number; title: string; error: string }>
}

export type PieceGeneratePhase = 'converting' | 'stamping' | 'index' | 'merging' | 'writing'

export interface PieceGenerateProgressEvent {
  dossierId: string
  phase: PieceGeneratePhase
  current: number
  total: number
  /** Human-readable label of the item being processed (e.g. pièce title). */
  label?: string
}
