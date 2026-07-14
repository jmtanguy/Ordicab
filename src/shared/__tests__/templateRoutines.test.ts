import { describe, expect, it } from 'vitest'

import {
  buildTagPathLocalizer,
  templateRoutineCatalog,
  TEMPLATE_ROUTINE_GROUPS
} from '@shared/templateRoutines'
import { normalizeTagPath } from '@shared/templateContent'

describe('templateRoutineCatalog — simplified authoring surface', () => {
  it('exposes only the supported routine groups', () => {
    expect(TEMPLATE_ROUTINE_GROUPS).toEqual([
      'dossier',
      'contact',
      'entity',
      'keyDates',
      'feeAgreement',
      'invoice',
      'system'
    ])
  })

  it('exposes invoice table and direct dossier routines, but no loops or keyRef routines', () => {
    const tags = templateRoutineCatalog.map((entry) => entry.tag)

    expect(tags).toEqual(
      expect.arrayContaining([
        '{{dossier.name}}',
        '{{dossier.juridiction}}',
        '{{dossier.tribunal}}',
        '{{dossier.keyDate.<label>.label}}',
        '{{dossier.feeAgreement.client.displayName}}',
        '{{dossier.feeAgreement.signatory.email}}',
        '{{invoice.linesTable}}'
      ])
    )
    expect(tags).not.toContain('{{dossier.status}}')
    expect(tags).not.toContain('{{dossier.type}}')
    expect(tags).not.toContain('{{dossier.reference}}')
    expect(tags).not.toContain('{{dossier.keyRef.<label>}}')
    expect(tags.some((tag) => tag.includes('billingItem'))).toBe(false)
    expect(tags.some((tag) => tag.includes('billingItems'))).toBe(false)
    expect(tags.some((tag) => tag.includes('billingTotals'))).toBe(false)
  })
})

describe('normalizeTagPath — removed routine families', () => {
  it('does not normalize key references or prestations to legacy template paths', () => {
    expect(normalizeTagPath('dossier.reference.nRg')).toBe('dossier.reference.nRg')
    expect(normalizeTagPath('dossier.keyRef.nRg')).toBe('dossier.keyRef.nRg')
    expect(normalizeTagPath('dossier.prestations')).toBe('dossier.prestations')
    expect(normalizeTagPath('dossier.prestation.audience.libelle')).toBe(
      'dossier.prestation.audience.libelle'
    )
  })

  it('resolves convention aliases and chronology label aliases', () => {
    expect(normalizeTagPath('convention.documentGenere')).toBe(
      'dossier.feeAgreement.generatedDocumentFilename'
    )
    expect(normalizeTagPath('convention.client.nomAffiche')).toBe(
      'dossier.feeAgreement.client.displayName'
    )
    expect(normalizeTagPath('convention.signataire.email')).toBe(
      'dossier.feeAgreement.signatory.email'
    )
    expect(normalizeTagPath('dossier.convention.signataire.email')).toBe(
      'dossier.feeAgreement.signatory.email'
    )
    expect(normalizeTagPath('feeAgreement.signatory.email')).toBe(
      'dossier.feeAgreement.signatory.email'
    )
    expect(normalizeTagPath('date.audience.libelle')).toBe('dossier.keyDate.audience.label')
    expect(normalizeTagPath('date.audience.formate')).toBe('dossier.keyDate.audience.formatted')
    expect(normalizeTagPath('date.audience')).toBe('dossier.keyDate.audience')
  })

  it('accepts the hand-authored hybrid dossier.date.<label> (FR alias with canonical prefix)', () => {
    expect(normalizeTagPath('dossier.date.audience.texte')).toBe('dossier.keyDate.audience.long')
    expect(normalizeTagPath('dossier.date.audience.formatted')).toBe(
      'dossier.keyDate.audience.formatted'
    )
    expect(normalizeTagPath('dossier.date.renvoi.texte')).toBe('dossier.keyDate.renvoi.long')
    expect(normalizeTagPath('dossier.date.audience')).toBe('dossier.keyDate.audience')
    // System keys stay literal even with the dossier. prefix
    expect(normalizeTagPath('dossier.date.today')).toBe('dossier.date.today')
    expect(normalizeTagPath('dossier.date.texte')).toBe('dossier.date.texte')
  })

  it('keeps system date keys distinct from chronology labels', () => {
    expect(normalizeTagPath('date.today')).toBe('date.today')
    expect(normalizeTagPath('date.todayFr')).toBe('date.todayFr')
    expect(normalizeTagPath('date.today+15')).toBe('date.today+15')
    expect(normalizeTagPath('date.j+15')).toBe('date.today+15')
  })

  it('keeps variant placeholder tags (date.formate/texte/court/libelle) literal', () => {
    // These are surfaced as default buttons in the template wizard before a
    // label is chosen; they must not normalize to a chronology label.
    expect(normalizeTagPath('date.formate')).toBe('date.formate')
    expect(normalizeTagPath('date.texte')).toBe('date.texte')
    expect(normalizeTagPath('date.court')).toBe('date.court')
    expect(normalizeTagPath('date.libelle')).toBe('date.libelle')
    expect(normalizeTagPath('date.abrege')).toBe('date.abrege')
  })

  it('uses French roots in localized routine tags', () => {
    expect(templateRoutineCatalog.find((entry) => entry.tag === '{{entity.firmName}}')?.tagFr).toBe(
      '{{cabinet.nomCabinet}}'
    )
    expect(
      templateRoutineCatalog.find(
        (entry) => entry.tag === '{{dossier.feeAgreement.signatory.email}}'
      )?.tagFr
    ).toBe('{{convention.signataire.email}}')
  })
})

describe('buildTagPathLocalizer — date offset rendering', () => {
  const localizeFr = buildTagPathLocalizer(templateRoutineCatalog, 'fr-FR')
  const localizeEn = buildTagPathLocalizer(templateRoutineCatalog, 'en-US')

  it('renders date.today+N as date.j+N in FR', () => {
    expect(localizeFr('date.today+15')).toBe('date.j+15')
    expect(localizeFr('date.today+8')).toBe('date.j+8')
  })

  it('renders FR variant suffixes for date.today+N.<variant>', () => {
    expect(localizeFr('date.today+15.formatted')).toBe('date.j+15.formate')
    expect(localizeFr('date.today+15.long')).toBe('date.j+15.texte')
    expect(localizeFr('date.today+15.short')).toBe('date.j+15.court')
  })

  it('keeps canonical date.today+N in EN', () => {
    expect(localizeEn('date.today+15')).toBe('date.today+15')
    expect(localizeEn('date.today+15.formatted')).toBe('date.today+15.formatted')
  })
})
