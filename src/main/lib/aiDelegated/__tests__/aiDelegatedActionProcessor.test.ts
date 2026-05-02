import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IpcErrorCode } from '@shared/types'

import {
  getDomainDelegatedFailedPath,
  getDomainDelegatedInboxPath,
  getDomainDelegatedProcessedCommandsPath,
  getDomainDelegatedResponsesPath,
  getDossierContactsPath
} from '../../../lib/ordicab/ordicabPaths'
import {
  createDelegatedAiActionProcessor,
  type DelegatedAiActionFileWatcherLike,
  type DelegatedAiActionWatchFactory
} from '../aiDelegatedActionProcessor'
import { GenerateServiceError } from '../../../services/domain/generateService'

const tempDirs: string[] = []

class FakeWatcher extends EventEmitter implements DelegatedAiActionFileWatcherLike {
  close = vi.fn(async () => undefined)
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-delegated-intents-'))
  tempDirs.push(dir)
  return dir
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readResponse(
  domainPath: string,
  filename: string
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(getDomainDelegatedResponsesPath(domainPath), filename), 'utf8')
  ) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('DelegatedAiActionProcessor', () => {
  it('processes existing inbox intents on watchDomain and records processed command ids', async () => {
    const domainPath = await createTempDir()
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }
    const watchers: FakeWatcher[] = []
    const watchFactory: DelegatedAiActionWatchFactory = vi.fn(() => {
      const watcher = new FakeWatcher()
      watchers.push(watcher)
      return watcher
    })
    const dossierService = {
      getDossier: vi.fn(async () => dossierMutationResult),
      updateDossier: vi.fn(async () => dossierMutationResult),
      upsertKeyDate: vi.fn(async () => dossierMutationResult),
      deleteKeyDate: vi.fn(async () => dossierMutationResult),
      upsertKeyReference: vi.fn(async () => dossierMutationResult),
      deleteKeyReference: vi.fn(async () => dossierMutationResult),
      registerDossier: vi.fn(async () => ({
        id: 'new-dossier',
        name: 'new-dossier',
        registeredAt: '2026-03-20T21:45:12.345Z'
      }))
    }
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService,
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'intent-1.json'), {
      version: 1,
      commandId: 'intent-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'dossier.update',
      payload: {
        id: 'Client Alpha',
        status: 'active',
        type: 'Civil litigation'
      }
    })

    await processor.watchDomain(domainPath)

    expect(dossierService.updateDossier).toHaveBeenCalledWith({
      id: 'Client Alpha',
      status: 'active',
      type: 'Civil litigation',
      information: undefined
    })
    await expect(
      readFile(join(getDomainDelegatedInboxPath(domainPath), 'intent-1.json'), 'utf8')
    ).rejects.toThrow()
    await expect(readResponse(domainPath, 'intent-1.json')).resolves.toMatchObject({
      commandId: 'intent-1',
      originDeviceId: 'device-origin-123',
      status: 'completed',
      action: 'dossier.update'
    })

    const processed = JSON.parse(
      await readFile(getDomainDelegatedProcessedCommandsPath(domainPath), 'utf8')
    ) as Record<string, { action: string }>
    expect(processed['intent-1']).toMatchObject({
      action: 'dossier.update',
      originDeviceId: 'device-origin-123',
      status: 'completed',
      responseFilename: 'intent-1.json'
    })

    await processor.dispose()
    expect(watchers).toHaveLength(1)
  })

  it('does not re-execute duplicate command ids and keeps the original response', async () => {
    const domainPath = await createTempDir()
    const updateDossier = vi.fn(async () => ({
      id: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z'
    }))
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(async () => ({
          id: 'Client Alpha',
          name: 'Client Alpha',
          status: 'active' as const,
          type: 'Civil litigation',
          updatedAt: '2026-03-20T21:45:12.345Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null,
          registeredAt: '2026-03-01T09:00:00.000Z',
          keyDates: [],
          keyReferences: []
        })),
        updateDossier,
        upsertKeyDate: vi.fn(),
        deleteKeyDate: vi.fn(),
        upsertKeyReference: vi.fn(),
        deleteKeyReference: vi.fn(),
        registerDossier: vi.fn()
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(),
        saveMetadata: vi.fn()
      },
      generateService: {
        generateDocument: vi.fn()
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    const duplicatePayload = {
      version: 1,
      commandId: 'duplicate-command',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'dossier.update',
      payload: {
        id: 'Client Alpha',
        information: 'Updated summary'
      }
    }

    await writeJson(
      join(getDomainDelegatedInboxPath(domainPath), 'duplicate-1.json'),
      duplicatePayload
    )
    await processor.watchDomain(domainPath)
    await writeJson(
      join(getDomainDelegatedInboxPath(domainPath), 'duplicate-2.json'),
      duplicatePayload
    )
    await processor.watchDomain(domainPath)

    expect(updateDossier).toHaveBeenCalledTimes(1)
    await expect(readResponse(domainPath, 'duplicate-1.json')).resolves.toMatchObject({
      commandId: 'duplicate-command',
      status: 'completed'
    })
    await expect(
      readFile(join(getDomainDelegatedResponsesPath(domainPath), 'duplicate-2.json'), 'utf8')
    ).rejects.toThrow()
  })

  it('writes a failed response for malformed intents without executing actions', async () => {
    const domainPath = await createTempDir()
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }
    const dossierService = {
      getDossier: vi.fn(async () => dossierMutationResult),
      updateDossier: vi.fn(async () => dossierMutationResult),
      upsertKeyDate: vi.fn(async () => dossierMutationResult),
      deleteKeyDate: vi.fn(async () => dossierMutationResult),
      upsertKeyReference: vi.fn(async () => dossierMutationResult),
      deleteKeyReference: vi.fn(async () => dossierMutationResult),
      registerDossier: vi.fn(async () => ({
        id: 'new-dossier',
        name: 'new-dossier',
        registeredAt: '2026-03-20T21:45:12.345Z'
      }))
    }
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 0
        }))
      },
      dossierService,
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    const brokenPath = join(getDomainDelegatedInboxPath(domainPath), 'broken.json')
    await mkdir(dirname(brokenPath), { recursive: true })
    await writeFile(brokenPath, '{"version": 1,', 'utf8')

    await processor.watchDomain(domainPath)

    expect(dossierService.updateDossier).not.toHaveBeenCalled()
    const response = await readResponse(domainPath, 'broken.json')
    expect(response.status).toBe('failed')
    expect(response.error).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(response.raw).toContain('"version": 1')
  })

  it('returns extracted text and structured analysis for document.analyze responses', async () => {
    const domainPath = await createTempDir()
    const dossierPath = join(domainPath, 'Client Alpha')
    await mkdir(dossierPath, { recursive: true })
    await writeFile(
      join(dossierPath, 'incoming-note.txt'),
      'Article 1 - Objet. Madame Alice Martin réclame 1 250,50 euros. Audience le 12 avril 2026.',
      'utf8'
    )

    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(),
        updateDossier: vi.fn(),
        upsertKeyDate: vi.fn(),
        deleteKeyDate: vi.fn(),
        upsertKeyReference: vi.fn(),
        deleteKeyReference: vi.fn(),
        registerDossier: vi.fn()
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath),
        listDocuments: vi.fn(async () => [
          {
            id: 'incoming-note.txt',
            dossierId: 'Client Alpha',
            filename: 'incoming-note.txt',
            byteLength: 0,
            relativePath: 'incoming-note.txt',
            modifiedAt: '2026-03-20T21:45:12.345Z',
            description: undefined,
            tags: [],
            textExtraction: { state: 'extractable', isExtractable: true }
          }
        ]),
        relocateMetadata: vi.fn(),
        saveMetadata: vi.fn()
      } as never,
      generateService: {
        generateDocument: vi.fn()
      },
      tessDataPath: '/tmp/tessdata',
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'document-analyze.json'), {
      version: 1,
      commandId: 'document-analyze-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'document.analyze',
      payload: {
        dossierId: 'Client Alpha',
        documentId: 'incoming-note.txt'
      }
    })

    await processor.watchDomain(domainPath)

    await expect(readResponse(domainPath, 'document-analyze.json')).resolves.toMatchObject({
      commandId: 'document-analyze-1',
      status: 'completed',
      action: 'document.analyze',
      result: {
        documentId: 'incoming-note.txt',
        method: 'direct',
        text: expect.stringContaining('Madame Alice Martin')
      },
      nextStep: expect.stringContaining('document.saveMetadata')
    })
  })

  it('rejects intents without originDeviceId with a failed response', async () => {
    const domainPath = await createTempDir()
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(),
        updateDossier: vi.fn(),
        upsertKeyDate: vi.fn(),
        deleteKeyDate: vi.fn(),
        upsertKeyReference: vi.fn(),
        deleteKeyReference: vi.fn(),
        registerDossier: vi.fn()
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(),
        saveMetadata: vi.fn()
      },
      generateService: {
        generateDocument: vi.fn()
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'missing-origin.json'), {
      version: 1,
      commandId: 'missing-origin',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      action: 'dossier.update',
      payload: {
        id: 'Client Alpha',
        information: 'Updated summary'
      }
    })

    await processor.watchDomain(domainPath)

    await expect(readResponse(domainPath, 'missing-origin.json')).resolves.toMatchObject({
      commandId: 'missing-origin',
      status: 'failed',
      error: { code: 'VALIDATION_FAILED' }
    })
  })

  it('writes a needs_input response when document generation requires missing macro values', async () => {
    const domainPath = await createTempDir()
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(),
        updateDossier: vi.fn(),
        upsertKeyDate: vi.fn(),
        deleteKeyDate: vi.fn(),
        upsertKeyReference: vi.fn(),
        deleteKeyReference: vi.fn(),
        registerDossier: vi.fn()
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(),
        saveMetadata: vi.fn()
      },
      generateService: {
        generateDocument: vi.fn(async () => {
          throw new GenerateServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Document generation failed: some template fields could not be resolved from the dossier data.',
            ['dossier.keyDate.judgmentDate']
          )
        })
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'generate-document.json'), {
      version: 1,
      commandId: 'generate-document-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'generate.document',
      payload: {
        dossierId: 'Client Alpha',
        templateId: 'tpl-1',
        description: 'Draft document',
        tags: ['2026']
      }
    })

    await processor.watchDomain(domainPath)

    await expect(readResponse(domainPath, 'generate-document.json')).resolves.toMatchObject({
      commandId: 'generate-document-1',
      originDeviceId: 'device-origin-123',
      status: 'needs_input',
      error: {
        code: 'VALIDATION_FAILED',
        unresolvedTags: [
          {
            path: 'dossier.keyDate.judgmentDate'
          }
        ]
      }
    })
  })

  it('processes contact upserts by updating canonical contacts.json through the queue', async () => {
    const domainPath = await createTempDir()
    const dossierPath = join(domainPath, 'Client Alpha')
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(async () => dossierMutationResult),
        updateDossier: vi.fn(async () => dossierMutationResult),
        upsertKeyDate: vi.fn(async () => dossierMutationResult),
        deleteKeyDate: vi.fn(async () => dossierMutationResult),
        upsertKeyReference: vi.fn(async () => dossierMutationResult),
        deleteKeyReference: vi.fn(async () => dossierMutationResult),
        registerDossier: vi.fn(async () => ({
          id: 'new-dossier',
          name: 'new-dossier',
          registeredAt: '2026-03-20T21:45:12.345Z'
        }))
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'contact-upsert.json'), {
      version: 1,
      commandId: 'contact-upsert-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'contact.upsert',
      payload: {
        dossierId: 'Client Alpha',
        displayName: 'Camille Martin',
        role: 'Client',
        email: 'camille.martin@example.com'
      }
    })

    await processor.watchDomain(domainPath)

    const contacts = JSON.parse(
      await readFile(getDossierContactsPath(dossierPath), 'utf8')
    ) as Array<{
      dossierId: string
      role: string
      email: string
      uuid: string
    }>
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({
      dossierId: 'Client Alpha',
      role: 'Client',
      email: 'camille.martin@example.com'
    })
    expect(contacts[0]!.uuid).toBeTruthy()
  })

  it('merges partial contact fields when updating an existing contact by id', async () => {
    const domainPath = await createTempDir()
    const dossierPath = join(domainPath, 'Client Alpha')
    const contactId = 'existing-contact-id'

    // Pre-populate contacts.json with a full contact record
    await writeJson(getDossierContactsPath(dossierPath), [
      {
        uuid: contactId,
        dossierId: 'Client Alpha',
        firstName: 'Camille',
        lastName: 'Martin',
        role: 'Client',
        email: 'camille.martin@example.com',
        phone: '+33 6 12 34 56 78'
      }
    ])

    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(),
        updateDossier: vi.fn(),
        upsertKeyDate: vi.fn(),
        deleteKeyDate: vi.fn(),
        upsertKeyReference: vi.fn(),
        deleteKeyReference: vi.fn(),
        registerDossier: vi.fn()
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath),
        relocateMetadata: vi.fn(),
        saveMetadata: vi.fn()
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    // Update only the email — all other fields must be preserved
    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'contact-update.json'), {
      version: 1,
      commandId: 'contact-update-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'contact.upsert',
      payload: {
        id: contactId,
        dossierId: 'Client Alpha',
        email: 'new.email@example.com'
      }
    })

    await processor.watchDomain(domainPath)

    const contacts = JSON.parse(
      await readFile(getDossierContactsPath(dossierPath), 'utf8')
    ) as Array<Record<string, string>>
    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({
      uuid: contactId,
      dossierId: 'Client Alpha',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client',
      email: 'new.email@example.com',
      phone: '+33 6 12 34 56 78'
    })
  })

  it('routes document relocation intents through the document service', async () => {
    const domainPath = await createTempDir()
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }
    const relocateMetadata = vi.fn(async () => ({
      id: 'moved/report.txt',
      uuid: 'document-uuid-1',
      dossierId: 'Client Alpha',
      filename: 'report.txt',
      byteLength: 128,
      relativePath: 'moved/report.txt',
      modifiedAt: '2026-03-20T21:45:12.345Z',
      description: 'Report',
      tags: ['evidence'],
      textExtraction: { state: 'extractable' as const, isExtractable: true }
    }))
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(async () => dossierMutationResult),
        updateDossier: vi.fn(async () => dossierMutationResult),
        upsertKeyDate: vi.fn(async () => dossierMutationResult),
        deleteKeyDate: vi.fn(async () => dossierMutationResult),
        upsertKeyReference: vi.fn(async () => dossierMutationResult),
        deleteKeyReference: vi.fn(async () => dossierMutationResult),
        registerDossier: vi.fn(async () => ({
          id: 'new-dossier',
          name: 'new-dossier',
          registeredAt: '2026-03-20T21:45:12.345Z'
        }))
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata,
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'document-relocate.json'), {
      version: 1,
      commandId: 'document-relocate-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'document.relocate',
      payload: {
        dossierId: 'Client Alpha',
        documentUuid: 'document-uuid-1',
        fromDocumentId: 'report.txt',
        toDocumentId: 'moved/report.txt'
      }
    })

    await processor.watchDomain(domainPath)

    expect(relocateMetadata).toHaveBeenCalledWith({
      dossierId: 'Client Alpha',
      documentUuid: 'document-uuid-1',
      fromDocumentId: 'report.txt',
      toDocumentId: 'moved/report.txt'
    })
  })

  it('merges partial dossier update intents with existing dossier metadata', async () => {
    const domainPath = await createTempDir()
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'pending' as const,
      type: 'Civil litigation',
      information: 'Existing summary',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }
    const dossierService = {
      getDossier: vi.fn(async () => dossierMutationResult),
      updateDossier: vi.fn(async () => dossierMutationResult),
      upsertKeyDate: vi.fn(async () => dossierMutationResult),
      deleteKeyDate: vi.fn(async () => dossierMutationResult),
      upsertKeyReference: vi.fn(async () => dossierMutationResult),
      deleteKeyReference: vi.fn(async () => dossierMutationResult),
      registerDossier: vi.fn(async () => ({
        id: 'new-dossier',
        name: 'new-dossier',
        registeredAt: '2026-03-20T21:45:12.345Z'
      }))
    }
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService,
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'dossier-information.json'), {
      version: 1,
      commandId: 'dossier-information-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'dossier.update',
      payload: {
        id: 'Client Alpha',
        information: 'Updated summary'
      }
    })

    await processor.watchDomain(domainPath)

    expect(dossierService.getDossier).toHaveBeenCalledWith({ dossierId: 'Client Alpha' })
    expect(dossierService.updateDossier).toHaveBeenCalledWith({
      id: 'Client Alpha',
      status: 'pending',
      type: 'Civil litigation',
      information: 'Updated summary'
    })
  })

  it('prunes failed delegated intents older than 5 days when watching a domain', async () => {
    const domainPath = await createTempDir()
    const currentDate = new Date('2026-03-21T08:00:00.000Z')
    const oldFailedPath = join(getDomainDelegatedFailedPath(domainPath), 'old.json')
    const recentFailedPath = join(getDomainDelegatedFailedPath(domainPath), 'recent.json')
    const dossierMutationResult = {
      id: 'Client Alpha',
      name: 'Client Alpha',
      status: 'active' as const,
      type: 'Civil litigation',
      updatedAt: '2026-03-20T21:45:12.345Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      registeredAt: '2026-03-01T09:00:00.000Z',
      keyDates: [],
      keyReferences: []
    }

    await writeJson(oldFailedPath, { failedAt: '2026-03-10T08:00:00.000Z' })
    await writeJson(recentFailedPath, { failedAt: '2026-03-19T08:00:00.000Z' })
    await utimes(
      oldFailedPath,
      currentDate,
      new Date(currentDate.getTime() - 6 * 24 * 60 * 60 * 1000)
    )
    await utimes(
      recentFailedPath,
      currentDate,
      new Date(currentDate.getTime() - 2 * 24 * 60 * 60 * 1000)
    )

    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      dossierService: {
        getDossier: vi.fn(async () => dossierMutationResult),
        updateDossier: vi.fn(async () => dossierMutationResult),
        upsertKeyDate: vi.fn(async () => dossierMutationResult),
        deleteKeyDate: vi.fn(async () => dossierMutationResult),
        upsertKeyReference: vi.fn(async () => dossierMutationResult),
        deleteKeyReference: vi.fn(async () => dossierMutationResult),
        registerDossier: vi.fn(async () => ({
          id: 'new-dossier',
          name: 'new-dossier',
          registeredAt: '2026-03-20T21:45:12.345Z'
        }))
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => join(domainPath, 'Client Alpha')),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => ({ outputPath: join(domainPath, 'generated.txt') }))
      },
      now: () => currentDate,
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await processor.watchDomain(domainPath)

    await expect(stat(oldFailedPath)).rejects.toThrow()
    await expect(readFile(recentFailedPath, 'utf8')).resolves.toContain('2026-03-19')
  })

  it('creates a dossier folder and registers it when processing a dossier.create intent', async () => {
    const domainPath = await createTempDir()
    const registerDossier = vi.fn(async () => ({
      id: 'Nouveau Client',
      name: 'Nouveau Client',
      registeredAt: '2026-03-20T21:45:12.345Z'
    }))
    const processor = createDelegatedAiActionProcessor({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 0
        }))
      },
      dossierService: {
        getDossier: vi.fn(async () => {
          throw new Error('not used')
        }),
        updateDossier: vi.fn(async () => {
          throw new Error('not used')
        }),
        upsertKeyDate: vi.fn(async () => {
          throw new Error('not used')
        }),
        deleteKeyDate: vi.fn(async () => {
          throw new Error('not used')
        }),
        upsertKeyReference: vi.fn(async () => {
          throw new Error('not used')
        }),
        deleteKeyReference: vi.fn(async () => {
          throw new Error('not used')
        }),
        registerDossier
      },
      documentService: {
        listDocuments: vi.fn().mockResolvedValue([]),
        resolveRegisteredDossierRoot: vi.fn(async () => {
          throw new Error('not used')
        }),
        relocateMetadata: vi.fn(async () => {
          throw new Error('not used')
        }),
        saveMetadata: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      generateService: {
        generateDocument: vi.fn(async () => {
          throw new Error('not used')
        })
      },
      stabilityWindowMs: 0,
      watchFactory: vi.fn(() => new FakeWatcher())
    })

    await writeJson(join(getDomainDelegatedInboxPath(domainPath), 'dossier-create.json'), {
      version: 1,
      commandId: 'dossier-create-1',
      createdAt: '2026-03-20T21:45:12.345Z',
      actor: 'claude-delegated',
      originDeviceId: 'device-origin-123',
      action: 'dossier.create',
      payload: { id: 'Nouveau Client' }
    })

    await processor.watchDomain(domainPath)

    const folderStats = await stat(join(domainPath, 'Nouveau Client'))
    expect(folderStats.isDirectory()).toBe(true)
    expect(registerDossier).toHaveBeenCalledWith({ id: 'Nouveau Client' })
  })
})
