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

async function createConfiguredDomain(): Promise<{
  domainPath: string
  stateFilePath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'ordicab-semantic-search-'))
  tempDirs.push(root)
  const domainPath = join(root, 'domain')
  const stateFilePath = join(root, 'app-state.json')

  await mkdir(domainPath, { recursive: true })
  await writeFile(
    stateFilePath,
    `${JSON.stringify(
      {
        selectedDomainPath: domainPath,
        updatedAt: '2026-04-24T08:00:00.000Z'
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  return { domainPath, stateFilePath }
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

describe('documentService semanticSearch', () => {
  it('indexes and searches plain-text documents on demand', async () => {
    const { domainPath, stateFilePath } = await createConfiguredDomain()
    const dossierId = 'Client Semantic Text'
    const dossierPath = join(domainPath, dossierId)

    await mkdir(dossierPath, { recursive: true })
    await writeFile(
      join(dossierPath, 'Assignation-2026-03-17.md'),
      '# Assignation\n\nJean Dupont sollicite une provision.',
      'utf8'
    )

    const dossierService = createDossierRegistryService({
      stateFilePath,
      now: () => new Date('2026-04-24T08:30:00.000Z')
    })
    await dossierService.registerDossier({ id: dossierId })

    const fakePipe = vi.fn(async (inputs: string[]) => {
      const values = inputs.flatMap((input) => {
        const first = input.startsWith('query: ') ? 1 : input.includes('Assignation') ? 0.9 : 0
        const second = input.startsWith('query: ') ? 0 : input.includes('Assignation') ? 0.1 : 1
        return [first, second, ...new Array(382).fill(0)]
      })
      return {
        data: new Float32Array(values),
        dims: [inputs.length, 384]
      }
    })
    pipelineSpy.mockResolvedValue(fakePipe)

    const service = createDocumentService({ stateFilePath })
    const result = await service.semanticSearch({
      dossierId,
      query: 'Assignation'
    })

    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]).toEqual(
      expect.objectContaining({
        documentId: 'Assignation-2026-03-17.md',
        filename: 'Assignation-2026-03-17.md'
      })
    )
    expect(result.hits[0]?.snippet).toContain('Assignation')
  })
})
