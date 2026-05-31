import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { IpcErrorCode } from '@shared/types'

import { createDossierRegistryService, DossierRegistryError } from '../dossierRegistryService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-dossier-service-'))
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
        updatedAt: '2026-03-13T08:00:00.000Z'
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

describe('dossier registry service', () => {
  it('lists only visible direct eligible subfolders and excludes already registered dossiers', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))
    await mkdir(join(domainPath, 'Client Beta'))
    await mkdir(join(domainPath, 'Client Beta', 'Nested'))
    await mkdir(join(domainPath, '.ordicab'))
    await mkdir(join(domainPath, '.git'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await expect(service.listEligibleFolders()).resolves.toEqual([
      {
        id: 'Client Alpha',
        name: 'Client Alpha',
        path: join(domainPath, 'Client Alpha')
      },
      {
        id: 'Client Beta',
        name: 'Client Beta',
        path: join(domainPath, 'Client Beta')
      }
    ])

    await service.registerDossier({ id: 'Client Alpha' })

    await expect(service.listEligibleFolders()).resolves.toEqual([
      {
        id: 'Client Beta',
        name: 'Client Beta',
        path: join(domainPath, 'Client Beta')
      }
    ])
  })

  it('registers a dossier by writing domain registry metadata and dossier.json atomically', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:00:00.000Z')
    })

    await expect(service.registerDossier({ id: 'Client Alpha' })).resolves.toMatchObject({
      id: 'Client Alpha',
      uuid: expect.any(String),
      name: 'Client Alpha',
      status: 'active',
      type: '',
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null
    })

    await expect(service.listRegisteredDossiers()).resolves.toEqual([
      expect.objectContaining({
        id: 'Client Alpha',
        uuid: expect.any(String),
        name: 'Client Alpha',
        status: 'active',
        type: '',
        updatedAt: '2026-03-13T09:00:00.000Z',
        lastOpenedAt: null,
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      })
    ])

    const registry = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'registry.json'), 'utf8')
    ) as {
      dossiers: Array<{ id: string; uuid?: string; name: string; registeredAt: string }>
    }
    expect(registry).toEqual({
      dossiers: [
        expect.objectContaining({
          id: 'Client Alpha',
          uuid: expect.any(String),
          name: 'Client Alpha',
          registeredAt: '2026-03-13T09:00:00.000Z'
        })
      ]
    })

    const dossierMetadata = JSON.parse(
      await readFile(join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      name: string
      registeredAt: string
      status: string
      type: string
    }
    expect(dossierMetadata).toMatchObject({
      name: 'Client Alpha',
      registeredAt: '2026-03-13T09:00:00.000Z',
      status: 'active',
      type: ''
    })
  })

  it('loads dossier detail and persists status or type updates atomically', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    let currentTime = new Date('2026-03-13T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => currentTime
    })

    await service.registerDossier({ id: 'Client Alpha' })

    await expect(service.getDossier({ dossierId: 'Client Alpha' })).resolves.toMatchObject({
      id: 'Client Alpha',
      uuid: expect.any(String),
      name: 'Client Alpha',
      registeredAt: '2026-03-13T09:00:00.000Z',
      status: 'active',
      type: '',
      information: undefined,
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      keyDates: [],
      keyReferences: [
        {
          id: expect.any(String),
          dossierId: 'Client Alpha',
          label: 'Nom du dossier',
          value: 'Client Alpha'
        }
      ]
    })

    currentTime = new Date('2026-03-13T09:15:00.000Z')

    await expect(
      service.updateDossier({
        id: 'Client Alpha',
        status: 'pending',
        type: 'Civil litigation',
        information: 'Current status note'
      })
    ).resolves.toMatchObject({
      id: 'Client Alpha',
      status: 'pending',
      type: 'Civil litigation',
      information: 'Current status note',
      updatedAt: '2026-03-13T09:15:00.000Z'
    })

    const dossierMetadata = JSON.parse(
      await readFile(join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      status: string
      type: string
      information?: string
      updatedAt: string
    }

    expect(dossierMetadata).toMatchObject({
      status: 'pending',
      type: 'Civil litigation',
      information: 'Current status note',
      updatedAt: '2026-03-13T09:15:00.000Z',
      lastOpenedAt: null
    })
  })

  it('persists lastOpenedAt inside .ordicab when a dossier is opened', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    let currentTime = new Date('2026-03-13T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => currentTime
    })

    await service.registerDossier({ id: 'Client Alpha' })

    currentTime = new Date('2026-03-13T09:20:00.000Z')

    await expect(service.openDossier({ dossierId: 'Client Alpha' })).resolves.toMatchObject({
      id: 'Client Alpha',
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: '2026-03-13T09:20:00.000Z'
    })

    await expect(service.listRegisteredDossiers()).resolves.toEqual([
      expect.objectContaining({
        id: 'Client Alpha',
        uuid: expect.any(String),
        name: 'Client Alpha',
        status: 'active',
        type: '',
        updatedAt: '2026-03-13T09:00:00.000Z',
        lastOpenedAt: '2026-03-13T09:20:00.000Z',
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      })
    ])

    const dossierMetadata = JSON.parse(
      await readFile(join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      updatedAt: string
      lastOpenedAt: string | null
    }

    expect(dossierMetadata).toMatchObject({
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: '2026-03-13T09:20:00.000Z'
    })
  })

  it('fails dossier detail reads when stored dossier metadata is invalid', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:00:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })
    await writeFile(
      join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json'),
      '{not-json}\n',
      'utf8'
    )

    await expect(service.getDossier({ dossierId: 'Client Alpha' })).rejects.toMatchObject({
      name: 'DossierRegistryError',
      code: IpcErrorCode.VALIDATION_FAILED,
      message: 'Stored dossier metadata is invalid.'
    } satisfies Partial<DossierRegistryError>)
  })

  it('preserves document metadata when dossier detail fields are updated', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Delta')
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    await writeFile(
      join(domainPath, '.ordicab', 'registry.json'),
      `${JSON.stringify(
        {
          dossiers: [
            {
              id: 'Client Delta',
              name: 'Client Delta',
              registeredAt: '2026-03-13T09:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )
    await writeFile(
      join(dossierPath, '.ordicab', 'dossier.json'),
      `${JSON.stringify(
        {
          id: 'Client Delta',
          name: 'Client Delta',
          registeredAt: '2026-03-13T09:00:00.000Z',
          status: 'active',
          type: '',
          updatedAt: '2026-03-13T09:00:00.000Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          keyDates: [],
          keyReferences: [],
          documents: [
            {
              relativePath: 'letter.txt',
              description: 'Incoming note',
              tags: ['urgent']
            }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:15:00.000Z')
    })

    await service.updateDossier({
      id: 'Client Delta',
      status: 'pending',
      type: 'Civil litigation'
    })

    const dossierMetadata = JSON.parse(
      await readFile(join(dossierPath, '.ordicab', 'dossier.json'), 'utf8')
    ) as {
      documents: Array<{ relativePath: string; description?: string; tags: string[] }>
      status: string
      type: string
    }

    expect(dossierMetadata.status).toBe('pending')
    expect(dossierMetadata.type).toBe('Civil litigation')
    expect(dossierMetadata.documents).toEqual([
      {
        relativePath: 'letter.txt',
        description: 'Incoming note',
        tags: ['urgent']
      }
    ])
  })

  it('creates, updates, deletes, and reloads key dates while deriving next upcoming dates from today forward', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    let currentTime = new Date('2026-03-20T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => currentTime
    })

    await service.registerDossier({ id: 'Client Alpha' })
    await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Past deadline',
      date: '2026-03-18'
    })

    const withToday = await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Today hearing',
      date: '2026-03-20'
    })
    const createdFuture = await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Appeal deadline',
      date: '2026-03-25'
    })

    expect(withToday.nextUpcomingKeyDate).toBe('2026-03-20')
    expect(createdFuture.nextUpcomingKeyDate).toBe('2026-03-20')

    const futureEntry = createdFuture.keyDates.find((entry) => entry.label === 'Appeal deadline')
    expect(futureEntry).toBeDefined()

    const updatedFuture = await service.upsertKeyDate({
      id: futureEntry?.id,
      dossierId: 'Client Alpha',
      label: 'Appeal deadline',
      date: '2026-03-21'
    })

    expect(updatedFuture.keyDates.some((entry) => entry.date === '2026-03-21')).toBe(true)

    const todayEntry = updatedFuture.keyDates.find((entry) => entry.label === 'Today hearing')
    expect(todayEntry).toBeDefined()

    currentTime = new Date('2026-03-20T10:00:00.000Z')
    const withoutToday = await service.deleteKeyDate({
      dossierId: 'Client Alpha',
      keyDateId: todayEntry?.id ?? ''
    })

    expect(withoutToday.nextUpcomingKeyDate).toBe('2026-03-21')

    const reloadedService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-20T10:05:00.000Z')
    })

    await expect(reloadedService.getDossier({ dossierId: 'Client Alpha' })).resolves.toMatchObject({
      nextUpcomingKeyDate: '2026-03-21'
    })
  })

  it('creates, updates, and deletes key references without corrupting other dossier detail fields', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    let currentTime = new Date('2026-03-21T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => currentTime
    })

    await service.registerDossier({ id: 'Client Alpha' })
    await service.updateDossier({
      id: 'Client Alpha',
      status: 'pending',
      type: 'Civil litigation'
    })

    const created = await service.upsertKeyReference({
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/001'
    })

    expect(created).toMatchObject({
      status: 'pending',
      type: 'Civil litigation'
    })

    const createdReference = created.keyReferences.find((entry) => entry.label === 'Case number')
    expect(createdReference).toBeDefined()

    currentTime = new Date('2026-03-21T09:10:00.000Z')
    const updated = await service.upsertKeyReference({
      id: createdReference?.id,
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/009'
    })

    expect(updated.keyReferences).toEqual([
      {
        id: expect.any(String),
        dossierId: 'Client Alpha',
        label: 'Nom du dossier',
        value: 'Client Alpha'
      },
      {
        id: createdReference?.id,
        dossierId: 'Client Alpha',
        label: 'Case number',
        value: 'RG 26/009'
      }
    ])

    const cleared = await service.deleteKeyReference({
      dossierId: 'Client Alpha',
      keyReferenceId: createdReference?.id ?? ''
    })

    // The auto-managed dossier-name reference is non-deletable, so it stays.
    expect(cleared.keyReferences).toEqual([
      {
        id: expect.any(String),
        dossierId: 'Client Alpha',
        label: 'Nom du dossier',
        value: 'Client Alpha'
      }
    ])
    expect(cleared.status).toBe('pending')
    expect(cleared.type).toBe('Civil litigation')
  })

  it('rejects duplicate registration without mutating registry files', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T10:00:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    await expect(service.registerDossier({ id: 'Client Alpha' })).rejects.toThrow(
      'This dossier is already registered.'
    )

    const registry = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'registry.json'), 'utf8')
    ) as {
      dossiers: Array<{ id: string }>
    }
    expect(registry.dossiers).toHaveLength(1)
  })

  it('unregisters only Ordicab metadata and keeps user documents untouched', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Alpha')
    await mkdir(dossierPath)
    await writeFile(join(dossierPath, 'notes.txt'), 'leave me here', 'utf8')

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T11:00:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })
    await expect(service.unregisterDossier({ id: 'Client Alpha' })).resolves.toBeNull()

    await expect(service.listRegisteredDossiers()).resolves.toEqual([])
    await expect(readFile(join(dossierPath, 'notes.txt'), 'utf8')).resolves.toBe('leave me here')
    await expect(pathExists(join(dossierPath, '.ordicab', 'dossier.json'))).resolves.toBe(false)

    const registry = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'registry.json'), 'utf8')
    ) as {
      dossiers: Array<{ id: string }>
    }
    expect(registry.dossiers).toEqual([])
  })

  it('rejects folder identifiers outside the active domain root', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T12:00:00.000Z')
    })

    await expect(service.registerDossier({ id: '../escape' })).rejects.toThrow(
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  })

  it('rejects hidden folders as dossier ids', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, '.Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T12:30:00.000Z')
    })

    await expect(service.registerDossier({ id: '.Client Alpha' })).rejects.toThrow(
      'Hidden folders cannot be registered as dossiers.'
    )
  })

  it('rejects dot-dot and dot as dossier ids to prevent parent directory traversal', async () => {
    const { stateFilePath } = await createConfiguredDomain()

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T12:00:00.000Z')
    })

    await expect(service.registerDossier({ id: '..' })).rejects.toThrow(
      'Dossier registration is limited to direct subfolders of the active domain.'
    )

    await expect(service.registerDossier({ id: '.' })).rejects.toThrow(
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  })

  it('normalizes legacy registered status metadata to active on read', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierPath = join(domainPath, 'Client Alpha')
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await writeFile(
      join(domainPath, '.ordicab', 'registry.json'),
      `${JSON.stringify(
        {
          dossiers: [
            {
              id: 'Client Alpha',
              name: 'Client Alpha',
              registeredAt: '2026-03-13T09:00:00.000Z'
            }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )
    await writeFile(
      join(dossierPath, '.ordicab', 'dossier.json'),
      `${JSON.stringify(
        {
          id: 'Client Alpha',
          name: 'Client Alpha',
          registeredAt: '2026-03-13T09:00:00.000Z',
          status: 'registered',
          type: '',
          updatedAt: '2026-03-13T09:00:00.000Z',
          lastOpenedAt: null,
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:30:00.000Z')
    })

    await expect(service.listRegisteredDossiers()).resolves.toEqual([
      expect.objectContaining({
        id: 'Client Alpha',
        uuid: expect.any(String),
        name: 'Client Alpha',
        status: 'active',
        type: '',
        updatedAt: '2026-03-13T09:00:00.000Z',
        lastOpenedAt: null,
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      })
    ])
  })

  it('updates and clears note fields on key date and key reference edits', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-21T09:00:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const created = await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Hearing',
      date: '2026-04-01',
      note: 'Initial note'
    })

    const createdEntry = created.keyDates[0]
    expect(createdEntry?.note).toBe('Initial note')

    const updated = await service.upsertKeyDate({
      id: createdEntry?.id,
      dossierId: 'Client Alpha',
      label: 'Hearing',
      date: '2026-04-01',
      note: 'Updated note'
    })

    expect(updated.keyDates[0]?.note).toBe('Updated note')

    const preserved = await service.upsertKeyDate({
      id: createdEntry?.id,
      dossierId: 'Client Alpha',
      label: 'Hearing',
      date: '2026-04-01'
    })

    expect(preserved.keyDates[0]?.note).toBe('Updated note')

    const createdRef = await service.upsertKeyReference({
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/001',
      note: 'First note'
    })

    const refEntry = createdRef.keyReferences.find((entry) => entry.label === 'Case number')
    expect(refEntry?.note).toBe('First note')

    const updatedRef = await service.upsertKeyReference({
      id: refEntry?.id,
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/001',
      note: 'Second note'
    })

    const updatedRefEntry = updatedRef.keyReferences.find((entry) => entry.label === 'Case number')
    expect(updatedRefEntry?.note).toBe('Second note')
  })

  it('migrates legacy singular feeAgreement metadata into feeAgreements[]', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const legacyMetadata = {
      id: 'Client Alpha',
      uuid: 'legacy-uuid',
      name: 'Client Alpha',
      registeredAt: '2026-03-13T08:30:00.000Z',
      status: 'active',
      type: '',
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      feeAgreement: {
        status: 'sent',
        matterLabel: 'Legacy convention',
        scopeDescription: 'Original scope',
        billingType: 'flat',
        flatFeeHtCents: 100_000,
        vatRateBasisPoints: 2000
      },
      keyDates: [],
      keyReferences: [],
      documents: []
    }
    const metadataPath = join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json')
    await writeFile(metadataPath, `${JSON.stringify(legacyMetadata, null, 2)}\n`, 'utf8')

    const detail = await service.getDossier({ dossierId: 'Client Alpha' })
    expect(detail.feeAgreements).toHaveLength(1)
    expect(detail.feeAgreements[0]?.isActive).toBe(true)
    expect(detail.feeAgreements[0]?.matterLabel).toBe('Legacy convention')
    expect(detail.feeAgreements[0]?.id).toBeDefined()
    expect(detail.billingItems).toEqual([])

    const persistedRaw = await readFile(metadataPath, 'utf8')
    const persisted = JSON.parse(persistedRaw) as { feeAgreements?: unknown[] }
    expect(Array.isArray(persisted.feeAgreements)).toBe(true)
  })

  it('tracks the active fee agreement across upsert and archive operations', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const first = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Initial convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 50_000,
      vatRateBasisPoints: 2000
    })
    expect(first.feeAgreements).toHaveLength(1)
    const firstId = first.feeAgreements[0]?.id as string
    expect(first.feeAgreements[0]?.isActive).toBe(true)

    const amended = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Amendment',
      scopeDescription: 'Phase 2',
      billingType: 'flat',
      flatFeeHtCents: 75_000,
      vatRateBasisPoints: 2000
    })
    expect(amended.feeAgreements).toHaveLength(2)
    const activeAgreements = amended.feeAgreements.filter((entry) => entry.isActive)
    expect(activeAgreements).toHaveLength(1)
    expect(activeAgreements[0]?.matterLabel).toBe('Amendment')

    const archivedFirst = amended.feeAgreements.find((entry) => entry.id === firstId)
    expect(archivedFirst?.isActive).toBe(false)
    expect(archivedFirst?.archivedAt).toBeDefined()

    const restored = await service.setActiveFeeAgreement({
      dossierId: 'Client Alpha',
      feeAgreementId: firstId
    })
    expect(restored.feeAgreements.find((entry) => entry.id === firstId)?.isActive).toBe(true)
    const previouslyActive = restored.feeAgreements.find((entry) => entry.id !== firstId)
    expect(previouslyActive?.isActive).toBe(false)
  })

  it('persists the commercial discount across disk reloads', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })
    const created = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'percent',
      discountPercentBasisPoints: 1500
    })
    const id = created.feeAgreements[0]?.id as string

    const reload = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:00:00.000Z')
    })
    const reread = await reload.getDossier({ dossierId: 'Client Alpha' })
    expect(reread.feeAgreements[0]?.discountKind).toBe('percent')
    expect(reread.feeAgreements[0]?.discountPercentBasisPoints).toBe(1500)

    const updated = await reload.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      id,
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'amount',
      discountAmountHtCents: 3_000
    })
    expect(updated.feeAgreements[0]?.discountKind).toBe('amount')
    expect(updated.feeAgreements[0]?.discountAmountHtCents).toBe(3_000)
    expect(updated.feeAgreements[0]?.discountPercentBasisPoints).toBeUndefined()

    const reload2 = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T10:00:00.000Z')
    })
    const reread2 = await reload2.getDossier({ dossierId: 'Client Alpha' })
    expect(reread2.feeAgreements[0]?.discountKind).toBe('amount')
    expect(reread2.feeAgreements[0]?.discountAmountHtCents).toBe(3_000)
    expect(reread2.feeAgreements[0]?.discountPercentBasisPoints).toBeUndefined()
  })

  it('updates the commercial discount when editing an existing fee agreement', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const created = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'percent',
      discountPercentBasisPoints: 1000
    })
    const id = created.feeAgreements[0]?.id as string
    expect(created.feeAgreements[0]?.discountPercentBasisPoints).toBe(1000)

    const bumped = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      id,
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'percent',
      discountPercentBasisPoints: 2500
    })
    expect(bumped.feeAgreements[0]?.discountKind).toBe('percent')
    expect(bumped.feeAgreements[0]?.discountPercentBasisPoints).toBe(2500)

    const switched = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      id,
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'amount',
      discountAmountHtCents: 7_500
    })
    expect(switched.feeAgreements[0]?.discountKind).toBe('amount')
    expect(switched.feeAgreements[0]?.discountAmountHtCents).toBe(7_500)
    expect(switched.feeAgreements[0]?.discountPercentBasisPoints).toBeUndefined()

    const cleared = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      id,
      status: 'draft',
      matterLabel: 'Convention',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000
    })
    expect(cleared.feeAgreements[0]?.discountKind).toBeUndefined()
    expect(cleared.feeAgreements[0]?.discountAmountHtCents).toBeUndefined()
    expect(cleared.feeAgreements[0]?.discountPercentBasisPoints).toBeUndefined()
  })

  it('persists the commercial discount on the fee agreement', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const percentResult = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Convention avec remise',
      scopeDescription: 'Phase 1',
      billingType: 'flat',
      flatFeeHtCents: 100_000,
      vatRateBasisPoints: 2000,
      discountKind: 'percent',
      discountPercentBasisPoints: 1500
    })
    const percentAgreement = percentResult.feeAgreements[0]
    expect(percentAgreement?.discountKind).toBe('percent')
    expect(percentAgreement?.discountPercentBasisPoints).toBe(1500)
    expect(percentAgreement?.discountAmountHtCents).toBeUndefined()

    const amountResult = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'draft',
      matterLabel: 'Convention avec montant',
      scopeDescription: 'Phase 2',
      billingType: 'flat',
      flatFeeHtCents: 80_000,
      vatRateBasisPoints: 2000,
      discountKind: 'amount',
      discountAmountHtCents: 10_000
    })
    const amountAgreement = amountResult.feeAgreements.find(
      (entry) => entry.matterLabel === 'Convention avec montant'
    )
    expect(amountAgreement?.discountKind).toBe('amount')
    expect(amountAgreement?.discountAmountHtCents).toBe(10_000)
    expect(amountAgreement?.discountPercentBasisPoints).toBeUndefined()
  })

  it('computes billing item totals deterministically on upsert', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const created = await service.upsertBillingItem({
      dossierId: 'Client Alpha',
      date: '2026-03-12',
      label: 'Consultation horaire',
      quantity: 2.5,
      quantityUnit: 'hours',
      unitPriceHtCents: 12_000,
      vatRateBasisPoints: 2000,
      status: 'draft'
    })
    expect(created.billingItems).toHaveLength(1)
    const item = created.billingItems[0]
    expect(item?.subtotalHtCents).toBe(30_000)
    expect(item?.discountHtCents).toBe(0)
    expect(item?.totalHtCents).toBe(30_000)
    expect(item?.totalTtcCents).toBe(36_000)
    expect(item?.id).toBeDefined()

    const itemId = item?.id as string
    const updated = await service.upsertBillingItem({
      id: itemId,
      dossierId: 'Client Alpha',
      date: '2026-03-12',
      label: 'Consultation horaire',
      quantity: 4,
      quantityUnit: 'hours',
      unitPriceHtCents: 12_000,
      vatRateBasisPoints: 2000,
      status: 'draft'
    })
    expect(updated.billingItems).toHaveLength(1)
    expect(updated.billingItems[0]?.subtotalHtCents).toBe(48_000)
    expect(updated.billingItems[0]?.discountHtCents).toBe(0)
    expect(updated.billingItems[0]?.totalHtCents).toBe(48_000)
    expect(updated.billingItems[0]?.totalTtcCents).toBe(57_600)

    const deleted = await service.deleteBillingItem({
      dossierId: 'Client Alpha',
      billingItemId: itemId
    })
    expect(deleted.billingItems).toEqual([])
  })

  it('refuses to delete a fee agreement still referenced by a billing item', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const withAgreement = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'signed',
      matterLabel: 'Convention',
      scopeDescription: 'Scope',
      billingType: 'flat',
      flatFeeHtCents: 60_000,
      vatRateBasisPoints: 2000
    })
    const feeAgreementId = withAgreement.feeAgreements[0]?.id as string

    const withItem = await service.upsertBillingItem({
      dossierId: 'Client Alpha',
      date: '2026-03-14',
      label: 'Solde final',
      quantity: 1,
      quantityUnit: 'units',
      unitPriceHtCents: 60_000,
      vatRateBasisPoints: 2000,
      status: 'draft',
      sourceFeeAgreementId: feeAgreementId,
      sourceFeeAgreementBillingKind: 'finalBalance'
    })
    const billingItemId = withItem.billingItems[0]?.id as string

    await expect(
      service.deleteFeeAgreement({
        dossierId: 'Client Alpha',
        feeAgreementId
      })
    ).rejects.toMatchObject({
      name: 'DossierRegistryError',
      code: IpcErrorCode.INTEGRITY_CONFLICT
    } satisfies Partial<DossierRegistryError>)

    const stillThere = await service.getDossier({ dossierId: 'Client Alpha' })
    expect(stillThere.feeAgreements.some((entry) => entry.id === feeAgreementId)).toBe(true)

    await service.deleteBillingItem({ dossierId: 'Client Alpha', billingItemId })
    const afterDelete = await service.deleteFeeAgreement({
      dossierId: 'Client Alpha',
      feeAgreementId
    })
    expect(afterDelete.feeAgreements.some((entry) => entry.id === feeAgreementId)).toBe(false)
  })

  it('applies a percentage discount to billing item totals on upsert', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const created = await service.upsertBillingItem({
      dossierId: 'Client Alpha',
      date: '2026-03-12',
      label: 'Consultation horaire',
      quantity: 2,
      quantityUnit: 'hours',
      unitPriceHtCents: 20_000,
      discountKind: 'percent',
      discountPercentBasisPoints: 1000,
      vatRateBasisPoints: 2000,
      status: 'draft'
    })

    const item = created.billingItems[0]
    expect(item?.discountKind).toBe('percent')
    expect(item?.discountPercentBasisPoints).toBe(1000)
    expect(item?.discountAmountHtCents).toBeUndefined()
    expect(item?.subtotalHtCents).toBe(40_000)
    expect(item?.discountHtCents).toBe(4_000)
    expect(item?.totalHtCents).toBe(36_000)
    expect(item?.totalTtcCents).toBe(43_200)
  })

  it('applies a fixed amount discount to billing item totals on upsert', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ id: 'Client Alpha' })

    const created = await service.upsertBillingItem({
      dossierId: 'Client Alpha',
      date: '2026-03-12',
      label: 'Forfait dossier',
      quantity: 1,
      quantityUnit: 'units',
      unitPriceHtCents: 50_000,
      discountKind: 'amount',
      discountAmountHtCents: 5_000,
      vatRateBasisPoints: 2000,
      status: 'draft'
    })

    const item = created.billingItems[0]
    expect(item?.discountKind).toBe('amount')
    expect(item?.discountAmountHtCents).toBe(5_000)
    expect(item?.discountPercentBasisPoints).toBeUndefined()
    expect(item?.subtotalHtCents).toBe(50_000)
    expect(item?.discountHtCents).toBe(5_000)
    expect(item?.totalHtCents).toBe(45_000)
    expect(item?.totalTtcCents).toBe(54_000)
  })
})
