/**
 * documentContentService — unified text extraction for AI analysis.
 *
 * Strategy by file type:
 *   .txt / .md / plain text  → read directly (no cache needed, fast)
 *   .docx                    → mammoth text extraction → cached
 *   .pdf (digital)           → pdfjs-dist embedded text → cached
 *   .pdf (scanned)           → Tesseract.js OCR → cached
 *
 * The result (plain text + existing metadata) is intended to be sent to a
 * text-only LLM — no images are transmitted outside the device.
 */
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { OCR_COMMON_WORDS, OCR_KEYWORDS, OCR_LANGUAGES } from './ocrLexicon'

// Minimum count of "readable" characters to consider embedded PDF text usable.
const READABLE_CHARS_MIN = 50
const DEFAULT_MAX_OCR_PAGES = 100
const OCR_PAGE_TIMEOUT_MS = 60_000
const PARAGRAPH_SEPARATOR = '<NL>'
const MIN_OCR_READABLE_CHARS = 20
const MIN_OCR_CANDIDATE_SCORE = 80
const EARLY_ACCEPT_OCR_SCORE = 140
const SIDEWAYS_RETRY_SCORE = 50
const ORIENTATION_LOCK_SCORE = 110
// Minimum ratio of recognised words to total tokens to trust an orientation.
// Below this threshold the extracted text is likely garbled (wrong scan angle).
const MIN_RECOGNIZED_WORD_RATIO = 0.15

// Plain-text extensions that are read directly without caching.
const PLAIN_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm'])

export function isDocumentTextExtractable(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return PLAIN_TEXT_EXTENSIONS.has(ext) || ext === '.docx' || ext === '.pdf'
}

export function isPlainTextDocument(filePath: string): boolean {
  return PLAIN_TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export type ExtractMethod = 'direct' | 'docx' | 'embedded' | 'tesseract' | 'cached'

interface ContentCacheEntry {
  version: 2
  name: string
  method: Exclude<ExtractMethod, 'direct' | 'cached'>
  extractedAt: string
  text: string
  isEmpty?: boolean
}

export interface ExtractResult {
  text: string
  method: ExtractMethod
}

type PdfTextItem = {
  str?: string
  hasEOL?: boolean
  height?: number
  transform?: number[]
}

type OcrLine = {
  text?: string
  bbox?: { x0: number; y0: number; x1: number; y1: number }
  rowAttributes?: {
    rowHeight?: number
  }
}

type OcrParagraph = {
  text?: string
  lines?: OcrLine[]
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

type OcrBlock = {
  text?: string
  paragraphs?: OcrParagraph[]
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

type OcrPage = {
  text?: string
  blocks?: OcrBlock[] | null
  rotateRadians?: number | null
  confidence?: number | null
}

type OcrRotation = 'auto' | 0 | 90 | 180 | 270

let structuredClonePatchDepth = 0
let originalStructuredClone: typeof globalThis.structuredClone | null = null

async function withPatchedStructuredClone<T>(run: () => Promise<T>): Promise<T> {
  if (structuredClonePatchDepth === 0 && typeof globalThis.structuredClone === 'function') {
    originalStructuredClone = globalThis.structuredClone
    globalThis.structuredClone = ((value: unknown) =>
      originalStructuredClone?.(value)) as typeof globalThis.structuredClone
  }

  structuredClonePatchDepth += 1

  try {
    return await run()
  } finally {
    structuredClonePatchDepth -= 1
    if (structuredClonePatchDepth === 0 && originalStructuredClone) {
      globalThis.structuredClone = originalStructuredClone
      originalStructuredClone = null
    }
  }
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
    const entry = JSON.parse(raw) as {
      version?: 1 | 2
      text?: string
      isEmpty?: boolean
      [key: string]: unknown
    }
    const version = entry.version
    if (version === 1 && typeof entry.text === 'string' && entry.text.length > 0) {
      return entry.text
    }
    if (
      version === 2 &&
      typeof entry.text === 'string' &&
      (entry.text.length > 0 || entry.isEmpty === true)
    ) {
      return entry.text
    }
  } catch {
    // corrupt cache — fall through to re-process
  }
  return null
}

async function writeCache(
  cachePath: string,
  filePath: string,
  text: string,
  method: Exclude<ExtractMethod, 'direct' | 'cached'>
): Promise<void> {
  const entry: ContentCacheEntry = {
    version: 2,
    name: basename(filePath),
    method,
    extractedAt: new Date().toISOString(),
    text: normalizeExtractedText(text),
    isEmpty: false
  }
  await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf8')
}

async function writeEmptyCache(
  cachePath: string,
  filePath: string,
  method: Exclude<ExtractMethod, 'direct' | 'cached'>
): Promise<void> {
  const entry: ContentCacheEntry = {
    version: 2,
    name: basename(filePath),
    method,
    extractedAt: new Date().toISOString(),
    text: '',
    isEmpty: true
  }
  await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf8')
}

function cachePathFor(cacheDir: string, filePath: string): string {
  const key = createHash('sha1').update(basename(filePath)).digest('hex').slice(0, 16)
  return join(cacheDir, `${key}.json`)
}

export function getDocumentContentCachePath(cacheDir: string, filePath: string): string {
  return cachePathFor(cacheDir, filePath)
}

export async function markDocumentExtractionEmpty(
  filePath: string,
  cacheDir: string
): Promise<void> {
  const cachePath = cachePathFor(cacheDir, filePath)
  const ext = extname(filePath).toLowerCase()
  const method: Exclude<ExtractMethod, 'direct' | 'cached'> = ext === '.pdf' ? 'tesseract' : 'docx'

  await mkdir(cacheDir, { recursive: true })
  await writeEmptyCache(cachePath, filePath, method)
}

export function normalizeExtractedText(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim()
  if (!normalized) {
    return ''
  }

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n+ */g, ' ')
        .trim()
    )
    .filter(Boolean)

  return paragraphs.join(PARAGRAPH_SEPARATOR)
}

function sortByTopLeft<T extends { bbox?: { x0: number; y0: number } }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const topDiff = (left.bbox?.y0 ?? 0) - (right.bbox?.y0 ?? 0)
    if (Math.abs(topDiff) > 1) {
      return topDiff
    }
    return (left.bbox?.x0 ?? 0) - (right.bbox?.x0 ?? 0)
  })
}

function buildParagraphsFromLines(lines: OcrLine[]): string[] {
  const orderedLines = sortByTopLeft(lines).filter(
    (line) => typeof line.text === 'string' && line.text.trim()
  )

  if (orderedLines.length === 0) {
    return []
  }

  const groups: string[][] = []
  let currentGroup: string[] = []
  let previousBottom: number | null = null
  let previousHeight = 0

  for (const line of orderedLines) {
    const text = line.text!.trim()
    const top = line.bbox?.y0 ?? previousBottom ?? 0
    const bottom = line.bbox?.y1 ?? top
    const rowHeight = line.rowAttributes?.rowHeight ?? bottom - top
    const height = rowHeight > 0 ? rowHeight : previousHeight || 12
    const gap = previousBottom === null ? 0 : top - previousBottom
    const isParagraphBreak = previousBottom !== null && gap > Math.max(height * 0.8, 12)

    if (isParagraphBreak && currentGroup.length > 0) {
      groups.push(currentGroup)
      currentGroup = []
    }

    currentGroup.push(text)
    previousBottom = bottom
    previousHeight = height
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups.map((group) => group.join('\n'))
}

export function extractStructuredOcrText(page: OcrPage): string {
  const paragraphs = sortByTopLeft(page.blocks ?? [])
    .flatMap((block) => {
      const blockParagraphs = sortByTopLeft(block.paragraphs ?? [])
      if (blockParagraphs.length > 0) {
        return blockParagraphs.flatMap((paragraph) => {
          const fromLines = buildParagraphsFromLines(paragraph.lines ?? [])
          if (fromLines.length > 0) {
            return fromLines
          }

          const paragraphText = typeof paragraph.text === 'string' ? paragraph.text.trim() : ''
          return paragraphText ? [paragraphText] : []
        })
      }

      const blockLines = buildParagraphsFromLines(
        (block.paragraphs ?? []).flatMap((paragraph) => paragraph.lines ?? [])
      )
      if (blockLines.length > 0) {
        return blockLines
      }

      return typeof block.text === 'string' && block.text.trim() ? [block.text.trim()] : []
    })
    .filter(Boolean)

  if (paragraphs.length > 0) {
    return normalizeExtractedText(paragraphs.join('\n\n'))
  }

  return normalizeExtractedText(page.text ?? '')
}

export function hasReadableOcrText(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= MIN_OCR_READABLE_CHARS
}

export function extractOcrLexicalFeatures(text: string): {
  commonWordHits: number
  keywordHits: number
  recognizedWordRatio: number
} {
  const tokens =
    text
      .toLowerCase()
      .match(/\b[\p{L}][\p{L}\p{N}'’-]{1,}\b/gu)
      ?.map((token) => token.normalize('NFD').replace(/\p{Diacritic}/gu, '')) ?? []

  if (tokens.length === 0) {
    return { commonWordHits: 0, keywordHits: 0, recognizedWordRatio: 0 }
  }

  let commonWordHits = 0
  let keywordHits = 0
  for (const token of tokens) {
    if (OCR_COMMON_WORDS.has(token)) {
      commonWordHits += 1
    }
    if (OCR_KEYWORDS.has(token)) {
      keywordHits += 1
    }
  }

  const recognizedWordRatio = (commonWordHits + keywordHits) / tokens.length
  return { commonWordHits, keywordHits, recognizedWordRatio }
}

export function scoreOcrText(text: string, confidence = 0): number {
  const normalized = normalizeExtractedText(text)
  const readableChars = (normalized.match(/[\p{L}\p{N}]/gu) ?? []).length
  const wordCount = normalized.match(/\b[\p{L}][\p{L}\p{N}'’-]{2,}\b/gu)?.length ?? 0
  const suspiciousChars = normalized.match(/[|~_=<>^*#$%\\/]{2,}/g)?.length ?? 0
  const paragraphCount = normalized.split(PARAGRAPH_SEPARATOR).filter(Boolean).length
  const { commonWordHits, keywordHits, recognizedWordRatio } = extractOcrLexicalFeatures(normalized)

  return (
    readableChars +
    wordCount * 6 +
    paragraphCount * 4 +
    confidence * 3 +
    commonWordHits * 5 +
    keywordHits * 9 +
    recognizedWordRatio * 80 -
    suspiciousChars * 20
  )
}

export function shouldAcceptOcrCandidateEarly(
  score: number,
  text: string,
  recognizedWordRatio?: number
): boolean {
  if (!hasReadableOcrText(text) || score < EARLY_ACCEPT_OCR_SCORE) return false
  const ratio = recognizedWordRatio ?? extractOcrLexicalFeatures(text).recognizedWordRatio
  return ratio >= MIN_RECOGNIZED_WORD_RATIO
}

export function shouldTrySidewaysRotations(
  bestScore: number,
  bestText: string,
  recognizedWordRatio?: number
): boolean {
  if (bestScore < SIDEWAYS_RETRY_SCORE || !hasReadableOcrText(bestText)) return true
  // Even with a passing score, try sideways when word recognition is too low —
  // symptom of OCR run on a scan that is rotated 90° or 270°.
  const ratio = recognizedWordRatio ?? extractOcrLexicalFeatures(bestText).recognizedWordRatio
  return ratio < MIN_RECOGNIZED_WORD_RATIO
}

export function shouldLockOcrOrientation(score: number, text: string): boolean {
  return score >= ORIENTATION_LOCK_SCORE && hasReadableOcrText(text)
}

export function resolveAutoDetectedRotation(
  rotateRadians: number | null | undefined
): Exclude<OcrRotation, 'auto'> | null {
  if (typeof rotateRadians !== 'number' || Number.isNaN(rotateRadians)) {
    return null
  }

  const degrees = (((Math.round((rotateRadians * 180) / Math.PI / 90) * 90) % 360) + 360) % 360
  if (degrees === 0 || degrees === 90 || degrees === 180 || degrees === 270) {
    return degrees as Exclude<OcrRotation, 'auto'>
  }

  return null
}

function rotateCanvasToPng(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceCanvas: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCanvas: any,
  rotation: Exclude<OcrRotation, 'auto'>
): Buffer {
  if (rotation === 0) {
    return sourceCanvas.toBuffer('image/png')
  }

  const quarterTurn = rotation === 90 || rotation === 270
  const targetCanvas = createCanvas(
    quarterTurn ? sourceCanvas.height : sourceCanvas.width,
    quarterTurn ? sourceCanvas.width : sourceCanvas.height
  )
  const ctx = targetCanvas.getContext('2d')
  ctx.translate(targetCanvas.width / 2, targetCanvas.height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2)

  return targetCanvas.toBuffer('image/png')
}

async function recognizeOcrCandidate(
  worker: {
    recognize: (
      image: string,
      options?: Partial<{ rotateAuto: boolean }>,
      output?: Partial<{ text: boolean; blocks: boolean }>
    ) => Promise<{ data: OcrPage }>
  },
  imagePath: string,
  rotation: OcrRotation
): Promise<{
  text: string
  score: number
  recognizedWordRatio: number
  detectedRotation: Exclude<OcrRotation, 'auto'> | null
}> {
  const result = await worker.recognize(
    imagePath,
    rotation === 'auto' ? { rotateAuto: true } : {},
    { text: true, blocks: true }
  )
  const text = extractStructuredOcrText(result.data)
  const { recognizedWordRatio } = extractOcrLexicalFeatures(text)
  const score = scoreOcrText(text, result.data.confidence ?? 0)
  return {
    text,
    score,
    recognizedWordRatio,
    detectedRotation:
      rotation === 'auto' ? resolveAutoDetectedRotation(result.data.rotateRadians) : rotation
  }
}

/** Extract text from a .docx file using mammoth. */
async function extractDocxText(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mammoth = (await import('mammoth')) as any
  const result = await mammoth.extractRawText({ path: filePath })
  return normalizeExtractedText(result.value as string)
}

/** Try to extract embedded text from a PDF (digital/born-digital). */
async function extractPdfEmbeddedText(data: Uint8Array): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { getDocument } = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any
  return withPatchedStructuredClone(async () => {
    const loadingTask = getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      useWasm: false,
      verbosity: 0
    })
    const pdfDoc = await loadingTask.promise

    try {
      const texts: string[] = []
      for (let i = 1; i <= (pdfDoc.numPages as number); i++) {
        const page = await pdfDoc.getPage(i)
        const content = await page.getTextContent()
        const items = content.items as PdfTextItem[]
        const pageParts: string[] = []
        let lastY: number | null = null

        for (const item of items) {
          const rawText = typeof item.str === 'string' ? item.str.trim() : ''
          if (!rawText) {
            continue
          }

          const y =
            Array.isArray(item.transform) && typeof item.transform[5] === 'number'
              ? item.transform[5]
              : null
          const lineHeight = typeof item.height === 'number' && item.height > 0 ? item.height : 12

          if (pageParts.length > 0) {
            const gap = y !== null && lastY !== null ? Math.abs(lastY - y) : 0
            if (gap > lineHeight * 1.2) {
              pageParts.push('\n\n')
            } else if (gap > lineHeight * 0.35) {
              pageParts.push('\n')
            } else {
              pageParts.push(' ')
            }
          }

          pageParts.push(rawText)

          if (item.hasEOL) {
            pageParts.push('\n')
          }

          lastY = y
        }

        const pageText = normalizeExtractedText(pageParts.join(''))
        if (pageText) texts.push(pageText)
      }
      return normalizeExtractedText(texts.join('\n\n'))
    } finally {
      await loadingTask.destroy()
    }
  })
}

/** Render each PDF page to an image and run Tesseract OCR (scanned PDFs). */
async function runTesseractOcr(data: Uint8Array, langDataPath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { getDocument } = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { createWorker } = (await import('tesseract.js')) as any
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const { createCanvas } = require('@napi-rs/canvas') as any

  return withPatchedStructuredClone(async () => {
    const loadingTask = getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      useWasm: false,
      verbosity: 0
    })
    const pdfDoc = await loadingTask.promise

    const pageCount = Math.min(pdfDoc.numPages as number, DEFAULT_MAX_OCR_PAGES)

    const worker = await createWorker([...OCR_LANGUAGES], 1, {
      langPath: langDataPath,
      cacheMethod: 'readOnly',
      gzip: false,
      logger: () => {}
    })

    try {
      const texts: string[] = []
      let preferredRotation: Exclude<OcrRotation, 'auto'> | null = null
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
        const candidatePaths = new Map<OcrRotation, string>()
        const baseTmpPath = join(tmpdir(), `ocr-${randomUUID()}.png`)
        await writeFile(baseTmpPath, canvas.toBuffer('image/png'))
        candidatePaths.set('auto', baseTmpPath)
        candidatePaths.set(0, baseTmpPath)

        let text = ''
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('OCR page timeout')), OCR_PAGE_TIMEOUT_MS)
          )
          let best: {
            text: string
            score: number
            recognizedWordRatio: number
            rotation: OcrRotation
            detectedRotation: Exclude<OcrRotation, 'auto'> | null
          } = {
            text: '',
            score: 0,
            recognizedWordRatio: 0,
            rotation: 'auto',
            detectedRotation: null
          }
          const runCandidate = async (
            rotation: OcrRotation
          ): Promise<{
            text: string
            score: number
            recognizedWordRatio: number
            rotation: OcrRotation
            detectedRotation: Exclude<OcrRotation, 'auto'> | null
          }> => {
            let path = candidatePaths.get(rotation)
            if (!path) {
              path = join(tmpdir(), `ocr-${randomUUID()}-${rotation}.png`)
              await writeFile(
                path,
                rotateCanvasToPng(canvas, createCanvas, rotation as Exclude<OcrRotation, 'auto'>)
              )
              candidatePaths.set(rotation, path)
            }

            const candidate = await Promise.race([
              recognizeOcrCandidate(worker, path, rotation),
              timeoutPromise
            ])
            return { ...candidate, rotation }
          }

          const primaryRotations: OcrRotation[] =
            preferredRotation === null ? [0, 180] : [preferredRotation]

          for (const rotation of primaryRotations) {
            const candidate = await runCandidate(rotation)
            if (candidate.score > best.score) {
              best = candidate
            }

            if (
              shouldAcceptOcrCandidateEarly(
                candidate.score,
                candidate.text,
                candidate.recognizedWordRatio
              )
            ) {
              break
            }

            if (
              (rotation === 0 || rotation === 180) &&
              hasReadableOcrText(candidate.text) &&
              candidate.score >= MIN_OCR_CANDIDATE_SCORE &&
              candidate.recognizedWordRatio >= MIN_RECOGNIZED_WORD_RATIO
            ) {
              break
            }
          }

          if (
            preferredRotation !== null &&
            best.score < MIN_OCR_CANDIDATE_SCORE &&
            best.rotation === preferredRotation
          ) {
            for (const rotation of preferredRotation === 180 ? [0, 90, 270] : [180, 90, 270]) {
              const typedRotation = rotation as OcrRotation
              const candidate = await runCandidate(typedRotation)
              if (candidate.score > best.score) {
                best = candidate
              }

              if (
                shouldAcceptOcrCandidateEarly(
                  candidate.score,
                  candidate.text,
                  candidate.recognizedWordRatio
                )
              ) {
                break
              }
            }
          } else if (shouldTrySidewaysRotations(best.score, best.text, best.recognizedWordRatio)) {
            for (const rotation of [90, 270] as OcrRotation[]) {
              const candidate = await runCandidate(rotation)
              if (candidate.score > best.score) {
                best = candidate
              }

              if (
                shouldAcceptOcrCandidateEarly(
                  candidate.score,
                  candidate.text,
                  candidate.recognizedWordRatio
                )
              ) {
                break
              }
            }
          }

          if (best.score >= MIN_OCR_CANDIDATE_SCORE) {
            text = best.text
          }
          if (shouldLockOcrOrientation(best.score, best.text)) {
            preferredRotation =
              best.detectedRotation ?? (best.rotation === 'auto' ? 0 : best.rotation)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message === 'OCR page timeout') {
            text = ''
          } else {
            throw err
          }
        } finally {
          await Promise.all(
            [...new Set(candidatePaths.values())].map((path) => unlink(path).catch(() => {}))
          )
        }
        const cleaned = normalizeExtractedText(text)
        if (!hasReadableOcrText(cleaned)) {
          continue
        }
        if (cleaned) texts.push(cleaned)
      }
      return normalizeExtractedText(texts.join('\n\n'))
    } finally {
      await worker.terminate()
      await loadingTask.destroy()
    }
  })
}

/**
 * Read document text from cache only — never triggers extraction or OCR.
 * Plain text files are read directly (they have no cache).
 * Returns null if the document has not been extracted yet.
 */
export async function readCachedDocumentText(
  filePath: string,
  cacheDir: string
): Promise<ExtractResult | null> {
  const ext = extname(filePath).toLowerCase()

  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    const text = normalizeExtractedText(await readFile(filePath, 'utf8'))
    return { text, method: 'direct' }
  }

  const cachePath = cachePathFor(cacheDir, filePath)
  const cached = await readCache(cachePath)
  if (cached !== null) {
    return { text: cached, method: 'cached' }
  }

  return null
}

export async function updateCachedDocumentText(
  filePath: string,
  cacheDir: string,
  text: string
): Promise<void> {
  const ext = extname(filePath).toLowerCase()
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return
  }

  const cachePath = cachePathFor(cacheDir, filePath)
  const existingRaw = await readFile(cachePath, 'utf8').catch(() => null)
  let method: Exclude<ExtractMethod, 'direct' | 'cached'> = ext === '.pdf' ? 'embedded' : 'docx'

  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as Partial<ContentCacheEntry>
      if (
        typeof existing.method === 'string' &&
        (existing.method === 'docx' ||
          existing.method === 'embedded' ||
          existing.method === 'tesseract')
      ) {
        method = existing.method
      }
    } catch {
      // Ignore corrupt cache metadata and rewrite with a sensible default.
    }
  }

  await mkdir(cacheDir, { recursive: true })
  await writeCache(cachePath, filePath, normalizeExtractedText(text), method)
}

/**
 * Extract text content from any supported document file.
 *
 * @param filePath     Absolute path to the document.
 * @param cacheDir     Directory where content cache JSON files are stored.
 * @param langDataPath Directory containing Tesseract traineddata files (required for PDF OCR).
 */
export async function extractDocumentText(
  filePath: string,
  cacheDir: string,
  langDataPath?: string
): Promise<ExtractResult> {
  const ext = extname(filePath).toLowerCase()

  // Plain text: read directly, no cache needed.
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    const text = normalizeExtractedText(await readFile(filePath, 'utf8'))
    return { text, method: 'direct' }
  }

  // All other types: check cache first.
  const cachePath = cachePathFor(cacheDir, filePath)
  const cached = await readCache(cachePath)
  if (cached !== null) {
    return { text: cached, method: 'cached' }
  }

  // DOCX: mammoth extraction.
  if (ext === '.docx') {
    const text = await extractDocxText(filePath)
    await mkdir(cacheDir, { recursive: true })
    await writeCache(cachePath, filePath, text, 'docx')
    return { text, method: 'docx' }
  }

  // PDF: try embedded text first, fall back to Tesseract.
  if (ext === '.pdf') {
    // readFile returns a Node.js Buffer whose underlying ArrayBuffer is managed
    // by native C++ memory. pdfjs tries to transfer data.buffer via structuredClone
    // which throws "Cannot transfer object of unsupported type" for native-backed
    // ArrayBuffers. .slice() produces a fresh, JS-heap-only ArrayBuffer copy.
    const raw = await readFile(filePath)
    const data = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))

    // Prefer embedded text first: it is faster, cheaper, and usually more accurate
    // than OCR when the PDF already contains a text layer.
    const embeddedText = await extractPdfEmbeddedText(data)
    const readableCount = (embeddedText.match(/[\p{L}\p{N}\s.,;:!?()\-'"]/gu) ?? []).length
    if (readableCount >= READABLE_CHARS_MIN) {
      await mkdir(cacheDir, { recursive: true })
      await writeCache(cachePath, filePath, embeddedText, 'embedded')
      return { text: embeddedText, method: 'embedded' }
    }

    if (!langDataPath) {
      // Only require tessdata at the point where OCR is actually needed.
      // Reason: plain text, DOCX, and digital PDFs should still be analyzable
      // even when OCR resources are unavailable on the current install.
      throw new Error('OCR data is not configured for scanned PDF extraction.')
    }

    const ocrText = await runTesseractOcr(data, langDataPath)
    await mkdir(cacheDir, { recursive: true })
    await writeCache(cachePath, filePath, ocrText, 'tesseract')
    return { text: ocrText, method: 'tesseract' }
  }

  throw new Error(`Unsupported file type: ${ext || '(no extension)'}`)
}
