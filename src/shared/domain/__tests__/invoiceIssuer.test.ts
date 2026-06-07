import { describe, expect, it } from 'vitest'

import type { EntityProfile } from '../entity'
import { entityToInvoiceIssuer } from '../invoiceIssuer'

const SETTINGS = { legalFooter: 'TVA non applicable, art. 293 B du CGI' }

describe('entityToInvoiceIssuer', () => {
  it('maps the entity profile into the invoice issuer snapshot', () => {
    const profile: EntityProfile = {
      firmName: 'Cabinet Dupont',
      siren: '123456789',
      siret: '12345678900012',
      vatNumber: 'FR12345678901',
      iban: 'FR7630006000011234567890189',
      addressLine: '1 rue de la Paix',
      zipCode: '75002',
      city: 'Paris'
    }

    const issuer = entityToInvoiceIssuer(profile, SETTINGS)

    expect(issuer.name).toBe('Cabinet Dupont')
    // Invoices carry the SIRET (the legally expected identifier), sourced from the entity.
    expect(issuer.siret).toBe('12345678900012')
    expect(issuer.vatNumber).toBe('FR12345678901')
    expect(issuer.iban).toBe('FR7630006000011234567890189')
    expect(issuer.address).toBe('1 rue de la Paix\n75002 Paris')
    expect(issuer.legalFooter).toBe('TVA non applicable, art. 293 B du CGI')
  })

  it('falls back to firstName + lastName when firmName is empty', () => {
    const profile = {
      firmName: '',
      firstName: 'Jean',
      lastName: 'Dupont'
    } as EntityProfile

    expect(entityToInvoiceIssuer(profile, SETTINGS).name).toBe('Jean Dupont')
  })

  it('falls back to the legacy free-text address when structured fields are absent', () => {
    const profile = {
      firmName: 'Cabinet X',
      address: '5 avenue des Champs\n75008 Paris'
    } as EntityProfile

    expect(entityToInvoiceIssuer(profile, SETTINGS).address).toBe(
      '5 avenue des Champs\n75008 Paris'
    )
  })

  it('returns an empty issuer identity for a null profile but keeps the legal footer', () => {
    const issuer = entityToInvoiceIssuer(null, SETTINGS)

    expect(issuer.name).toBeUndefined()
    expect(issuer.siret).toBeUndefined()
    expect(issuer.address).toBeUndefined()
    expect(issuer.legalFooter).toBe('TVA non applicable, art. 293 B du CGI')
  })
})
