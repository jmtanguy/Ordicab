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
          uuid: 'kd-1',
          dossierId: 'dos-1',
          label: 'Audience',
          date: '2026-04-01',
          note: 'Pièces à préparer'
        }
      ]
    })

    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }))

    expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-04-01')
  })

  it('saves the ISO date directly when the form is submitted', async () => {
    const onSave = vi.fn(async () => true)
    await renderSection({ onSave })

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))
    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: 'Audience' } })
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-04-01' } })
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
      expect(screen.getByLabelText(/^Libellé/)).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: 'Audience' } })
    // leave date empty — submit the form directly to bypass native date validation
    const form = screen.getByRole('dialog').querySelector('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText('Saisissez une date valide.')).toBeTruthy()
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  describe('procedural deadline helper', () => {
    it('computes the deadline, fills the date and suggests the label', async () => {
      await renderSection()

      fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))
      // Le point de départ est présent mais désactivé tant qu'aucun délai n'est choisi.
      expect((screen.getByLabelText('Point de départ') as HTMLInputElement).disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Délai de procédure'), {
        target: { value: 'appel' }
      })
      fireEvent.change(screen.getByLabelText('Point de départ'), {
        target: { value: '2026-06-10' }
      })

      // 10 juin + 1 mois (art. 641) → vendredi 10 juillet, sans prorogation
      expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-07-10')
      expect((screen.getByLabelText(/^Libellé/) as HTMLInputElement).value).toBe(
        "Expiration délai — Appel d'un jugement contradictoire (art. 538 CPC)"
      )
      expect(screen.getByText(/art\. 538 CPC\)$/)).toBeTruthy()
      expect(screen.queryByText(/ajustée au premier jour ouvrable/)).toBeNull()
    })

    it('shows the working-day adjustment note when the deadline is postponed', async () => {
      await renderSection()

      fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))
      fireEvent.change(screen.getByLabelText('Délai de procédure'), {
        target: { value: 'appel' }
      })
      fireEvent.change(screen.getByLabelText('Point de départ'), {
        target: { value: '2026-01-15' }
      })

      // 15 février 2026 (dimanche) → lundi 16 février (art. 642)
      expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-02-16')
      expect(screen.getByText(/ajustée au premier jour ouvrable \(week-end/)).toBeTruthy()
    })

    it('keeps a manually entered label and lets the user edit the computed date', async () => {
      await renderSection()

      fireEvent.click(screen.getByRole('button', { name: 'Ajouter un événement' }))
      fireEvent.change(screen.getByLabelText(/^Libellé/), { target: { value: 'Audience' } })
      fireEvent.change(screen.getByLabelText('Délai de procédure'), {
        target: { value: 'pourvoi-cassation' }
      })
      fireEvent.change(screen.getByLabelText('Point de départ'), {
        target: { value: '2026-06-10' }
      })

      expect((screen.getByLabelText(/^Libellé/) as HTMLInputElement).value).toBe('Audience')
      expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-08-10')

      // L'édition manuelle de la date reprend la main et efface la note de calcul.
      fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-08-12' } })
      expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-08-12')
      expect(screen.queryByText(/Échéance calculée/)).toBeNull()
      expect((screen.getByLabelText('Délai de procédure') as HTMLSelectElement).value).toBe('')
    })
  })
})
