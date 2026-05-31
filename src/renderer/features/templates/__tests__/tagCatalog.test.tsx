import { describe, expect, it } from 'vitest'

import { getTagCatalog, TAG_GROUPS, tagCatalog } from '../tagCatalog'

describe('tagCatalog', () => {
  it('includes the simplified routine groups and no removed groups', () => {
    expect(TAG_GROUPS).toEqual([
      'dossier',
      'contact',
      'entity',
      'keyDates',
      'feeAgreement',
      'invoice',
      'system'
    ])
  })

  it('exposes the recommended static routines', () => {
    const tags = tagCatalog.map((entry) => entry.tag)

    expect(tags).toEqual(
      expect.arrayContaining([
        '{{dossier.name}}',
        '{{dossier.juridiction}}',
        '{{dossier.tribunal}}',
        '{{contact.displayName}}',
        '{{contact.email}}',
        '{{contact.phone}}',
        '{{contact.addressFormatted}}',
        '{{contact.salutationFull}}',
        '{{contact.dear}}',
        '{{entity.firmName}}',
        '{{entity.addressFormatted}}',
        '{{entity.vatNumber}}',
        '{{entity.phone}}',
        '{{entity.email}}',
        '{{dossier.keyDate.<label>.label}}',
        '{{invoice.linesTable}}',
        '{{todayLong}}',
        '{{todayShort}}'
      ])
    )
    expect(tags).not.toContain('{{dossier.status}}')
    expect(tags).not.toContain('{{dossier.type}}')
    expect(tags).not.toContain('{{dossier.reference}}')
    expect(tags).not.toContain('{{dossier.keyRef.<label>}}')
    expect(tags.some((tag) => tag.includes('billingItem'))).toBe(false)
  })

  it('defines description and example text for every entry', () => {
    expect(tagCatalog.length).toBeGreaterThan(0)

    for (const entry of tagCatalog) {
      expect(TAG_GROUPS).toContain(entry.group)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.example.length).toBeGreaterThan(0)
    }
  })

  it('projects configured dossier references as direct dossier routines', () => {
    const catalog = getTagCatalog({
      contactRoles: [],
      contacts: [],
      keyDates: [],
      keyReferences: [
        { label: 'N° RG', type: 'text' },
        { label: 'N° Portalis', type: 'text' },
        { label: 'Tribunal', type: 'text' }
      ],
      contactRoleFields: {}
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: '{{dossier.nRg}}' }),
        expect.objectContaining({ tag: '{{dossier.nPortalis}}' }),
        expect.objectContaining({ tag: '{{dossier.tribunal}}' })
      ])
    )
  })

  it('limits role contact routines to the recommended fields', () => {
    const catalog = getTagCatalog({
      contactRoles: ['client'],
      contacts: [],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {}
    })
    const tags = catalog.map((entry) => entry.tag)

    expect(tags).toEqual(
      expect.arrayContaining([
        '{{contact.client.displayName}}',
        '{{contact.client.salutationFull}}',
        '{{contact.client.dear}}',
        '{{contact.client.addressFormatted}}',
        '{{contact.client.email}}',
        '{{contact.client.phone}}'
      ])
    )
    expect(tags).not.toContain('{{contact.client.dateOfBirth}}')
    expect(tags).not.toContain('{{contact.client.addressLine}}')
  })

  it('groups fee agreement client and signatory routines under fee agreement with French tags', () => {
    const catalog = getTagCatalog({
      contactRoles: [],
      contacts: [],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {}
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: '{{dossier.feeAgreement.client.displayName}}',
          tagFr: '{{convention.client.nomAffiche}}',
          group: 'feeAgreement'
        }),
        expect.objectContaining({
          tag: '{{dossier.feeAgreement.signatory.email}}',
          tagFr: '{{convention.signataire.email}}',
          group: 'feeAgreement'
        })
      ])
    )
    expect(catalog.map((entry) => entry.tag)).not.toContain('{{feeAgreement.signatory.email}}')
  })
})
