import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  DOSSIER_INFORMATION_REFERENCE_LABEL,
  DOSSIER_JURIDICTION_REFERENCE_LABEL,
  DOSSIER_NAME_REFERENCE_LABEL,
  DOSSIER_STATUS_REFERENCE_LABEL,
  DOSSIER_TRIBUNAL_REFERENCE_LABEL,
  DOSSIER_TYPE_REFERENCE_LABEL,
  IpcErrorCode,
  type KeyReference
} from '@shared/types'

import {
  createDossierRegistryService,
  DossierRegistryError,
  NOTE_SNIPPET_MAX_LENGTH
} from '../dossierRegistryService'

const tempDirs: string[] = []

function expectRequiredDossierReferences(
  references: KeyReference[],
  values: Partial<Record<string, string>> = {}
): void {
  expect(references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_NAME_REFERENCE_LABEL,
        value: values[DOSSIER_NAME_REFERENCE_LABEL] ?? 'Client Alpha'
      }),
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_STATUS_REFERENCE_LABEL,
        value: values[DOSSIER_STATUS_REFERENCE_LABEL] ?? 'active'
      }),
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_TYPE_REFERENCE_LABEL,
        value: values[DOSSIER_TYPE_REFERENCE_LABEL] ?? ''
      }),
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_JURIDICTION_REFERENCE_LABEL,
        value: values[DOSSIER_JURIDICTION_REFERENCE_LABEL] ?? ''
      }),
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_TRIBUNAL_REFERENCE_LABEL,
        value: values[DOSSIER_TRIBUNAL_REFERENCE_LABEL] ?? ''
      }),
      expect.objectContaining({
        uuid: expect.any(String),
        label: DOSSIER_INFORMATION_REFERENCE_LABEL,
        value: values[DOSSIER_INFORMATION_REFERENCE_LABEL] ?? ''
      })
    ])
  )
}

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
        slug: 'Client Alpha',
        name: 'Client Alpha',
        path: join(domainPath, 'Client Alpha')
      },
      {
        slug: 'Client Beta',
        name: 'Client Beta',
        path: join(domainPath, 'Client Beta')
      }
    ])

    await service.registerDossier({ slug: 'Client Alpha' })

    await expect(service.listEligibleFolders()).resolves.toEqual([
      {
        slug: 'Client Beta',
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

    await expect(service.registerDossier({ slug: 'Client Alpha' })).resolves.toMatchObject({
      slug: 'Client Alpha',
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
        slug: 'Client Alpha',
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
          slug: 'Client Alpha',
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

  it('creates a new folder on disk and registers it', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()

    const registered: Array<{ dossierId: string; dossierPath: string }> = []
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T10:00:00.000Z'),
      onDossierRegistered: (dossierId, dossierPath) => {
        registered.push({ dossierId, dossierPath })
      }
    })

    await expect(service.createDossier({ name: 'Client Gamma' })).resolves.toMatchObject({
      slug: 'Client Gamma',
      name: 'Client Gamma',
      status: 'active',
      type: '',
      updatedAt: '2026-03-13T10:00:00.000Z'
    })

    expect(await pathExists(join(domainPath, 'Client Gamma'))).toBe(true)
    expect(await pathExists(join(domainPath, 'Client Gamma', '.ordicab', 'dossier.json'))).toBe(
      true
    )
    expect(registered).toEqual([
      { dossierId: 'Client Gamma', dossierPath: join(domainPath, 'Client Gamma') }
    ])

    await expect(service.listRegisteredDossiers()).resolves.toEqual([
      expect.objectContaining({ slug: 'Client Gamma', name: 'Client Gamma' })
    ])
  })

  it('sanitizes illegal filesystem characters into the folder name but keeps the original display name', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T10:00:00.000Z')
    })

    const summary = await service.createDossier({ name: 'Dupont c/ Martin' })

    expect(summary.slug).toBe('Dupont c- Martin')
    expect(summary.name).toBe('Dupont c/ Martin')
    expect(await pathExists(join(domainPath, 'Dupont c- Martin'))).toBe(true)

    const metadata = JSON.parse(
      await readFile(join(domainPath, 'Dupont c- Martin', '.ordicab', 'dossier.json'), 'utf8')
    ) as { name: string }
    expect(metadata.name).toBe('Dupont c/ Martin')
  })

  it('rejects creation when a folder with the same name already exists', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Gamma'))

    const service = createDossierRegistryService({ stateFilePath })

    await expect(service.createDossier({ name: 'Client Gamma' })).rejects.toMatchObject({
      code: IpcErrorCode.INVALID_INPUT
    })
  })

  it('rejects creation for names that are empty or invalid even after sanitization', async () => {
    const { stateFilePath } = await createConfiguredDomain()
    const service = createDossierRegistryService({ stateFilePath })

    await expect(service.createDossier({ name: '   ' })).rejects.toBeInstanceOf(
      DossierRegistryError
    )
    // Sanitization strips the illegal characters; a name made only of them becomes empty.
    await expect(service.createDossier({ name: ':*?' })).rejects.toBeInstanceOf(
      DossierRegistryError
    )
    await expect(service.createDossier({ name: '.hidden' })).rejects.toBeInstanceOf(
      DossierRegistryError
    )
  })

  it('rejects creation when no active domain is configured', async () => {
    const root = await createTempDir()
    const stateFilePath = join(root, 'app-state.json')
    const service = createDossierRegistryService({ stateFilePath })

    await expect(service.createDossier({ name: 'Client Gamma' })).rejects.toMatchObject({
      code: IpcErrorCode.NOT_FOUND
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

    await service.registerDossier({ slug: 'Client Alpha' })

    const initialDetail = await service.getDossier({ dossierId: 'Client Alpha' })
    expect(initialDetail).toMatchObject({
      slug: 'Client Alpha',
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
      keyDates: []
    })
    expectRequiredDossierReferences(initialDetail.keyReferences)

    currentTime = new Date('2026-03-13T09:15:00.000Z')

    await expect(
      service.updateDossier({
        slug: 'Client Alpha',
        status: 'pending',
        type: 'Civil litigation',
        information: 'Current status note'
      })
    ).resolves.toMatchObject({
      slug: 'Client Alpha',
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
      keyReferences: KeyReference[]
    }

    expect(dossierMetadata).toMatchObject({
      status: 'pending',
      type: 'Civil litigation',
      information: 'Current status note',
      updatedAt: '2026-03-13T09:15:00.000Z',
      lastOpenedAt: null
    })
    expectRequiredDossierReferences(dossierMetadata.keyReferences, {
      [DOSSIER_STATUS_REFERENCE_LABEL]: 'pending',
      [DOSSIER_TYPE_REFERENCE_LABEL]: 'Civil litigation',
      [DOSSIER_INFORMATION_REFERENCE_LABEL]: 'Current status note'
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

    await service.registerDossier({ slug: 'Client Alpha' })

    currentTime = new Date('2026-03-13T09:20:00.000Z')

    await expect(service.openDossier({ dossierId: 'Client Alpha' })).resolves.toMatchObject({
      slug: 'Client Alpha',
      updatedAt: '2026-03-13T09:00:00.000Z',
      lastOpenedAt: '2026-03-13T09:20:00.000Z'
    })

    await expect(service.listRegisteredDossiers()).resolves.toEqual([
      expect.objectContaining({
        slug: 'Client Alpha',
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

    await service.registerDossier({ slug: 'Client Alpha' })
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
              slug: 'Client Delta',
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
          slug: 'Client Delta',
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
              uuid: 'stored-letter-uuid',
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
      slug: 'Client Delta',
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
        uuid: 'stored-letter-uuid',
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

    await service.registerDossier({ slug: 'Client Alpha' })
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
      uuid: futureEntry?.uuid,
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
      keyDateUuid: todayEntry?.uuid ?? ''
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

    await service.registerDossier({ slug: 'Client Alpha' })
    await service.updateDossier({
      slug: 'Client Alpha',
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
    const statusReference = created.keyReferences.find(
      (entry) => entry.label === DOSSIER_STATUS_REFERENCE_LABEL
    )
    await expect(
      service.deleteKeyReference({
        dossierId: 'Client Alpha',
        keyReferenceUuid: statusReference?.uuid ?? ''
      })
    ).rejects.toMatchObject({
      code: IpcErrorCode.VALIDATION_FAILED
    })

    currentTime = new Date('2026-03-21T09:10:00.000Z')
    const updated = await service.upsertKeyReference({
      uuid: createdReference?.uuid,
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/009'
    })

    expectRequiredDossierReferences(updated.keyReferences, {
      [DOSSIER_STATUS_REFERENCE_LABEL]: 'pending',
      [DOSSIER_TYPE_REFERENCE_LABEL]: 'Civil litigation'
    })
    expect(updated.keyReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uuid: createdReference?.uuid,
          dossierId: 'Client Alpha',
          label: 'Case number',
          value: 'RG 26/009'
        })
      ])
    )

    const cleared = await service.deleteKeyReference({
      dossierId: 'Client Alpha',
      keyReferenceUuid: createdReference?.uuid ?? ''
    })

    expectRequiredDossierReferences(cleared.keyReferences, {
      [DOSSIER_STATUS_REFERENCE_LABEL]: 'pending',
      [DOSSIER_TYPE_REFERENCE_LABEL]: 'Civil litigation'
    })
    expect(cleared.keyReferences.some((entry) => entry.label === 'Case number')).toBe(false)
    expect(cleared.status).toBe('pending')
    expect(cleared.type).toBe('Civil litigation')
  })

  it('creates, updates, and deletes dossier notes with per-file storage and index, triggering indexing', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const indexed: string[] = []
    let currentTime = new Date('2026-03-21T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => currentTime,
      indexNote: async (_dossierPath, note) => {
        indexed.push(note.uuid)
      }
    })

    await service.registerDossier({ slug: 'Client Alpha' })

    const created = await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Vérifier la prescription',
      content: 'Délai possiblement expiré le 12/04.',
      kind: 'to_verify',
      tags: ['prescription', 'prescription', '  '],
      source: 'ai'
    })

    const note = created.notes.find((entry) => entry.title === 'Vérifier la prescription')
    expect(note).toBeDefined()
    expect(note).toMatchObject({
      kind: 'to_verify',
      source: 'ai',
      tags: ['prescription'], // trimmed + de-duplicated, blanks dropped
      createdAt: '2026-03-21T09:00:00.000Z',
      updatedAt: '2026-03-21T09:00:00.000Z'
    })
    expect(indexed).toEqual([note?.uuid])

    // The note record is persisted per-file; notes are not embedded in
    // dossier.json (per-file storage, no index).
    const notePath = join(domainPath, 'Client Alpha', '.ordicab', 'notes', `${note?.uuid}.json`)
    expect(await pathExists(notePath)).toBe(true)
    const dossierJson = JSON.parse(
      await readFile(join(domainPath, 'Client Alpha', '.ordicab', 'dossier.json'), 'utf8')
    ) as { notes: unknown[] }
    expect(dossierJson.notes).toEqual([])

    currentTime = new Date('2026-03-21T09:10:00.000Z')
    const updated = await service.upsertNote({
      uuid: note?.uuid,
      dossierId: 'Client Alpha',
      title: 'Vérifier la prescription',
      content: 'Confirmé : prescription acquise.',
      kind: 'to_verify',
      status: 'done'
    })
    const updatedNote = updated.notes.find((entry) => entry.uuid === note?.uuid)
    expect(updatedNote).toMatchObject({
      content: 'Confirmé : prescription acquise.',
      status: 'done',
      createdAt: '2026-03-21T09:00:00.000Z', // preserved
      updatedAt: '2026-03-21T09:10:00.000Z' // bumped
    })
    expect(indexed).toEqual([note?.uuid, note?.uuid]) // re-indexed on update

    const afterDelete = await service.deleteNote({
      dossierId: 'Client Alpha',
      noteUuid: note?.uuid ?? ''
    })
    expect(afterDelete.notes).toEqual([])
    expect(await pathExists(notePath)).toBe(false)
  })

  it('falls back to a substring scan for searchNotes when no embedder is wired', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-21T09:00:00.000Z')
    })

    await service.registerDossier({ slug: 'Client Alpha' })
    await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Prescription',
      content: 'Vérifier le délai de prescription.',
      kind: 'to_verify'
    })
    await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Appeler le client',
      content: 'Rappeler avant vendredi.',
      kind: 'todo',
      status: 'open'
    })

    const hits = await service.searchNotes({ dossierId: 'Client Alpha', query: 'prescription' })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ title: 'Prescription', matchKind: 'keyword' })

    // Kind/status filters narrow the candidate set before search.
    const todoHits = await service.searchNotes({
      dossierId: 'Client Alpha',
      query: 'prescription',
      kind: 'todo'
    })
    expect(todoHits).toEqual([])
  })

  it('lists all notes when searchNotes is called with no query (pinned first, then recent)', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    let clock = new Date('2026-03-21T09:00:00.000Z')
    const service = createDossierRegistryService({
      stateFilePath,
      now: () => clock
    })

    await service.registerDossier({ slug: 'Client Alpha' })
    await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Ancienne note',
      content: 'La plus ancienne.',
      kind: 'note'
    })
    clock = new Date('2026-03-22T09:00:00.000Z')
    await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Todo récent',
      content: 'Rappeler le client.',
      kind: 'todo',
      status: 'open'
    })
    clock = new Date('2026-03-23T09:00:00.000Z')
    await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Note épinglée',
      content: 'À garder en tête.',
      kind: 'idea',
      pinned: true
    })

    // Empty query → every note, pinned first then most recently updated.
    const all = await service.searchNotes({ dossierId: 'Client Alpha', query: '' })
    expect(all.map((hit) => hit.title)).toEqual(['Note épinglée', 'Todo récent', 'Ancienne note'])

    // Each result carries kind/status and a (here false) truncation flag.
    expect(all[0]).toMatchObject({ kind: 'idea', truncated: false })
    expect(all[1]).toMatchObject({ kind: 'todo', status: 'open', truncated: false })

    // "*" behaves the same as an empty query (no real search term).
    const wildcard = await service.searchNotes({ dossierId: 'Client Alpha', query: '*' })
    expect(wildcard.map((hit) => hit.title)).toEqual([
      'Note épinglée',
      'Todo récent',
      'Ancienne note'
    ])

    // Filters still apply when listing all.
    const openTodos = await service.searchNotes({
      dossierId: 'Client Alpha',
      query: '',
      status: 'open'
    })
    expect(openTodos.map((hit) => hit.title)).toEqual(['Todo récent'])
  })

  it('truncates long note content and flags it, leaving the full note readable', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-21T09:00:00.000Z')
    })

    const longContent = 'a'.repeat(NOTE_SNIPPET_MAX_LENGTH + 50)
    await service.registerDossier({ slug: 'Client Alpha' })
    const created = await service.upsertNote({
      dossierId: 'Client Alpha',
      title: 'Note longue',
      content: longContent,
      kind: 'note'
    })
    const noteUuid = created.notes.find((entry) => entry.title === 'Note longue')?.uuid

    const [hit] = await service.searchNotes({ dossierId: 'Client Alpha', query: '' })
    expect(hit).toBeDefined()
    expect(hit!.truncated).toBe(true)
    expect(hit!.snippet).toHaveLength(NOTE_SNIPPET_MAX_LENGTH)
    expect(hit!.snippet).toBe(longContent.slice(0, NOTE_SNIPPET_MAX_LENGTH))

    // The full content is still recoverable via the dossier detail (what note_get reads).
    const detail = await service.getDossier({ dossierId: 'Client Alpha' })
    expect(detail.notes.find((entry) => entry.uuid === noteUuid)?.content).toBe(longContent)
  })

  it('rejects duplicate registration without mutating registry files', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T10:00:00.000Z')
    })

    await service.registerDossier({ slug: 'Client Alpha' })

    await expect(service.registerDossier({ slug: 'Client Alpha' })).rejects.toThrow(
      'This dossier is already registered.'
    )

    const registry = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'registry.json'), 'utf8')
    ) as {
      dossiers: Array<{ slug: string }>
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

    await service.registerDossier({ slug: 'Client Alpha' })
    await expect(service.unregisterDossier({ slug: 'Client Alpha' })).resolves.toBeNull()

    await expect(service.listRegisteredDossiers()).resolves.toEqual([])
    await expect(readFile(join(dossierPath, 'notes.txt'), 'utf8')).resolves.toBe('leave me here')
    await expect(pathExists(join(dossierPath, '.ordicab', 'dossier.json'))).resolves.toBe(false)

    const registry = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'registry.json'), 'utf8')
    ) as {
      dossiers: Array<{ slug: string }>
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

    await expect(service.registerDossier({ slug: '../escape' })).rejects.toThrow(
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

    await expect(service.registerDossier({ slug: '.Client Alpha' })).rejects.toThrow(
      'Hidden folders cannot be registered as dossiers.'
    )
  })

  it('rejects dot-dot and dot as dossier ids to prevent parent directory traversal', async () => {
    const { stateFilePath } = await createConfiguredDomain()

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T12:00:00.000Z')
    })

    await expect(service.registerDossier({ slug: '..' })).rejects.toThrow(
      'Dossier registration is limited to direct subfolders of the active domain.'
    )

    await expect(service.registerDossier({ slug: '.' })).rejects.toThrow(
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
              slug: 'Client Alpha',
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
          slug: 'Client Alpha',
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
        slug: 'Client Alpha',
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

    await service.registerDossier({ slug: 'Client Alpha' })

    const created = await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Hearing',
      date: '2026-04-01',
      note: 'Initial note'
    })

    const createdEntry = created.keyDates[0]
    expect(createdEntry?.note).toBe('Initial note')

    const updated = await service.upsertKeyDate({
      uuid: createdEntry?.uuid,
      dossierId: 'Client Alpha',
      label: 'Hearing',
      date: '2026-04-01',
      note: 'Updated note'
    })

    expect(updated.keyDates[0]?.note).toBe('Updated note')

    const preserved = await service.upsertKeyDate({
      uuid: createdEntry?.uuid,
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
      uuid: refEntry?.uuid,
      dossierId: 'Client Alpha',
      label: 'Case number',
      value: 'RG 26/001',
      note: 'Second note'
    })

    const updatedRefEntry = updatedRef.keyReferences.find((entry) => entry.label === 'Case number')
    expect(updatedRefEntry?.note).toBe('Second note')
  })

  it('tracks the active fee agreement across upsert and archive operations', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ slug: 'Client Alpha' })

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
    const firstId = first.feeAgreements[0]?.uuid as string
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

    const archivedFirst = amended.feeAgreements.find((entry) => entry.uuid === firstId)
    expect(archivedFirst?.isActive).toBe(false)
    expect(archivedFirst?.archivedAt).toBeDefined()

    const restored = await service.setActiveFeeAgreement({
      dossierId: 'Client Alpha',
      feeAgreementUuid: firstId
    })
    expect(restored.feeAgreements.find((entry) => entry.uuid === firstId)?.isActive).toBe(true)
    const previouslyActive = restored.feeAgreements.find((entry) => entry.uuid !== firstId)
    expect(previouslyActive?.isActive).toBe(false)
  })

  it('persists the commercial discount across disk reloads', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ slug: 'Client Alpha' })
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
    const id = created.feeAgreements[0]?.uuid as string

    const reload = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T09:00:00.000Z')
    })
    const reread = await reload.getDossier({ dossierId: 'Client Alpha' })
    expect(reread.feeAgreements[0]?.discountKind).toBe('percent')
    expect(reread.feeAgreements[0]?.discountPercentBasisPoints).toBe(1500)

    const updated = await reload.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      uuid: id,
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

    await service.registerDossier({ slug: 'Client Alpha' })

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
    const id = created.feeAgreements[0]?.uuid as string
    expect(created.feeAgreements[0]?.discountPercentBasisPoints).toBe(1000)

    const bumped = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      uuid: id,
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
      uuid: id,
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
      uuid: id,
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

    await service.registerDossier({ slug: 'Client Alpha' })

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

    await service.registerDossier({ slug: 'Client Alpha' })

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
    expect(item?.uuid).toBeDefined()

    const itemId = item?.uuid as string
    const updated = await service.upsertBillingItem({
      uuid: itemId,
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
      billingItemUuid: itemId
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

    await service.registerDossier({ slug: 'Client Alpha' })

    const withAgreement = await service.upsertFeeAgreement({
      dossierId: 'Client Alpha',
      status: 'signed',
      matterLabel: 'Convention',
      scopeDescription: 'Scope',
      billingType: 'flat',
      flatFeeHtCents: 60_000,
      vatRateBasisPoints: 2000
    })
    const feeAgreementUuid = withAgreement.feeAgreements[0]?.uuid as string

    const withItem = await service.upsertBillingItem({
      dossierId: 'Client Alpha',
      date: '2026-03-14',
      label: 'Solde final',
      quantity: 1,
      quantityUnit: 'units',
      unitPriceHtCents: 60_000,
      vatRateBasisPoints: 2000,
      status: 'draft',
      sourceFeeAgreementUuid: feeAgreementUuid,
      sourceFeeAgreementBillingKind: 'finalBalance'
    })
    const billingItemUuid = withItem.billingItems[0]?.uuid as string

    await expect(
      service.deleteFeeAgreement({
        dossierId: 'Client Alpha',
        feeAgreementUuid
      })
    ).rejects.toMatchObject({
      name: 'DossierRegistryError',
      code: IpcErrorCode.INTEGRITY_CONFLICT
    } satisfies Partial<DossierRegistryError>)

    const stillThere = await service.getDossier({ dossierId: 'Client Alpha' })
    expect(stillThere.feeAgreements.some((entry) => entry.uuid === feeAgreementUuid)).toBe(true)

    await service.deleteBillingItem({ dossierId: 'Client Alpha', billingItemUuid })
    const afterDelete = await service.deleteFeeAgreement({
      dossierId: 'Client Alpha',
      feeAgreementUuid
    })
    expect(afterDelete.feeAgreements.some((entry) => entry.uuid === feeAgreementUuid)).toBe(false)
  })

  it('applies a percentage discount to billing item totals on upsert', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))

    const service = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-03-13T08:30:00.000Z')
    })

    await service.registerDossier({ slug: 'Client Alpha' })

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

    await service.registerDossier({ slug: 'Client Alpha' })

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

  it('creates, lists, updates and deletes general (hors-dossier) key dates', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const service = createDossierRegistryService({ stateFilePath })

    // Empty domain → empty list.
    expect(await service.listGeneralKeyDates()).toEqual([])

    // Create.
    const afterCreate = await service.upsertGeneralKeyDate({
      label: '  Formation déontologie  ',
      date: '2026-07-01',
      tags: ['important'],
      note: 'Hors dossier'
    })
    expect(afterCreate).toHaveLength(1)
    const created = afterCreate[0]!
    expect(created.uuid).toBeTruthy()
    expect(created.label).toBe('Formation déontologie') // trimmed
    expect(created.date).toBe('2026-07-01')

    // Persisted as one file per record under .ordicab/general-key-dates/.
    expect(
      await pathExists(join(domainPath, '.ordicab', 'general-key-dates', `${created.uuid}.json`))
    ).toBe(true)

    // Reloads independently.
    const listed = await service.listGeneralKeyDates()
    expect(listed).toHaveLength(1)
    expect(listed[0]!.uuid).toBe(created.uuid)

    // Update keeps the same id and preserves untouched fields.
    const afterUpdate = await service.upsertGeneralKeyDate({
      uuid: created.uuid,
      label: 'Formation déontologie (reportée)',
      date: '2026-07-08'
    })
    expect(afterUpdate).toHaveLength(1)
    expect(afterUpdate[0]!.uuid).toBe(created.uuid)
    expect(afterUpdate[0]!.date).toBe('2026-07-08')
    expect(afterUpdate[0]!.tags).toEqual(['important']) // preserved

    // Unknown id on update → NOT_FOUND.
    await expect(
      service.upsertGeneralKeyDate({ uuid: 'missing', label: 'x', date: '2026-07-08' })
    ).rejects.toMatchObject({ code: IpcErrorCode.NOT_FOUND })

    // Delete.
    const afterDelete = await service.deleteGeneralKeyDate({ keyDateUuid: created.uuid })
    expect(afterDelete).toEqual([])
    expect(
      await pathExists(join(domainPath, '.ordicab', 'general-key-dates', `${created.uuid}.json`))
    ).toBe(false)

    // Deleting again → NOT_FOUND.
    await expect(service.deleteGeneralKeyDate({ keyDateUuid: created.uuid })).rejects.toMatchObject(
      {
        code: IpcErrorCode.NOT_FOUND
      }
    )
  })

  it('moves a key date between dossiers and to/from « hors dossier », keeping its uuid', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await mkdir(join(domainPath, 'Client Alpha'))
    await mkdir(join(domainPath, 'Client Beta'))
    const service = createDossierRegistryService({ stateFilePath })

    await service.registerDossier({ slug: 'Client Alpha' })
    await service.registerDossier({ slug: 'Client Beta' })

    const created = await service.upsertKeyDate({
      dossierId: 'Client Alpha',
      label: 'Audience',
      date: '2026-09-10',
      tags: ['urgent']
    })
    const uuid = created.keyDates[0]!.uuid
    const recordPath = (slug: string): string =>
      join(domainPath, slug, '.ordicab', 'key-dates', `${uuid}.json`)
    const generalPath = join(domainPath, '.ordicab', 'general-key-dates', `${uuid}.json`)

    // Dossier → dossier : uuid conservé, fichier déplacé, champs édités appliqués.
    await service.moveKeyDate({
      keyDateUuid: uuid,
      fromDossierId: 'Client Alpha',
      toDossierId: 'Client Beta',
      label: 'Audience (renvoi)',
      date: '2026-09-17',
      tags: ['urgent']
    })
    expect(await pathExists(recordPath('Client Alpha'))).toBe(false)
    expect(await pathExists(recordPath('Client Beta'))).toBe(true)
    const beta = await service.getDossier({ dossierId: 'Client Beta' })
    expect(beta.keyDates).toHaveLength(1)
    expect(beta.keyDates[0]!).toMatchObject({
      uuid,
      label: 'Audience (renvoi)',
      date: '2026-09-17'
    })
    expect((await service.getDossier({ dossierId: 'Client Alpha' })).keyDates).toEqual([])

    // Dossier → hors dossier.
    await service.moveKeyDate({
      keyDateUuid: uuid,
      fromDossierId: 'Client Beta',
      toDossierId: null,
      label: 'Audience (renvoi)',
      date: '2026-09-17'
    })
    expect(await pathExists(recordPath('Client Beta'))).toBe(false)
    expect(await pathExists(generalPath)).toBe(true)
    const general = await service.listGeneralKeyDates()
    expect(general).toHaveLength(1)
    expect(general[0]!.uuid).toBe(uuid)

    // Hors dossier → dossier.
    await service.moveKeyDate({
      keyDateUuid: uuid,
      fromDossierId: null,
      toDossierId: 'Client Alpha',
      label: 'Audience (renvoi)',
      date: '2026-09-17'
    })
    expect(await pathExists(generalPath)).toBe(false)
    expect(await service.listGeneralKeyDates()).toEqual([])
    expect(await pathExists(recordPath('Client Alpha'))).toBe(true)
    expect((await service.getDossier({ dossierId: 'Client Alpha' })).keyDates[0]!.uuid).toBe(uuid)
  })
})
