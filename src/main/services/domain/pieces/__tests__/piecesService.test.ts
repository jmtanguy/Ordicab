import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EntityProfile } from '@shared/types'

import { createDossierRegistryService } from '../../dossierRegistryService'
import { createDocumentService } from '../../documentService'
import type { EntityService } from '../../entityService'
import { createPiecesService } from '../piecesService'
import { assembleBundle } from '../bundleAssembler'
import { renderGeneratedStampPng } from '../stampRenderer'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-pieces-service-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const TEST_PROFILE: EntityProfile = {
  firmName: 'Cabinet Test',
  firstName: 'Jeanne',
  lastName: 'Martin',
  barreau: 'Paris',
  toque: 'A123',
  city: 'Paris'
}

function createEntityServiceMock(profile: EntityProfile | null): EntityService {
  return {
    get: async () => profile,
    update: async () => profile ?? ({ firmName: '' } as EntityProfile),
    importDefaultTemplate: async () => profile ?? ({ firmName: '' } as EntityProfile),
    getDefaultTemplatePath: async () => '',
    removeDefaultTemplate: async () => profile ?? ({ firmName: '' } as EntityProfile),
    importStamp: async () => profile ?? ({ firmName: '' } as EntityProfile),
    removeStamp: async () => profile ?? ({ firmName: '' } as EntityProfile),
    getStampImagePath: async () => null,
    getStampDataUrl: async () => null
  }
}

async function createPdfBytes(pageCount: number): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const document = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([595.28, 841.89])
  }
  return document.save()
}

async function createPngBytes(): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(40, 30)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 40, 30)
  return canvas.encode('png')
}

/** Stubbed printer: ignores the HTML and writes a fixed-size pdf-lib document. */
function createPrintStub(pageCount = 1): (html: string, outputPath: string) => Promise<void> {
  return async (_html, outputPath) => {
    await writeFile(outputPath, await createPdfBytes(pageCount))
  }
}

/** Stubbed DOCX converter: ignores the source and writes a fixed-size pdf-lib document. */
function createDocxToPdfStub(
  pageCount = 1
): (docxAbsolutePath: string, outputPath: string) => Promise<void> {
  return async (_docxAbsolutePath, outputPath) => {
    await writeFile(outputPath, await createPdfBytes(pageCount))
  }
}

async function setupDossier(name = 'Client Pieces'): Promise<{
  domainPath: string
  dossierPath: string
  stateFilePath: string
  dossierId: string
}> {
  const root = await createTempDir()
  const domainPath = join(root, 'domain')
  const stateFilePath = join(root, 'app-state.json')
  const dossierPath = join(domainPath, name)

  await mkdir(dossierPath, { recursive: true })
  await writeFile(
    stateFilePath,
    `${JSON.stringify({ selectedDomainPath: domainPath, updatedAt: '2026-03-14T08:00:00.000Z' }, null, 2)}\n`,
    'utf8'
  )

  const dossierService = createDossierRegistryService({
    stateFilePath,
    now: () => new Date('2026-03-14T08:30:00.000Z')
  })
  await dossierService.registerDossier({ slug: name })

  return { domainPath, dossierPath, stateFilePath, dossierId: name }
}

describe('piecesService CRUD', () => {
  it('assigns permanent numbers in item order, keeps gaps after removal, and never reuses them', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'a.pdf'), await createPdfBytes(1))
    await writeFile(join(dossierPath, 'b.pdf'), await createPdfBytes(1))
    await writeFile(join(dossierPath, 'c.pdf'), await createPdfBytes(1))

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE)
    })

    const documents = await documentService.listDocuments({ dossierId })
    const uuidOf = (filename: string): string =>
      documents.find((record) => record.filename === filename)!.uuid!

    const afterAdd = await piecesService.add({
      dossierId,
      items: [
        { documentUuid: uuidOf('b.pdf'), title: 'Pièce B' },
        { documentUuid: uuidOf('a.pdf'), title: 'Pièce A', pieceDate: '2026-01-10' }
      ]
    })
    expect(afterAdd.map((piece) => [piece.pieceNumber, piece.title])).toEqual([
      [1, 'Pièce B'],
      [2, 'Pièce A']
    ])

    // Removing n°1 leaves a gap; the next add takes 3, never 1.
    const pieceOne = afterAdd.find((piece) => piece.pieceNumber === 1)!
    const afterRemove = await piecesService.remove({ dossierId, pieceUuid: pieceOne.uuid })
    expect(afterRemove.map((piece) => piece.pieceNumber)).toEqual([2])

    const afterSecondAdd = await piecesService.add({
      dossierId,
      items: [{ documentUuid: uuidOf('c.pdf'), title: 'Pièce C' }]
    })
    expect(afterSecondAdd.map((piece) => piece.pieceNumber)).toEqual([2, 3])

    // Survives a metadata rewrite by documentService.
    await documentService.renameFile({ dossierId, documentPath: 'a.pdf', newFilename: 'a2.pdf' })
    const listed = await piecesService.list({ dossierId })
    expect(listed.map((piece) => piece.pieceNumber)).toEqual([2, 3])
  })

  it('survives dossierRegistryService rewrites (open → lastOpenedAt, update)', async () => {
    // Regression guard: registry readMetadata rebuilds the metadata object
    // field by field; if `pieces` is not threaded through, the very next
    // registry write (every dossier open!) silently erases the cotation.
    const { dossierPath, stateFilePath, dossierId } = await setupDossier('Client Registry')
    await writeFile(join(dossierPath, 'a.pdf'), await createPdfBytes(1))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-06-12T08:00:00.000Z')
    })
    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE)
    })

    const [document] = await documentService.listDocuments({ dossierId })
    await piecesService.add({
      dossierId,
      items: [{ documentUuid: document!.uuid!, title: 'Contrat' }]
    })

    await dossierService.openDossier({ dossierId })
    await dossierService.updateDossier({
      slug: dossierId,
      status: 'active',
      type: 'Bail commercial',
      juridiction: 'TJ Nice'
    })

    const listed = await piecesService.list({ dossierId })
    expect(listed.map((piece) => [piece.pieceNumber, piece.title])).toEqual([[1, 'Contrat']])
  })

  it('rejects duplicate cotation, unknown uuids, and unsupported formats', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'a.pdf'), await createPdfBytes(1))
    await writeFile(join(dossierPath, 'mail.eml'), 'From: x@y.z\n\nbody', 'utf8')

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE)
    })
    const documents = await documentService.listDocuments({ dossierId })
    const pdfUuid = documents.find((record) => record.filename === 'a.pdf')!.uuid!
    const emlUuid = documents.find((record) => record.filename === 'mail.eml')!.uuid!

    await piecesService.add({ dossierId, items: [{ documentUuid: pdfUuid, title: 'Contrat' }] })

    await expect(
      piecesService.add({ dossierId, items: [{ documentUuid: pdfUuid, title: 'Doublon' }] })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(
      piecesService.add({ dossierId, items: [{ documentUuid: 'missing-uuid', title: 'X' }] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      piecesService.add({ dossierId, items: [{ documentUuid: emlUuid, title: 'Mail' }] })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('updates title, date, and summary of an existing pièce', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'a.pdf'), await createPdfBytes(1))

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE)
    })
    const [document] = await documentService.listDocuments({ dossierId })
    const [piece] = await piecesService.add({
      dossierId,
      items: [{ documentUuid: document!.uuid!, title: 'Brouillon' }]
    })

    const updated = await piecesService.update({
      dossierId,
      pieceUuid: piece!.uuid,
      title: 'Contrat de bail signé',
      pieceDate: '2025-11-03',
      summary: 'Bail commercial 3-6-9'
    })
    expect(updated[0]).toMatchObject({
      pieceNumber: 1,
      title: 'Contrat de bail signé',
      pieceDate: '2025-11-03',
      summary: 'Bail commercial 3-6-9'
    })
  })
})

describe('piecesService generate', () => {
  it('produces bordereau, bundle, and individual stamped PDFs with correct page math', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'contrat.pdf'), await createPdfBytes(3))
    await writeFile(join(dossierPath, 'photo.png'), await createPngBytes())

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE),
      printHtmlToPdf: createPrintStub(1)
    })
    const documents = await documentService.listDocuments({ dossierId })
    const uuidOf = (filename: string): string =>
      documents.find((record) => record.filename === filename)!.uuid!

    await piecesService.add({
      dossierId,
      items: [
        { documentUuid: uuidOf('contrat.pdf'), title: 'Contrat', pieceDate: '2026-01-05' },
        { documentUuid: uuidOf('photo.png'), title: 'Photographie des lieux' }
      ]
    })

    const progressPhases: string[] = []
    const result = await piecesService.generate(
      {
        dossierId,
        outputs: { bundle: true, bordereau: true, individual: true },
        header: { juridiction: 'Tribunal judiciaire de Paris', rg: '26/01234' },
        bordereauDate: '2026-06-14'
      },
      (event) => progressPhases.push(event.phase)
    )

    expect(result.failed).toEqual([])
    // The chosen bordereau date (end of week) names the output folder.
    expect(result.outputFolderRelativePath).toBe('Pièces communiquées/2026-06-14')
    expect(result.files.map((file) => file.kind).sort()).toEqual([
      'bordereau',
      'bundle',
      'piece',
      'piece'
    ])
    expect(progressPhases).toContain('converting')
    expect(progressPhases).toContain('merging')

    const { PDFDocument } = await import('pdf-lib')
    const bundleFile = result.files.find((file) => file.kind === 'bundle')!
    const bundleBytes = await readFile(join(dossierPath, bundleFile.relativePath))
    const bundle = await PDFDocument.load(new Uint8Array(bundleBytes))
    // 1 index page (print stub) + 3 pages (contrat) + 1 page (photo A4).
    expect(bundle.getPageCount()).toBe(5)

    const pieceFiles = result.files.filter((file) => file.kind === 'piece')
    expect(pieceFiles.map((file) => file.relativePath)).toEqual([
      'Pièces communiquées/' +
        result.outputFolderRelativePath.split('/')[1] +
        '/Pièce n°1 - Contrat.pdf',
      'Pièces communiquées/' +
        result.outputFolderRelativePath.split('/')[1] +
        '/Pièce n°2 - Photographie des lieux.pdf'
    ])
    for (const file of pieceFiles) {
      expect(await pathExists(join(dossierPath, file.relativePath))).toBe(true)
    }

    // communicatedAt is set once the bordereau was generated.
    const pieces = await piecesService.list({ dossierId })
    expect(pieces.every((piece) => Boolean(piece.communicatedAt))).toBe(true)

    // A second generation keeps communicatedAt (no longer "new").
    const again = await piecesService.generate({
      dossierId,
      outputs: { bundle: false, bordereau: true, individual: false }
    })
    expect(again.failed).toEqual([])
    const piecesAfter = await piecesService.list({ dossierId })
    expect(piecesAfter.map((piece) => piece.communicatedAt)).toEqual(
      pieces.map((piece) => piece.communicatedAt)
    )
  })

  it('converts a .docx piece through the injected docxToPdf converter', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    const fixture = await readFile(
      join(process.cwd(), 'node_modules/mammoth/test/test-data/single-paragraph.docx')
    )
    await writeFile(join(dossierPath, 'conclusions.docx'), fixture)

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE),
      printHtmlToPdf: createPrintStub(1),
      docxToPdf: createDocxToPdfStub(2)
    })
    const [document] = await documentService.listDocuments({ dossierId })
    await piecesService.add({
      dossierId,
      items: [{ documentUuid: document!.uuid!, title: 'Conclusions' }]
    })

    const result = await piecesService.generate({
      dossierId,
      outputs: { bundle: true, bordereau: false, individual: true }
    })

    expect(result.failed).toEqual([])
    const { PDFDocument } = await import('pdf-lib')
    const bundleFile = result.files.find((file) => file.kind === 'bundle')!
    const bundleBytes = await readFile(join(dossierPath, bundleFile.relativePath))
    const bundle = await PDFDocument.load(new Uint8Array(bundleBytes))
    // 1 index page (print stub) + 2 pages from the docxToPdf stub.
    expect(bundle.getPageCount()).toBe(3)
  })

  it('surfaces docxToPdf conversion failures as per-piece errors', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    const fixture = await readFile(
      join(process.cwd(), 'node_modules/mammoth/test/test-data/single-paragraph.docx')
    )
    await writeFile(join(dossierPath, 'conclusions.docx'), fixture)

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE),
      printHtmlToPdf: createPrintStub(1),
      docxToPdf: async () => {
        throw new Error('docx-preview rendering crashed')
      }
    })
    const [document] = await documentService.listDocuments({ dossierId })
    await piecesService.add({
      dossierId,
      items: [{ documentUuid: document!.uuid!, title: 'Conclusions' }]
    })

    // The only piece fails to convert → the generation aborts with a clear error.
    await expect(
      piecesService.generate({
        dossierId,
        outputs: { bundle: false, bordereau: false, individual: true }
      })
    ).rejects.toMatchObject({ code: 'FILE_SYSTEM_ERROR' })
  })

  it('collects per-piece failures without aborting the whole generation', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'ok.pdf'), await createPdfBytes(2))
    await writeFile(join(dossierPath, 'broken.pdf'), 'this is not a pdf', 'utf8')

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE),
      printHtmlToPdf: createPrintStub(1)
    })
    const documents = await documentService.listDocuments({ dossierId })
    const uuidOf = (filename: string): string =>
      documents.find((record) => record.filename === filename)!.uuid!

    await piecesService.add({
      dossierId,
      items: [
        { documentUuid: uuidOf('broken.pdf'), title: 'Cassée' },
        { documentUuid: uuidOf('ok.pdf'), title: 'Valide' }
      ]
    })

    const result = await piecesService.generate({
      dossierId,
      outputs: { bundle: true, bordereau: false, individual: true }
    })

    expect(result.failed).toEqual([expect.objectContaining({ pieceNumber: 1, title: 'Cassée' })])
    expect(result.files.filter((file) => file.kind === 'piece')).toHaveLength(1)
    expect(result.files.some((file) => file.kind === 'bundle')).toBe(true)
  })

  it('reports the missing source when a coté document was deleted', async () => {
    const { dossierPath, stateFilePath, dossierId } = await setupDossier()
    await writeFile(join(dossierPath, 'a.pdf'), await createPdfBytes(1))

    const documentService = createDocumentService({ stateFilePath })
    const piecesService = createPiecesService({
      documentService,
      entityService: createEntityServiceMock(TEST_PROFILE),
      printHtmlToPdf: createPrintStub(1)
    })
    const [document] = await documentService.listDocuments({ dossierId })
    await piecesService.add({
      dossierId,
      items: [{ documentUuid: document!.uuid!, title: 'Disparue' }]
    })
    await documentService.trashFiles({ dossierId, documentPaths: ['a.pdf'] })

    await expect(
      piecesService.generate({
        dossierId,
        outputs: { bundle: false, bordereau: false, individual: true }
      })
    ).rejects.toMatchObject({ code: 'FILE_SYSTEM_ERROR' })
  })
})

describe('bundleAssembler', () => {
  it('computes page starts after the index and converges on a stable index size', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const makeDocument = async (pages: number): Promise<typeof document> => {
      const document = await PDFDocument.create()
      for (let index = 0; index < pages; index += 1) document.addPage()
      return document
    }

    let renderedAssignments: unknown = 'unset'
    const { bytes, indexPageCount, assignments } = await assembleBundle({
      pieces: [
        { pieceNumber: 1, document: await makeDocument(3) },
        { pieceNumber: 4, document: await makeDocument(2) }
      ],
      renderIndexPdf: async (input) => {
        renderedAssignments = input
        return createPdfBytes(2)
      }
    })

    expect(indexPageCount).toBe(2)
    expect(assignments).toEqual([
      { pieceNumber: 1, pageStart: 3, pageCount: 3 },
      { pieceNumber: 4, pageStart: 6, pageCount: 2 }
    ])
    // Final render received the real assignments, not the placeholder pass.
    expect(renderedAssignments).toEqual(assignments)

    const merged = await PDFDocument.load(bytes)
    expect(merged.getPageCount()).toBe(7)
  })
})

describe('stampRenderer', () => {
  it('renders a generated stamp PNG and applies it to the first page only', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const stampPng = await renderGeneratedStampPng(TEST_PROFILE)
    // PNG signature.
    expect([...stampPng.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

    const document = await PDFDocument.load(await createPdfBytes(2))
    const { embedStampAssets, applyStampToFirstPage } = await import('../stampRenderer')
    const assets = await embedStampAssets(document, stampPng)
    await applyStampToFirstPage(document, assets, { pieceNumber: 12, position: 'top-right' })

    const saved = await document.save()
    const reloaded = await PDFDocument.load(saved)
    const firstPageContent = reloaded.getPage(0).node.normalizedEntries().XObject
    const secondPageContent = reloaded.getPage(1).node.normalizedEntries().XObject
    expect(firstPageContent?.entries().length ?? 0).toBeGreaterThan(0)
    expect(secondPageContent?.entries().length ?? 0).toBe(0)
  })
})
