import { access, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDossierRegistryService } from '../dossierRegistryService'
import { createDocumentService } from '../documentService'
import { getDocumentContentCachePath } from '../../../lib/aiEmbedded/documentContentService'
import { getDossierContentCachePath } from '../../../lib/ordicab/ordicabPaths'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-document-service-'))
  tempDirs.push(dir)
  return dir
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function createConfiguredDomain(): Promise<{
  root: string
  domainPath: string
  stateFilePath: string
}> {
  const root = await createTempDir()
  const domainPath = join(root, 'domain')
  const stateFilePath = join(root, 'app-state.json')

  await mkdir(domainPath, { recursive: true })
  await writeFile(
    stateFilePath,
    `${JSON.stringify(
      {
        selectedDomainPath: domainPath,
        updatedAt: '2026-03-14T08:00:00.000Z'
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  return { root, domainPath, stateFilePath }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('document service', () => {
  it('lists dossier files recursively, excludes dot-prefixed entries, and merges stored metadata by relative path', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Alpha')

    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await mkdir(join(dossierPath, '.git'), { recursive: true })
    await mkdir(join(dossierPath, 'evidence'), { recursive: true })
    await writeFile(join(dossierPath, 'CLAUDE.md'), 'generated context', 'utf8')
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')
    await writeFile(join(dossierPath, '.hidden-file'), 'ignore me', 'utf8')
    await writeFile(join(dossierPath, 'evidence', 'photo.png'), 'binary-ish', 'utf8')
    await writeFile(join(dossierPath, '.ordicab', 'hidden.txt'), 'ignore me', 'utf8')
    await writeFile(join(dossierPath, '.git', 'config'), 'ignore me', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Alpha' })

    const dossierMetadataPath = join(dossierPath, '.ordicab', 'dossier.json')
    const currentMetadata = JSON.parse(await readFile(dossierMetadataPath, 'utf8')) as Record<
      string,
      unknown
    >

    await writeFile(
      dossierMetadataPath,
      `${JSON.stringify(
        {
          ...currentMetadata,
          documents: [
            {
              uuid: 'stored-letter-uuid',
              relativePath: 'letter.txt',
              description: 'Incoming client summary',
              tags: ['urgent', 'client']
            }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const service = createDocumentService({ stateFilePath })
    const documents = await service.listDocuments({ dossierId: 'Client Alpha' })

    expect(documents).toHaveLength(2)
    expect(documents).toEqual([
      expect.objectContaining({
        path: 'evidence/photo.png',
        uuid: expect.any(String),
        dossierId: 'Client Alpha',
        filename: 'photo.png',
        byteLength: expect.any(Number),
        relativePath: 'evidence/photo.png',
        tags: []
      }),
      expect.objectContaining({
        path: 'letter.txt',
        uuid: 'stored-letter-uuid',
        dossierId: 'Client Alpha',
        filename: 'letter.txt',
        byteLength: expect.any(Number),
        relativePath: 'letter.txt',
        description: 'Incoming client summary',
        tags: ['urgent', 'client']
      })
    ])
    expect(
      documents.every(
        (document) => !document.relativePath.split('/').some((part) => part.startsWith('.'))
      )
    ).toBe(true)
    expect(documents.some((document) => document.relativePath === 'CLAUDE.md')).toBe(false)
    expect(
      documents.every((document) => typeof document.modifiedAt === 'string' && document.modifiedAt)
    ).toBe(true)
  })

  it('excludes the Cowork/ export workspace from listings and rejects it as a folder name', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Cowork')

    await mkdir(join(dossierPath, 'Cowork', 'documents'), { recursive: true })
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')
    await writeFile(join(dossierPath, 'Cowork', 'dossier.md'), 'pseudonymized', 'utf8')
    await writeFile(join(dossierPath, 'Cowork', 'documents', 'piece.md'), 'pseudonymized', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Cowork' })

    const service = createDocumentService({ stateFilePath })

    const documents = await service.listDocuments({ dossierId: 'Client Cowork' })
    expect(documents.map((document) => document.relativePath)).toEqual(['letter.txt'])

    const folders = await service.listFolders({ dossierId: 'Client Cowork' })
    expect(folders.some((folder) => folder.split('/')[0] === 'Cowork')).toBe(false)

    await expect(
      service.createFolder({ dossierId: 'Client Cowork', name: 'Cowork' })
    ).rejects.toThrow(/reserved/)
  })

  it('resolves a registered dossier root even when the folder is temporarily unavailable', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Beta')

    await mkdir(dossierPath, { recursive: true })

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T09:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Beta' })

    await rm(dossierPath, { recursive: true, force: true })

    const service = createDocumentService({ stateFilePath })
    await expect(service.resolveRegisteredDossierRoot({ dossierId: 'Client Beta' })).resolves.toBe(
      dossierPath
    )
    await expect(service.listDocuments({ dossierId: 'Client Beta' })).rejects.toThrow(
      'Selected dossier folder was not found.'
    )
    await expect(pathExists(dossierPath)).resolves.toBe(false)
    await expect(stat(domainPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('resolves a registered dossier root from its uuid', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Uuid')

    await mkdir(dossierPath, { recursive: true })

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T09:00:00.000Z')
    })
    const registered = await dossierService.registerDossier({ slug: 'Client Uuid' })

    const service = createDocumentService({ stateFilePath })
    await expect(
      service.resolveRegisteredDossierRoot({ dossierId: registered.uuid ?? '' })
    ).resolves.toBe(dossierPath)
  })

  it('saves metadata and reconstructs dossier.json from registry when the file is missing', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Fallback')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'report.txt'), 'Report body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T11:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Fallback' })

    // Simulate dossier.json being deleted after registration
    const dossierMetadataPath = join(dossierPath, '.ordicab', 'dossier.json')
    await rm(dossierMetadataPath, { force: true })
    await expect(pathExists(dossierMetadataPath)).resolves.toBe(false)

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Fallback',
      documentPath: 'report.txt',
      description: 'Annual report',
      tags: ['report']
    })

    expect(saved).toMatchObject({
      path: 'report.txt',
      uuid: expect.any(String),
      dossierId: 'Client Fallback',
      description: 'Annual report',
      tags: ['report']
    })

    const written = JSON.parse(await readFile(dossierMetadataPath, 'utf8')) as {
      documents: Array<{
        uuid?: string
        relativePath: string
        description?: string
        tags: string[]
      }>
    }
    expect(written.documents).toEqual([
      expect.objectContaining({
        uuid: expect.any(String),
        relativePath: 'report.txt',
        description: 'Annual report',
        tags: ['report']
      })
    ])
  })

  it('returns NOT_FOUND when saving metadata for a document that does not exist on disk', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Delta')

    await mkdir(dossierPath, { recursive: true })

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T11:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Delta' })

    const service = createDocumentService({ stateFilePath })
    await expect(
      service.saveMetadata({
        dossierId: 'Client Delta',
        documentPath: 'ghost.txt',
        description: 'Does not exist',
        tags: []
      })
    ).rejects.toThrow('The selected document was not found.')
  })

  it('saves normalized document metadata in dossier.json and returns the canonical document record', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Gamma')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Gamma' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Gamma',
      documentPath: 'letter.txt',
      description: '  Incoming client summary  ',
      tags: [' urgent ', 'client', 'urgent']
    })

    expect(saved).toMatchObject({
      path: 'letter.txt',
      uuid: expect.any(String),
      dossierId: 'Client Gamma',
      filename: 'letter.txt',
      byteLength: expect.any(Number),
      relativePath: 'letter.txt',
      description: 'Incoming client summary',
      tags: ['urgent', 'client']
    })

    const dossierMetadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      documents: Array<{
        uuid?: string
        relativePath: string
        description?: string
        tags: string[]
      }>
    }

    expect(dossierMetadata.documents).toEqual([
      expect.objectContaining({
        uuid: expect.any(String),
        relativePath: 'letter.txt',
        filename: 'letter.txt',
        byteLength: expect.any(Number),
        modifiedAt: expect.any(String),
        description: 'Incoming client summary',
        tags: ['urgent', 'client']
      })
    ])
  })

  it('rebinds stored document metadata to a new path when the same file is moved externally', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Rebind')
    const originalPath = join(dossierPath, 'report.txt')
    const movedPath = join(dossierPath, 'archive', 'report.txt')

    await mkdir(join(dossierPath, 'archive'), { recursive: true })
    await writeFile(originalPath, 'Preserve this metadata', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Rebind' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Rebind',
      documentPath: 'report.txt',
      description: 'Signed report',
      tags: ['signed', 'client']
    })

    await rename(originalPath, movedPath)

    const documents = await service.listDocuments({ dossierId: 'Client Rebind' })

    expect(documents).toEqual([
      expect.objectContaining({
        path: 'archive/report.txt',
        uuid: saved.uuid,
        dossierId: 'Client Rebind',
        filename: 'report.txt',
        relativePath: 'archive/report.txt',
        description: 'Signed report',
        tags: ['signed', 'client']
      })
    ])

    const metadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      documents: Array<{
        uuid?: string
        relativePath: string
        filename?: string
        byteLength?: number
        modifiedAt?: string
        description?: string
        tags: string[]
      }>
    }

    expect(metadata.documents).toEqual([
      expect.objectContaining({
        uuid: saved.uuid,
        relativePath: 'archive/report.txt',
        filename: 'report.txt',
        byteLength: expect.any(Number),
        modifiedAt: expect.any(String),
        description: 'Signed report',
        tags: ['signed', 'client']
      })
    ])
  })

  it('relocates stored metadata explicitly by document uuid', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Relocate')

    await mkdir(join(dossierPath, 'moved'), { recursive: true })
    await writeFile(join(dossierPath, 'moved', 'report.txt'), 'Report body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T10:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Relocate' })

    await writeFile(join(dossierPath, 'report.txt'), 'Report body', 'utf8')

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Relocate',
      documentPath: 'report.txt',
      description: 'Original report',
      tags: ['report']
    })

    await rm(join(dossierPath, 'report.txt'))

    const relocated = await service.relocateMetadata({
      dossierId: 'Client Relocate',
      documentUuid: saved.uuid!,
      fromDocumentPath: 'report.txt',
      toDocumentPath: 'moved/report.txt'
    })

    expect(relocated).toMatchObject({
      path: 'moved/report.txt',
      uuid: saved.uuid,
      dossierId: 'Client Relocate',
      filename: 'report.txt',
      relativePath: 'moved/report.txt',
      description: 'Original report',
      tags: ['report']
    })
  })

  it('returns preview-safe payloads for text, image, email, docx, and doc files', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Preview')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')
    await writeFile(join(dossierPath, 'brochure.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46]))
    await writeFile(join(dossierPath, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(dossierPath, 'scan.tif'), Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    await writeFile(join(dossierPath, 'inbox.eml'), Buffer.from('From: sender@example.com'))
    await writeFile(join(dossierPath, 'outlook.msg'), Buffer.from('msg-binary'))
    await writeFile(join(dossierPath, 'draft.docx'), Buffer.from('docx-binary'))
    await writeFile(join(dossierPath, 'legacy.doc'), Buffer.from('doc-binary'))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T12:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Preview' })

    const service = createDocumentService({
      stateFilePath,
      previewLoaders: {
        extractLegacyDocText: vi.fn(async () => 'DOC preview text'),
        parseMimeEmail: vi.fn(async () => ({
          subject: 'Client follow-up',
          from: 'sender@example.com',
          to: 'receiver@example.com',
          cc: null,
          date: '2026-03-14T12:00:00.000Z',
          attachments: [{ index: 0, filename: 'brief.pdf', byteLength: 1024 }],
          text: 'Email body'
        })),
        parseOutlookMessage: vi.fn(async () => ({
          subject: 'Outlook follow-up',
          from: 'advisor@example.com',
          to: 'client@example.com',
          cc: 'assistant@example.com',
          date: '2026-03-14T12:05:00.000Z',
          attachments: [{ index: 0, filename: 'scan.tif', byteLength: null }],
          text: 'MSG body'
        }))
      }
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'letter.txt' })
    ).resolves.toMatchObject({
      kind: 'text',
      sourceType: 'txt',
      filename: 'letter.txt',
      text: 'Letter body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'brochure.pdf' })
    ).resolves.toMatchObject({
      kind: 'pdf',
      sourceType: 'pdf',
      filename: 'brochure.pdf',
      mimeType: 'application/pdf'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'photo.png' })
    ).resolves.toMatchObject({
      kind: 'image',
      sourceType: 'png',
      filename: 'photo.png',
      mimeType: 'image/png'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'scan.tif' })
    ).resolves.toMatchObject({
      kind: 'image',
      sourceType: 'tif',
      filename: 'scan.tif',
      mimeType: 'image/tiff'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'inbox.eml' })
    ).resolves.toMatchObject({
      kind: 'email',
      sourceType: 'eml',
      filename: 'inbox.eml',
      mimeType: 'message/rfc822',
      subject: 'Client follow-up',
      text: 'Email body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'outlook.msg' })
    ).resolves.toMatchObject({
      kind: 'email',
      sourceType: 'msg',
      filename: 'outlook.msg',
      mimeType: 'application/vnd.ms-outlook',
      subject: 'Outlook follow-up',
      text: 'MSG body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'draft.docx' })
    ).resolves.toMatchObject({
      kind: 'docx',
      sourceType: 'docx',
      filename: 'draft.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentPath: 'legacy.doc' })
    ).resolves.toMatchObject({
      kind: 'text',
      sourceType: 'doc',
      filename: 'legacy.doc',
      text: 'DOC preview text'
    })
  })

  it('blocks oversized previews before attempting expensive parsing', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Large Preview')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'too-large.docx'), Buffer.alloc(10 * 1024 * 1024 + 1, 1))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T12:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Large Preview' })

    const service = createDocumentService({
      stateFilePath,
      previewLoaders: {
        extractLegacyDocText: vi.fn(async () => 'unused')
      }
    })

    await expect(
      service.getPreview({ dossierId: 'Client Large Preview', documentPath: 'too-large.docx' })
    ).resolves.toMatchObject({
      kind: 'unsupported',
      sourceType: 'docx',
      reason: 'file-too-large'
    })
  })

  it('marks a corrupt extractable document as extracted with empty content so it stops blocking export', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Corrupt Extraction')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'conclusions.docx'), Buffer.from('not-a-zip-docx'))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T13:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Corrupt Extraction' })

    const service = createDocumentService({ stateFilePath })
    const extracted = await service.extractContent({
      dossierId: 'Client Corrupt Extraction',
      documentPath: 'conclusions.docx'
    })

    expect(extracted).toMatchObject({
      documentPath: 'conclusions.docx',
      filename: 'conclusions.docx',
      text: '',
      textLength: 0,
      method: 'cached',
      status: { state: 'extracted', isExtractable: true }
    })

    await expect(
      service.getContentStatus({
        dossierId: 'Client Corrupt Extraction',
        documentPath: 'conclusions.docx'
      })
    ).resolves.toEqual({ state: 'extracted', isExtractable: true })
  })

  it('reads cached extracted text without re-running extraction when requested', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Cached Extraction')
    const filePath = join(dossierPath, 'cached.docx')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(filePath, Buffer.from('not-a-zip-docx'))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T13:05:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Cached Extraction' })

    const cacheDir = getDossierContentCachePath(dossierPath)
    const cachePath = getDocumentContentCachePath(cacheDir, filePath)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          version: 3,
          name: 'cached.docx',
          method: 'docx',
          extractedAt: '2026-03-14T13:05:00.000Z',
          text: 'Texte déjà extrait',
          isEmpty: false
        },
        null,
        2
      ),
      'utf8'
    )

    const service = createDocumentService({ stateFilePath })

    await expect(
      service.extractContent({
        dossierId: 'Client Cached Extraction',
        documentPath: 'cached.docx',
        readCacheOnly: true
      })
    ).resolves.toMatchObject({
      documentPath: 'cached.docx',
      text: 'Texte déjà extrait',
      method: 'cached',
      status: { state: 'extracted', isExtractable: true }
    })
  })

  it('marks markdown files as already extracted because their text is read directly without cache', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Markdown')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'Assignation-2026-03-17.md'), '# Assignation\n\nContenu')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T13:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Markdown' })

    const service = createDocumentService({ stateFilePath })
    const documents = await service.listDocuments({ dossierId: 'Client Markdown' })

    expect(documents).toEqual([
      expect.objectContaining({
        relativePath: 'Assignation-2026-03-17.md',
        textExtraction: { state: 'extracted', isExtractable: true }
      })
    ])

    await expect(
      service.getContentStatus({
        dossierId: 'Client Markdown',
        documentPath: 'Assignation-2026-03-17.md'
      })
    ).resolves.toEqual({ state: 'extracted', isExtractable: true })
  })

  it('marks supported raster image documents as OCR extractable', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Image OCR')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'scan.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    await writeFile(join(dossierPath, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(dossierPath, 'multi.tiff'), Buffer.from([0x49, 0x49, 0x2a, 0x00]))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T14:00:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Image OCR' })

    const service = createDocumentService({ stateFilePath })
    const documents = await service.listDocuments({ dossierId: 'Client Image OCR' })

    expect(documents).toEqual([
      expect.objectContaining({
        relativePath: 'multi.tiff',
        textExtraction: { state: 'extractable', isExtractable: true }
      }),
      expect.objectContaining({
        relativePath: 'photo.png',
        textExtraction: { state: 'extractable', isExtractable: true }
      }),
      expect.objectContaining({
        relativePath: 'scan.jpg',
        textExtraction: { state: 'extractable', isExtractable: true }
      })
    ])
  })

  it('moves files into a target folder and carries stored metadata with preserved uuid', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Move')

    await mkdir(join(dossierPath, 'archive'), { recursive: true })
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')
    await writeFile(join(dossierPath, 'note.txt'), 'Note body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Move' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Move',
      documentPath: 'letter.txt',
      description: 'Important letter',
      tags: ['urgent']
    })

    const result = await service.moveFiles({
      dossierId: 'Client Move',
      documentPaths: ['letter.txt', 'note.txt'],
      targetFolderPath: 'archive'
    })

    expect(result.failed).toEqual([])
    expect(result.moved).toHaveLength(2)
    expect(await pathExists(join(dossierPath, 'archive', 'letter.txt'))).toBe(true)
    expect(await pathExists(join(dossierPath, 'letter.txt'))).toBe(false)

    const movedLetter = result.moved.find((entry) => entry.fromPath === 'letter.txt')
    expect(movedLetter?.record).toEqual(
      expect.objectContaining({
        relativePath: 'archive/letter.txt',
        uuid: saved.uuid,
        description: 'Important letter',
        tags: ['urgent']
      })
    )

    const metadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as { documents: Array<{ relativePath: string; uuid?: string }> }
    expect(metadata.documents.some((entry) => entry.relativePath === 'letter.txt')).toBe(false)
    expect(
      metadata.documents.find((entry) => entry.relativePath === 'archive/letter.txt')?.uuid
    ).toBe(saved.uuid)
  })

  it('collects per-file failures on name collisions without aborting the batch', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Move Conflict')

    await mkdir(join(dossierPath, 'archive'), { recursive: true })
    await writeFile(join(dossierPath, 'letter.txt'), 'Letter body', 'utf8')
    await writeFile(join(dossierPath, 'note.txt'), 'Note body', 'utf8')
    await writeFile(join(dossierPath, 'archive', 'letter.txt'), 'Existing letter', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Move Conflict' })

    const service = createDocumentService({ stateFilePath })
    const result = await service.moveFiles({
      dossierId: 'Client Move Conflict',
      documentPaths: ['letter.txt', 'note.txt'],
      targetFolderPath: 'archive'
    })

    expect(result.failed).toEqual([expect.objectContaining({ documentPath: 'letter.txt' })])
    expect(result.moved).toEqual([expect.objectContaining({ fromPath: 'note.txt' })])
    expect(await readFile(join(dossierPath, 'archive', 'letter.txt'), 'utf8')).toBe(
      'Existing letter'
    )
    expect(await pathExists(join(dossierPath, 'letter.txt'))).toBe(true)
  })

  it('moves a folder and rewrites metadata paths under its prefix', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Folder Move')

    await mkdir(join(dossierPath, 'correspondance', '2024'), { recursive: true })
    await mkdir(join(dossierPath, 'archive'), { recursive: true })
    await writeFile(join(dossierPath, 'correspondance', '2024', 'letter.txt'), 'Body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Folder Move' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Folder Move',
      documentPath: 'correspondance/2024/letter.txt',
      description: 'Archived letter',
      tags: []
    })

    const newPath = await service.moveFolder({
      dossierId: 'Client Folder Move',
      fromPath: 'correspondance',
      targetFolderPath: 'archive'
    })

    expect(newPath).toBe('archive/correspondance')
    expect(
      await pathExists(join(dossierPath, 'archive', 'correspondance', '2024', 'letter.txt'))
    ).toBe(true)
    expect(await pathExists(join(dossierPath, 'correspondance'))).toBe(false)

    const metadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as { documents: Array<{ relativePath: string; uuid?: string }> }
    expect(
      metadata.documents.find(
        (entry) => entry.relativePath === 'archive/correspondance/2024/letter.txt'
      )?.uuid
    ).toBe(saved.uuid)
  })

  it('rejects moving a folder into itself or one of its subfolders', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Folder Cycle')

    await mkdir(join(dossierPath, 'parent', 'child'), { recursive: true })

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Folder Cycle' })

    const service = createDocumentService({ stateFilePath })

    await expect(
      service.moveFolder({
        dossierId: 'Client Folder Cycle',
        fromPath: 'parent',
        targetFolderPath: 'parent/child'
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await pathExists(join(dossierPath, 'parent', 'child'))).toBe(true)
  })

  it('carries the extraction cache over when a file is renamed', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Rename Cache')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'scan.pdf'), 'fake pdf bytes', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Rename Cache' })

    const cacheDir = getDossierContentCachePath(dossierPath)
    await mkdir(cacheDir, { recursive: true })
    const fromCachePath = getDocumentContentCachePath(cacheDir, join(dossierPath, 'scan.pdf'))
    await writeFile(
      fromCachePath,
      JSON.stringify({
        version: 3,
        name: 'scan.pdf',
        method: 'tesseract',
        extractedAt: '2026-03-14T08:30:00.000Z',
        text: 'extracted text'
      }),
      'utf8'
    )

    const service = createDocumentService({ stateFilePath })
    await service.renameFile({
      dossierId: 'Client Rename Cache',
      documentPath: 'scan.pdf',
      newFilename: 'scan-final.pdf'
    })

    const toCachePath = getDocumentContentCachePath(cacheDir, join(dossierPath, 'scan-final.pdf'))
    expect(await pathExists(fromCachePath)).toBe(false)
    const carried = JSON.parse(await readFile(toCachePath, 'utf8')) as { text: string }
    expect(carried.text).toBe('extracted text')
  })

  it('trashes files into .ordicab/trash with a manifest and restores them with metadata intact', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Trash')

    await mkdir(join(dossierPath, 'archive'), { recursive: true })
    await writeFile(join(dossierPath, 'archive', 'letter.txt'), 'Letter body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Trash' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Trash',
      documentPath: 'archive/letter.txt',
      description: 'Tagged letter',
      tags: ['urgent']
    })

    const trashed = await service.trashFiles({
      dossierId: 'Client Trash',
      documentPaths: ['archive/letter.txt']
    })

    expect(trashed.trashedCount).toBe(1)
    expect(trashed.failed).toEqual([])
    expect(trashed.deletionId).toBeTruthy()
    expect(await pathExists(join(dossierPath, 'archive', 'letter.txt'))).toBe(false)

    const deletionDir = join(dossierPath, '.ordicab', 'trash', trashed.deletionId!)
    expect(await pathExists(join(deletionDir, 'payload', 'archive', 'letter.txt'))).toBe(true)
    const manifest = JSON.parse(await readFile(join(deletionDir, 'manifest.json'), 'utf8')) as {
      kind: string
      items: Array<{ relativePath: string; storedMetadata: { uuid?: string; tags: string[] } }>
    }
    expect(manifest.kind).toBe('files')
    expect(manifest.items[0]?.storedMetadata?.tags).toEqual(['urgent'])

    const metadataAfterTrash = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as { documents: Array<{ relativePath: string }> }
    expect(
      metadataAfterTrash.documents.some((entry) => entry.relativePath === 'archive/letter.txt')
    ).toBe(false)

    const restored = await service.restoreTrash({
      dossierId: 'Client Trash',
      deletionId: trashed.deletionId!
    })

    expect(restored.restoredCount).toBe(1)
    expect(await pathExists(join(dossierPath, 'archive', 'letter.txt'))).toBe(true)
    expect(await pathExists(deletionDir)).toBe(false)

    const metadataAfterRestore = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as { documents: Array<{ relativePath: string; uuid?: string; tags: string[] }> }
    const restoredEntry = metadataAfterRestore.documents.find(
      (entry) => entry.relativePath === 'archive/letter.txt'
    )
    expect(restoredEntry?.uuid).toBe(saved.uuid)
    expect(restoredEntry?.tags).toEqual(['urgent'])
  })

  it('lists trash entries newest first and deletes an entry permanently', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Trash List')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'a.txt'), 'A', 'utf8')
    await writeFile(join(dossierPath, 'b.txt'), 'B', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Trash List' })

    const service = createDocumentService({ stateFilePath })
    const first = await service.trashFiles({
      dossierId: 'Client Trash List',
      documentPaths: ['a.txt']
    })
    const second = await service.trashFiles({
      dossierId: 'Client Trash List',
      documentPaths: ['b.txt']
    })

    const entries = await service.listTrash({ dossierId: 'Client Trash List' })
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.deletionId)).toContain(first.deletionId)
    expect(entries.map((entry) => entry.deletionId)).toContain(second.deletionId)
    expect(entries[0]?.kind).toBe('files')
    expect(entries.flatMap((entry) => entry.items.map((item) => item.relativePath))).toEqual(
      expect.arrayContaining(['a.txt', 'b.txt'])
    )

    await service.deleteTrashEntry({
      dossierId: 'Client Trash List',
      deletionId: first.deletionId!
    })

    const remaining = await service.listTrash({ dossierId: 'Client Trash List' })
    expect(remaining.map((entry) => entry.deletionId)).toEqual([second.deletionId])

    await expect(
      service.restoreTrash({
        dossierId: 'Client Trash List',
        deletionId: first.deletionId!
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('trashes a non-empty folder and restores it with its metadata entries', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Folder Trash')

    await mkdir(join(dossierPath, 'correspondance', '2024'), { recursive: true })
    await writeFile(join(dossierPath, 'correspondance', '2024', 'letter.txt'), 'Body', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Folder Trash' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Folder Trash',
      documentPath: 'correspondance/2024/letter.txt',
      description: 'Archived',
      tags: ['archive']
    })

    const { deletionId } = await service.deleteFolder({
      dossierId: 'Client Folder Trash',
      path: 'correspondance'
    })

    expect(await pathExists(join(dossierPath, 'correspondance'))).toBe(false)
    expect(
      await pathExists(
        join(
          dossierPath,
          '.ordicab',
          'trash',
          deletionId,
          'payload',
          'correspondance',
          '2024',
          'letter.txt'
        )
      )
    ).toBe(true)

    const restored = await service.restoreTrash({
      dossierId: 'Client Folder Trash',
      deletionId
    })

    expect(restored.restoredCount).toBeGreaterThanOrEqual(1)
    expect(await pathExists(join(dossierPath, 'correspondance', '2024', 'letter.txt'))).toBe(true)

    const metadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as { documents: Array<{ relativePath: string; uuid?: string }> }
    expect(
      metadata.documents.find((entry) => entry.relativePath === 'correspondance/2024/letter.txt')
        ?.uuid
    ).toBe(saved.uuid)
  })

  it('restores trashed files under a suffixed name when the original path is taken again', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Trash Collision')

    await mkdir(dossierPath, { recursive: true })
    await writeFile(join(dossierPath, 'note.txt'), 'Original', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Trash Collision' })

    const service = createDocumentService({ stateFilePath })
    const trashed = await service.trashFiles({
      dossierId: 'Client Trash Collision',
      documentPaths: ['note.txt']
    })

    await writeFile(join(dossierPath, 'note.txt'), 'Replacement', 'utf8')

    const restored = await service.restoreTrash({
      dossierId: 'Client Trash Collision',
      deletionId: trashed.deletionId!
    })

    expect(restored.restoredCount).toBe(1)
    expect(await readFile(join(dossierPath, 'note.txt'), 'utf8')).toBe('Replacement')
    expect(await readFile(join(dossierPath, 'note (2).txt'), 'utf8')).toBe('Original')
  })

  it('saves .eml attachments into the email folder with collision-free sanitized names', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Attachments')

    await mkdir(join(dossierPath, 'courrier'), { recursive: true })

    const emlContent = [
      'From: sender@example.com',
      'To: receiver@example.com',
      'Subject: Pieces jointes',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="BOUNDARY"',
      '',
      '--BOUNDARY',
      'Content-Type: text/plain',
      '',
      'Bonjour',
      '--BOUNDARY',
      'Content-Type: application/pdf; name="piece.pdf"',
      'Content-Disposition: attachment; filename="piece.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('PDF BYTES').toString('base64'),
      '--BOUNDARY',
      'Content-Type: text/plain; name="rapport:final.txt"',
      'Content-Disposition: attachment; filename="rapport:final.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('Rapport').toString('base64'),
      '--BOUNDARY--',
      ''
    ].join('\r\n')

    await writeFile(join(dossierPath, 'courrier', 'message.eml'), emlContent, 'utf8')
    // Pre-existing file with the same name as the first attachment → suffix
    await writeFile(join(dossierPath, 'courrier', 'piece.pdf'), 'existing', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Attachments' })

    const service = createDocumentService({ stateFilePath })
    const result = await service.saveEmailAttachments({
      dossierId: 'Client Attachments',
      documentPath: 'courrier/message.eml'
    })

    expect(result.failed).toEqual([])
    expect(result.saved).toHaveLength(2)
    expect(await readFile(join(dossierPath, 'courrier', 'piece (2).pdf'), 'utf8')).toBe('PDF BYTES')
    // Forbidden ':' sanitized to a space
    expect(await readFile(join(dossierPath, 'courrier', 'rapport final.txt'), 'utf8')).toBe(
      'Rapport'
    )

    const single = await service.saveEmailAttachments({
      dossierId: 'Client Attachments',
      documentPath: 'courrier/message.eml',
      attachmentIndexes: [0],
      targetFolderPath: ''
    })
    expect(single.saved).toEqual([{ index: 0, relativePath: 'piece.pdf' }])
    expect(await readFile(join(dossierPath, 'piece.pdf'), 'utf8')).toBe('PDF BYTES')
  })

  it('extracts, merges, and splits PDF pages with pdf-lib', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Pdf Ops')

    await mkdir(dossierPath, { recursive: true })

    const { PDFDocument } = await import('pdf-lib')

    const createPdf = async (pageCount: number): Promise<Uint8Array> => {
      const doc = await PDFDocument.create()
      for (let index = 0; index < pageCount; index += 1) {
        doc.addPage([200, 300])
      }
      return doc.save()
    }

    await writeFile(join(dossierPath, 'source.pdf'), await createPdf(5))
    await writeFile(join(dossierPath, 'annexe.pdf'), await createPdf(2))

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Pdf Ops' })

    const service = createDocumentService({ stateFilePath })

    const extracted = await service.extractPdfPages({
      dossierId: 'Client Pdf Ops',
      documentPath: 'source.pdf',
      ranges: [{ from: 2, to: 3 }]
    })
    expect(extracted.relativePaths).toEqual(['source (pages 2-3).pdf'])
    const extractedDoc = await PDFDocument.load(
      new Uint8Array(await readFile(join(dossierPath, 'source (pages 2-3).pdf')))
    )
    expect(extractedDoc.getPageCount()).toBe(2)

    const merged = await service.mergePdfs({
      dossierId: 'Client Pdf Ops',
      documentPaths: ['source.pdf', 'annexe.pdf'],
      outputFilename: 'Fusion.pdf'
    })
    expect(merged.relativePaths).toEqual(['Fusion.pdf'])
    const mergedDoc = await PDFDocument.load(
      new Uint8Array(await readFile(join(dossierPath, 'Fusion.pdf')))
    )
    expect(mergedDoc.getPageCount()).toBe(7)

    const split = await service.splitPdf({
      dossierId: 'Client Pdf Ops',
      documentPath: 'annexe.pdf',
      mode: 'each-page'
    })
    expect(split.relativePaths).toEqual(['annexe (page 1).pdf', 'annexe (page 2).pdf'])

    await expect(
      service.extractPdfPages({
        dossierId: 'Client Pdf Ops',
        documentPath: 'source.pdf',
        ranges: [{ from: 4, to: 9 }]
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('preserves the pieces array across metadata rewrites (rename, saveMetadata, move)', async () => {
    // Regression guard: dossier.json is rewritten wholesale through
    // dossierMetadataFileSchema, which strips unknown keys. If `pieces` ever
    // drops out of that schema, every rename/move silently erases the cotation.
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Pieces')

    await mkdir(join(dossierPath, 'sub'), { recursive: true })
    await writeFile(join(dossierPath, 'contrat.pdf'), 'fake pdf bytes', 'utf8')

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T08:30:00.000Z')
    })
    await dossierService.registerDossier({ slug: 'Client Pieces' })

    const service = createDocumentService({ stateFilePath })
    const [document] = await service.listDocuments({ dossierId: 'Client Pieces' })
    expect(document?.uuid).toBeTruthy()

    const piece = {
      uuid: 'piece-entry-1',
      pieceNumber: 1,
      documentUuid: document!.uuid!,
      sourceFilename: 'contrat.pdf',
      title: 'Contrat de bail',
      pieceDate: '2026-01-15',
      addedAt: '2026-03-14T08:30:00.000Z'
    }
    const metadataPath = join(dossierPath, '.ordicab', 'dossier.json')
    const current = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    await writeFile(metadataPath, `${JSON.stringify({ ...current, pieces: [piece] }, null, 2)}\n`)

    await service.renameFile({
      dossierId: 'Client Pieces',
      documentPath: 'contrat.pdf',
      newFilename: 'contrat-signe.pdf'
    })
    await service.saveMetadata({
      dossierId: 'Client Pieces',
      documentPath: 'contrat-signe.pdf',
      description: 'Bail commercial',
      tags: []
    })
    await service.moveFiles({
      dossierId: 'Client Pieces',
      documentPaths: ['contrat-signe.pdf'],
      targetFolderPath: 'sub'
    })

    const after = JSON.parse(await readFile(metadataPath, 'utf8')) as {
      pieces: Array<{ documentUuid: string; pieceNumber: number; title: string }>
      documents: Array<{ uuid?: string; relativePath: string }>
    }
    expect(after.pieces).toEqual([piece])
    // The uuid reference still resolves to the renamed + moved document.
    const moved = after.documents.find((entry) => entry.uuid === piece.documentUuid)
    expect(moved?.relativePath).toBe('sub/contrat-signe.pdf')
  })
})
