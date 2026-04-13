/**
 * documentOcrService — extracts text from PDF files for AI analysis.
 *
 * Strategy:
 *   1. Try pdfjs-dist embedded text extraction (fast, free, works on digital PDFs).
 *   2. If text is too short (scanned PDF), fall back to Tesseract.js OCR.
 *   3. Cache the extracted text in the dossier's .ordicab/ocr-cache/ folder to
 *      avoid re-processing the same file on subsequent requests.
 *
 * The result (plain text) is intended to be sent to a text-only LLM — no images
 * are transmitted outside the device.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'

// Minimum count of "readable" characters (Latin letters, digits, common punctuation)
// to consider embedded text usable. Below this, the PDF is treated as scanned.
const READABLE_CHARS_MIN = 50

interface OcrCacheEntry {
  version: 1
  method: 'embedded' | 'tesseract'
  extractedAt: string
  text: string
}

function toPngDataUrl(pngBuffer: Buffer): string {
  return `data:image/png;base64,${pngBuffer.toString('base64')}`
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readCache(cachePath: string): Promise<string | null> {
  if (!(await pathExists(cachePath))) return null
  try {
    const raw = await readFile(cachePath, 'utf8')
    const entry = JSON.parse(raw) as OcrCacheEntry
    if (entry.version === 1 && typeof entry.text === 'string' && entry.text.length > 0) {
      return entry.text
    }
  } catch {
    // corrupt cache — fall through to re-process
  }
  return null
}

async function writeCache(
  cachePath: string,
  text: string,
  method: 'embedded' | 'tesseract'
): Promise<void> {
  const entry: OcrCacheEntry = {
    version: 1,
    method,
    extractedAt: new Date().toISOString(),
    text
  }
  await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf8')
}

/**
 * Try to extract embedded text from the PDF (works on digital/born-digital PDFs).
 * Returns empty string if the PDF has no embedded text layer.
 */
async function extractEmbeddedText(data: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { getDocument } = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any
  const pdfDoc = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise
  const texts: string[] = []
  for (let i = 1; i <= (pdfDoc.numPages as number); i++) {
    const page = await pdfDoc.getPage(i)
    const content = await page.getTextContent()
    const pageText = (content.items as Array<{ str?: string }>)
      .filter((item) => typeof item.str === 'string')
      .map((item) => item.str as string)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (pageText) texts.push(pageText)
  }
  return texts.join('\n\n')
}

/**
 * Render each PDF page to an image and run Tesseract OCR on it.
 * Used when embedded text extraction returns nothing (scanned PDFs).
 */
async function runTesseractOcr(data: Uint8Array, langDataPath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { getDocument } = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createWorker } = (await import('tesseract.js')) as any
  // `@napi-rs/canvas` top-level bootstrap touches GlobalFonts and can crash in
  // bundled Electron main-process builds. Load the native binding directly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { createCanvas } = require('@napi-rs/canvas/js-binding') as any

  const pdfDoc = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise

  const MAX_PAGES = 20
  const OCR_PAGE_TIMEOUT_MS = 60_000
  const pageCount = Math.min(pdfDoc.numPages as number, MAX_PAGES)

  const worker = await createWorker(['fra', 'eng'], 1, {
    langPath: langDataPath,
    cacheMethod: 'readOnly',
    gzip: false
  })

  try {
    const texts: string[] = []
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvasWidth = Math.floor(viewport.width as number)
      const canvasHeight = Math.floor(viewport.height as number)
      // Tesseract requires a minimum image width of 3px — skip degenerate pages.
      if (canvasWidth < 3 || canvasHeight < 3) continue
      const canvas = createCanvas(canvasWidth, canvasHeight)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport }).promise
      // PNG gives better OCR quality than JPEG (no compression artifacts)
      const pngBuffer = canvas.toBuffer('image/png')
      // Electron can reject some native-backed buffers when Tesseract forwards
      // them to its worker thread. A data URL keeps the payload cloneable.
      const imageSource = toPngDataUrl(Buffer.from(pngBuffer))
      let text: string
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OCR page timeout')), OCR_PAGE_TIMEOUT_MS)
        )
        const result = await Promise.race([worker.recognize(imageSource), timeoutPromise])
        text = result.data.text as string
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message === 'OCR page timeout') {
          text = ''
        } else {
          throw err
        }
      }
      const cleaned = text.replace(/\s+/g, ' ').trim()
      if (cleaned) texts.push(cleaned)
    }
    return texts.join('\n\n')
  } finally {
    await worker.terminate()
  }
}

export interface ExtractResult {
  text: string
  method: 'embedded' | 'tesseract' | 'cached'
}

/**
 * Extract text from a PDF file, using cache when available.
 *
 * @param filePath    Absolute path to the PDF file.
 * @param cacheDir    Directory where OCR cache JSON files are stored.
 * @param langDataPath  Directory containing Tesseract traineddata files.
 */
export async function extractDocumentText(
  filePath: string,
  cacheDir: string,
  langDataPath: string
): Promise<ExtractResult> {
  // Cache key: SHA-1 of the filename (stable, no need to read the file twice).
  const cacheKey = createHash('sha1').update(basename(filePath)).digest('hex').slice(0, 16)
  const cachePath = join(cacheDir, `${cacheKey}.json`)

  const cached = await readCache(cachePath)
  if (cached !== null) {
    return { text: cached, method: 'cached' }
  }

  const data = new Uint8Array(await readFile(filePath))

  // Step 1 — try embedded text.
  // Count only "readable" characters (letters, digits, spaces, common punctuation)
  // to reject PDFs whose embedded layer contains only garbled/encoded glyphs.
  const embeddedText = await extractEmbeddedText(data)
  const readableCount = (embeddedText.match(/[\p{L}\p{N}\s.,;:!?()\-'"]/gu) ?? []).length
  if (readableCount >= READABLE_CHARS_MIN) {
    await mkdir(cacheDir, { recursive: true })
    await writeCache(cachePath, embeddedText, 'embedded')
    return { text: embeddedText, method: 'embedded' }
  }

  // Step 2 — scanned PDF: run Tesseract
  const ocrText = await runTesseractOcr(data, langDataPath)
  await mkdir(cacheDir, { recursive: true })
  await writeCache(cachePath, ocrText, 'tesseract')
  return { text: ocrText, method: 'tesseract' }
}
