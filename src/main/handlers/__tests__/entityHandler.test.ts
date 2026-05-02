import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type EntityProfile, type IpcResult } from '@shared/types'

import { createEntityService } from '../../services/domain/entityService'
import { registerEntityHandlers } from '../entityHandler'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-entity-handler-'))
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

describe('entityHandler', () => {
  it('returns null when entity.json is missing and loads an existing entity profile', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerEntityHandlers({
      ipcMain: harness.ipcMain,
      entityService: createEntityService({ domainService })
    })

    await expect(harness.invoke(IPC_CHANNELS.entity.get)).resolves.toEqual({
      success: true,
      data: null
    })

    const storedEntity: EntityProfile = {
      firmName: 'Cabinet Martin',
      address: '12 rue de la Paix, 75001 Paris',
      vatNumber: 'FR12345678901',
      phone: '+33 1 02 03 04 05',
      email: 'contact@example.com'
    }

    await writeFile(
      join(domainPath, '.ordicab', 'entity.json'),
      `${JSON.stringify(storedEntity, null, 2)}\n`,
      'utf8'
    )

    await expect(harness.invoke(IPC_CHANNELS.entity.get)).resolves.toMatchObject({
      success: true,
      data: expect.objectContaining(storedEntity)
    })
  })

  it('validates update input — persists on success and rejects on invalid input or unavailable domain', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerEntityHandlers({
      ipcMain: harness.ipcMain,
      entityService: createEntityService({ domainService })
    })

    const result = (await harness.invoke(IPC_CHANNELS.entity.update, {
      firmName: 'Cabinet Martin',
      address: '12 rue de la Paix, 75001 Paris',
      vatNumber: 'FR12345678901',
      phone: '+33 1 02 03 04 05',
      email: 'contact@example.com'
    })) as IpcResult<EntityProfile>

    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({
        firmName: 'Cabinet Martin',
        address: '12 rue de la Paix, 75001 Paris',
        vatNumber: 'FR12345678901',
        phone: '+33 1 02 03 04 05',
        email: 'contact@example.com'
      })
    })

    const stored = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'entity.json'), 'utf8')
    ) as EntityProfile

    expect(stored).toEqual(result.success ? result.data : null)

    // Invalid input: validation fails before domain is checked
    const harness2 = createIpcMainHarness()
    const domainServiceUnavailable = {
      getStatus: vi.fn().mockResolvedValue({
        registeredDomainPath: null,
        isAvailable: false,
        dossierCount: 0
      })
    }

    registerEntityHandlers({
      ipcMain: harness2.ipcMain,
      entityService: createEntityService({ domainService: domainServiceUnavailable })
    })

    await expect(
      harness2.invoke(IPC_CHANNELS.entity.update, {
        firmName: '',
        email: 'contact@example.com'
      })
    ).resolves.toMatchObject({
      success: false,
      code: IpcErrorCode.VALIDATION_FAILED
    })

    expect(domainServiceUnavailable.getStatus).not.toHaveBeenCalled()

    await expect(harness2.invoke(IPC_CHANNELS.entity.get)).resolves.toEqual({
      success: false,
      error: 'Active domain is not configured.',
      code: IpcErrorCode.NOT_FOUND
    })
  })

  it('returns validation failures when stored entity JSON is malformed', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeFile(join(domainPath, '.ordicab', 'entity.json'), '{not-json}\n', 'utf8')

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerEntityHandlers({
      ipcMain: harness.ipcMain,
      entityService: createEntityService({ domainService })
    })

    await expect(harness.invoke(IPC_CHANNELS.entity.get)).resolves.toEqual({
      success: false,
      error: 'Stored professional entity profile is invalid.',
      code: IpcErrorCode.VALIDATION_FAILED
    })
  })
})
