// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { useCabinetBillingStore, useDossierStore } from '@renderer/stores'
import { useTimerStore } from '@renderer/stores/timerStore'
import type {
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierDetail,
  DossierFeeAgreement
} from '@shared/types'

import { DossierBillingItemsSection } from '../DossierBillingItemsSection'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
  useCabinetBillingStore.setState(useCabinetBillingStore.getInitialState(), true)
  useTimerStore.setState({ timer: null })
  useDossierStore.setState({ activeDossier: null })
})

function createBillingItem(overrides: Partial<DossierBillingItem> = {}): DossierBillingItem {
  return {
    uuid: 'bi-1',
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

    expect(onDelete).toHaveBeenCalledWith({ dossierId: 'dos-1', billingItemUuid: 'bi-1' })
  })

  it('stops the timer into a prefilled billing item editor', async () => {
    useDossierStore.setState({
      activeDossier: createDossierDetail({
        feeAgreements: [createFeeAgreement({ isActive: true, hourlyRateHtCents: 25_000 })]
      })
    })

    await renderSection({ entries: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Démarrer le chrono' }))

    const timer = useTimerStore.getState().timer
    expect(timer?.dossierId).toBe('dos-1')
    expect(timer?.dossierName).toBe('Dupont c/ Martin')

    // Backdate the start so the stop yields a known elapsed time:
    // 90 min + 1 s rounds up to 91 min → 91 / 60 = 1.52 h (2 decimals).
    useTimerStore.setState({
      timer: { ...timer!, startedAtMs: Date.now() - (90 * 60_000 + 1_000) }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Arrêter et facturer' }))

    expect(useTimerStore.getState().timer).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Prestation' })).toBeTruthy()
    expect((screen.getByLabelText('Quantité') as HTMLInputElement).value).toBe('1.52')
    expect((screen.getByLabelText('PU HT (€)') as HTMLInputElement).value).toBe('250.00')
    expect((screen.getByLabelText('Unité') as HTMLSelectElement).value).toBe('hours')
  })

  it('discards the timer without opening the editor', async () => {
    await renderSection({ entries: [] })

    fireEvent.click(screen.getByRole('button', { name: 'Démarrer le chrono' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abandonner le chrono' }))

    expect(useTimerStore.getState().timer).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Prestation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Démarrer le chrono' })).toBeTruthy()
  })
})

function createFeeAgreement(overrides: Partial<DossierFeeAgreement> = {}): DossierFeeAgreement {
  return {
    uuid: 'fa-1',
    createdAt: '2026-04-01T09:00:00.000Z',
    updatedAt: '2026-04-01T09:00:00.000Z',
    isActive: true,
    status: 'signed',
    matterLabel: 'Contentieux',
    scopeDescription: 'Procédure complète',
    billingType: 'hourly',
    hourlyRateHtCents: 25_000,
    vatRateBasisPoints: 2000,
    ...overrides
  }
}

function createDossierDetail(overrides: Partial<DossierDetail> = {}): DossierDetail {
  return {
    slug: 'dos-1',
    uuid: 'uuid-dos-1',
    name: 'Dupont c/ Martin',
    type: 'civil',
    status: 'active',
    updatedAt: '2026-04-01T09:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    registeredAt: '2026-04-01',
    feeAgreements: [],
    billingItems: [],
    keyDates: [],
    keyReferences: [],
    notes: [],
    ...overrides
  }
}
