// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { IpcErrorCode, type OrdicabAPI } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'

import { useAiStore } from '@renderer/stores/aiStore'
import { AiSettings } from '../AiSettings'

type MutableGlobal = typeof globalThis & { ordicabAPI?: Partial<OrdicabAPI> }

/** No-op stubs for OrdicabAPI.ai methods not under test */
const aiStubs = {
  deleteApiKey: vi.fn(async () => ({ success: true as const, data: null })),
  cloudProviderStatus: vi.fn(async () => ({ success: true as const, data: { available: true } })),
  executeCommand: vi.fn(async () => ({
    success: true as const,
    data: { intent: { type: 'unknown' as const, message: '' }, feedback: '' }
  })),
  cancelCommand: vi.fn(async () => ({ success: true as const, data: null })),
  resetConversation: vi.fn(async () => ({ success: true as const, data: null })),
  onIntentReceived: vi.fn(() => () => undefined),
  onTextToken: vi.fn(() => () => undefined),
  remoteConnectionStatus: vi.fn(async () => ({
    success: true as const,
    data: { reachable: false }
  }))
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useAiStore.setState(useAiStore.getInitialState(), true)
  delete (globalThis as MutableGlobal).ordicabAPI
})

async function renderPanel(): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <AiSettings />
    </I18nextProvider>
  )
}

describe('AiSettings', () => {
  it('shows first-run onboarding when settings are null, and hides it when settings exist', async () => {
    // null settings -> show onboarding
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({
          success: false as const,
          error: 'no config',
          code: IpcErrorCode.NOT_FOUND
        })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(async () => ({
          success: false as const,
          error: 'unreachable',
          code: IpcErrorCode.OLLAMA_UNREACHABLE
        }))
      }
    }

    await renderPanel()

    await waitFor(() => {
      expect(screen.queryByText(/Set up your local AI model/)).toBeTruthy()
    })
    cleanup()
    useAiStore.setState(useAiStore.getInitialState(), true)

    // existing settings -> no onboarding
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({
          success: true as const,
          data: {
            mode: 'local' as const,
            ollamaEndpoint: 'http://localhost:11434',
            hasApiKey: false
          }
        })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(async () => ({
          success: true as const,
          data: { reachable: true, models: ['llama3'] }
        }))
      }
    }

    await renderPanel()

    await waitFor(() => {
      expect(screen.queryByText(/Set up your local AI model/)).toBeNull()
    })
  })

  it('Remote API mode shows privacy warning; cancelling keeps Local mode', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({
          success: true as const,
          data: {
            mode: 'local' as const,
            ollamaEndpoint: 'http://localhost:11434',
            hasApiKey: false
          }
        })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(async () => ({
          success: true as const,
          data: { reachable: true, models: ['llama3'] }
        }))
      }
    }

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(screen.getByText('External API (API key)')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('External API (API key)'))

    await waitFor(() => {
      expect(screen.getByText('Remote API Warning')).toBeTruthy()
    })

    // Cancel keeps local mode
    const cancelButtons = screen.getAllByText('Cancel')
    fireEvent.click(cancelButtons[cancelButtons.length - 1])

    await waitFor(() => {
      expect(screen.queryByText('Remote API Warning')).toBeNull()
    })
    expect(useAiStore.getState().privacyWarningPending).toBe(false)
  })

  it('save button calls saveSettings', async () => {
    const saveSettings = vi.fn(async () => ({ success: true as const, data: null }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: { mode: 'local' as const, ollamaEndpoint: 'http://localhost:11434', hasApiKey: false }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings,
        saveSettings,
        connectionStatus: vi.fn(async () => ({
          success: true as const,
          data: { reachable: true, models: [] }
        }))
      }
    }

    await renderPanel()
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Edit'))
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledTimes(1)
    })
  })

  it('check connection button calls checkConnection and updates connection status', async () => {
    const connectionStatus = vi.fn(async () => ({
      success: true as const,
      data: { reachable: true, models: ['llama3'] }
    }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: { mode: 'local' as const, ollamaEndpoint: 'http://localhost:11434', hasApiKey: false }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: { ...aiStubs, getSettings, saveSettings: vi.fn(), connectionStatus }
    }

    await renderPanel()
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Edit'))
    await waitFor(() => {
      expect(screen.getByText('Check Connection')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Check Connection'))
    await waitFor(() => {
      expect(useAiStore.getState().connectionStatus).toBe('connected')
    })
  })

  it('Clear API key button is visible in remote mode and clicking it calls deleteApiKey', async () => {
    const deleteApiKey = vi.fn(async () => ({ success: true as const, data: null }))
    const getSettings = vi.fn(async () => ({
      success: true as const,
      data: {
        mode: 'remote' as const,
        remoteProvider: 'openai',
        hasApiKey: true,
        apiKeySuffix: '1234'
      }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings,
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(async () => ({
          success: true as const,
          data: { reachable: true, models: [] }
        })),
        deleteApiKey
      }
    }

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(screen.getByText('Clear API Key')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('Clear API Key'))
    await waitFor(() => {
      expect(deleteApiKey).toHaveBeenCalledTimes(1)
    })
  })

  it('cloud mode dialog shows Ready or warning based on availability, and auto-checks when null', async () => {
    // available -> Ready badge
    const cloudAvailableSettings = { mode: 'claude-code' as const, hasApiKey: false }
    useAiStore.setState({
      settings: cloudAvailableSettings,
      cloudAvailability: { available: true }
    })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({ success: true as const, data: cloudAvailableSettings })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(),
        cloudProviderStatus: vi.fn(async () => ({
          success: true as const,
          data: { available: true }
        }))
      }
    }

    await renderPanel()
    fireEvent.click(screen.getByText('Edit'))
    await waitFor(() => {
      expect(screen.getAllByText(/Ready/).length).toBeGreaterThan(0)
      expect(screen.getByText(/CLAUDE\.md/)).toBeTruthy()
    })
    cleanup()
    useAiStore.setState(useAiStore.getInitialState(), true)

    // unavailable -> warning
    const cloudSettings2 = { mode: 'claude-code' as const, hasApiKey: false }
    useAiStore.setState({
      settings: cloudSettings2,
      cloudAvailability: { available: false, reason: 'Claude CLI not found' }
    })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({ success: true as const, data: cloudSettings2 })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(),
        cloudProviderStatus: vi.fn(async () => ({
          success: true as const,
          data: { available: false, reason: 'Claude CLI not found' }
        }))
      }
    }
    await renderPanel()
    fireEvent.click(screen.getByText('Edit'))
    await waitFor(() => {
      expect(screen.getAllByText(/Claude CLI not found/).length).toBeGreaterThan(0)
    })
    cleanup()
    useAiStore.setState(useAiStore.getInitialState(), true)

    // null cloudAvailability -> auto-check
    const cloudProviderStatus = vi.fn(async () => ({
      success: true as const,
      data: { available: true }
    }))
    const cloudSettings3 = { mode: 'claude-code' as const, hasApiKey: false }
    useAiStore.setState({ settings: cloudSettings3, cloudAvailability: null })
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({ success: true as const, data: cloudSettings3 })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(),
        cloudProviderStatus
      }
    }
    await renderPanel()
    fireEvent.click(screen.getByText('Edit'))
    await waitFor(() => {
      expect(cloudProviderStatus).toHaveBeenCalledWith('claude-code')
    })
  })

  it('remote API error is displayed in the dialog when remoteApiError is set', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      ai: {
        ...aiStubs,
        getSettings: vi.fn(async () => ({
          success: true as const,
          data: {
            mode: 'remote' as const,
            remoteProvider: 'openai',
            hasApiKey: true,
            apiKeySuffix: '5678'
          }
        })),
        saveSettings: vi.fn(),
        connectionStatus: vi.fn(async () => ({
          success: true as const,
          data: { reachable: true, models: [] }
        })),
        deleteApiKey: vi.fn()
      }
    }

    useAiStore.setState({
      remoteApiError: { type: 'auth_error', message: 'API key invalid or unauthorized' }
    })

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeTruthy()
    })
    fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(screen.getByText('API key invalid or unauthorized')).toBeTruthy()
    })
  })
})
