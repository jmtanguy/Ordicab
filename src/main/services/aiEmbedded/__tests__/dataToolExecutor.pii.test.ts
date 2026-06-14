import { describe, expect, it } from 'vitest'

import {
  pseudonymizeActionToolResultAsync,
  pseudonymizeDocumentToolResultAsync
} from '../dataToolExecutor'

describe('action tool result PII pseudonymization', () => {
  it('pseudonymizes nested entity strings while preserving structural handles', async () => {
    const raw = JSON.stringify({
      success: true,
      contactUuid: 'contact-123',
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

    expect(parsed.contactUuid).toBe('contact-123')
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

describe('document tool result PII pseudonymization', () => {
  it('pseudonymizes the flat document_get shape while preserving structural fields', async () => {
    const raw = JSON.stringify({
      uuid: 'doc-uuid-1',
      filename: 'Assignation Dupont.pdf',
      description: 'Assignation contre Jean Dupont',
      tags: ['assignation', 'Dupont'],
      totalChars: 1234,
      totalLines: 56
    })

    const safe = await pseudonymizeDocumentToolResultAsync(raw, async (value) => `SAFE(${value})`)
    const parsed = JSON.parse(safe)

    expect(parsed.uuid).toBe('doc-uuid-1')
    expect(parsed.totalChars).toBe(1234)
    expect(parsed.totalLines).toBe(56)
    expect(parsed.filename).toBe('SAFE(Assignation Dupont.pdf)')
    expect(parsed.description).toBe('SAFE(Assignation contre Jean Dupont)')
    expect(parsed.tags).toEqual(['SAFE(assignation)', 'SAFE(Dupont)'])
  })

  it('still pseudonymizes the wrapped document_list shape', async () => {
    const raw = JSON.stringify({
      documents: [{ documentUuid: 'doc-1', filename: 'Courrier Merlin.pdf', tags: ['courrier'] }]
    })

    const safe = await pseudonymizeDocumentToolResultAsync(raw, async (value) => `SAFE(${value})`)
    const parsed = JSON.parse(safe)

    expect(parsed.documents[0].documentUuid).toBe('doc-1')
    expect(parsed.documents[0].filename).toBe('SAFE(Courrier Merlin.pdf)')
    expect(parsed.documents[0].tags).toEqual(['SAFE(courrier)'])
  })

  it('leaves a document_get error result untouched', async () => {
    const raw = JSON.stringify({ error: 'Document not found: doc-uuid-9' })
    const safe = await pseudonymizeDocumentToolResultAsync(raw, async (value) => `SAFE(${value})`)
    expect(JSON.parse(safe)).toEqual({ error: 'SAFE(Document not found: doc-uuid-9)' })
  })

  it('fails closed for malformed document tool results', async () => {
    const safe = await pseudonymizeDocumentToolResultAsync(
      'Assignation Dupont.pdf\nJean Dupont',
      async (value) => `SAFE(${value})`
    )

    expect(JSON.parse(safe)).toEqual({
      error: 'Document tool returned a malformed result.'
    })
  })
})
