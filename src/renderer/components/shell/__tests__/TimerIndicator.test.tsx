// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { useTimerStore } from '@renderer/stores/timerStore'

import { TimerIndicator } from '../TimerIndicator'

afterEach(() => {
  cleanup()
  useTimerStore.setState({ timer: null })
})

async function renderIndicator(onOpen = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
  const i18n = await createRendererI18n('en')
  render(
    <I18nextProvider i18n={i18n}>
      <TimerIndicator onOpen={onOpen} />
    </I18nextProvider>
  )
  return onOpen
}

describe('TimerIndicator', () => {
  it('renders nothing when no timer is running', async () => {
    await renderIndicator()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the dossier name and opens it on click', async () => {
    useTimerStore.setState({
      timer: {
        dossierId: 'dos-1',
        dossierName: 'Dupont c/ Martin',
        startedAtMs: Date.now() - 65_000,
        pausedAccumulatedMs: 0,
        isPaused: false
      }
    })

    const onOpen = await renderIndicator()

    expect(screen.getByText('Dupont c/ Martin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Timer running' }))
    expect(onOpen).toHaveBeenCalledWith('dos-1')
  })

  it('shows the paused state', async () => {
    useTimerStore.setState({
      timer: {
        dossierId: 'dos-1',
        dossierName: 'Dupont c/ Martin',
        startedAtMs: Date.now(),
        pausedAccumulatedMs: 30_000,
        isPaused: true
      }
    })

    await renderIndicator()

    expect(screen.getByText('Paused')).toBeTruthy()
  })
})
