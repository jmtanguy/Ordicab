// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'

import { DossierKeyDatesSection } from '../DossierKeyDatesSection'

afterEach(() => {
  cleanup()
})

async function renderSection(
  options: {
    entries?: React.ComponentProps<typeof DossierKeyDatesSection>['entries']
    onSave?: React.ComponentProps<typeof DossierKeyDatesSection>['onSave']
    onDelete?: React.ComponentProps<typeof DossierKeyDatesSection>['onDelete']
    locale?: 'fr' | 'en'
  } = {}
): Promise<void> {
  const i18n = await createRendererI18n(options.locale ?? 'fr')

  render(
    <I18nextProvider i18n={i18n}>
      <DossierKeyDatesSection
        dossierId="dos-1"
        dossierName="Client Alpha"
        entries={options.entries ?? []}
        disabled={false}
        onSave={options.onSave ?? vi.fn(async () => true)}
        onDelete={options.onDelete ?? vi.fn(async () => true)}
      />
    </I18nextProvider>
  )
}

describe('DossierKeyDatesSection', () => {
  it('pre-fills the editor date with the ISO value when editing', async () => {
    await renderSection({
      entries: [
        {
          id: 'kd-1',
          dossierId: 'dos-1',
          label: 'Audience',
          date: '2026-04-01',
          note: 'Pièces à préparer'
        }
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))

    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-04-01')
  })

  it('saves the ISO date directly when the form is submitted', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Audience' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-04-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          dossierId: 'dos-1',
          label: 'Audience',
          date: '2026-04-01'
        })
      )
    })
  })

  it('shows an inline error and does not save when date is empty', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Libellé')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Audience' } })
    // leave date empty — submit the form directly to bypass native date validation
    const form = screen.getByRole('dialog').querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('Saisissez une date valide.')).toBeTruthy()
    })

    expect(onSave).not.toHaveBeenCalled()
  })
})
