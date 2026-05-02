import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode } from '@shared/types'

import { registerAiHandlers } from '../aiHandler'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

function createIpcMainHarness(): {
  invoke: (channel: string, input?: unknown, event?: unknown) => Promise<unknown>
  ipcMain: {
    handle: (
      channel: string,
      listener: (_event: unknown, input?: unknown) => Promise<unknown>
    ) => void
  }
} {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

  return {
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      }
    },
    invoke: async (channel, input, event = {}) => {
      const handler = handlers.get(channel)

      if (!handler) {
        throw new Error(`No IPC handler registered for ${channel}`)
      }

      return handler(event, input)
    }
  }
}

function createCredentialStoreMock(storedKey: string | null = null): {
  saveApiKey: (provider: string, key: string) => Promise<void>
  getApiKey: (provider: string) => Promise<string | null>
  deleteApiKey: (provider: string) => Promise<void>
} {
  return {
    saveApiKey: vi.fn(async () => undefined),
    getApiKey: vi.fn(async () => storedKey),
    deleteApiKey: vi.fn(async () => undefined)
  }
}

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => '{}'),
  access: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined)
}))

vi.mock('node:fs', () => ({
  constants: { F_OK: 0 }
}))

describe('aiHandler', () => {
  const stateFilePath = '/tmp/app-state.json'

  it('ai:settings-get returns default settings, hasApiKey flag without exposing raw key', async () => {
    // default settings when no config
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock(null)
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, stateFilePath })

    const result = await harness.invoke(IPC_CHANNELS.ai.settingsGet)
    expect(result).toEqual({
      success: true,
      data: {
        mode: 'local',
        ollamaEndpoint: 'http://localhost:11434',
        hasApiKey: false,
        apiKeySuffix: undefined
      }
    })

    // key present: hasApiKey true, raw key never returned
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ ai: { mode: 'remote', ollamaEndpoint: 'http://localhost:11434' } }) as never
    )
    const harness2 = createIpcMainHarness()
    const credentialStore2 = createCredentialStoreMock('sk-secret-key')
    registerAiHandlers({
      ipcMain: harness2.ipcMain,
      credentialStore: credentialStore2,
      stateFilePath
    })

    const resultWithKey = (await harness2.invoke(IPC_CHANNELS.ai.settingsGet)) as {
      success: boolean
      data: Record<string, unknown>
    }
    expect(resultWithKey.success).toBe(true)
    expect(resultWithKey.data.hasApiKey).toBe(true)
    expect(resultWithKey.data).not.toHaveProperty('encryptedApiKey')
    expect(Object.values(resultWithKey.data)).not.toContain('sk-secret-key')

    // key absent: hasApiKey false
    const harness3 = createIpcMainHarness()
    const credentialStore3 = createCredentialStoreMock(null)
    registerAiHandlers({
      ipcMain: harness3.ipcMain,
      credentialStore: credentialStore3,
      stateFilePath
    })

    const resultNoKey = (await harness3.invoke(IPC_CHANNELS.ai.settingsGet)) as {
      success: boolean
      data: Record<string, unknown>
    }
    expect(resultNoKey.success).toBe(true)
    expect(resultNoKey.data.hasApiKey).toBe(false)
  })

  it('ai:settings-save writes settings, stores API key, blocks key in state file, and rejects invalid input', async () => {
    const fsMod = await import('node:fs/promises')
    vi.mocked(fsMod.readFile).mockResolvedValueOnce('{}' as never)
    vi.mocked(fsMod.writeFile).mockResolvedValueOnce(undefined as never)
    vi.mocked(fsMod.rename).mockResolvedValueOnce(undefined as never)

    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock(null)
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, stateFilePath })

    const result = await harness.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'remote',
      ollamaEndpoint: 'http://localhost:11434',
      remoteProvider: 'https://api.openai.com/v1',
      apiKey: 'sk-my-key'
    })
    expect(result).toEqual({ success: true, data: null })
    expect(credentialStore.saveApiKey).toHaveBeenCalledWith('default', 'sk-my-key')

    // key not written to state file
    let writtenContent = ''
    vi.mocked(fsMod.readFile).mockResolvedValueOnce('{}' as never)
    vi.mocked(fsMod.writeFile).mockImplementationOnce(async (_path, content) => {
      writtenContent = content as string
    })
    vi.mocked(fsMod.rename).mockResolvedValueOnce(undefined as never)

    const harness2 = createIpcMainHarness()
    const credentialStore2 = createCredentialStoreMock(null)
    registerAiHandlers({
      ipcMain: harness2.ipcMain,
      credentialStore: credentialStore2,
      stateFilePath
    })
    await harness2.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'remote',
      remoteProvider: 'https://api.anthropic.com/v1',
      apiKey: 'sk-super-secret'
    })
    expect(writtenContent).not.toContain('sk-super-secret')
    expect(writtenContent).not.toContain('apiKey')
    expect(credentialStore2.saveApiKey).toHaveBeenCalledWith('default', 'sk-super-secret')

    // invalid input
    const harness3 = createIpcMainHarness()
    const credentialStore3 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness3.ipcMain,
      credentialStore: credentialStore3,
      stateFilePath
    })
    const invalidResult = await harness3.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'invalid-mode',
      ollamaEndpoint: 'not-a-url'
    })
    expect(invalidResult).toMatchObject({ success: false, code: IpcErrorCode.VALIDATION_FAILED })
  })

  it('ai:settings-save forwards the saved settings payload to onModeChanged', async () => {
    const fsMod = await import('node:fs/promises')
    vi.mocked(fsMod.readFile).mockResolvedValueOnce('{}' as never)
    vi.mocked(fsMod.writeFile).mockResolvedValueOnce(undefined as never)
    vi.mocked(fsMod.rename).mockResolvedValueOnce(undefined as never)

    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock(null)
    const onModeChanged = vi.fn()
    registerAiHandlers({
      ipcMain: harness.ipcMain,
      credentialStore,
      stateFilePath,
      onModeChanged
    })

    await harness.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'local',
      ollamaEndpoint: 'http://localhost:11434'
    })

    expect(onModeChanged).toHaveBeenCalledWith({
      mode: 'local',
      ollamaEndpoint: 'http://localhost:11434'
    })
  })

  it('ai:connection-status returns reachable result or OLLAMA_UNREACHABLE', async () => {
    // reachable
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'llama3' }] })
    } as Response)
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock(null)
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, stateFilePath })
    const result = await harness.invoke(IPC_CHANNELS.ai.connectionStatus)
    expect(result).toEqual({ success: true, data: { reachable: true, models: ['llama3'] } })

    // unreachable
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({})
    } as Response)
    const harness2 = createIpcMainHarness()
    const credentialStore2 = createCredentialStoreMock(null)
    registerAiHandlers({
      ipcMain: harness2.ipcMain,
      credentialStore: credentialStore2,
      stateFilePath
    })
    const result2 = (await harness2.invoke(IPC_CHANNELS.ai.connectionStatus)) as {
      success: boolean
      code: string
    }
    expect(result2.success).toBe(false)
    expect(result2.code).toBe(IpcErrorCode.OLLAMA_UNREACHABLE)
  })

  it('ai:delete-api-key calls credentialStore.deleteApiKey and returns success', async () => {
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock('sk-existing-key')
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, stateFilePath })

    const result = await harness.invoke(IPC_CHANNELS.ai.deleteApiKey, 'openai')
    expect(result).toEqual({ success: true, data: null })
    expect(credentialStore.deleteApiKey).toHaveBeenCalledWith('openai')
  })

  it('ai:cloud-provider-status returns availability, handles missing CLI, and falls back to none for invalid mode', async () => {
    // found CLI
    const checkerFound = { checkAvailability: vi.fn(async () => ({ available: true })) }
    const harness1 = createIpcMainHarness()
    const credentialStore1 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness1.ipcMain,
      credentialStore: credentialStore1,
      stateFilePath,
      checker: checkerFound
    })
    const result1 = await harness1.invoke(IPC_CHANNELS.ai.cloudProviderStatus, 'claude-code')
    expect(result1).toEqual({ success: true, data: { available: true } })
    expect(checkerFound.checkAvailability).toHaveBeenCalledWith('claude-code')

    // CLI missing
    const checkerMissing = {
      checkAvailability: vi.fn(async () => ({
        available: false,
        reason: 'Claude CLI not found — install via: npm i -g @anthropic-ai/claude-code'
      }))
    }
    const harness2 = createIpcMainHarness()
    const credentialStore2 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness2.ipcMain,
      credentialStore: credentialStore2,
      stateFilePath,
      checker: checkerMissing
    })
    const result2 = (await harness2.invoke(IPC_CHANNELS.ai.cloudProviderStatus, 'claude-code')) as {
      success: boolean
      data: { available: boolean; reason: string }
    }
    expect(result2.success).toBe(true)
    expect(result2.data.available).toBe(false)
    expect(result2.data.reason).toContain('Claude CLI not found')

    // invalid mode falls back to none
    const checkerNone = { checkAvailability: vi.fn(async () => ({ available: true })) }
    const harness3 = createIpcMainHarness()
    const credentialStore3 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness3.ipcMain,
      credentialStore: credentialStore3,
      stateFilePath,
      checker: checkerNone
    })
    await harness3.invoke(IPC_CHANNELS.ai.cloudProviderStatus, 'not-a-valid-mode')
    expect(checkerNone.checkAvailability).toHaveBeenCalledWith('none')
  })

  it('ai:execute-command resolves webContents lazily so push events still work after bootstrap', async () => {
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock()
    const send = vi.fn()
    let currentWebContents: { send(channel: string, ...args: unknown[]): void } | null = null
    const aiService = {
      executeCommand: vi.fn(
        async (
          _input: unknown,
          onToken?: (token: string) => void,
          onReflection?: (text: string) => void
        ) => {
          onReflection?.('step intermédiaire')
          onToken?.('token')
          return {
            intent: { type: 'direct_response' as const, message: 'Réponse finale' },
            feedback: 'Réponse finale'
          }
        }
      ),
      cancelCommand: vi.fn(),
      resetConversation: vi.fn()
    }

    registerAiHandlers({
      ipcMain: harness.ipcMain,
      credentialStore,
      stateFilePath,
      aiService: aiService as never,
      getWebContents: () => currentWebContents
    })

    currentWebContents = { send }

    const result = await harness.invoke(IPC_CHANNELS.ai.executeCommand, {
      command: 'Bonjour',
      context: {}
    })

    expect(result).toEqual({
      success: true,
      data: {
        intent: { type: 'direct_response', message: 'Réponse finale' },
        feedback: 'Réponse finale'
      }
    })
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ai.reflection, 'step intermédiaire')
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ai.textToken, 'token')
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ai.intentReceived, {
      type: 'direct_response',
      message: 'Réponse finale'
    })
  })

  it('ai:execute-command prefers the invoking renderer sender for push events', async () => {
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock()
    const senderSend = vi.fn()
    const fallbackSend = vi.fn()
    const aiService = {
      executeCommand: vi.fn(
        async (
          _input: unknown,
          _onToken?: (token: string) => void,
          onReflection?: (text: string) => void
        ) => {
          onReflection?.('step via sender')
          return {
            intent: { type: 'direct_response' as const, message: 'Réponse finale' },
            feedback: 'Réponse finale'
          }
        }
      ),
      cancelCommand: vi.fn(),
      resetConversation: vi.fn()
    }

    registerAiHandlers({
      ipcMain: harness.ipcMain,
      credentialStore,
      stateFilePath,
      aiService: aiService as never,
      getWebContents: () => ({ send: fallbackSend })
    })

    await harness.invoke(
      IPC_CHANNELS.ai.executeCommand,
      { command: 'Bonjour', context: {} },
      { sender: { send: senderSend } }
    )

    expect(senderSend).toHaveBeenCalledWith(IPC_CHANNELS.ai.reflection, 'step via sender')
    expect(fallbackSend).not.toHaveBeenCalled()
  })
})
