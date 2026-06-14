/**
 * High-fidelity DOCX→PDF conversion through a hidden BrowserWindow.
 *
 * Each call spins up a transient window loading the dedicated docx2pdf page
 * (src/renderer/docx2pdf.html), pushes the DOCX bytes over IPC, waits for the
 * page to render it with docx-preview, then captures the result with
 * webContents.printToPDF using the document's own page size (reported by the
 * page in PDF points) and zero margins — docx-preview already renders the
 * document margins as section padding.
 *
 * Electron-coupled by design (BrowserWindow, ipcMain); injected into domain
 * services by the container so they stay decoupled, like printHtmlToPdf.
 */
import { readFile, writeFile } from 'node:fs/promises'

import { BrowserWindow, ipcMain } from 'electron'

import {
  DOCX2PDF_CHANNELS,
  type Docx2PdfRenderedPayload,
  type Docx2PdfRenderPayload
} from '@shared/contracts/docx2pdf'

const PT_PER_INCH = 72
const DEFAULT_TIMEOUT_MS = 30_000

export interface CreateDocxToPdfOptions {
  /** Absolute path to the compiled docx2pdf preload bundle. */
  preloadPath: string
  /**
   * Loads the docx2pdf page into the window — the host decides between the
   * dev-server URL and the packaged file, like the main window.
   */
  loadPage: (window: BrowserWindow) => Promise<void>
  /** Budget for load + render before the conversion is aborted. */
  timeoutMs?: number
}

/**
 * Waits for the page's `docx2pdf:rendered` reply. Scoped to the window's
 * webContents id so concurrent conversions cannot cross wires.
 */
function waitForRendered(
  webContentsId: number,
  timeoutMs: number,
  documentPath: string
): Promise<Docx2PdfRenderedPayload> {
  return new Promise<Docx2PdfRenderedPayload>((resolvePromise, rejectPromise) => {
    const listener = (event: Electron.IpcMainEvent, payload: Docx2PdfRenderedPayload): void => {
      if (event.sender.id !== webContentsId) return
      cleanup()
      resolvePromise(payload)
    }
    const timer = setTimeout(() => {
      cleanup()
      rejectPromise(new Error(`DOCX rendering timed out after ${timeoutMs}ms for ${documentPath}.`))
    }, timeoutMs)
    function cleanup(): void {
      clearTimeout(timer)
      ipcMain.removeListener(DOCX2PDF_CHANNELS.rendered, listener)
    }
    ipcMain.on(DOCX2PDF_CHANNELS.rendered, listener)
  })
}

export function createDocxToPdf(
  options: CreateDocxToPdfOptions
): (docxAbsolutePath: string, outputPath: string) => Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async function docxToPdf(docxAbsolutePath, outputPath) {
    const data = new Uint8Array(await readFile(docxAbsolutePath))

    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    try {
      // Register the reply listener before sending so a fast render can't
      // slip through; the timeout covers page load + render together.
      const renderedPromise = waitForRendered(window.webContents.id, timeoutMs, docxAbsolutePath)
      await options.loadPage(window)
      const payload: Docx2PdfRenderPayload = { data }
      window.webContents.send(DOCX2PDF_CHANNELS.render, payload)

      const rendered = await renderedPromise
      if (!rendered.ok) {
        throw new Error(`DOCX rendering failed for ${docxAbsolutePath}: ${rendered.error}`)
      }

      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: false,
        pageSize: {
          width: rendered.pageWidthPt / PT_PER_INCH,
          height: rendered.pageHeightPt / PT_PER_INCH
        },
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 }
      })
      await writeFile(outputPath, pdf)
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}
