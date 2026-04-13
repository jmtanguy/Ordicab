import { access, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDossierRegistryService } from '../dossierRegistryService'
import { createDocumentService } from '../documentService'

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
    await dossierService.registerDossier({ id: 'Client Alpha' })

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
        id: 'evidence/photo.png',
        uuid: expect.any(String),
        dossierId: 'Client Alpha',
        filename: 'photo.png',
        byteLength: expect.any(Number),
        relativePath: 'evidence/photo.png',
        tags: []
      }),
      expect.objectContaining({
        id: 'letter.txt',
        uuid: expect.any(String),
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

  it('resolves a registered dossier root even when the folder is temporarily unavailable', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Beta')

    await mkdir(dossierPath, { recursive: true })

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-14T09:00:00.000Z')
    })
    await dossierService.registerDossier({ id: 'Client Beta' })

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
    const registered = await dossierService.registerDossier({ id: 'Client Uuid' })

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
    await dossierService.registerDossier({ id: 'Client Fallback' })

    // Simulate dossier.json being deleted after registration
    const dossierMetadataPath = join(dossierPath, '.ordicab', 'dossier.json')
    await rm(dossierMetadataPath, { force: true })
    await expect(pathExists(dossierMetadataPath)).resolves.toBe(false)

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Fallback',
      documentId: 'report.txt',
      description: 'Annual report',
      tags: ['report']
    })

    expect(saved).toMatchObject({
      id: 'report.txt',
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
    await dossierService.registerDossier({ id: 'Client Delta' })

    const service = createDocumentService({ stateFilePath })
    await expect(
      service.saveMetadata({
        dossierId: 'Client Delta',
        documentId: 'ghost.txt',
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
    await dossierService.registerDossier({ id: 'Client Gamma' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Gamma',
      documentId: 'letter.txt',
      description: '  Incoming client summary  ',
      tags: [' urgent ', 'client', 'urgent']
    })

    expect(saved).toMatchObject({
      id: 'letter.txt',
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
    await dossierService.registerDossier({ id: 'Client Rebind' })

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Rebind',
      documentId: 'report.txt',
      description: 'Signed report',
      tags: ['signed', 'client']
    })

    await rename(originalPath, movedPath)

    const documents = await service.listDocuments({ dossierId: 'Client Rebind' })

    expect(documents).toEqual([
      expect.objectContaining({
        id: 'archive/report.txt',
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
    await dossierService.registerDossier({ id: 'Client Relocate' })

    await writeFile(join(dossierPath, 'report.txt'), 'Report body', 'utf8')

    const service = createDocumentService({ stateFilePath })
    const saved = await service.saveMetadata({
      dossierId: 'Client Relocate',
      documentId: 'report.txt',
      description: 'Original report',
      tags: ['report']
    })

    await rm(join(dossierPath, 'report.txt'))

    const relocated = await service.relocateMetadata({
      dossierId: 'Client Relocate',
      documentUuid: saved.uuid!,
      fromDocumentId: 'report.txt',
      toDocumentId: 'moved/report.txt'
    })

    expect(relocated).toMatchObject({
      id: 'moved/report.txt',
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
    await dossierService.registerDossier({ id: 'Client Preview' })

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
          attachments: ['brief.pdf'],
          text: 'Email body'
        })),
        parseOutlookMessage: vi.fn(async () => ({
          subject: 'Outlook follow-up',
          from: 'advisor@example.com',
          to: 'client@example.com',
          cc: 'assistant@example.com',
          date: '2026-03-14T12:05:00.000Z',
          attachments: ['scan.tif'],
          text: 'MSG body'
        }))
      }
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'letter.txt' })
    ).resolves.toMatchObject({
      kind: 'text',
      sourceType: 'txt',
      filename: 'letter.txt',
      text: 'Letter body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'brochure.pdf' })
    ).resolves.toMatchObject({
      kind: 'pdf',
      sourceType: 'pdf',
      filename: 'brochure.pdf',
      mimeType: 'application/pdf'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'photo.png' })
    ).resolves.toMatchObject({
      kind: 'image',
      sourceType: 'png',
      filename: 'photo.png',
      mimeType: 'image/png'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'scan.tif' })
    ).resolves.toMatchObject({
      kind: 'image',
      sourceType: 'tif',
      filename: 'scan.tif',
      mimeType: 'image/tiff'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'inbox.eml' })
    ).resolves.toMatchObject({
      kind: 'email',
      sourceType: 'eml',
      filename: 'inbox.eml',
      mimeType: 'message/rfc822',
      subject: 'Client follow-up',
      text: 'Email body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'outlook.msg' })
    ).resolves.toMatchObject({
      kind: 'email',
      sourceType: 'msg',
      filename: 'outlook.msg',
      mimeType: 'application/vnd.ms-outlook',
      subject: 'Outlook follow-up',
      text: 'MSG body'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'draft.docx' })
    ).resolves.toMatchObject({
      kind: 'docx',
      sourceType: 'docx',
      filename: 'draft.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })

    await expect(
      service.getPreview({ dossierId: 'Client Preview', documentId: 'legacy.doc' })
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
    await dossierService.registerDossier({ id: 'Client Large Preview' })

    const service = createDocumentService({
      stateFilePath,
      previewLoaders: {
        extractLegacyDocText: vi.fn(async () => 'unused')
      }
    })

    await expect(
      service.getPreview({ dossierId: 'Client Large Preview', documentId: 'too-large.docx' })
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
    await dossierService.registerDossier({ id: 'Client Corrupt Extraction' })

    const service = createDocumentService({ stateFilePath })
    const extracted = await service.extractContent({
      dossierId: 'Client Corrupt Extraction',
      documentId: 'conclusions.docx'
    })

    expect(extracted).toMatchObject({
      documentId: 'conclusions.docx',
      filename: 'conclusions.docx',
      text: '',
      textLength: 0,
      method: 'cached',
      status: { state: 'extracted', isExtractable: true }
    })

    await expect(
      service.getContentStatus({
        dossierId: 'Client Corrupt Extraction',
        documentId: 'conclusions.docx'
      })
    ).resolves.toEqual({ state: 'extracted', isExtractable: true })
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
    await dossierService.registerDossier({ id: 'Client Markdown' })

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
        documentId: 'Assignation-2026-03-17.md'
      })
    ).resolves.toEqual({ state: 'extracted', isExtractable: true })
  })
})
