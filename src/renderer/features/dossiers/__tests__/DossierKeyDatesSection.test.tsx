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
  it('pre-fills the editor date with the local format when editing', async () => {
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

    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('01/04/2026')
  })

  it('normalizes a local date to ISO before saving', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une date clé' }))
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Audience' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '01/04/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la date clé' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        dossierId: 'dos-1',
        id: undefined,
        label: 'Audience',
        date: '2026-04-01',
        note: undefined
      })
    })
  })

  it('blocks invalid local dates and shows an inline error', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une date clé' }))
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Audience' } })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '31/31/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la date clé' }))

    await waitFor(() => {
      expect(screen.getByText('Saisissez une date valide.')).toBeTruthy()
    })

    expect(onSave).not.toHaveBeenCalled()
  })
})
