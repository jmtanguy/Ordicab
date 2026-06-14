// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import { createRendererI18n } from '@renderer/i18n'
import { useCabinetBillingStore, useTemplateStore } from '@renderer/stores'
import type {
  DossierBillingItem,
  DossierFeeAgreement,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementUpsertInput,
  SourceFeeAgreementBillingKind
} from '@shared/types'

import { DossierFeeAgreementSection } from '../DossierFeeAgreementSection'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  useCabinetBillingStore.setState(useCabinetBillingStore.getInitialState(), true)
  useTemplateStore.setState(useTemplateStore.getInitialState(), true)
})

function createAgreement(overrides: Partial<DossierFeeAgreement> = {}): DossierFeeAgreement {
  return {
    uuid: 'fa-1',
    createdAt: '2026-03-13T08:30:00.000Z',
    updatedAt: '2026-03-13T08:30:00.000Z',
    isActive: true,
    status: 'draft',
    matterLabel: 'Convention test',
    scopeDescription: 'Phase 1 du dossier',
    billingType: 'flat',
    flatFeeHtCents: 100_000,
    vatRateBasisPoints: 2000,
    ...overrides
  }
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s/g, ' ') ?? ''
}

async function renderSection(options: {
  feeAgreements: DossierFeeAgreement[]
  billingItems?: DossierBillingItem[]
  onSave?: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  onDelete?: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  onConvertToBillingItem?: (
    agreement: DossierFeeAgreement,
    conversionKind: SourceFeeAgreementBillingKind
  ) => void
}): Promise<void> {
  const i18n = await createRendererI18n('fr')
  render(
    <I18nextProvider i18n={i18n}>
      <DossierFeeAgreementSection
        dossierId="dos-1"
        dossierName="Client Alpha"
        feeAgreements={options.feeAgreements}
        billingItems={options.billingItems ?? []}
        documents={[]}
        contacts={[]}
        disabled={false}
        onSave={options.onSave ?? vi.fn(async () => true)}
        onDelete={options.onDelete ?? vi.fn(async () => true)}
        onArchive={vi.fn(async () => true)}
        onSetActive={vi.fn(async () => true)}
        onConvertToBillingItem={options.onConvertToBillingItem}
      />
    </I18nextProvider>
  )
}

describe('DossierFeeAgreementSection — commercial discount', () => {
  it('shows a percentage discount on the agreement card', async () => {
    await renderSection({
      feeAgreements: [
        createAgreement({
          discountKind: 'percent',
          discountPercentBasisPoints: 1250
        })
      ]
    })

    expect(screen.getByText('Remise commerciale')).toBeTruthy()
    expect(screen.getByText(/de remise/)).toBeTruthy()

    const text = normalizeText(document.body.textContent)
    expect(text).toContain('875,00 €')
    expect(text).toContain('1 000,00 €')
    expect(text).toContain('1 050,00 €')
    expect(text).toContain('1 200,00 €')

    const struckAmounts = Array.from(document.querySelectorAll('.line-through')).map((entry) =>
      normalizeText(entry.textContent)
    )
    expect(struckAmounts).toContain('1 000,00 €')
    expect(struckAmounts).toContain('1 200,00 €')
  })

  it('shows a fixed amount discount on the agreement card', async () => {
    await renderSection({
      feeAgreements: [
        createAgreement({
          discountKind: 'amount',
          discountAmountHtCents: 12_500
        })
      ]
    })

    expect(screen.getByText('Remise commerciale')).toBeTruthy()
    expect(screen.getByText(/de remise/)).toBeTruthy()

    const text = normalizeText(document.body.textContent)
    expect(text).toContain('875,00 €')
    expect(text).toContain('1 050,00 €')
  })

  it('does not render the discount row when none is configured', async () => {
    await renderSection({
      feeAgreements: [createAgreement()]
    })

    expect(screen.queryByText('Remise commerciale')).toBeNull()
    expect(document.querySelectorAll('.line-through')).toHaveLength(0)
  })

  it('confirms before deleting an agreement from the card action', async () => {
    const onDelete = vi.fn(async () => true)

    await renderSection({
      feeAgreements: [createAgreement()],
      onDelete
    })

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))

    expect(screen.getByText('Supprimer cette convention ?')).toBeTruthy()
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    expect(onDelete).toHaveBeenCalledWith({ dossierId: 'dos-1', feeAgreementUuid: 'fa-1' })
  })

  it('opens a choice menu before converting an agreement into a billing item', async () => {
    const onConvertToBillingItem = vi.fn()
    const agreement = createAgreement({ retainerHtCents: 25_000 })

    await renderSection({
      feeAgreements: [agreement],
      onConvertToBillingItem
    })

    fireEvent.click(screen.getByRole('button', { name: 'Transformer en prestation' }))

    expect(screen.getByRole('menuitem', { name: /Facturer la provision/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Facturer le solde final/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: /Facturer la provision/ }))

    expect(onConvertToBillingItem).toHaveBeenCalledWith(agreement, 'retainer')
  })

  it('marks existing fee-agreement billing items and disables duplicate conversion choices', async () => {
    const agreement = createAgreement({ retainerHtCents: 25_000 })

    await renderSection({
      feeAgreements: [agreement],
      onConvertToBillingItem: vi.fn(),
      billingItems: [
        {
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
          sourceFeeAgreementUuid: 'fa-1',
          sourceFeeAgreementBillingKind: 'retainer',
          createdAt: '2026-04-01T09:00:00.000Z',
          updatedAt: '2026-04-01T09:00:00.000Z'
        }
      ]
    })

    expect(screen.getByText('Provision créée')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Transformer en prestation' }))

    expect(
      (screen.getByRole('menuitem', { name: /Facturer la provision/ }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(screen.getByText('Provision déjà créée')).toBeTruthy()
  })
})
