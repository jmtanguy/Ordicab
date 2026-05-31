import { describe, expect, it } from 'vitest'

import {
  PiiMapping,
  revertJsonValueWithMappingEntries,
  revertWithMappingEntries
} from '../piiMapping'

describe('PiiMapping', () => {
  it('formats model-facing replacements as fake values only', () => {
    expect(PiiMapping.format('name_1', 'Antoine')).toBe('Antoine')
  })

  it('reverts a bare fake value whose formatting changed slightly', () => {
    const mapping = new PiiMapping()
    mapping.add('25 rue du Faubourg Saint-Antoine', 'address_1', '42 rue du Faubourg Saint-Antoine')

    expect(mapping.revert('Adresse : 42 rue du Faubourg Saint\u2011Antoine.')).toBe(
      'Adresse : 25 rue du Faubourg Saint-Antoine.'
    )
  })

  it('rejects an add() that would overwrite an existing markerPath with a different original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Sophie')).toBeDefined()

    const collidingEntry = mapping.add('Sophie', 'contact.client.firstName', 'Antoine')
    expect(collidingEntry).toBeUndefined()

    expect(mapping.revert('Sophie')).toBe('Marie')
    expect(mapping.getOriginalByMarker('contact.client.firstName')).toBe('Marie')
  })

  it('rejects an add() that would overwrite an existing fakeValue with a different original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Sophie')).toBeDefined()

    const collidingEntry = mapping.add('Léa', 'contact.witness.firstName', 'Sophie')
    expect(collidingEntry).toBeUndefined()
    expect(mapping.getOriginalByFake('Sophie')).toBe('Marie')
  })

  it('rejects fake values that are the original itself or another registered original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Marie')).toBeUndefined()

    expect(mapping.add('Sophie', 'contact.witness.firstName', 'Antoine')).toBeDefined()
    expect(mapping.add('Léa', 'contact.client_2.firstName', 'Sophie')).toBeUndefined()
  })

  it('returns the existing entry when the same original is added twice', () => {
    const mapping = new PiiMapping()
    const first = mapping.add('Marie', 'contact.client.firstName', 'Sophie')
    const second = mapping.add('Marie', 'contact.client.firstName', 'Sophie')
    expect(first).toBeDefined()
    expect(second).toBe(first)
  })

  it('collapses whitespace runs in the stored original', () => {
    const mapping = new PiiMapping()
    const wide = '15 RUE TONDUTI                      L ESCARENE'
    const entry = mapping.add(wide, 'address_1', '42 rue du Marché Villeneuve')

    expect(entry?.originalValue).toBe('15 RUE TONDUTI L ESCARENE')
    expect(mapping.toJSON()[0]?.original).toBe('15 RUE TONDUTI L ESCARENE')
    expect(mapping.getFake(wide)?.markerPath).toBe('address_1')
    expect(mapping.revert('Adresse : 42 rue du Marché Villeneuve.')).toBe(
      'Adresse : 15 RUE TONDUTI L ESCARENE.'
    )
  })

  it('keeps globally ambiguous bare fakes unchanged without a current-turn override', () => {
    const entries = [
      { original: 'Pillot', markerPath: 'name_7', fakeValue: 'Charpentier' },
      { original: 'StaleSurname', markerPath: 'name_11', fakeValue: 'Charpentier' }
    ]

    expect(revertWithMappingEntries('Charpentier', entries)).toBe('Charpentier')
  })

  it('disambiguates a cross-turn-ambiguous bare fake using currentTurnEntries', () => {
    const ledger = [
      { original: 'Pillot', markerPath: 'name_7', fakeValue: 'Charpentier' },
      { original: 'StaleSurname', markerPath: 'name_11', fakeValue: 'Charpentier' }
    ]
    const currentTurnEntries = [
      { original: 'Pillot', markerPath: 'name_7', fakeValue: 'Charpentier' }
    ]

    const upsertArgs = {
      firstName: 'Sandrine',
      lastName: 'Charpentier',
      role: 'Avocat de la partie représentée',
      email: 'antoine.girard@test-inbox.net',
      city: 'Strasbourg'
    }

    const without = revertJsonValueWithMappingEntries(upsertArgs, ledger) as Record<string, string>
    expect(without.lastName).toBe('Charpentier')

    const withOverride = revertJsonValueWithMappingEntries(upsertArgs, ledger, {
      currentTurnEntries
    }) as Record<string, string>
    expect(withOverride.lastName).toBe('Pillot')
  })

  it('reverts a fake date the LLM reformatted to ISO into the original date in ISO', () => {
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' }]

    expect(
      revertWithMappingEntries('{"label":"Date d\'audience","date":"2026-04-21"}', entries)
    ).toBe('{"label":"Date d\'audience","date":"2026-03-15"}')
  })

  it('reverts a fake date kept in textual French while preserving casing', () => {
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '2026-04-21' }]

    expect(revertWithMappingEntries('Audience tenue le 21 Avril 2026.', entries)).toBe(
      'Audience tenue le 15 Mars 2026.'
    )
  })

  it('preserves the LLM-emitted date format when the original is in a different format', () => {
    const entries = [{ original: '2026-03-15', markerPath: 'date_1', fakeValue: '21/04/2026' }]

    expect(revertWithMappingEntries('Renvoi: 2026-04-21.', entries)).toBe('Renvoi: 2026-03-15.')
    expect(revertWithMappingEntries('Renvoi: 21/04/2026.', entries)).toBe('Renvoi: 15/03/2026.')
  })

  it('interprets two-digit years with a civil-status pivot during date revert', () => {
    const entries = [{ original: '12/07/81', markerPath: 'date_1', fakeValue: '21/08/81' }]

    expect(revertWithMappingEntries('Naissance: 1981-08-21.', entries)).toBe(
      'Naissance: 1981-07-12.'
    )
  })

  it('leaves unrelated date-shaped tokens untouched', () => {
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' }]

    expect(revertWithMappingEntries('Échéance: 2026-12-31.', entries)).toBe('Échéance: 2026-12-31.')
  })

  it('bails on ambiguous canonical-fake collisions across two originals', () => {
    const entries = [
      { original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' },
      { original: '03 mai 2026', markerPath: 'date_2', fakeValue: '21/04/2026' }
    ]

    expect(revertWithMappingEntries('Date: 2026-04-21.', entries)).toBe('Date: 2026-04-21.')
  })
})
