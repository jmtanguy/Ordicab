import { describe, expect, it } from 'vitest'

import { pseudonymizeActionToolResultAsync } from '../dataToolExecutor'

describe('action tool result PII pseudonymization', () => {
  it('pseudonymizes nested entity strings while preserving structural handles', async () => {
    const raw = JSON.stringify({
      success: true,
      contactId: 'contact-123',
      feedback: 'Contact Luc Merlin ajouté.',
      entity: {
        id: 'contact-123',
        uuid: 'contact-uuid-123',
        firstName: 'Luc',
        lastName: 'Merlin',
        customFields: {
          birthPlace: 'Nantes',
          id: 'carte nationale 123456',
          relatives: ['Marie Merlin', { name: 'Paul Merlin', uuid: 'nested-uuid-456' }]
        }
      }
    })

    const safe = await pseudonymizeActionToolResultAsync(raw, async (value) => `SAFE(${value})`)
    const parsed = JSON.parse(safe)

    expect(parsed.contactId).toBe('contact-123')
    expect(parsed.entity.id).toBe('contact-123')
    expect(parsed.entity.uuid).toBe('contact-uuid-123')
    expect(parsed.feedback).toBe('SAFE(Contact Luc Merlin ajouté.)')
    expect(parsed.entity.firstName).toBe('SAFE(Luc)')
    expect(parsed.entity.lastName).toBe('SAFE(Merlin)')
    expect(parsed.entity.customFields.birthPlace).toBe('SAFE(Nantes)')
    expect(parsed.entity.customFields.id).toBe('SAFE(carte nationale 123456)')
    expect(parsed.entity.customFields.relatives[0]).toBe('SAFE(Marie Merlin)')
    expect(parsed.entity.customFields.relatives[1].name).toBe('SAFE(Paul Merlin)')
    expect(parsed.entity.customFields.relatives[1].uuid).toBe('SAFE(nested-uuid-456)')
  })
})
