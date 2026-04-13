import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createCredentialStore } from '../credentialStore'

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

  it('saves, retrieves (with decryption), and handles missing key or missing file', async () => {
    const fsMod = await import('node:fs/promises')

    // save
    vi.mocked(readFile).mockResolvedValue('{}' as never)
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(fsMod.writeFile).mockResolvedValue(undefined as never)
    vi.mocked(fsMod.rename).mockResolvedValue(undefined as never)
    const safeStorage = createMockSafeStorage()
    const store = createCredentialStore(safeStorage, stateFilePath)
    await store.saveApiKey('openai', 'sk-secret')
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-secret')

    // no key stored -> null
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(readFile).mockResolvedValue('{"ai": {}}' as never)
    const store2 = createCredentialStore(createMockSafeStorage(), stateFilePath)
    expect(await store2.getApiKey('openai')).toBeNull()

    // key stored -> decrypts
    const base64 = Buffer.from('ENCRYPTED').toString('base64')
    vi.mocked(fsMod.access).mockResolvedValue(undefined as never)
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ ai: { encryptedApiKey: base64 } }) as never
    )
    const safeStorage3 = createMockSafeStorage()
    const store3 = createCredentialStore(safeStorage3, stateFilePath)
    expect(await store3.getApiKey('openai')).toBe('sk-decrypted-key')
    expect(safeStorage3.decryptString).toHaveBeenCalled()

    // file does not exist -> null
    vi.mocked(fsMod.access).mockRejectedValue(new Error('ENOENT') as never)
    const store4 = createCredentialStore(createMockSafeStorage(), stateFilePath)
    expect(await store4.getApiKey('openai')).toBeNull()
  })
})
