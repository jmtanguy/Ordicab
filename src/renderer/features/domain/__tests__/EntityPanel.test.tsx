// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import type { OrdicabAPI } from '@shared/types'
import { createRendererI18n } from '@renderer/i18n'
import { ToastProvider } from '@renderer/contexts/ToastContext'
import { useEntityStore } from '@renderer/stores'

import { EntityPanel } from '../EntityPanel'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useEntityStore.setState(useEntityStore.getInitialState(), true)
  delete (globalThis as MutableGlobal).ordicabAPI
})

async function renderPanel(): Promise<void> {
  const i18n = await createRendererI18n('en')

  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <EntityPanel />
      </ToastProvider>
    </I18nextProvider>
  )
}

async function openEditor(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: 'My entity' })).toBeTruthy()
  })
}

describe('EntityPanel', () => {
  it('blocks submit and shows the required error when firm name is empty', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get: vi.fn(async () => ({ success: true as const, data: null })),
        update: vi.fn()
      }
    } as unknown as OrdicabAPI

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Start by adding your firm details once.')).toBeTruthy()
    })

    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save entity' }))

    await waitFor(() => {
      expect(screen.getByText('This field is required.')).toBeTruthy()
    })
  })

  it('pre-fills the form with the saved entity profile on load', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get: vi.fn(async () => ({
          success: true as const,
          data: {
            firmName: 'Cabinet Martin',
            address: '12 rue de la Paix, 75001 Paris',
            vatNumber: 'FR12345678901',
            phone: '+33 1 02 03 04 05',
            email: 'contact@example.com'
          }
        })),
        update: vi.fn()
      }
    } as unknown as OrdicabAPI

    await renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Cabinet Martin')).toBeTruthy()
    })

    await openEditor()
    await waitFor(() => {
      expect((screen.getByLabelText('Firm name') as HTMLInputElement).value).toBe('Cabinet Martin')
    })

    expect((screen.getByLabelText('VAT number') as HTMLInputElement).value).toBe('FR12345678901')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('contact@example.com')
  })

  it('saves the entity profile and shows a success toast', async () => {
    const update = vi.fn(async (input) => ({
      success: true as const,
      data: input
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get: vi.fn(async () => ({ success: true as const, data: null })),
        update
      }
    } as unknown as OrdicabAPI

    await renderPanel()

    await openEditor()
    await waitFor(() => {
      expect(screen.getByLabelText('Firm name')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Firm name'), {
      target: { value: 'Cabinet Martin' }
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'contact@example.com' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save entity' }))

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          firmName: 'Cabinet Martin',
          email: 'contact@example.com'
        })
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('region').textContent).toContain('Entity saved.')
    })
  })

  it('adds a managed field row in the visible table', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get: vi.fn(async () => ({ success: true as const, data: null })),
        update: vi.fn()
      }
    } as unknown as OrdicabAPI

    await renderPanel()
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Managed contact fields' }))

    expect(screen.queryAllByPlaceholderText('Libellé')).toHaveLength(7)

    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))

    await waitFor(() => {
      expect(screen.queryAllByPlaceholderText('Libellé')).toHaveLength(8)
    })
  })

  it('persists managed field deletion instead of restoring defaults on reopen', async () => {
    let savedProfile: Record<string, unknown> | null = {
      firmName: 'Cabinet Martin',
      managedFields: {
        contacts: [
          { label: "Prénoms complémentaires de l'état civil", type: 'text' },
          { label: 'Nom de jeune fille', type: 'text' },
          { label: 'Date de naissance', type: 'date' },
          { label: 'Nationalité', type: 'text' },
          { label: 'Pays de naissance', type: 'text' },
          { label: 'Profession', type: 'text' },
          { label: 'N° sécurité sociale', type: 'text' }
        ]
      }
    }

    const get = vi.fn(async () => ({ success: true as const, data: savedProfile }))
    const update = vi.fn(async (input) => {
      savedProfile = input as Record<string, unknown>
      return { success: true as const, data: input }
    })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      entity: {
        get,
        update
      }
    } as unknown as OrdicabAPI

    await renderPanel()
    await waitFor(() => {
      expect(screen.getByText('Cabinet Martin')).toBeTruthy()
    })

    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Managed contact fields' }))

    expect(screen.queryAllByPlaceholderText('Libellé')).toHaveLength(7)

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    expect(screen.queryAllByPlaceholderText('Libellé')).toHaveLength(6)

    fireEvent.click(screen.getByRole('button', { name: 'Save entity' }))

    await waitFor(() => {
      expect(update).toHaveBeenCalled()
    })

    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Managed contact fields' }))

    expect(screen.queryAllByPlaceholderText('Libellé')).toHaveLength(6)
  })
})
