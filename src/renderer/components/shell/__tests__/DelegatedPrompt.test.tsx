// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'

import { DelegatedPrompt } from '../DelegatedPrompt'

const writeText = vi.fn(async () => undefined)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText
    }
  })
})

async function renderPrompt(): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <DelegatedPrompt prompt="In dossier 'Client Alpha', add the following contacts:\n[paste contact details here]" />
    </I18nextProvider>
  )
}

describe('DelegatedPrompt', () => {
  it('expands and collapses the prompt body', async () => {
    await renderPrompt()

    const toggle = screen.getByRole('button', { name: 'Toggle Add via AI section' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/\[paste contact details here\]/)).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/\[paste contact details here\]/)).toBeTruthy()

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('renders accessible toggle and copy buttons for keyboard users', async () => {
    await renderPrompt()

    const toggle = screen.getByRole('button', { name: 'Toggle Add via AI section' })
    expect(toggle.tabIndex).toBe(0)

    fireEvent.click(toggle)

    const copyButton = screen.getByRole('button', { name: 'Copy prompt' })
    expect(copyButton.tabIndex).toBe(0)
  })

  it('copies the prompt and resets the confirmation state after 1.5 seconds', async () => {
    await renderPrompt()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Add via AI section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))

    await Promise.resolve()
    const copiedText = String((writeText.mock.calls as unknown[][])[0]?.[0] ?? '')

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copiedText).toContain("In dossier 'Client Alpha', add the following contacts:")
    expect(copiedText).toContain('[paste contact details here]')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeTruthy()
    })

    await new Promise((resolve) => setTimeout(resolve, 1600))

    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeTruthy()
  })
})
