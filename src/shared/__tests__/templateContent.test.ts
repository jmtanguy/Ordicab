import { describe, expect, it } from 'vitest'

import { labelToKey, normalizeTagPath } from '../templateContent'

describe('templateContent labelToKey', () => {
  it('normalizes uppercase labels to lowercase-first camel case', () => {
    expect(labelToKey('NRG')).toBe('nrg')
  })

  it('preserves mixed-case transitions as current behavior', () => {
    expect(labelToKey('nRg')).toBe('nRg')
  })
})

describe('templateContent normalizeTagPath — address aliases', () => {
  it('translates contact.ville to contact.city', () => {
    expect(normalizeTagPath('contact.ville')).toBe('contact.city')
  })

  it('translates contact.codePostal to contact.zipCode', () => {
    expect(normalizeTagPath('contact.codePostal')).toBe('contact.zipCode')
  })

  it('translates contact.ligneAdresse to contact.addressLine', () => {
    expect(normalizeTagPath('contact.ligneAdresse')).toBe('contact.addressLine')
  })

  it('translates contact.ligneAdresse2 to contact.addressLine2', () => {
    expect(normalizeTagPath('contact.ligneAdresse2')).toBe('contact.addressLine2')
  })

  it('translates contact.adresseFormatee to contact.addressFormatted', () => {
    expect(normalizeTagPath('contact.adresseFormatee')).toBe('contact.addressFormatted')
  })

  it('translates contact.adresseCompacte to contact.addressInline', () => {
    expect(normalizeTagPath('contact.adresseCompacte')).toBe('contact.addressInline')
  })

  it('translates entity.ville to entity.city', () => {
    expect(normalizeTagPath('entity.ville')).toBe('entity.city')
  })

  it('translates entity.codePostal to entity.zipCode', () => {
    expect(normalizeTagPath('entity.codePostal')).toBe('entity.zipCode')
  })

  it('translates entite.ville to entity.city (root alias)', () => {
    expect(normalizeTagPath('entite.ville')).toBe('entity.city')
  })

  it('passes through canonical paths unchanged', () => {
    expect(normalizeTagPath('contact.city')).toBe('contact.city')
    expect(normalizeTagPath('contact.addressLine')).toBe('contact.addressLine')
    expect(normalizeTagPath('contact.firstNames')).toBe('contact.firstNames')
    expect(normalizeTagPath('contact.additionalFirstNames')).toBe('contact.additionalFirstNames')
    expect(normalizeTagPath('entity.zipCode')).toBe('entity.zipCode')
  })
})

describe('templateContent normalizeTagPath — salutation aliases', () => {
  it('translates contact.civilite to contact.salutation', () => {
    expect(normalizeTagPath('contact.civilite')).toBe('contact.salutation')
  })

  it('translates contact.civiliteNom to contact.salutationFull', () => {
    expect(normalizeTagPath('contact.civiliteNom')).toBe('contact.salutationFull')
  })

  it('translates contact.formuleAppel to contact.dear', () => {
    expect(normalizeTagPath('contact.formuleAppel')).toBe('contact.dear')
  })

  it('translates role-based contact aliases to canonical fields', () => {
    expect(normalizeTagPath('contact.Avocat adverse.civilite')).toBe(
      'contact.avocatAdverse.salutation'
    )
    expect(normalizeTagPath('contact.Avocat adverse.formuleAppel')).toBe(
      'contact.avocatAdverse.dear'
    )
  })
})

describe('templateContent normalizeTagPath — additional first names alias', () => {
  it('translates contact.prenoms to contact.firstNames', () => {
    expect(normalizeTagPath('contact.prenoms')).toBe('contact.firstNames')
  })

  it('translates contact.prenomsComplementaires to contact.additionalFirstNames', () => {
    expect(normalizeTagPath('contact.prenomsComplementaires')).toBe('contact.additionalFirstNames')
  })

  it('translates role-based additional first names aliases to canonical fields', () => {
    expect(normalizeTagPath('contact.Avocat adverse.prenoms')).toBe(
      'contact.avocatAdverse.firstNames'
    )
    expect(normalizeTagPath('contact.Avocat adverse.prenomsComplementaires')).toBe(
      'contact.avocatAdverse.additionalFirstNames'
    )
  })
})
