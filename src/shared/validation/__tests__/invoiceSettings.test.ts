import { describe, expect, it } from 'vitest'

import { DEFAULT_INVOICE_SETTINGS } from '@shared/domain/invoice'

import { invoiceSettingsSchema } from '../invoice'

// Un catalogue minimal tel qu'écrit avant l'introduction de la rétribution AJ :
// il ne contient AUCUN champ stateRetribution*. Le preprocess doit les défauter
// pour que les domaines existants se chargent sans erreur (migration douce).
const legacySettings = {
  numberPattern: 'FAC-{YYYY}-{SEQ}',
  sequencePadding: 4,
  resetSequenceYearly: true,
  nextSequence: 12,
  currentSequenceYear: 2025,
  creditNoteNumberPattern: 'AV-{YYYY}-{SEQ}',
  creditNoteNextSequence: 3,
  creditNoteCurrentSequenceYear: 2025,
  correctiveInvoiceNumberPattern: 'FCR-{YYYY}-{SEQ}',
  correctiveInvoiceNextSequence: 1,
  correctiveInvoiceCurrentSequenceYear: 2025
}

describe('invoiceSettingsSchema — migration rétribution AJ', () => {
  it('defaults the stateRetribution fields for legacy catalogs', () => {
    const parsed = invoiceSettingsSchema.parse(legacySettings)
    expect(parsed.stateRetributionNumberPattern).toBe(
      DEFAULT_INVOICE_SETTINGS.stateRetributionNumberPattern
    )
    expect(parsed.stateRetributionNextSequence).toBe(1)
    // L'année courante de la rétribution suit celle des factures si absente.
    expect(parsed.stateRetributionCurrentSequenceYear).toBe(2025)
  })

  it('keeps explicit stateRetribution settings untouched', () => {
    const parsed = invoiceSettingsSchema.parse({
      ...legacySettings,
      stateRetributionNumberPattern: 'RET-{YYYY}-{SEQ}',
      stateRetributionNextSequence: 5,
      stateRetributionCurrentSequenceYear: 2026
    })
    expect(parsed.stateRetributionNumberPattern).toBe('RET-{YYYY}-{SEQ}')
    expect(parsed.stateRetributionNextSequence).toBe(5)
    expect(parsed.stateRetributionCurrentSequenceYear).toBe(2026)
  })

  it('rejects a stateRetribution pattern without {SEQ}', () => {
    const result = invoiceSettingsSchema.safeParse({
      ...legacySettings,
      stateRetributionNumberPattern: 'RET-{YYYY}'
    })
    expect(result.success).toBe(false)
  })
})
