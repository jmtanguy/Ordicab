import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode } from '@shared/types'

import { AI_REMOTE_API_KEY_SECRET, registerAiHandlers } from '../aiHandler'
import { createAppStateStore } from '../../lib/system/appStateStore'

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
  saveSecret: (key: string, value: string) => Promise<void>
  getSecret: (key: string) => Promise<string | null>
  deleteSecret: (key: string) => Promise<void>
  hasSecret: (key: string) => Promise<boolean>
} {
  return {
    saveSecret: vi.fn(async () => undefined),
    getSecret: vi.fn(async () => storedKey),
    deleteSecret: vi.fn(async () => undefined),
    hasSecret: vi.fn(async () => storedKey !== null)
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
  const appState = createAppStateStore(stateFilePath)

  it('ai:settings-get returns default settings, hasApiKey flag without exposing raw key', async () => {
    // default settings when no config
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock(null)
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, appState })

    const result = await harness.invoke(IPC_CHANNELS.ai.settingsGet)
    expect(result).toEqual({
      success: true,
      data: {
        mode: 'none',
        piiWordlist: [],
        claudeCoworkEnabled: false,
        hasApiKey: false,
        apiKeySuffix: undefined
      }
    })

    // key present: hasApiKey true, raw key never returned
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        ai: {
          mode: 'remote',
          piiWordlist: ['Client sensible'],
          claudeCoworkEnabled: true
        }
      }) as never
    )
    const harness2 = createIpcMainHarness()
    const credentialStore2 = createCredentialStoreMock('sk-secret-key')
    registerAiHandlers({
      ipcMain: harness2.ipcMain,
      credentialStore: credentialStore2,
      appState
    })

    const resultWithKey = (await harness2.invoke(IPC_CHANNELS.ai.settingsGet)) as {
      success: boolean
      data: Record<string, unknown>
    }
    expect(resultWithKey.success).toBe(true)
    expect(resultWithKey.data.hasApiKey).toBe(true)
    expect(resultWithKey.data.piiWordlist).toEqual(['Client sensible'])
    expect(resultWithKey.data.claudeCoworkEnabled).toBe(true)
    expect(resultWithKey.data).not.toHaveProperty('encryptedApiKey')
    expect(Object.values(resultWithKey.data)).not.toContain('sk-secret-key')

    // key absent: hasApiKey false
    const harness3 = createIpcMainHarness()
    const credentialStore3 = createCredentialStoreMock(null)
    registerAiHandlers({
      ipcMain: harness3.ipcMain,
      credentialStore: credentialStore3,
      appState
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
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, appState })

    const result = await harness.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'remote',
      remoteProvider: 'https://api.openai.com/v1',
      apiKey: 'sk-my-key'
    })
    expect(result).toEqual({ success: true, data: null })
    expect(credentialStore.saveSecret).toHaveBeenCalledWith(AI_REMOTE_API_KEY_SECRET, 'sk-my-key')

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
      appState
    })
    await harness2.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'remote',
      remoteProvider: 'https://api.anthropic.com/v1',
      piiWordlist: ['Projet confidentiel'],
      claudeCoworkEnabled: true,
      apiKey: 'sk-super-secret'
    })
    expect(writtenContent).not.toContain('sk-super-secret')
    expect(writtenContent).not.toContain('apiKey')
    expect(writtenContent).toContain('Projet confidentiel')
    expect(writtenContent).toContain('claudeCoworkEnabled')
    expect(credentialStore2.saveSecret).toHaveBeenCalledWith(
      AI_REMOTE_API_KEY_SECRET,
      'sk-super-secret'
    )

    // invalid input
    const harness3 = createIpcMainHarness()
    const credentialStore3 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness3.ipcMain,
      credentialStore: credentialStore3,
      appState
    })
    const invalidResult = await harness3.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'invalid-mode',
      remoteProvider: 'not-a-url'
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
      appState,
      onModeChanged
    })

    await harness.invoke(IPC_CHANNELS.ai.settingsSave, {
      mode: 'remote',
      remoteProvider: 'https://api.openai.com/v1',
      claudeCoworkEnabled: true,
      piiWordlist: ['Client sensible']
    })

    expect(onModeChanged).toHaveBeenCalledWith({
      mode: 'remote',
      remoteProvider: 'https://api.openai.com/v1',
      claudeCoworkEnabled: true,
      piiWordlist: ['Client sensible']
    })
  })

  it('ai:delete-api-key calls credentialStore.deleteSecret and returns success', async () => {
    const harness = createIpcMainHarness()
    const credentialStore = createCredentialStoreMock('sk-existing-key')
    registerAiHandlers({ ipcMain: harness.ipcMain, credentialStore, appState })

    const result = await harness.invoke(IPC_CHANNELS.ai.deleteApiKey, 'openai')
    expect(result).toEqual({ success: true, data: null })
    expect(credentialStore.deleteSecret).toHaveBeenCalledWith(AI_REMOTE_API_KEY_SECRET)
  })

  it('ai:cloud-provider-status returns availability, handles missing CLI, and falls back to none for invalid mode', async () => {
    // found CLI
    const checkerFound = { checkAvailability: vi.fn(async () => ({ available: true })) }
    const harness1 = createIpcMainHarness()
    const credentialStore1 = createCredentialStoreMock()
    registerAiHandlers({
      ipcMain: harness1.ipcMain,
      credentialStore: credentialStore1,
      appState,
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
      appState,
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
      appState,
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
      appState,
      aiService: aiService as never,
      getWebContents: () => currentWebContents
    })

    currentWebContents = { send }

    const result = await harness.invoke(IPC_CHANNELS.ai.executeCommand, {
      command: 'Bonjour',
      context: {
        dossierId: 'dos-1',
        pendingTagPaths: ['dossier.keyDate.audience.long'],
        documentMentions: [{ uuid: 'doc-uuid-1', filename: 'assignation.pdf' }]
      }
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
    expect(aiService.executeCommand).toHaveBeenCalledWith(
      {
        command: 'Bonjour',
        context: {
          dossierId: 'dos-1',
          pendingTagPaths: ['dossier.keyDate.audience.long'],
          documentMentions: [{ uuid: 'doc-uuid-1', filename: 'assignation.pdf' }]
        }
      },
      expect.any(Function),
      expect.any(Function)
    )
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
      appState,
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
