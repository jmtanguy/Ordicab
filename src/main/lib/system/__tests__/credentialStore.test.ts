import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createCredentialStore } from '../credentialStore'
import { createAppStateStore } from '../appStateStore'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn()
}))

vi.mock('node:fs', () => ({
  constants: { F_OK: 0 }
}))

function createMockSafeStorage(encrypted = 'ENCRYPTED'): {
  isEncryptionAvailable: () => boolean
  encryptString: (input: string) => Buffer
  decryptString: (input: Buffer) => string
} {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(() => Buffer.from(encrypted)),
    decryptString: vi.fn(() => 'sk-decrypted-key')
  }
}

describe('credentialStore', () => {
  const stateFilePath = '/tmp/app-state.json'

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('saves, retrieves, checks, and deletes named encrypted secrets', async () => {
    const fsMod = await import('node:fs/promises')

    // save
    vi.mocked(readFile).mockResolvedValue('{}' as never)
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined as never)
    vi.mocked(fsMod.rename).mockResolvedValue(undefined as never)
    const safeStorage = createMockSafeStorage()
    const store = createCredentialStore(safeStorage, createAppStateStore(stateFilePath))
    await store.saveSecret('ai.remote.default', 'sk-secret')
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-secret')

    // no key stored -> null
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(readFile).mockResolvedValue('{"credentials": {}}' as never)
    const store2 = createCredentialStore(
      createMockSafeStorage(),
      createAppStateStore(stateFilePath)
    )
    expect(await store2.getSecret('ai.remote.default')).toBeNull()
    expect(await store2.hasSecret('ai.remote.default')).toBe(false)

    // key stored -> decrypts
    const base64 = Buffer.from('ENCRYPTED').toString('base64')
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ credentials: { 'ai.remote.default': base64 } }) as never
    )
    const safeStorage3 = createMockSafeStorage()
    const store3 = createCredentialStore(safeStorage3, createAppStateStore(stateFilePath))
    expect(await store3.getSecret('ai.remote.default')).toBe('sk-decrypted-key')
    expect(await store3.hasSecret('ai.remote.default')).toBe(true)
    expect(safeStorage3.decryptString).toHaveBeenCalled()

    // delete removes only the named secret
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        credentials: {
          'ai.remote.default': base64,
          'legal.piste.production.clientId': base64
        }
      }) as never
    )
    let writtenContent = ''
    vi.mocked(fsMod.writeFile).mockImplementationOnce(async (_path, content) => {
      writtenContent = content as string
    })
    vi.mocked(fsMod.rename).mockResolvedValueOnce(undefined as never)
    await store3.deleteSecret('ai.remote.default')
    expect(writtenContent).not.toContain('ai.remote.default')
    expect(writtenContent).toContain('legal.piste.production.clientId')

    // file does not exist -> null
    vi.mocked(fsMod.access).mockRejectedValue(new Error('ENOENT') as never)
    const store4 = createCredentialStore(
      createMockSafeStorage(),
      createAppStateStore(stateFilePath)
    )
    expect(await store4.getSecret('ai.remote.default')).toBeNull()
  })
})
