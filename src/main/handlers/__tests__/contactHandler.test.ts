import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type ContactRecord, type IpcResult } from '@shared/types'

import { type DocumentService, DocumentServiceError } from '../../services/domain/documentService'
import { createContactService } from '../../services/domain/contactService'
import { registerContactHandlers } from '../contactHandler'

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
  it('lists contacts from contacts.json and returns an empty array when the file is missing', async () => {
    const dossierPath = await createTempDir()
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService })
    })

    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, { dossierId: 'dos-1' })
    ).resolves.toEqual({
      success: true,
      data: []
    })

    const storedContacts: ContactRecord[] = [
      {
        uuid: 'contact-1',
        dossierId: 'dos-1',
        firstName: 'Camille',
        lastName: 'Martin',
        role: 'Client',
        institution: 'Martin SARL',
        email: 'camille@example.com'
      }
    ]
    await writeFile(
      join(dossierPath, '.ordicab', 'contacts.json'),
      `${JSON.stringify(storedContacts, null, 2)}\n`,
      'utf8'
    )

    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, { dossierId: 'dos-1' })
    ).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining(storedContacts[0]!)]
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
      contactService: createContactService({ documentService })
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
      id: createdId,
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
      await readFile(join(dossierPath, '.ordicab', 'contacts.json'), 'utf8')
    ) as ContactRecord[]

    expect(written).toMatchObject([
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
    ])
  })

  it('deletes contacts from contacts.json', async () => {
    const dossierPath = await createTempDir()
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await writeFile(
      join(dossierPath, '.ordicab', 'contacts.json'),
      `${JSON.stringify(
        [
          {
            uuid: 'contact-1',
            dossierId: 'dos-1',
            firstName: 'Camille',
            lastName: 'Martin',
            role: 'Client'
          }
        ],
        null,
        2
      )}\n`,
      'utf8'
    )

    const harness = createIpcMainHarness()
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
    } as unknown as DocumentService

    registerContactHandlers({
      ipcMain: harness.ipcMain,
      contactService: createContactService({ documentService })
    })

    await expect(
      harness.invoke(IPC_CHANNELS.contact.delete, {
        dossierId: 'dos-1',
        contactUuid: 'contact-1'
      })
    ).resolves.toEqual({
      success: true,
      data: null
    })

    const written = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'contacts.json'), 'utf8')
    ) as ContactRecord[]

    expect(written).toEqual([])
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
      contactService: createContactService({ documentService })
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

    await expect(
      harness.invoke(IPC_CHANNELS.contact.list, {
        dossierId: '../escape'
      })
    ).resolves.toEqual({
      success: false,
      error: 'Dossier registration is limited to direct subfolders of the active domain.',
      code: IpcErrorCode.INVALID_INPUT
    })
  })
})
