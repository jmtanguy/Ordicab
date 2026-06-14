import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type ContactRecord, type IpcResult } from '@shared/types'

import { type DocumentService, DocumentServiceError } from '../../services/domain/documentService'
import type { DossierRegistryService } from '../../services/domain/dossierRegistryService'
import { createConflictCheckService } from '../../services/domain/conflictCheckService'
import { createContactService } from '../../services/domain/contactService'
import { registerContactHandlers } from '../contactHandler'
import { pathExists } from '../../lib/system/domainState'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-contact-handler-'))
  tempDirs.push(dir)
  return dir
}

function createIpcMainHarness(): {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
  ipcMain: {
    handle: (
      channel: string,
      listener: (_event: unknown, input?: unknown) => Promise<unknown>
    ) => void
  }
} {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

  return {
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      }
    },
    invoke: async (channel, input) => {
      const handler = handlers.get(channel)

      if (!handler) {
        throw new Error(`No IPC handler registered for ${channel}`)
      }

      return handler({}, input)
    }
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('contactHandler', () => {
  it('lists contacts from per-file storage and returns an empty array when the directory is missing', async () => {
    const dossierPath = await createTempDir()
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService }),
      conflictCheckService: { check: vi.fn(async () => []) }
    })

    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, { dossierId: 'dos-1' })
    ).resolves.toEqual({
      success: true,
      data: []
    })

    const contact: ContactRecord = {
      uuid: 'contact-1',
      dossierId: 'dos-1',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client',
      institution: 'Martin SARL',
      email: 'camille@example.com'
    }
    const contactsDir = join(dossierPath, '.ordicab', 'contacts')
    await mkdir(contactsDir, { recursive: true })
    await writeFile(
      join(contactsDir, `${contact.uuid}.json`),
      `${JSON.stringify(contact, null, 2)}\n`,
      'utf8'
    )

    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, { dossierId: 'dos-1' })
    ).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining(contact)]
    })
  })

  it('inserts and updates contacts with atomic file persistence', async () => {
    const dossierPath = await createTempDir()
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService }),
      conflictCheckService: { check: vi.fn(async () => []) }
    })

    const created = (await harness.invoke(IPC_CHANNELS.contact.upsert, {
      dossierId: 'dos-1',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client',
      institution: '  Martin SARL  ',
      email: 'camille@example.com',
      information: '  Main contact for strategic decisions  '
    })) as IpcResult<ContactRecord>

    expect(created).toMatchObject({
      success: true,
      data: {
        dossierId: 'dos-1',
        firstName: 'Camille',
        lastName: 'Martin',
        role: 'Client',
        institution: 'Martin SARL',
        email: 'camille@example.com',
        information: 'Main contact for strategic decisions'
      }
    })

    const createdId = created.success ? created.data.uuid : ''

    const updated = (await harness.invoke(IPC_CHANNELS.contact.upsert, {
      uuid: createdId,
      dossierId: 'dos-1',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Lead client',
      institution: '',
      addressLine: '12 rue de la Paix',
      phone: '+33 6 00 00 00 00',
      email: '',
      information: '  Handles client validation and follow-up  '
    })) as IpcResult<ContactRecord>

    expect(updated).toMatchObject({
      success: true,
      data: expect.objectContaining({
        uuid: createdId,
        dossierId: 'dos-1',
        firstName: 'Camille',
        lastName: 'Martin',
        role: 'Lead client',
        addressLine: '12 rue de la Paix',
        phone: '+33 6 00 00 00 00',
        information: 'Handles client validation and follow-up'
      })
    })

    const written = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'contacts', `${createdId}.json`), 'utf8')
    ) as ContactRecord

    expect(written).toMatchObject(
      expect.objectContaining({
        uuid: createdId,
        dossierId: 'dos-1',
        firstName: 'Camille',
        lastName: 'Martin',
        role: 'Lead client',
        addressLine: '12 rue de la Paix',
        phone: '+33 6 00 00 00 00',
        information: 'Handles client validation and follow-up'
      })
    )
  })

  it('deletes a contact that was created via the service', async () => {
    const dossierPath = await createTempDir()
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService }),
      conflictCheckService: { check: vi.fn(async () => []) }
    })

    // Create the contact via the service so it lands in per-file storage
    const created = (await harness.invoke(IPC_CHANNELS.contact.upsert, {
      dossierId: 'dos-1',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client'
    })) as IpcResult<ContactRecord>
    const contactUuid = created.success ? created.data.uuid : ''

    await expect(
      harness.invoke(IPC_CHANNELS.contact.delete, {
        dossierId: 'dos-1',
        contactUuid: contactUuid
      })
    ).resolves.toEqual({
      success: true,
      data: null
    })

    // The per-file record should no longer exist
    const recordPath = join(dossierPath, '.ordicab', 'contacts', `${contactUuid}.json`)
    await expect(pathExists(recordPath)).resolves.toBe(false)
  })

  it('reports name conflicts found in other registered dossiers', async () => {
    const currentDossierPath = await createTempDir()
    const otherDossierPath = await createTempDir()

    const contactsDir = join(otherDossierPath, '.ordicab', 'contacts')
    await mkdir(contactsDir, { recursive: true })
    const contact: ContactRecord = {
      uuid: 'contact-9',
      dossierId: 'dos-2',
      firstName: 'Camille',
      lastName: 'Martin',
      role: 'Client'
    }
    await writeFile(
      join(contactsDir, `${contact.uuid}.json`),
      `${JSON.stringify(contact, null, 2)}\n`,
      'utf8'
    )

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async (input: { dossierId: string }) =>
        input.dossierId === 'dos-2' ? otherDossierPath : currentDossierPath
      )
    } as unknown as DocumentService
    const dossierRegistryService = {
      listRegisteredDossiers: vi.fn(async () => [
        { slug: 'dos-1', name: 'Dossier 1' },
        { slug: 'dos-2', name: 'Dossier 2' }
      ])
    } as unknown as DossierRegistryService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService }),
      conflictCheckService: createConflictCheckService({ dossierRegistryService, documentService })
    })

    await expect(
      harness.invoke(IPC_CHANNELS.contact.checkConflicts, {
        dossierId: 'dos-1',
        firstName: 'camille',
        lastName: 'MARTIN'
      })
    ).resolves.toEqual({
      success: true,
      data: [
        {
          dossierId: 'dos-2',
          dossierName: 'Dossier 2',
          contactUuid: 'contact-9',
          contactDisplayName: 'Camille Martin',
          contactRole: 'Client',
          matchKind: 'exact'
        }
      ]
    })

    // The dossier being edited is never scanned against itself.
    await expect(
      harness.invoke(IPC_CHANNELS.contact.checkConflicts, {
        dossierId: 'dos-2',
        firstName: 'Camille',
        lastName: 'Martin'
      })
    ).resolves.toEqual({ success: true, data: [] })
  })

  it('rejects invalid input and dossier path traversal attempts', async () => {
    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async (input: { dossierId: string }) => {
        if (input.dossierId.includes('..')) {
          throw new DocumentServiceError(
            IpcErrorCode.INVALID_INPUT,
            'Dossier registration is limited to direct subfolders of the active domain.'
          )
        }

        return '/tmp/dossier'
      })
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService }),
      conflictCheckService: { check: vi.fn(async () => []) }
    })

    await expect(
      harness.invoke(IPC_CHANNELS.contact.upsert, {
        dossierId: '',
        role: 'Client'
      })
    ).resolves.toMatchObject({
      success: false,
      code: IpcErrorCode.VALIDATION_FAILED
    })

    // A dossierId carrying a path separator / traversal segment is now rejected
    // at the schema boundary (dossierIdSchema), before it can reach any path join.
    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, {
        dossierId: '../escape'
      })
    ).resolves.toMatchObject({
      success: false,
      code: IpcErrorCode.VALIDATION_FAILED
    })
  })
})
