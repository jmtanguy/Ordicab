import { describe, expect, it } from 'vitest'

import { migrateDanglingOverrideKeys, resolveDossierTags } from '../dossierTagResolver'

describe('resolveDossierTags', () => {
  it('matches a keyDate slug against a long French label and formats the variant', () => {
    const result = resolveDossierTags({
      unresolvedTags: [
        'dossier.keyDate.audience.long',
        'dossier.keyDate.renvoi.long',
        'dossier.keyDate.audience.short',
        'dossier.keyDate.audience.formatted',
        'dossier.keyDate.audience'
      ],
      keyDates: [
        { label: "Date d'audience", date: '2026-04-21' },
        { label: 'Date de renvoi', date: '2026-06-08' }
      ]
    })

    expect(result.stillUnresolved).toEqual([])
    expect(result.ambiguous).toEqual([])
    expect(result.resolvedOverrides['dossier.keyDate.audience.long']).toBe('21 avril 2026')
    expect(result.resolvedOverrides['dossier.keyDate.renvoi.long']).toBe('8 juin 2026')
    expect(result.resolvedOverrides['dossier.keyDate.audience.short']).toContain('avr')
    expect(result.resolvedOverrides['dossier.keyDate.audience.formatted']).toBe('21/04/2026')
    expect(result.resolvedOverrides['dossier.keyDate.audience']).toBe('2026-04-21')
  })

  it('matches a keyRef by token against a longer label', () => {
    const result = resolveDossierTags({
      unresolvedTags: ['dossier.keyRef.rg'],
      keyReferences: [
        { label: 'Numéro RG', value: '24/00321' },
        { label: 'Cabinet', value: 'X' }
      ]
    })

    expect(result.resolvedOverrides['dossier.keyRef.rg']).toBe('24/00321')
    expect(result.stillUnresolved).toEqual([])
  })

  it('leaves the tag unresolved and reports ambiguity when several entries match', () => {
    const result = resolveDossierTags({
      unresolvedTags: ['dossier.keyDate.audience.long'],
      keyDates: [
        { label: "Date d'audience", date: '2026-04-21' },
        { label: 'Audience finale', date: '2026-12-15' }
      ]
    })

    expect(result.resolvedOverrides).toEqual({})
    expect(result.stillUnresolved).toEqual(['dossier.keyDate.audience.long'])
    expect(result.ambiguous).toEqual([
      { tag: 'dossier.keyDate.audience.long', candidates: ["Date d'audience", 'Audience finale'] }
    ])
  })

  it('leaves the tag unresolved when no entry matches', () => {
    const result = resolveDossierTags({
      unresolvedTags: ['dossier.keyDate.delibere.long'],
      keyDates: [{ label: "Date d'audience", date: '2026-04-21' }]
    })

    expect(result.resolvedOverrides).toEqual({})
    expect(result.stillUnresolved).toEqual(['dossier.keyDate.delibere.long'])
    expect(result.ambiguous).toEqual([])
  })

  it('passes through tags it does not know how to handle', () => {
    const result = resolveDossierTags({
      unresolvedTags: ['contact.client.email', 'todayLong'],
      keyDates: [{ label: "Date d'audience", date: '2026-04-21' }]
    })

    expect(result.resolvedOverrides).toEqual({})
    expect(result.stillUnresolved).toEqual(['contact.client.email', 'todayLong'])
  })
})

describe('migrateDanglingOverrideKeys', () => {
  it('keeps overrides whose key already matches a template macro', () => {
    const result = migrateDanglingOverrideKeys(
      { 'dossier.keyDate.audience.long': '21 avril 2026' },
      ['dossier.keyDate.audience.long', 'contact.juridiction.displayName']
    )

    expect(result.migrated).toEqual({ 'dossier.keyDate.audience.long': '21 avril 2026' })
    expect(result.migrations).toEqual([])
    expect(result.dropped).toEqual([])
  })

  it('migrates a short LLM key (dateDAudience) onto its unique macro target', () => {
    const result = migrateDanglingOverrideKeys({ dateDAudience: '2026-09-11' }, [
      'dossier.keyDate.audience.long',
      'dossier.keyDate.renvoi.long',
      'dossier.name'
    ])

    expect(result.migrated).toEqual({ 'dossier.keyDate.audience.long': '2026-09-11' })
    expect(result.migrations).toEqual([
      { from: 'dateDAudience', to: 'dossier.keyDate.audience.long' }
    ])
    expect(result.dropped).toEqual([])
  })

  it('drops keys that have no distinguishing tokens or no unique macro match', () => {
    const result = migrateDanglingOverrideKeys(
      { dossier_1: 'Conseil Pelican', renvoi: 'foo', date: 'bar' },
      ['dossier.keyDate.audience.long', 'dossier.keyDate.renvoi.long']
    )

    // `dossier_1` has only generic tokens after filtering → dropped
    expect(result.dropped).toContain('dossier_1')
    // `date` is generic, no distinguishing tokens → dropped
    expect(result.dropped).toContain('date')
    // `renvoi` matches a unique macro → migrated
    expect(result.migrated).toEqual({ 'dossier.keyDate.renvoi.long': 'foo' })
    expect(result.migrations).toEqual([{ from: 'renvoi', to: 'dossier.keyDate.renvoi.long' }])
  })

  it('drops a key that matches multiple macros (ambiguous)', () => {
    const result = migrateDanglingOverrideKeys({ date: '2026-04-21' }, [
      'dossier.keyDate.audience.long',
      'dossier.keyDate.renvoi.long'
    ])

    expect(result.dropped).toEqual(['date'])
    expect(result.migrated).toEqual({})
  })

  it('falls through unchanged when no macros are known (defensive)', () => {
    const result = migrateDanglingOverrideKeys({ foo: 'bar' }, [])

    expect(result.migrated).toEqual({ foo: 'bar' })
    expect(result.migrations).toEqual([])
    expect(result.dropped).toEqual([])
  })
})
