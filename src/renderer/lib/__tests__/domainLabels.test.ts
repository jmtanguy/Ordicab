import { describe, expect, it } from 'vitest'

import { createRendererI18n } from '../../i18n'
import {
  billingItemStatusLabel,
  billingTypeLabel,
  dossierStatusLabel,
  feeAgreementStatusLabel,
  invoiceStatusLabel,
  paymentMethodLabel,
  type TranslateFn
} from '../domainLabels'

async function getFrenchT(): Promise<TranslateFn> {
  const i18n = await createRendererI18n('fr')
  await i18n.changeLanguage('fr')
  return i18n.t as unknown as TranslateFn
}

describe('domainLabels', () => {
  it('renders invoice status labels', async () => {
    const t = await getFrenchT()
    expect(invoiceStatusLabel('issued', t)).toBe('Émise')
    expect(invoiceStatusLabel('partiallyPaid', t)).toBe('Partielle')
    expect(invoiceStatusLabel('paid', t)).toBe('Payée')
    expect(invoiceStatusLabel('overpaid', t)).toBe('Trop payé')
    expect(invoiceStatusLabel('cancelled', t)).toBe('Annulée')
    expect(invoiceStatusLabel('corrected', t)).toBe('Rectifiée')
  })

  it('renders payment method labels', async () => {
    const t = await getFrenchT()
    expect(paymentMethodLabel('transfer', t)).toBe('Virement')
    expect(paymentMethodLabel('card', t)).toBe('Carte')
    expect(paymentMethodLabel('cash', t)).toBe('Espèces')
    expect(paymentMethodLabel('check', t)).toBe('Chèque')
    expect(paymentMethodLabel('other', t)).toBe('Autre')
  })

  it('renders fee agreement status labels', async () => {
    const t = await getFrenchT()
    expect(feeAgreementStatusLabel('draft', t)).toBe('Brouillon')
    expect(feeAgreementStatusLabel('sent', t)).toBe('Envoyée')
    expect(feeAgreementStatusLabel('signed', t)).toBe('Signée')
  })

  it('renders billing item status labels', async () => {
    const t = await getFrenchT()
    expect(billingItemStatusLabel('draft', t)).toBe('À facturer')
    expect(billingItemStatusLabel('billed', t)).toBe('Facturée')
    expect(billingItemStatusLabel('cancelled', t)).toBe('Annulée')
  })

  it('renders billing type labels', async () => {
    const t = await getFrenchT()
    expect(billingTypeLabel('flat', t)).toBe('Forfait')
    expect(billingTypeLabel('hourly', t)).toBe('Horaire')
    expect(billingTypeLabel('mixed', t)).toBe('Mixte')
  })

  it('renders dossier status labels from the locale catalog', async () => {
    const t = await getFrenchT()
    expect(dossierStatusLabel('active', t)).toBe('Actif')
    expect(dossierStatusLabel('pending', t)).toBe('En attente')
    expect(dossierStatusLabel('completed', t)).toBe('Terminé')
    expect(dossierStatusLabel('archived', t)).toBe('Archivé')
  })
})
