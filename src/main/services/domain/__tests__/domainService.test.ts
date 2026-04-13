import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDomainService, shouldRevealMainWindow } from '../domainService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-domain-service-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('domain service', () => {
  it('returns unconfigured status when no domain was persisted', async () => {
    const root = await createTempDir()
    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-11T08:00:00.000Z'),
      openDirectoryDialog: async () => ({ canceled: true, filePaths: [] })
    })

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: null,
      isAvailable: false,
      dossierCount: 0
    })
  })

  it('selects and initializes a domain with .ordicab/domain.json', async () => {
    const root = await createTempDir()
    const selectedDomainPath = join(root, 'domain-a')
    await mkdir(selectedDomainPath, { recursive: true })

    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-11T09:12:00.000Z'),
      openDirectoryDialog: async () => ({ canceled: false, filePaths: [selectedDomainPath] })
    })

    await expect(service.selectDomain()).resolves.toEqual({ selectedPath: selectedDomainPath })

    const metadataPath = join(selectedDomainPath, '.ordicab', 'domain.json')
    const metadataRaw = await readFile(metadataPath, 'utf8')
    const metadata = JSON.parse(metadataRaw) as { domainPath: string; initializedAt: string }

    expect(metadata.domainPath).toBe(selectedDomainPath)
    expect(metadata.initializedAt).toBe('2026-03-11T09:12:00.000Z')

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: selectedDomainPath,
      isAvailable: true,
      dossierCount: 0
    })
  })

  it('keeps previous state unchanged when selection is canceled', async () => {
    const root = await createTempDir()
    const selectedDomainPath = join(root, 'domain-a')
    await mkdir(selectedDomainPath, { recursive: true })

    let invocation = 0
    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-11T09:12:00.000Z'),
      openDirectoryDialog: async () => {
        invocation += 1
        if (invocation === 1) {
          return { canceled: false, filePaths: [selectedDomainPath] }
        }
        return { canceled: true, filePaths: [] }
      }
    })

    await service.selectDomain()
    await expect(service.selectDomain()).resolves.toEqual({ selectedPath: null })

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: selectedDomainPath,
      isAvailable: true,
      dossierCount: 0
    })
  })

  it('reports unavailable when configured domain no longer exists', async () => {
    const root = await createTempDir()
    const selectedDomainPath = join(root, 'domain-a')
    await mkdir(selectedDomainPath, { recursive: true })

    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-11T09:12:00.000Z'),
      openDirectoryDialog: async () => ({ canceled: false, filePaths: [selectedDomainPath] })
    })

    await service.selectDomain()
    await rm(selectedDomainPath, { recursive: true, force: true })

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: selectedDomainPath,
      isAvailable: false,
      dossierCount: 0
    })
  })

  it('updates configured path when changing domain', async () => {
    const root = await createTempDir()
    const domainA = join(root, 'domain-a')
    const domainB = join(root, 'domain-b')
    await mkdir(domainA, { recursive: true })
    await mkdir(domainB, { recursive: true })

    let invocation = 0
    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-11T09:12:00.000Z'),
      openDirectoryDialog: async () => {
        invocation += 1
        return { canceled: false, filePaths: [invocation === 1 ? domainA : domainB] }
      }
    })

    await service.selectDomain()
    await service.selectDomain()

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: domainB,
      isAvailable: true,
      dossierCount: 0
    })
  })

  it('counts only registered dossiers from the domain registry', async () => {
    const root = await createTempDir()
    const selectedDomainPath = join(root, 'domain-a')
    await mkdir(join(selectedDomainPath, '.ordicab'), { recursive: true })
    await mkdir(join(selectedDomainPath, 'Client Alpha'), { recursive: true })
    await mkdir(join(selectedDomainPath, 'Client Beta'), { recursive: true })
    await mkdir(join(selectedDomainPath, 'Loose Folder'), { recursive: true })

    await writeFile(
      join(selectedDomainPath, '.ordicab', 'registry.json'),
      `${JSON.stringify(
        {
          dossiers: [
            { id: 'Client Alpha', name: 'Client Alpha', registeredAt: '2026-03-13T09:00:00.000Z' },
            { id: 'Client Beta', name: 'Client Beta', registeredAt: '2026-03-13T09:05:00.000Z' }
          ]
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const service = createDomainService({
      stateFilePath: join(root, 'app-state.json'),
      now: () => new Date('2026-03-13T09:12:00.000Z'),
      openDirectoryDialog: async () => ({ canceled: false, filePaths: [selectedDomainPath] })
    })

    await service.selectDomain()

    await expect(service.getStatus()).resolves.toEqual({
      registeredDomainPath: selectedDomainPath,
      isAvailable: true,
      dossierCount: 2
    })
  })
})

describe('shouldRevealMainWindow', () => {
  it('returns true when no domain is configured', () => {
    expect(
      shouldRevealMainWindow({
        registeredDomainPath: null,
        isAvailable: false,
        dossierCount: 0
      })
    ).toBe(true)
  })

  it('returns true when domain is configured but unavailable', () => {
    expect(
      shouldRevealMainWindow({
        registeredDomainPath: '/tmp/domain',
        isAvailable: false,
        dossierCount: 0
      })
    ).toBe(true)
  })

  it('returns false when configured domain is available', () => {
    expect(
      shouldRevealMainWindow({
        registeredDomainPath: '/tmp/domain',
        isAvailable: true,
        dossierCount: 2
      })
    ).toBe(false)
  })
})
