/**
 * Channels and payloads exchanged between the main process and the hidden
 * docx2pdf conversion window.
 *
 * Deliberately kept out of IPC_CHANNELS (contracts/channels.ts): these are
 * private to the conversion window, and the docx2pdf preload runs sandboxed —
 * it must bundle to a single self-contained file, so it cannot share modules
 * (like the channels barrel) with the main preload without emitting a chunk
 * that a sandboxed preload cannot require.
 */

export const DOCX2PDF_CHANNELS = {
  /** main → page: Docx2PdfRenderPayload (DOCX bytes to render). */
  render: 'docx2pdf:render',
  /** page → main: Docx2PdfRenderedPayload (render outcome + page size). */
  rendered: 'docx2pdf:rendered'
} as const

/** main → page on `docx2pdf:render`. */
export interface Docx2PdfRenderPayload {
  /** Raw DOCX bytes (structured-clone friendly, no base64 size limits). */
  data: Uint8Array
}

/**
 * page → main on `docx2pdf:rendered`. On success carries the page size of the
 * first rendered section (in PDF points) so printToPDF can match the document
 * geometry exactly — docx-preview renders document margins as section padding,
 * so the print itself uses zero margins.
 */
export type Docx2PdfRenderedPayload =
  | { ok: true; pageWidthPt: number; pageHeightPt: number }
  | { ok: false; error: string }
