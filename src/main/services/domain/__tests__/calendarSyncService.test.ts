import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { DossierSummary } from '@shared/types'

import type { AppStateStore } from '../../../lib/system/appStateStore'
import type { CredentialStore } from '../../../lib/system/credentialStore'
import type { CalDavClientLike } from '../../../lib/calendar/caldavClient'
import { createCalendarSyncService, currentWeekCutoffIso } from '../calendarSyncService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-calendar-sync-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createMemoryAppState(): AppStateStore {
  let state: Record<string, unknown> = {}
  return {
    read: async () => ({ ...state }),
    update: async (mutate) => {
      state = mutate({ ...state })
      return { ...state }
    }
  }
}

function createMemoryCredentialStore(): CredentialStore {
  const secrets = new Map<string, string>()
  return {
    saveSecret: async (key, value) => void secrets.set(key, value),
    getSecret: async (key) => secrets.get(key) ?? null,
    deleteSecret: async (key) => void secrets.delete(key),
    hasSecret: async (key) => secrets.has(key)
  }
}

interface FakeRemote {
  client: CalDavClientLike
  objects: Map<string, string>
  puts: string[]
  deletes: string[]
  failPutFilenames: Set<string>
}

const CALENDAR_URL = 'https://caldav.example.com/home/ordicab/'

function createFakeRemote(): FakeRemote {
  const objects = new Map<string, string>()
  const puts: string[] = []
  const deletes: string[] = []
  const failPutFilenames = new Set<string>()
  return {
    objects,
    puts,
    deletes,
    failPutFilenames,
    client: {
      findOrCreateCalendar: async () => ({ url: CALENDAR_URL }),
      putObject: async ({ filename, ics }) => {
        if (failPutFilenames.has(filename)) {
          throw new Error(`PUT ${filename} failed: HTTP 503`)
        }
        puts.push(filename)
        objects.set(new URL(filename, CALENDAR_URL).href, ics)
      },
      deleteObject: async ({ url }) => {
        deletes.push(url)
        objects.delete(url)
      },
      listObjects: async () =>
        Array.from(objects.entries()).map(([url, ics]) => ({
          url,
          uid: ics.match(/^UID:(.+)$/m)?.[1]?.trim() ?? null
        }))
    }
  }
}

function dossierSummary(id: string, name: string): DossierSummary {
  return {
    slug: id,
    uuid: `uuid-${id}`,
    name,
    type: 'litigation',
    status: 'active',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null
  } as DossierSummary
}

async function writeKeyDate(
  domainPath: string,
  dossierId: string,
  keyDate: Record<string, unknown>
): Promise<string> {
  const dir = join(domainPath, dossierId, '.ordicab', 'key-dates')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${keyDate.uuid}.json`)
  await writeFile(path, JSON.stringify(keyDate, null, 2))
  return path
}

async function writeGeneralKeyDate(
  domainPath: string,
  keyDate: Record<string, unknown>
): Promise<void> {
  const dir = join(domainPath, '.ordicab', 'general-key-dates')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${keyDate.uuid}.json`), JSON.stringify(keyDate, null, 2))
}

async function setup(options?: { dossiers?: DossierSummary[] }): Promise<{
  domainPath: string
  remote: FakeRemote
  service: ReturnType<typeof createCalendarSyncService>
  clock: { value: Date }
}> {
  const domainPath = await createTempDir()
  const remote = createFakeRemote()
  // 2026-06-12 is a Friday; the surrounding week starts Monday 2026-06-08.
  const clock = { value: new Date('2026-06-12T10:00:00.000Z') }
  const service = createCalendarSyncService({
    appState: createMemoryAppState(),
    credentialStore: createMemoryCredentialStore(),
    domainService: {
      getStatus: async () => ({ registeredDomainPath: domainPath, isAvailable: true })
    },
    listRegisteredDossiers: async () =>
      options?.dossiers ?? [dossierSummary('Dupont', 'Dupont c/ Moreau')],
    davClientFactory: async () => remote.client,
    now: () => clock.value
  })
  await service.saveSettings({
    serverUrl: 'https://caldav.example.com',
    username: 'user@example.com',
    password: 'app-password'
  })
  return { domainPath, remote, service, clock }
}

describe('currentWeekCutoffIso', () => {
  it('returns the Monday of the week containing the reference date (local)', () => {
    // Local-time constructor on purpose: the cutoff is wall-clock based.
    expect(currentWeekCutoffIso(new Date(2026, 5, 12, 10, 0))).toBe('2026-06-08') // Friday
    expect(currentWeekCutoffIso(new Date(2026, 5, 14, 10, 0))).toBe('2026-06-08') // Sunday
    expect(currentWeekCutoffIso(new Date(2026, 5, 8, 0, 0))).toBe('2026-06-08') // Monday itself
    expect(currentWeekCutoffIso(new Date(2026, 5, 15, 0, 0))).toBe('2026-06-15') // next Monday
  })
})

describe('calendarSyncService', () => {
  it('saveSettings verifies the connection and enables the sync', async () => {
    const { service } = await setup()
    const status = await service.getStatus()
    expect(status.configured).toBe(true)
    expect(status.enabled).toBe(true)
  })

  it('pushes all events on the first run (dossier name in the summary)', async () => {
    const { domainPath, remote, service } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18',
      time: '14:00',
      duration: 90
    })
    await writeGeneralKeyDate(domainPath, {
      uuid: 'gkd-1',
      label: 'Déclaration TVA',
      date: '2026-06-30'
    })

    const result = await service.syncNow()

    expect(result).toMatchObject({ created: 2, updated: 0, deleted: 0, failed: 0 })
    expect(remote.puts.sort()).toEqual(['gkd-1.ics', 'kd-1.ics'])
    const pushed = remote.objects.get(`${CALENDAR_URL}kd-1.ics`)
    expect(pushed).toContain('SUMMARY:Audience — Dupont c/ Moreau')
    const stateRaw = await readFile(
      join(domainPath, '.ordicab', 'calendar-sync-state.json'),
      'utf8'
    )
    expect(JSON.parse(stateRaw).entries['kd-1']).toBeDefined()
  })

  it('is a no-op when nothing changed, and updates only the edited event', async () => {
    const { domainPath, remote, service } = await setup()
    const path = await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18'
    })
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-2',
      dossierId: 'Dupont',
      label: 'Expertise',
      date: '2026-07-02'
    })
    await service.syncNow()
    remote.puts.length = 0

    expect(await service.syncNow()).toMatchObject({ created: 0, updated: 0, deleted: 0 })
    expect(remote.puts).toEqual([])

    await writeFile(
      path,
      JSON.stringify({
        uuid: 'kd-1',
        dossierId: 'Dupont',
        label: 'Audience reportée',
        date: '2026-06-25'
      })
    )
    expect(await service.syncNow()).toMatchObject({ created: 0, updated: 1, deleted: 0 })
    expect(remote.puts).toEqual(['kd-1.ics'])
  })

  it('deletes remote events whose local record disappeared', async () => {
    const { domainPath, remote, service } = await setup()
    const path = await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18'
    })
    await service.syncNow()

    await rm(path)
    const result = await service.syncNow()

    expect(result).toMatchObject({ deleted: 1 })
    expect(remote.deletes).toEqual([`${CALENDAR_URL}kd-1.ics`])
    expect(remote.objects.size).toBe(0)
  })

  it('keeps failed pushes out of the state so the next run retries them', async () => {
    const { domainPath, remote, service } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18'
    })
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-2',
      dossierId: 'Dupont',
      label: 'Expertise',
      date: '2026-07-02'
    })
    remote.failPutFilenames.add('kd-2.ics')

    await expect(service.syncNow()).rejects.toThrow(/failure/)

    remote.failPutFilenames.clear()
    remote.puts.length = 0
    const retry = await service.syncNow()
    expect(retry).toMatchObject({ created: 1, failed: 0 })
    expect(remote.puts).toEqual(['kd-2.ics'])
  })

  it('reconciles when the state file is missing: orphan remote objects are removed', async () => {
    const { domainPath, remote, service } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18'
    })
    await service.syncNow()
    // Simulate a foreign/orphan object plus a lost state file.
    remote.objects.set(`${CALENDAR_URL}orphan.ics`, 'UID:orphan@ordicab.app\r\n')
    await rm(join(domainPath, '.ordicab', 'calendar-sync-state.json'))

    await service.syncNow()

    expect(remote.objects.has(`${CALENDAR_URL}orphan.ics`)).toBe(false)
    expect(remote.objects.has(`${CALENDAR_URL}kd-1.ics`)).toBe(true)
  })

  it('syncNow throws when the sync is disabled', async () => {
    const { service } = await setup()
    await service.setOptions({ enabled: false })
    await expect(service.syncNow()).rejects.toThrow(/not configured/i)
  })

  it('futureOnly (default) keeps the current week and the future, drops older events', async () => {
    const { domainPath, remote, service } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-old',
      dossierId: 'Dupont',
      label: 'Audience passée',
      date: '2026-05-20'
    })
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-week',
      dossierId: 'Dupont',
      label: 'Expertise (cette semaine)',
      date: '2026-06-09'
    })
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-future',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-07-02'
    })

    const result = await service.syncNow()

    expect(result).toMatchObject({ created: 2, failed: 0 })
    expect(remote.puts.sort()).toEqual(['kd-future.ics', 'kd-week.ics'])
    expect(remote.objects.has(`${CALENDAR_URL}kd-old.ics`)).toBe(false)
  })

  it('prunes a pushed event from the phone once the week window slides past it', async () => {
    const { domainPath, remote, service, clock } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-1',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-10'
    })
    expect(await service.syncNow()).toMatchObject({ created: 1 })

    // Next Monday: 2026-06-10 falls out of the "current week" window.
    clock.value = new Date('2026-06-15T23:00:00.000Z')
    const result = await service.syncNow()

    expect(result).toMatchObject({ deleted: 1 })
    expect(remote.objects.size).toBe(0)
  })

  it('setOptions({futureOnly: false}) pushes the full history again', async () => {
    const { domainPath, remote, service } = await setup()
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-old',
      dossierId: 'Dupont',
      label: 'Audience passée',
      date: '2026-05-20'
    })
    expect(await service.syncNow()).toMatchObject({ created: 0 })

    await service.setOptions({ futureOnly: false })
    expect(await service.syncNow()).toMatchObject({ created: 1 })
    expect(remote.objects.has(`${CALENDAR_URL}kd-old.ics`)).toBe(true)
  })

  it('requestSync coalesces change bursts into one debounced run', async () => {
    const { domainPath, remote, service } = await setup()
    await service.dispose()

    const remote2 = remote
    const service2 = createCalendarSyncService({
      appState: createMemoryAppState(),
      credentialStore: createMemoryCredentialStore(),
      domainService: {
        getStatus: async () => ({ registeredDomainPath: domainPath, isAvailable: true })
      },
      listRegisteredDossiers: async () => [dossierSummary('Dupont', 'Dupont c/ Moreau')],
      davClientFactory: async () => remote2.client,
      now: () => new Date('2026-06-12T10:00:00.000Z'),
      debounceMs: 20
    })
    await service2.saveSettings({
      serverUrl: 'https://caldav.example.com',
      username: 'user@example.com',
      password: 'app-password'
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    remote2.puts.length = 0
    await writeKeyDate(domainPath, 'Dupont', {
      uuid: 'kd-9',
      dossierId: 'Dupont',
      label: 'Audience',
      date: '2026-06-18'
    })

    service2.requestSync('change')
    service2.requestSync('change')
    service2.requestSync('change')
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(remote2.puts).toEqual(['kd-9.ics'])
    await service2.dispose()
  })
})
