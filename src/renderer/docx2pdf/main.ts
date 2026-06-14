/**
 * Hidden docx2pdf conversion page — renders a DOCX with docx-preview so the
 * main process can capture it via webContents.printToPDF with full layout
 * fidelity (pagination, headers/footers, tables, embedded fonts), unlike the
 * semantic-only mammoth conversion it replaced.
 *
 * Protocol (see shared/contracts/docx2pdf.ts): main pushes the DOCX bytes on
 * `docx2pdf:render` through the docx2pdf preload bridge; this page renders and
 * replies on `docx2pdf:rendered` with the first section's page size in PDF
 * points (docx-preview sizes each page <section> in pt from the document's
 * sectPr, with margins as padding).
 */
import { renderAsync } from 'docx-preview'

import type { Docx2PdfRenderedPayload } from '@shared/contracts/docx2pdf'

declare global {
  interface Window {
    docx2pdfBridge: {
      onRender(callback: (data: Uint8Array) => void): void
      rendered(result: Docx2PdfRenderedPayload): void
    }
  }
}

// A4 in PDF points — fallback when the rendered section carries no usable size.
const A4_WIDTH_PT = 595.3
const A4_HEIGHT_PT = 841.9

function parsePt(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)pt$/.exec(value.trim())
  if (!match?.[1]) return null
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function render(data: Uint8Array): Promise<Docx2PdfRenderedPayload> {
  const styleHost = document.getElementById('style-host')!
  const bodyHost = document.getElementById('body-host')!

  // Copy into a fresh ArrayBuffer-backed view — the IPC payload's buffer is
  // typed ArrayBufferLike, which Blob refuses.
  await renderAsync(new Blob([new Uint8Array(data)]), bodyHost, styleHost, {
    className: 'docx2pdf',
    inWrapper: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    ignoreWidth: false,
    ignoreHeight: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true
  })

  // Let embedded @font-face fonts and images settle before main snapshots the
  // page — printToPDF captures whatever is laid out at call time.
  await document.fonts.ready
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)

  const firstSection = bodyHost.querySelector<HTMLElement>('section.docx2pdf')
  return {
    ok: true,
    pageWidthPt: parsePt(firstSection?.style.width ?? '') ?? A4_WIDTH_PT,
    pageHeightPt: parsePt(firstSection?.style.minHeight ?? '') ?? A4_HEIGHT_PT
  }
}

window.docx2pdfBridge.onRender((data) => {
  void render(data)
    .catch((error: unknown): Docx2PdfRenderedPayload => {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    })
    .then((result) => {
      window.docx2pdfBridge.rendered(result)
    })
})
