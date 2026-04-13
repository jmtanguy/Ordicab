// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'

import { DelegatedReference } from '../DelegatedReference'

const writeText = vi.fn(async () => undefined)

beforeEach(() => {
  writeText.mockClear()
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function renderReference(props?: {
  entityName?: string | null
  sampleDossierName?: string | null
}): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <DelegatedReference
        entityName={props?.entityName === undefined ? 'Test Entity' : props.entityName}
        sampleDossierName={
          props?.sampleDossierName === undefined ? 'Test Dossier' : props.sampleDossierName
        }
      />
    </I18nextProvider>
  )
}

describe('DelegatedReference', () => {
  it('renders all operations with domain context, shows placeholders when no context, copies prompt, and handles clipboard rejection', async () => {
    // with context
    await renderReference()
    expect(screen.getByRole('heading', { name: 'AI Reference' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Dossier Bulk Setup',
      'Add or Update Contact',
      'Extract Key Dates',
      'Add Key Reference',
      'Update Firm Profile',
      'Tag Documents',
      'Annotate Documents',
      'Add or Update Template',
      'Generate Document'
    ])
    expect(screen.getByText(/set up dossier 'Test Dossier'/i)).toBeTruthy()
    expect(screen.getByText(/entity profile for 'Test Entity'/i)).toBeTruthy()
    cleanup()

    // no context -> placeholders
    await renderReference({ entityName: null, sampleDossierName: null })
    expect(screen.getByText('Configure a domain to see context-aware prompts.')).toBeTruthy()
    expect(screen.getAllByText(/\[your dossier name\]/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/\[firm name\]/).length).toBeGreaterThan(0)
    cleanup()

    // clipboard rejection: no throw
    writeText.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    await renderReference()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Dossier Bulk Setup prompt' }))
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('button', { name: /copy dossier bulk setup prompt/i }).length).toBe(
      1
    )
    cleanup()
    writeText.mockClear()

    // copy success
    vi.useFakeTimers()
    await renderReference()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Dossier Bulk Setup prompt' }))
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String((writeText.mock.calls as unknown[][])[0]?.[0] ?? '')).toContain(
      "Set up dossier 'Test Dossier'"
    )
  })
})
