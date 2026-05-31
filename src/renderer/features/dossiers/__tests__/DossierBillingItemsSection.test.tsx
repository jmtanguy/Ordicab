// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { useCabinetBillingStore } from '@renderer/stores'
import type { DossierBillingItem, DossierBillingItemDeleteInput } from '@shared/types'

import { DossierBillingItemsSection } from '../DossierBillingItemsSection'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useCabinetBillingStore.setState(useCabinetBillingStore.getInitialState(), true)
})

function createBillingItem(overrides: Partial<DossierBillingItem> = {}): DossierBillingItem {
  return {
    id: 'bi-1',
    dossierId: 'dos-1',
    date: '2026-04-01',
    label: 'Provision',
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents: 25_000,
    subtotalHtCents: 25_000,
    discountHtCents: 0,
    totalHtCents: 25_000,
    vatRateBasisPoints: 2000,
    totalTtcCents: 30_000,
    status: 'draft',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    ...overrides
  }
}

async function renderSection(options: {
  entries: DossierBillingItem[]
  onDelete?: (input: DossierBillingItemDeleteInput) => Promise<boolean>
}): Promise<void> {
  const i18n = await createRendererI18n('fr')
  render(
    <I18nextProvider i18n={i18n}>
      <DossierBillingItemsSection
        dossierId="dos-1"
        entries={options.entries}
        disabled={false}
        onSave={vi.fn(async () => true)}
        onDelete={options.onDelete ?? vi.fn(async () => true)}
      />
    </I18nextProvider>
  )
}

describe('DossierBillingItemsSection', () => {
  it('opens the billing item dialog with the essential fields', async () => {
    await renderSection({ entries: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle prestation' }))

    expect(screen.getByRole('dialog', { name: 'Prestation' })).toBeTruthy()
    expect(screen.getByText('Prestation cabinet')).toBeTruthy()
    expect(screen.getByLabelText('Libellé')).toBeTruthy()
    expect(screen.getByLabelText('Quantité')).toBeTruthy()
    expect(screen.getByLabelText('PU HT (€)')).toBeTruthy()
    expect(screen.getByLabelText('TVA (%)')).toBeTruthy()
    expect(screen.getByLabelText('Date')).toBeTruthy()
    expect(screen.getByLabelText('Statut')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeTruthy()
  })

  it('confirms before deleting a billing item from the row action', async () => {
    const onDelete = vi.fn(async () => true)

    await renderSection({
      entries: [createBillingItem()],
      onDelete
    })

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))

    expect(screen.getByText('Supprimer cette prestation ?')).toBeTruthy()
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(onDelete).toHaveBeenCalledWith({ dossierId: 'dos-1', billingItemId: 'bi-1' })
  })
})
