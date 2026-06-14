/**
 * piecesService — cotation des pièces of a dossier and generation of the
 * communication deliverables.
 *
 * CRUD: the pieces array lives inline in dossier.json (like documents) and is
 * mutated through the same per-dossier metadata lock as documentService, so a
 * concurrent rename/move can never clobber a cotation write (or vice versa).
 *
 * Numbering invariant: a pièce receives max+1 on add and keeps that number
 * forever. Removal leaves a gap; numbers are never reused (French procedural
 * practice — the numbering is continuous for the whole procedure).
 *
 * generate() produces, in a date-stamped subfolder of the dossier:
 *  - the standalone bordereau PDF (annexed to conclusions / RPVA)
 *  - the merged bundle (index pages + stamped pièces in numeric order)
 *  - one stamped PDF per pièce ("Pièce n°X - intitulé.pdf") for RPVA filing
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import type { PDFDocument as PdfLibDocument } from 'pdf-lib'

import {
  IpcErrorCode,
  type DossierScopedQuery,
  type EntityProfile,
  type PieceAddInput,
  type PieceGenerateInput,
  type PieceGenerateProgressEvent,
  type PieceGenerateResult,
  type PieceRecord,
  type PieceRemoveInput,
  type PieceStampPosition,
  type PieceUpdateInput,
  type StoredDocumentMetadata
} from '@shared/types'

import {
  pieceAddInputSchema,
  pieceGenerateInputSchema,
  pieceRemoveInputSchema,
  pieceUpdateInputSchema
} from '@shared/validation'
import { dossierScopedQuerySchema } from '@shared/validation/dossier'

import { pathExists } from '../../../lib/system/domainState'
import {
  readDossierMetadataFile,
  resolveSafePathInDossier,
  withDossierMetadataLock,
  writeDossierMetadataFile,
  type DocumentService
} from '../documentService'
import type { EntityService } from '../entityService'
import { buildBordereauHtml, type BordereauRow } from './bordereauHtml'
import { assembleBundle, type PageAssignment } from './bundleAssembler'
import { convertSourceToPdf, isPieceSourceSupported } from './pieceSourceToPdf'
import { PiecesServiceError } from './piecesError'
import { applyStampToFirstPage, embedStampAssets, renderGeneratedStampPng } from './stampRenderer'

const OUTPUT_FOLDER_NAME = 'Pièces communiquées'
const DEFAULT_STAMP_POSITION: PieceStampPosition = 'top-right'
const MAX_OUTPUT_FILENAME_LENGTH = 120

export type PieceGenerateProgressCallback = (event: PieceGenerateProgressEvent) => void

export interface PiecesService {
  list(input: DossierScopedQuery): Promise<PieceRecord[]>
  add(input: PieceAddInput): Promise<PieceRecord[]>
  update(input: PieceUpdateInput): Promise<PieceRecord[]>
  remove(input: PieceRemoveInput): Promise<PieceRecord[]>
  generate(
    input: PieceGenerateInput,
    onProgress?: PieceGenerateProgressCallback
  ): Promise<PieceGenerateResult>
}

export interface PiecesServiceOptions {
  documentService: DocumentService
  entityService: EntityService
  /** Renders the bordereau/index HTML to PDF (Electron printToPDF). */
  printHtmlToPdf?: (html: string, outputPath: string) => Promise<void>
  /** Converts a .docx pièce to a layout-faithful PDF (docx-preview window). */
  docxToPdf?: (docxAbsolutePath: string, outputPath: string) => Promise<void>
}

function sortedPieces(pieces: PieceRecord[]): PieceRecord[] {
  return [...pieces].sort((left, right) => left.pieceNumber - right.pieceNumber)
}

const FORBIDDEN_FILENAME_CHARS = /[\\/:*?"<>|]/g
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f]/g

function sanitizeOutputFilename(raw: string): string {
  const cleaned = raw
    .replace(FORBIDDEN_FILENAME_CHARS, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  const capped =
    cleaned.length > MAX_OUTPUT_FILENAME_LENGTH
      ? cleaned.slice(0, MAX_OUTPUT_FILENAME_LENGTH).trim()
      : cleaned
  return capped || 'document'
}

async function resolveCollisionFreeTarget(directory: string, filename: string): Promise<string> {
  const dotIndex = filename.lastIndexOf('.')
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : ''

  let candidate = join(directory, filename)
  for (let attempt = 2; await pathExists(candidate); attempt += 1) {
    candidate = join(directory, `${stem} (${attempt})${extension}`)
  }
  return candidate
}

export function createPiecesService(options: PiecesServiceOptions): PiecesService {
  const { documentService, entityService, printHtmlToPdf, docxToPdf } = options

  async function loadMetadataOrThrow(
    dossierPath: string
  ): Promise<Awaited<ReturnType<typeof readDossierMetadataFile>> & { ok: true }> {
    const result = await readDossierMetadataFile(dossierPath)
    if (!result.ok) {
      throw new PiecesServiceError(
        IpcErrorCode.FILE_SYSTEM_ERROR,
        'Dossier metadata is missing or invalid.'
      )
    }
    return result
  }

  /** Render HTML to PDF bytes through the injected printer, via a temp file. */
  async function renderHtmlToPdfBytes(html: string): Promise<Uint8Array> {
    if (!printHtmlToPdf) {
      throw new PiecesServiceError(
        IpcErrorCode.NOT_IMPLEMENTED,
        'PDF rendering is unavailable in this environment.'
      )
    }
    const tempPath = join(tmpdir(), `ordicab-bordereau-${randomUUID()}.pdf`)
    try {
      await printHtmlToPdf(html, tempPath)
      return new Uint8Array(await readFile(tempPath))
    } finally {
      await rm(tempPath, { force: true })
    }
  }

  async function loadStampPng(profile: EntityProfile | null): Promise<Uint8Array> {
    const importedPath = await entityService.getStampImagePath().catch(() => null)
    if (importedPath) {
      return new Uint8Array(await readFile(importedPath))
    }
    return renderGeneratedStampPng(profile)
  }

  return {
    async list(input): Promise<PieceRecord[]> {
      const parsed = dossierScopedQuerySchema.parse(input)
      const dossierPath = await documentService.resolveRegisteredDossierRoot(parsed)
      const result = await readDossierMetadataFile(dossierPath)
      return result.ok ? sortedPieces(result.metadata.pieces) : []
    },

    async add(input): Promise<PieceRecord[]> {
      const parsed = pieceAddInputSchema.parse(input)
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: parsed.dossierId
      })

      // Materialize uuids for every file first: listDocuments persists missing
      // uuids into dossier.json, so the lookup below sees a complete map.
      const documents = await documentService.listDocuments({ dossierId: parsed.dossierId })
      const documentsByUuid = new Map(
        documents.flatMap((record) => (record.uuid ? [[record.uuid, record] as const] : []))
      )

      return withDossierMetadataLock(dossierPath, async () => {
        const { metadata } = await loadMetadataOrThrow(dossierPath)
        const cotedUuids = new Set(metadata.pieces.map((piece) => piece.documentUuid))
        let nextNumber =
          metadata.pieces.reduce((max, piece) => Math.max(max, piece.pieceNumber), 0) + 1

        const additions: PieceRecord[] = []
        for (const item of parsed.items) {
          const record = documentsByUuid.get(item.documentUuid)
          if (!record) {
            throw new PiecesServiceError(
              IpcErrorCode.NOT_FOUND,
              `Document introuvable pour la pièce « ${item.title} ».`
            )
          }
          if (cotedUuids.has(item.documentUuid)) {
            throw new PiecesServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Le document « ${record.filename} » est déjà coté.`
            )
          }
          if (!isPieceSourceSupported(record.filename)) {
            throw new PiecesServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              `Format non pris en charge pour la pièce « ${record.filename} ».`
            )
          }
          cotedUuids.add(item.documentUuid)
          additions.push({
            uuid: randomUUID(),
            pieceNumber: nextNumber++,
            documentUuid: item.documentUuid,
            sourceFilename: record.filename,
            title: item.title,
            pieceDate: item.pieceDate,
            summary: item.summary,
            addedAt: new Date().toISOString()
          })
        }

        const nextMetadata = { ...metadata, pieces: [...metadata.pieces, ...additions] }
        await writeDossierMetadataFile(dossierPath, nextMetadata)
        return sortedPieces(nextMetadata.pieces)
      })
    },

    async update(input): Promise<PieceRecord[]> {
      const parsed = pieceUpdateInputSchema.parse(input)
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: parsed.dossierId
      })

      return withDossierMetadataLock(dossierPath, async () => {
        const { metadata } = await loadMetadataOrThrow(dossierPath)
        const index = metadata.pieces.findIndex((piece) => piece.uuid === parsed.pieceUuid)
        if (index === -1) {
          throw new PiecesServiceError(IpcErrorCode.NOT_FOUND, 'Cette pièce est introuvable.')
        }

        const nextPieces = [...metadata.pieces]
        nextPieces[index] = {
          ...nextPieces[index]!,
          title: parsed.title,
          pieceDate: parsed.pieceDate,
          summary: parsed.summary
        }
        const nextMetadata = { ...metadata, pieces: nextPieces }
        await writeDossierMetadataFile(dossierPath, nextMetadata)
        return sortedPieces(nextPieces)
      })
    },

    async remove(input): Promise<PieceRecord[]> {
      const parsed = pieceRemoveInputSchema.parse(input)
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: parsed.dossierId
      })

      return withDossierMetadataLock(dossierPath, async () => {
        const { metadata } = await loadMetadataOrThrow(dossierPath)
        if (!metadata.pieces.some((piece) => piece.uuid === parsed.pieceUuid)) {
          throw new PiecesServiceError(IpcErrorCode.NOT_FOUND, 'Cette pièce est introuvable.')
        }

        // The removed number is NOT reassigned: the remaining series keeps its
        // gaps so every already-cited "Pièce n°X" stays accurate.
        const nextPieces = metadata.pieces.filter((piece) => piece.uuid !== parsed.pieceUuid)
        const nextMetadata = { ...metadata, pieces: nextPieces }
        await writeDossierMetadataFile(dossierPath, nextMetadata)
        return sortedPieces(nextPieces)
      })
    },

    async generate(input, onProgress): Promise<PieceGenerateResult> {
      const parsed = pieceGenerateInputSchema.parse(input)
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: parsed.dossierId
      })
      const { metadata } = await loadMetadataOrThrow(dossierPath)
      const pieces = sortedPieces(metadata.pieces)
      if (pieces.length === 0) {
        throw new PiecesServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Aucune pièce cotée dans ce dossier.'
        )
      }

      const profile = await entityService.get().catch(() => null)
      const stampPosition = profile?.stampPosition ?? DEFAULT_STAMP_POSITION
      const stampPng = await loadStampPng(profile)

      const documentsByUuid = new Map<string, StoredDocumentMetadata>(
        metadata.documents.flatMap((entry) => (entry.uuid ? [[entry.uuid, entry] as const] : []))
      )

      // Bordereau date chosen in the dialog (defaults there to the Sunday
      // closing the current week); fallback: today.
      const generationDate = parsed.bordereauDate ?? new Date().toISOString().slice(0, 10)
      const outputFolderRelativePath = `${OUTPUT_FOLDER_NAME}/${generationDate}`
      const outputDir = resolveSafePathInDossier(dossierPath, outputFolderRelativePath)
      await mkdir(outputDir, { recursive: true })

      const emit = (event: Omit<PieceGenerateProgressEvent, 'dossierId'>): void => {
        onProgress?.({ dossierId: parsed.dossierId, ...event })
      }

      // --- Convert + stamp every pièce sequentially (memory + printToPDF). ---
      const converted: Array<{ piece: PieceRecord; document: PdfLibDocument }> = []
      const failed: PieceGenerateResult['failed'] = []

      for (const [index, piece] of pieces.entries()) {
        emit({
          phase: 'converting',
          current: index + 1,
          total: pieces.length,
          label: `Pièce n°${piece.pieceNumber} — ${piece.title}`
        })
        try {
          const stored = documentsByUuid.get(piece.documentUuid)
          if (!stored) {
            throw new PiecesServiceError(
              IpcErrorCode.NOT_FOUND,
              'Le document source est introuvable dans le dossier.'
            )
          }
          const absolutePath = resolveSafePathInDossier(dossierPath, stored.relativePath)
          if (!(await pathExists(absolutePath))) {
            throw new PiecesServiceError(
              IpcErrorCode.NOT_FOUND,
              'Le fichier source est introuvable sur le disque.'
            )
          }

          const document = await convertSourceToPdf(absolutePath, { docxToPdf })
          if (document.getPageCount() === 0) {
            throw new PiecesServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              'Le document converti ne contient aucune page.'
            )
          }

          emit({
            phase: 'stamping',
            current: index + 1,
            total: pieces.length,
            label: `Pièce n°${piece.pieceNumber}`
          })
          const assets = await embedStampAssets(document, stampPng)
          await applyStampToFirstPage(document, assets, {
            pieceNumber: piece.pieceNumber,
            position: stampPosition
          })
          converted.push({ piece, document })
        } catch (error) {
          failed.push({
            pieceNumber: piece.pieceNumber,
            title: piece.title,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      if (converted.length === 0) {
        throw new PiecesServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          `Aucune pièce n'a pu être préparée (${failed.length} en échec).`
        )
      }

      const files: PieceGenerateResult['files'] = []
      const toBordereauRow = (piece: PieceRecord): BordereauRow => ({
        pieceNumber: piece.pieceNumber,
        title: piece.title,
        pieceDate: piece.pieceDate,
        summary: piece.summary,
        isNew: !piece.communicatedAt
      })

      // --- Standalone bordereau (lists ALL pièces, even failed conversions:
      // the bordereau reflects the cotation, not the bundle content). ---
      if (parsed.outputs.bordereau) {
        emit({ phase: 'index', current: 1, total: 1, label: 'Bordereau' })
        const html = buildBordereauHtml({
          variant: 'bordereau',
          rows: pieces.map(toBordereauRow),
          profile,
          header: parsed.header,
          dossierName: metadata.name,
          date: generationDate
        })
        const bytes = await renderHtmlToPdfBytes(html)
        const target = await resolveCollisionFreeTarget(outputDir, 'Bordereau de pièces.pdf')
        await writeFile(target, bytes)
        files.push({ kind: 'bordereau', relativePath: relative(dossierPath, target) })
      }

      // --- Merged bundle: index pages + stamped pièces in numeric order. ---
      if (parsed.outputs.bundle) {
        emit({ phase: 'merging', current: 1, total: 1, label: 'Fusion des pièces' })
        const rowByNumber = new Map(
          converted.map(({ piece }) => [piece.pieceNumber, toBordereauRow(piece)])
        )
        const { bytes } = await assembleBundle({
          pieces: converted.map(({ piece, document }) => ({
            pieceNumber: piece.pieceNumber,
            document
          })),
          renderIndexPdf: async (assignments: PageAssignment[] | null) => {
            const rows = converted.map(({ piece }) => {
              const assignment = assignments?.find(
                (entry) => entry.pieceNumber === piece.pieceNumber
              )
              return {
                ...rowByNumber.get(piece.pieceNumber)!,
                pageStart: assignment?.pageStart ?? 999,
                pageCount: assignment?.pageCount
              }
            })
            return renderHtmlToPdfBytes(
              buildBordereauHtml({
                variant: 'bundle-index',
                rows,
                profile,
                header: parsed.header,
                dossierName: metadata.name,
                date: generationDate
              })
            )
          }
        })

        emit({ phase: 'writing', current: 1, total: 1, label: 'Écriture du dossier de pièces' })
        const firstNumber = converted[0]!.piece.pieceNumber
        const lastNumber = converted[converted.length - 1]!.piece.pieceNumber
        const bundleName =
          converted.length > 1
            ? `Pièces n°${firstNumber} à ${lastNumber}.pdf`
            : `Pièce n°${firstNumber} (reliée).pdf`
        const target = await resolveCollisionFreeTarget(outputDir, bundleName)
        await writeFile(target, bytes)
        files.push({ kind: 'bundle', relativePath: relative(dossierPath, target) })
      }

      // --- One stamped PDF per pièce, named for RPVA filing. ---
      if (parsed.outputs.individual) {
        for (const [index, { piece, document }] of converted.entries()) {
          emit({
            phase: 'writing',
            current: index + 1,
            total: converted.length,
            label: `Pièce n°${piece.pieceNumber} — ${piece.title}`
          })
          const filename = sanitizeOutputFilename(
            `Pièce n°${piece.pieceNumber} - ${piece.title}.pdf`
          )
          const target = await resolveCollisionFreeTarget(outputDir, filename)
          await writeFile(target, await document.save())
          files.push({
            kind: 'piece',
            relativePath: relative(dossierPath, target),
            pieceNumber: piece.pieceNumber
          })
        }
      }

      // --- Mark pièces as communicated (first bordereau/bundle generation). ---
      if (parsed.outputs.bordereau || parsed.outputs.bundle) {
        const communicatedAt = new Date().toISOString()
        const includedIds = new Set(
          (parsed.outputs.bordereau ? pieces : converted.map(({ piece }) => piece)).map(
            (piece) => piece.uuid
          )
        )
        await withDossierMetadataLock(dossierPath, async () => {
          const { metadata: current } = await loadMetadataOrThrow(dossierPath)
          const nextPieces = current.pieces.map((piece) =>
            includedIds.has(piece.uuid) && !piece.communicatedAt
              ? { ...piece, communicatedAt }
              : piece
          )
          await writeDossierMetadataFile(dossierPath, { ...current, pieces: nextPieces })
        })
      }

      return {
        outputFolderRelativePath,
        files: files.map((file) => ({
          ...file,
          relativePath: file.relativePath.split('\\').join('/')
        })),
        failed
      }
    }
  }
}
