import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { __resetModelRegistryForTests } from '../../../lib/aiEmbedded/modelRegistry'
import { createDossierRegistryService } from '../dossierRegistryService'
import { createDocumentService } from '../documentService'

const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return {
    pipelineSpy: vi.fn(),
    envRef: env
  }
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineSpy,
  env: envRef
}))

const tempDirs: string[] = []

async function createConfiguredDomain(): Promise<{ domainPath: string; stateFilePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ordicab-global-search-'))
  tempDirs.push(root)
  const domainPath = join(root, 'domain')
  const stateFilePath = join(root, 'app-state.json')

  await mkdir(domainPath, { recursive: true })
  await writeFile(
    stateFilePath,
    `${JSON.stringify({ selectedDomainPath: domainPath, updatedAt: '2026-04-24T08:00:00.000Z' }, null, 2)}\n`,
    'utf8'
  )

  return { domainPath, stateFilePath }
}

async function seedDossier(
  domainPath: string,
  stateFilePath: string,
  slug: string,
  fileName: string,
  contents: string
): Promise<void> {
  const dossierPath = join(domainPath, slug)
  await mkdir(dossierPath, { recursive: true })
  await writeFile(join(dossierPath, fileName), contents, 'utf8')

  const dossierService = createDossierRegistryService({
    stateFilePath,
    now: () => new Date('2026-04-24T08:30:00.000Z')
  })
  await dossierService.registerDossier({ slug })
}

beforeEach(() => {
  __resetModelRegistryForTests()
  pipelineSpy.mockReset()
  envRef.localModelPath = undefined
  envRef.allowRemoteModels = true
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('documentService searchAllDossiers', () => {
  it('tags each hit with its source dossier and skips dossiers without a match', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await seedDossier(
      domainPath,
      stateFilePath,
      'Client Alpha',
      'attestation.md',
      "Certificat de scolarité de l'enfant inscrit à l'école."
    )
    await seedDossier(
      domainPath,
      stateFilePath,
      'Client Beta',
      'mariage.md',
      'Extrait acte de mariage. Mairie de Lyon 6e arrondissement.'
    )

    // Embedding model unavailable → only the deterministic keyword side runs.
    pipelineSpy.mockResolvedValue(null)

    const service = createDocumentService({ stateFilePath })
    const result = await service.searchAllDossiers({ query: 'école' })

    expect(result.query).toBe('école')
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toEqual(
      expect.objectContaining({
        documentPath: 'attestation.md',
        dossierId: 'Client Alpha',
        dossierName: 'Client Alpha',
        matchKind: 'keyword'
      })
    )
  })

  it('aggregates matches from multiple dossiers, each carrying its own source', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    await seedDossier(
      domainPath,
      stateFilePath,
      'Client Alpha',
      'attestation.md',
      "Inscription à l'école primaire."
    )
    await seedDossier(
      domainPath,
      stateFilePath,
      'Client Beta',
      'certificat.md',
      "Certificat de l'école élémentaire."
    )

    pipelineSpy.mockResolvedValue(null)

    const service = createDocumentService({ stateFilePath })
    const result = await service.searchAllDossiers({ query: 'école' })

    expect(result.hits).toHaveLength(2)
    const bySource = new Map(result.hits.map((hit) => [hit.dossierId, hit.dossierName]))
    expect(bySource.get('Client Alpha')).toBe('Client Alpha')
    expect(bySource.get('Client Beta')).toBe('Client Beta')
    expect(result.hits.every((hit) => hit.matchKind === 'keyword')).toBe(true)
  })

  it('returns an empty result set when no dossiers are registered', async () => {
    const { stateFilePath } = await createConfiguredDomain()

    const service = createDocumentService({ stateFilePath })
    const result = await service.searchAllDossiers({ query: 'école' })

    expect(result).toEqual({ query: 'école', hits: [] })
  })
})
