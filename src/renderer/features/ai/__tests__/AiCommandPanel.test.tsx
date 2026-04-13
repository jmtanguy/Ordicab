// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import type { AiMode } from '@shared/types'

import { AiCommandPanel } from '../AiCommandPanel'

// Mock the aiStore
const mockStore = {
  settings: { mode: 'local' as AiMode, hasApiKey: false },
  commandLoading: false,
  commandFeedback: null as string | null,
  commandError: null as string | null,
  lastIntent: null as { type: string } | null,
  pendingClarification: null as { question: string; options: string[] } | null,
  executeCommand: vi.fn(),
  resolveClarification: vi.fn(),
  subscribeToIntentEvents: vi.fn().mockReturnValue(() => undefined)
}

vi.mock('@renderer/stores/aiStore', () => ({
  useAiStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore)
}))

describe('AiCommandPanel', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    mockStore.settings = { mode: 'local' as AiMode, hasApiKey: false }
    mockStore.commandLoading = false
    mockStore.commandFeedback = null
    mockStore.commandError = null
    mockStore.lastIntent = null
    mockStore.pendingClarification = null
    mockStore.executeCommand.mockClear()
    mockStore.resolveClarification.mockClear()
  })

  it('renders textarea and send button in local mode', () => {
    render(<AiCommandPanel />)
    expect(screen.getByPlaceholderText('ai.panel.placeholder')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ai.panel.send' })).toBeTruthy()
  })

  it('shows configure message when mode is none', () => {
    mockStore.settings = { mode: 'none' as AiMode, hasApiKey: false }
    render(<AiCommandPanel />)
    expect(screen.getByText('ai.panel.configure_message')).toBeTruthy()
  })

  it('shows cloud mode message for claude-code mode', () => {
    mockStore.settings = { mode: 'claude-code' as AiMode, hasApiKey: false }
    render(<AiCommandPanel />)
    expect(screen.getByText('ai.panel.cloud_mode_message')).toBeTruthy()
  })

  it('calls executeCommand on form submit', async () => {
    render(<AiCommandPanel />)
    const textarea = screen.getByPlaceholderText('ai.panel.placeholder')
    fireEvent.change(textarea, { target: { value: 'Find Contact Exemple' } })
    fireEvent.submit(textarea.closest('form')!)
    await waitFor(() => {
      expect(mockStore.executeCommand).toHaveBeenCalledWith('Find Contact Exemple', undefined)
    })
  })

  it('disables send button when loading', () => {
    mockStore.commandLoading = true
    render(<AiCommandPanel />)
    const btn = screen.getByRole('button', { name: '...' })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('displays command feedback', () => {
    mockStore.commandFeedback = 'Found 3 contacts.'
    mockStore.lastIntent = { type: 'contact_lookup' }
    render(<AiCommandPanel />)
    expect(screen.getByText('Found 3 contacts.')).toBeTruthy()
  })

  it('displays error feedback', () => {
    mockStore.commandError = 'AI runtime unavailable.'
    render(<AiCommandPanel />)
    expect(screen.getByText('AI runtime unavailable.')).toBeTruthy()
  })

  it('renders clarification options and calls resolveClarification on click', async () => {
    mockStore.pendingClarification = {
      question: 'Which contact?',
      options: ['Contact Exemple A', 'Contact Exemple B']
    }
    render(<AiCommandPanel />)
    expect(screen.getByText('Which contact?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Contact Exemple A' }))
    await waitFor(() => {
      expect(mockStore.resolveClarification).toHaveBeenCalledWith('Contact Exemple A')
    })
  })

  it('shows command hints below unknown intent feedback', () => {
    mockStore.lastIntent = { type: 'unknown' }
    mockStore.commandFeedback = "I couldn't understand that."
    render(<AiCommandPanel />)
    expect(screen.getByText('ai.panel.command_hints')).toBeTruthy()
  })
})
