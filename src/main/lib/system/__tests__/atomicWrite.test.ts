import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { atomicWrite } from '../atomicWrite'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-atomic-write-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true })
    })
  )
})

describe('atomicWrite', () => {
  it('creates parent directories and writes file content atomically', async () => {
    const root = await createTempDir()
    const targetPath = join(root, 'nested', '.ordicab', 'domain.json')
    const content = JSON.stringify({ domainPath: '/tmp/domain-a' })

    await atomicWrite(targetPath, content)

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(content)
  })

  it('replaces existing content atomically', async () => {
    const root = await createTempDir()
    const targetPath = join(root, 'state.json')

    await writeFile(targetPath, '{"version":1}', 'utf8')
    await atomicWrite(targetPath, '{"version":2}')

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('{"version":2}')
  })
})
