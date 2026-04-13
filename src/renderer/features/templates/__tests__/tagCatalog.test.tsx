import { describe, expect, it } from 'vitest'

import { getTagCatalog, TAG_GROUPS, tagCatalog } from '../tagCatalog'

describe('tagCatalog', () => {
  it('includes every expected tag group and tag', () => {
    expect(TAG_GROUPS).toEqual(['dossier', 'contact', 'entity', 'keyDates', 'keyRefs', 'system'])

    expect(tagCatalog.map((entry) => entry.tag)).toEqual(
      expect.arrayContaining([
        '{{dossier.name}}',
        '{{dossier.reference}}',
        '{{dossier.status}}',
        '{{dossier.type}}',
        '{{dossier.createdAt}}',
        '{{contact.displayName}}',
        '{{contact.role}}',
        '{{contact.email}}',
        '{{contact.phone}}',
        '{{contact.institution}}',
        '{{contact.salutation}}',
        '{{contact.salutationFull}}',
        '{{contact.dear}}',
        '{{entity.firmName}}',
        '{{entity.address}}',
        '{{entity.vatNumber}}',
        '{{entity.phone}}',
        '{{entity.email}}',
        '{{dossier.keyDate.<label>}}',
        '{{dossier.keyRef.<label>}}',
        '{{createdAt}}',
        '{{today}}'
      ])
    )
  })

  it('defines description and example text for every entry', () => {
    expect(tagCatalog.length).toBeGreaterThan(0)

    for (const entry of tagCatalog) {
      expect(TAG_GROUPS).toContain(entry.group)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.example.length).toBeGreaterThan(0)
    }
  })

  it('localizes managed personal contact field keys in French', () => {
    const catalog = getTagCatalog('lawyer', {
      contactRoles: ['client'],
      contacts: [
        { label: 'Date de naissance', type: 'date' },
        { label: 'Nationalité', type: 'text' }
      ],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {
        client: ['dateOfBirth', 'nationality']
      }
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: '{{contact.dateOfBirth}}',
          tagFr: '{{contact.dateNaissance}}'
        }),
        expect.objectContaining({
          tag: '{{contact.nationality}}',
          tagFr: '{{contact.nationalite}}'
        }),
        expect.objectContaining({
          tag: '{{contact.client.dateOfBirth}}',
          tagFr: '{{contact.client.dateNaissance}}'
        }),
        expect.objectContaining({
          tag: '{{contact.client.nationality}}',
          tagFr: '{{contact.client.nationalite}}'
        })
      ])
    )
  })

  it('assigns contact role address tags to the address subgroup', () => {
    const catalog = getTagCatalog('lawyer', {
      contactRoles: ['client'],
      contacts: [],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {}
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: '{{contact.client.addressLine}}',
          subGroup: 'address'
        }),
        expect.objectContaining({
          tag: '{{contact.client.city}}',
          subGroup: 'address'
        }),
        expect.objectContaining({
          tag: '{{contact.client.addressFormatted}}',
          subGroup: 'address'
        })
      ])
    )
  })

  it('assigns primary and managed contact identity tags to the identity subgroup', () => {
    const catalog = getTagCatalog('lawyer', {
      contactRoles: ['client'],
      contacts: [{ label: 'Date de naissance', type: 'date' }],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {
        client: ['dateOfBirth']
      }
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: '{{contact.displayName}}',
          subGroup: 'identity'
        }),
        expect.objectContaining({
          tag: '{{contact.role}}',
          subGroup: 'identity'
        }),
        expect.objectContaining({
          tag: '{{contact.email}}',
          subGroup: 'identity'
        }),
        expect.objectContaining({
          tag: '{{contact.client.displayName}}',
          subGroup: 'identity'
        }),
        expect.objectContaining({
          tag: '{{contact.client.phone}}',
          subGroup: 'identity'
        })
      ])
    )
  })

  it('assigns personal contact fields to the personal info subgroup', () => {
    const catalog = getTagCatalog('lawyer', {
      contactRoles: ['client'],
      contacts: [{ label: 'Date de naissance', type: 'date' }],
      keyDates: [],
      keyReferences: [],
      contactRoleFields: {
        client: ['dateOfBirth']
      }
    })

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: '{{contact.client.additionalFirstNames}}',
          subGroup: 'personalInfo'
        }),
        expect.objectContaining({
          tag: '{{contact.dateOfBirth}}',
          subGroup: 'personalInfo'
        }),
        expect.objectContaining({
          tag: '{{contact.client.dateOfBirth}}',
          subGroup: 'personalInfo'
        })
      ])
    )
  })
})
