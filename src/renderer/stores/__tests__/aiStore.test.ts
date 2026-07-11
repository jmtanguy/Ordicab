import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrdicabAPI } from '@shared/types'

import { useAiStore } from '../aiStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

const defaultSettings = {
  mode: 'none' as const,
  hasApiKey: false
}

beforeEach(() => {
  useAiStore.setState(useAiStore.getInitialState(), true)
  delete (globalThis as MutableGlobal).ordicabAPI
})

describe('aiStore', () => {
  it('loads settings successfully and surfaces errors', async () => {
    // success
    const getSettings = vi.fn(async () => ({ success: true as const, data: defaultSettings }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings, saveSettings: vi.fn() }
    } as unknown as OrdicabAPI
    await useAiStore.getState().loadSettings()
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().settings).toEqual(defaultSettings)
    expect(useAiStore.getState().loading).toBe(false)
    expect(useAiStore.getState().error).toBeNull()

    // error
    useAiStore.setState(useAiStore.getInitialState(), true)
    const getSettingsErr = vi.fn(async () => ({
      success: false as const,
      error: 'File read error',
      code: 'FILE_SYSTEM_ERROR' as const
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: getSettingsErr, saveSettings: vi.fn() }
    } as unknown as OrdicabAPI
    await useAiStore.getState().loadSettings()
    expect(useAiStore.getState().error).toBe('File read error')
    expect(useAiStore.getState().settings).toBeNull()
  })

  it('saves settings and reloads; surfaces save errors; clears remoteApiError on mode switch; loading is false after throw', async () => {
    // success save
    const saveSettings = vi.fn(async () => ({ success: true as const, data: null }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: { ...defaultSettings, mode: 'remote' as const, hasApiKey: true }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings, saveSettings }
    } as unknown as OrdicabAPI
    await useAiStore.getState().saveSettings({ mode: 'remote', apiKey: 'sk-test' })
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().settings?.mode).toBe('remote')

    // save error
    useAiStore.setState(useAiStore.getInitialState(), true)
    const saveErr = vi.fn(async () => ({
      success: false as const,
      error: 'Save failed',
      code: 'UNKNOWN' as const
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: vi.fn(), saveSettings: saveErr }
    } as unknown as OrdicabAPI
    await useAiStore.getState().saveSettings({ mode: 'none' })
    expect(useAiStore.getState().error).toBe('Save failed')

    // loading false after throw
    useAiStore.setState(useAiStore.getInitialState(), true)
    const saveThrow = vi.fn(async () => {
      throw new Error('network error')
    })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: vi.fn(), saveSettings: saveThrow }
    } as unknown as OrdicabAPI
    await useAiStore.getState().saveSettings({ mode: 'none' })
    expect(useAiStore.getState().loading).toBe(false)
    expect(useAiStore.getState().error).toBe('network error')

    // clears remoteApiError when switching away from remote
    useAiStore.setState(useAiStore.getInitialState(), true)
    const saveOk2 = vi.fn(async () => ({ success: true as const, data: null }))
    const getOk2 = vi.fn(async () => ({
      success: true as const,
      data: { ...defaultSettings, mode: 'none' as const }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: getOk2, saveSettings: saveOk2 }
    } as unknown as OrdicabAPI
    useAiStore.setState({ remoteApiError: { type: 'auth_error', message: 'bad key' } })
    await useAiStore.getState().saveSettings({ mode: 'none' })
    expect(useAiStore.getState().remoteApiError).toBeNull()
  })

  it('checkConnection sets connected or unreachable status', async () => {
    // connected
    const remoteConnectionStatus = vi.fn(async () => ({
      success: true as const,
      data: { reachable: true }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: vi.fn(), saveSettings: vi.fn(), remoteConnectionStatus }
    } as unknown as OrdicabAPI
    await useAiStore.getState().checkConnection({ mode: 'remote' })
    expect(useAiStore.getState().connectionStatus).toBe('connected')
    expect(useAiStore.getState().connectionError).toBeNull()

    // unreachable
    useAiStore.setState(useAiStore.getInitialState(), true)
    const remoteConnectionStatusErr = vi.fn(async () => ({
      success: false as const,
      error: 'Cannot reach provider',
      code: 'REMOTE_API_ERROR' as const
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        getSettings: vi.fn(),
        saveSettings: vi.fn(),
        remoteConnectionStatus: remoteConnectionStatusErr
      }
    } as unknown as OrdicabAPI
    await useAiStore.getState().checkConnection({ mode: 'remote' })
    expect(useAiStore.getState().connectionStatus).toBe('unreachable')
    expect(useAiStore.getState().connectionError).toBe('Cannot reach provider')
  })

  it('setSelectedModel is a no-op when the selected model does not change', () => {
    useAiStore.setState({ selectedModel: 'llama3' })

    const before = useAiStore.getState()
    useAiStore.getState().setSelectedModel('llama3')
    const after = useAiStore.getState()

    expect(after).toBe(before)
    expect(after.selectedModel).toBe('llama3')
  })

  it('deleteApiKey calls api.ai.deleteApiKey and reloads settings', async () => {
    const deleteApiKey = vi.fn(async () => ({ success: true as const, data: null }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: { ...defaultSettings, hasApiKey: false }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings, saveSettings: vi.fn(), deleteApiKey }
    } as unknown as OrdicabAPI
    useAiStore.setState({
      settings: {
        ...defaultSettings,
        mode: 'remote' as const,
        hasApiKey: true,
        remoteProvider: 'openai'
      }
    })
    await useAiStore.getState().deleteApiKey()
    expect(deleteApiKey).toHaveBeenCalledWith('openai')
    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().settings?.hasApiKey).toBe(false)
  })

  it('checkCloudAvailability stores result for cloud mode and clears for non-cloud modes', async () => {
    // cloud mode
    const cloudProviderStatus = vi.fn(async () => ({
      success: true as const,
      data: { available: true }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: vi.fn(), saveSettings: vi.fn(), cloudProviderStatus }
    } as unknown as OrdicabAPI
    await useAiStore.getState().checkCloudAvailability('claude-code')
    expect(cloudProviderStatus).toHaveBeenCalledWith('claude-code')
    expect(useAiStore.getState().cloudAvailability).toEqual({ available: true })

    // non-cloud mode clears
    useAiStore.setState({ cloudAvailability: { available: true } })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings: vi.fn(), saveSettings: vi.fn(), cloudProviderStatus: vi.fn() }
    } as unknown as OrdicabAPI
    await useAiStore.getState().checkCloudAvailability('none')
    expect(useAiStore.getState().cloudAvailability).toBeNull()
  })

  it('saveSettings triggers checkCloudAvailability when Cowork is enabled', async () => {
    const cloudProviderStatus = vi.fn(async () => ({
      success: true as const,
      data: { available: false, reason: 'Claude CLI not found' }
    }))
    const saveSettings = vi.fn(async () => ({ success: true as const, data: null }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: { ...defaultSettings, claudeCoworkEnabled: true, hasApiKey: false }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { getSettings, saveSettings, cloudProviderStatus }
    } as unknown as OrdicabAPI
    await useAiStore.getState().saveSettings({ claudeCoworkEnabled: true })
    expect(cloudProviderStatus).toHaveBeenCalledWith('claude-code')
    expect(useAiStore.getState().cloudAvailability).toEqual({
      available: false,
      reason: 'Claude CLI not found'
    })
  })

  it('resetConversation clears chat state and calls the main process reset', async () => {
    const resetConversation = vi.fn(async () => ({ success: true as const, data: null }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { resetConversation }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      messages: [{ id: 'm1', role: 'user', text: 'Bonjour' }],
      commandLoading: true,
      pendingClarification: { type: 'clarification_request', question: 'Q?', options: ['A'] },
      originalCommand: 'Bonjour',
      clarificationRound: 1,
      streamingMessageId: 'stream-1',
      lastContext: {
        dossierId: 'd1',
        contactUuid: 'c1',
        templateUuid: 't1',
        pendingTagPaths: ['x']
      }
    })

    await useAiStore.getState().resetConversation()

    expect(resetConversation).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().messages).toEqual([])
    expect(useAiStore.getState().commandLoading).toBe(false)
    expect(useAiStore.getState().pendingClarification).toBeNull()
    expect(useAiStore.getState().originalCommand).toBeNull()
    expect(useAiStore.getState().clarificationRound).toBe(0)
    expect(useAiStore.getState().streamingMessageId).toBeNull()
    expect(useAiStore.getState().lastContext).toEqual({
      dossierId: 'd1',
      contactUuid: undefined,
      templateUuid: undefined,
      pendingTagPaths: undefined
    })
  })

  it('does not send conversation history — the main-process runtime owns it', async () => {
    const executeCommand = vi.fn(async () => ({
      success: true as const,
      data: {
        intent: { type: 'direct_response' as const, message: 'Voici la suite.' },
        feedback: 'Voici la suite.',
        debugContext: 'debug'
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { executeCommand }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      messages: [
        { id: 'u1', role: 'user', text: 'Bonjour' },
        { id: 'a1', role: 'assistant', text: 'Salut' },
        { id: 'e1', role: 'error', text: 'Erreur precedente' }
      ],
      activeDossierId: 'd1'
    })

    await useAiStore.getState().executeCommand('Donne la suite')

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'Donne la suite',
      context: { dossierId: 'd1' },
      model: undefined
    })
  })

  it('resolveClarification sends only the selected option for binary yes-no confirmations', async () => {
    const executeCommand = vi.fn(async () => ({
      success: true as const,
      data: {
        intent: { type: 'direct_response' as const, message: 'Contact supprimé.' },
        feedback: 'Contact supprimé.'
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { executeCommand }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      pendingClarification: {
        type: 'clarification_request',
        question: 'Voulez-vous vraiment supprimer le contact Merlin ?',
        options: ['Oui', 'Non']
      },
      originalCommand: 'supprimer merlin',
      lastContext: { dossierId: 'd1' }
    })

    await useAiStore.getState().resolveClarification('Oui')

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'Oui',
      context: { dossierId: 'd1' },
      model: undefined
    })
  })

  it('treats a typed yes as an answer to the pending binary clarification', async () => {
    const executeCommand = vi.fn(async () => ({
      success: true as const,
      data: {
        intent: { type: 'direct_response' as const, message: 'Contact supprimé.' },
        feedback: 'Contact supprimé.'
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { executeCommand }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      pendingClarification: {
        type: 'clarification_request',
        question: 'Voulez-vous vraiment supprimer le contact Merlin ?',
        options: ['Oui', 'Non']
      },
      originalCommand: 'supprimer merlin',
      lastContext: { dossierId: 'd1' }
    })

    await useAiStore.getState().executeCommand('yes')

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'Oui',
      context: { dossierId: 'd1' },
      model: undefined
    })
  })

  it('includes the selected option id when replaying a non-binary clarification', async () => {
    const executeCommand = vi.fn(async () => ({
      success: true as const,
      data: {
        intent: { type: 'direct_response' as const, message: 'Contact ciblé.' },
        feedback: 'Contact ciblé.'
      }
    }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { executeCommand }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      pendingClarification: {
        type: 'clarification_request',
        question: 'Lequel supprimer ?',
        options: ['Caroline Merlin — Client', 'Julien Merlin — Huissier'],
        optionIds: ['uuid-1', 'uuid-2']
      },
      originalCommand: 'supprimer merlin',
      lastContext: { dossierId: 'd1' }
    })

    await useAiStore.getState().resolveClarification('Julien Merlin — Huissier')

    expect(executeCommand).toHaveBeenCalledWith({
      command: 'supprimer merlin — specifically: Julien Merlin — Huissier (id: uuid-2)',
      context: { dossierId: 'd1' },
      model: undefined
    })
  })

  it('stores reflection events as deduplicated ephemeral messages', () => {
    type ReflectionEvent = { text: string; conversationId?: string }
    let reflectionListener: ((event: ReflectionEvent) => void) | null = null
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        onReflection: vi.fn((listener: (event: ReflectionEvent) => void) => {
          reflectionListener = listener
          return () => {
            reflectionListener = null
          }
        })
      }
    } as unknown as OrdicabAPI

    const unsubscribe = useAiStore.getState().subscribeToReflections()
    expect(reflectionListener).toBeTruthy()
    const emitReflection = (text: string, conversationId?: string): void => {
      if (!reflectionListener) {
        throw new Error('Expected onReflection listener to be registered')
      }
      reflectionListener({ text, conversationId })
    }
    emitReflection('  étape 1  ')
    emitReflection('étape 1')
    emitReflection('étape 2')
    // Scoped drafting-session reflections never reach the global chat
    emitReflection('étape rédaction', 'redaction:dossier-1:abc12345')

    expect(useAiStore.getState().reflections).toEqual([
      { id: expect.any(String), text: 'étape 1' },
      { id: expect.any(String), text: 'étape 2' }
    ])

    unsubscribe()
  })

  it('setActiveDossierId resets the conversation when switching to a different dossier', async () => {
    const resetConversation = vi.fn(async () => ({ success: true as const, data: null }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { resetConversation }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      activeDossierId: 'd1',
      messages: [{ id: 'm1', role: 'user', text: 'Bonjour' }],
      lastContext: { dossierId: 'd1' }
    })

    useAiStore.getState().setActiveDossierId('d2')

    // Active dossier + context update synchronously…
    expect(useAiStore.getState().activeDossierId).toBe('d2')
    expect(useAiStore.getState().lastContext.dossierId).toBe('d2')

    // …and the stale conversation is cleared (async, via the main-process reset).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resetConversation).toHaveBeenCalledTimes(1)
    expect(useAiStore.getState().messages).toEqual([])
    expect(useAiStore.getState().lastContext.dossierId).toBe('d2')
  })

  it('setActiveDossierId does not reset when there is no existing conversation', async () => {
    const resetConversation = vi.fn(async () => ({ success: true as const, data: null }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { resetConversation }
    } as unknown as OrdicabAPI

    useAiStore.setState({ activeDossierId: null, messages: [] })

    useAiStore.getState().setActiveDossierId('d1')

    expect(useAiStore.getState().activeDossierId).toBe('d1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resetConversation).not.toHaveBeenCalled()
  })

  it('setActiveDossierId is a no-op when the dossier id does not change', async () => {
    const resetConversation = vi.fn(async () => ({ success: true as const, data: null }))
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { resetConversation }
    } as unknown as OrdicabAPI

    useAiStore.setState({
      activeDossierId: 'd1',
      messages: [{ id: 'm1', role: 'user', text: 'Bonjour' }]
    })

    useAiStore.getState().setActiveDossierId('d1')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resetConversation).not.toHaveBeenCalled()
    expect(useAiStore.getState().messages).toHaveLength(1)
  })
})
