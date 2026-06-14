/**
 * Preload for the hidden docx2pdf conversion window. Exposes the minimal
 * bridge the page needs: receive DOCX bytes pushed by main, and report the
 * render outcome back. See shared/contracts/docx2pdf.ts for the protocol.
 */
import { contextBridge, ipcRenderer } from 'electron'

import {
  DOCX2PDF_CHANNELS,
  type Docx2PdfRenderedPayload,
  type Docx2PdfRenderPayload
} from '@shared/contracts/docx2pdf'

// Hard-fail if contextIsolation was accidentally disabled, like the main
// preload — without it the page could access Node.js directly.
if (!process.contextIsolated) {
  throw new Error(
    'contextIsolation must be enabled — docx2pdfBridge cannot be exposed safely without it.'
  )
}

try {
  contextBridge.exposeInMainWorld('docx2pdfBridge', {
    onRender(callback: (data: Uint8Array) => void): void {
      ipcRenderer.on(DOCX2PDF_CHANNELS.render, (_event, payload: Docx2PdfRenderPayload) => {
        callback(payload.data)
      })
    },
    rendered(result: Docx2PdfRenderedPayload): void {
      ipcRenderer.send(DOCX2PDF_CHANNELS.rendered, result)
    }
  })
} catch (error) {
  console.error(error)
}
