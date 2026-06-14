/**
 * Converts a pièce source file into a pdf-lib PDFDocument ready for stamping
 * and merging.
 *
 *  - .pdf passes through (owner-password encryption ignored when possible)
 *  - images (.png/.jpg/.jpeg/.tif/.tiff) are laid out on A4 pages
 *  - .docx goes through the injected docxToPdf converter (docx-preview in a
 *    hidden window — layout-faithful rendering)
 *
 * Pure Node module: the BrowserWindow-backed docxToPdf is injected by the
 * container, like invoiceService.
 */
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'

import type { PDFDocument as PdfLibDocument } from 'pdf-lib'

import { IpcErrorCode } from '@shared/types'

import { PiecesServiceError } from './piecesError'

// A4 in PDF points.
const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const A4_MARGIN = 36

const PIECE_SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.docx'
] as const

export function isPieceSourceSupported(filename: string): boolean {
  const extension = extname(filename).toLowerCase()
  return (PIECE_SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)
}

export interface ConvertSourceToPdfOptions {
  docxToPdf?: (docxAbsolutePath: string, outputPath: string) => Promise<void>
}

async function loadPdf(bytes: Uint8Array): Promise<PdfLibDocument> {
  const { PDFDocument } = await import('pdf-lib')
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PiecesServiceError(
      IpcErrorCode.VALIDATION_FAILED,
      `This PDF could not be read: ${message}`
    )
  }
}

/** Place one raster image per A4 page, fitted inside the margins. */
async function imagePagesToPdf(
  pngPages: Uint8Array[],
  embedAsJpg: Uint8Array | null
): Promise<PdfLibDocument> {
  const { PDFDocument } = await import('pdf-lib')
  const output = await PDFDocument.create()

  const images = embedAsJpg
    ? [await output.embedJpg(embedAsJpg)]
    : await Promise.all(pngPages.map((page) => output.embedPng(page)))

  for (const image of images) {
    const page = output.addPage([A4_WIDTH, A4_HEIGHT])
    const maxWidth = A4_WIDTH - 2 * A4_MARGIN
    const maxHeight = A4_HEIGHT - 2 * A4_MARGIN
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, {
      x: (A4_WIDTH - width) / 2,
      y: A4_HEIGHT - A4_MARGIN - height,
      width,
      height
    })
  }

  return output
}

async function tiffToPngPages(absolutePath: string): Promise<Uint8Array[]> {
  const importedUtif = (await import('utif')) as typeof import('utif') & {
    default?: typeof import('utif')
  }
  const utif = importedUtif.default ?? importedUtif
  const { createCanvas } = await import('@napi-rs/canvas')

  const raw = await readFile(absolutePath)
  const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const directories = utif.decode(arrayBuffer)

  const pages: Uint8Array[] = []
  for (const directory of directories) {
    utif.decodeImage(arrayBuffer, directory)
    const width = directory.width ?? 0
    const height = directory.height ?? 0
    if (width < 3 || height < 3) continue

    const rgba = utif.toRGBA8(directory)
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(width, height)
    imageData.data.set(rgba)
    ctx.putImageData(imageData, 0, 0)
    pages.push(await canvas.encode('png'))
  }

  if (pages.length === 0) {
    throw new PiecesServiceError(
      IpcErrorCode.VALIDATION_FAILED,
      'This TIFF image could not be decoded.'
    )
  }
  return pages
}

async function docxSourceToPdf(
  absolutePath: string,
  docxToPdf: ConvertSourceToPdfOptions['docxToPdf']
): Promise<PdfLibDocument> {
  if (!docxToPdf) {
    throw new PiecesServiceError(
      IpcErrorCode.NOT_IMPLEMENTED,
      'Word conversion is unavailable in this environment.'
    )
  }

  const tempPath = join(tmpdir(), `ordicab-piece-${randomUUID()}.pdf`)
  try {
    await docxToPdf(absolutePath, tempPath)
    return await loadPdf(new Uint8Array(await readFile(tempPath)))
  } finally {
    await rm(tempPath, { force: true })
  }
}

export async function convertSourceToPdf(
  absolutePath: string,
  options: ConvertSourceToPdfOptions
): Promise<PdfLibDocument> {
  const extension = extname(absolutePath).toLowerCase()

  switch (extension) {
    case '.pdf':
      return loadPdf(new Uint8Array(await readFile(absolutePath)))
    case '.png':
      return imagePagesToPdf([new Uint8Array(await readFile(absolutePath))], null)
    case '.jpg':
    case '.jpeg':
      return imagePagesToPdf([], new Uint8Array(await readFile(absolutePath)))
    case '.tif':
    case '.tiff':
      return imagePagesToPdf(await tiffToPngPages(absolutePath), null)
    case '.docx':
      return docxSourceToPdf(absolutePath, options.docxToPdf)
    default:
      throw new PiecesServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        `Unsupported pièce format: ${extension || 'unknown'}.`
      )
  }
}
