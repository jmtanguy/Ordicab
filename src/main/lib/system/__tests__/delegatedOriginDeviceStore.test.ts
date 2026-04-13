import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDelegatedOriginDeviceStore } from '../delegatedOriginDeviceStore'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-delegated-origin-device-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('delegatedOriginDeviceStore', () => {
  it('generates one persistent origin device id and reuses it across restarts', async () => {
    const root = await createTempDir()
    const stateFilePath = join(root, 'app-state.json')

    const store = createDelegatedOriginDeviceStore(stateFilePath)
    const originDeviceId = await store.getOriginDeviceId()

    expect(originDeviceId).toBeTruthy()

    const persisted = JSON.parse(await readFile(stateFilePath, 'utf8')) as {
      delegatedAi?: { originDeviceId?: string }
    }
    expect(persisted.delegatedAi?.originDeviceId).toBe(originDeviceId)

    const reloadedStore = createDelegatedOriginDeviceStore(stateFilePath)
    await expect(reloadedStore.getOriginDeviceId()).resolves.toBe(originDeviceId)
  })
})
