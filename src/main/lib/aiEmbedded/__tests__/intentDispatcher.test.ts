import { describe, expect, it, vi } from 'vitest'

import type { ContactRecord, TemplateRecord } from '@shared/types'

import { createInternalAICommandDispatcher } from '../aiCommandDispatcher'
import type {
  ContactServiceLike,
  GenerateServiceLike,
  TemplateServiceLike
} from '../aiCommandDispatcher'

const mockContacts: ContactRecord[] = [
  {
    uuid: 'c1',
    dossierId: 'dos1',
    firstName: 'Contact',
    lastName: 'Exemple',
    role: 'tenant'
  } as ContactRecord,
  {
    uuid: 'c2',
    dossierId: 'dos1',
    firstName: 'Contact',
    lastName: 'Exemple-A',
    role: 'tenant'
  } as ContactRecord,
  {
    uuid: 'c3',
    dossierId: 'dos1',
    firstName: 'Contact',
    lastName: 'Exemple-B',
    role: 'landlord'
  } as ContactRecord,
  {
    uuid: 'contact-exemple-complet',
    dossierId: 'dos1',
    firstName: 'Contact',
    lastName: 'EXEMPLE-C',
    role: 'Client',
    phone: '0601020304'
  } as ContactRecord
]

const mockTemplates: TemplateRecord[] = [
  { id: 'tpl1', name: 'NDA Standard' } as unknown as TemplateRecord,
  { id: 'tpl2', name: 'Bail commercial' } as unknown as TemplateRecord
]

const mockDossierService = {
  listRegisteredDossiers: vi.fn().mockResolvedValue([]),
  getDossier: vi.fn().mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '' }),
  registerDossier: vi.fn().mockResolvedValue(undefined),
  updateDossier: vi.fn().mockResolvedValue(undefined),
  upsertKeyDate: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', keyDates: [] }),
  deleteKeyDate: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', keyDates: [] }),
  upsertKeyReference: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', keyReferences: [] }),
  deleteKeyReference: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', keyReferences: [] })
}
const mockDocumentService = {
  listDocuments: vi.fn().mockResolvedValue([]),
  saveMetadata: vi.fn().mockResolvedValue(undefined),
  relocateMetadata: vi.fn().mockResolvedValue(undefined),
  resolveRegisteredDossierRoot: vi.fn().mockResolvedValue('/path')
}

function makeServices(overrides?: { contacts?: ContactRecord[]; templates?: TemplateRecord[] }): {
  contactService: ContactServiceLike
  templateService: TemplateServiceLike
  generateService: GenerateServiceLike
  dossierService: typeof mockDossierService
  documentService: typeof mockDocumentService
} {
  return {
    contactService: {
      list: vi.fn().mockResolvedValue(overrides?.contacts ?? mockContacts),
      upsert: vi.fn().mockResolvedValue(mockContacts[0]),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    templateService: {
      list: vi.fn().mockResolvedValue(overrides?.templates ?? mockTemplates),
      getContent: vi.fn().mockResolvedValue('<p>{{contact.firstName}}</p>'),
      create: vi.fn().mockResolvedValue(mockTemplates[0]),
      update: vi.fn().mockResolvedValue(mockTemplates[0]),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    generateService: {
      generateDocument: vi.fn().mockResolvedValue({ outputPath: '/output/doc.docx' })
    },
    dossierService: mockDossierService,
    documentService: mockDocumentService
  }
}

describe('intentDispatcher', () => {
  describe('contact_lookup', () => {
    it('returns all contacts when no query', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch({ type: 'contact_lookup' }, { dossierId: 'dos1' })
      expect(result.feedback).toContain('4 contact(s):')
    })

    it('uses the active dossier for contact_lookup_active', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_lookup_active' },
        { dossierId: 'dos1' }
      )

      expect(services.contactService.list).toHaveBeenCalledWith('dos1')
      expect(result.feedback).toContain('4 contact(s):')
    })

    it('ignores query and still returns the full contact list', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_lookup', query: 'Exemple' },
        { dossierId: 'dos1' }
      )
      expect(result.feedback).toContain('4 contact(s):')
      expect(result.feedback).toContain('Contact Exemple-A')
      expect(result.feedback).toContain('Contact Exemple-B')
    })

    it('treats generic contact query terms as an unfiltered list request', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_lookup', query: 'contacts' },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toContain('4 contact(s):')
    })

    it('ignores lookup query even when it contains a full contact name', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_lookup', query: 'Contact Secondaire Tertiaire EXEMPLE-C' },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toContain('4 contact(s):')
      expect(result.feedback).toContain('Contact EXEMPLE-C')
    })

    it('still returns the full list when query text matches nothing', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_lookup', query: 'Zzz' },
        { dossierId: 'dos1' }
      )
      expect(result.feedback).toContain('4 contact(s):')
    })
  })

  describe('contact_get', () => {
    it('resolves a contact even when contactId contains a contact name', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_get', contactId: 'Contact EXEMPLE-C' },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toContain('Nom: Contact EXEMPLE-C')
      expect(result.feedback).toContain('Téléphone: 0601020304')
    })
  })

  describe('contact_upsert', () => {
    it('merges existing contact fields before persisting an update', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      await dispatcher.dispatch(
        { type: 'contact_upsert', id: 'c1', phone: '0600000000' },
        { dossierId: 'dos1' }
      )

      expect(services.contactService.list).toHaveBeenCalledWith('dos1')
      expect(services.contactService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'c1',
          dossierId: 'dos1',
          firstName: 'Contact',
          lastName: 'Exemple',
          role: 'tenant',
          phone: '0600000000'
        })
      )
    })
  })

  describe('contact_delete', () => {
    it('resolves a contact name to the stored contact id before deleting', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'contact_delete', contactId: 'Contact EXEMPLE-C' },
        { dossierId: 'dos1' }
      )

      expect(services.contactService.list).toHaveBeenCalledWith('dos1')
      expect(services.contactService.delete).toHaveBeenCalledWith('dos1', 'contact-exemple-complet')
      expect(result.feedback).toBe('Contact supprimé.')
    })

    it('returns a clarification request instead of deleting when multiple contacts match', async () => {
      const services = makeServices({
        contacts: [
          {
            uuid: 'c1',
            dossierId: 'dos1',
            firstName: 'Caroline',
            lastName: 'Merlin',
            role: 'Client'
          } as ContactRecord,
          {
            uuid: 'c2',
            dossierId: 'dos1',
            firstName: 'Julien',
            lastName: 'Merlin',
            role: 'Huissier'
          } as ContactRecord
        ]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'contact_delete', contactId: 'Merlin' },
        { dossierId: 'dos1' }
      )

      expect(result.intent.type).toBe('clarification_request')
      expect(result.feedback).toBe('Plusieurs contacts correspondent. Lequel supprimer ?')
      expect(
        (result.intent.type === 'clarification_request' && result.intent.options) || []
      ).toEqual(['Caroline Merlin — Client', 'Julien Merlin — Huissier'])
      expect(result.intent.type === 'clarification_request' ? result.intent.optionIds : []).toEqual(
        ['c1', 'c2']
      )
      expect(services.contactService.delete).not.toHaveBeenCalled()
    })
  })

  describe('template_select', () => {
    it('selects an exact template match', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'template_select', templateName: 'NDA Standard' },
        {}
      )
      expect(result.feedback).toContain('Modèle "NDA Standard" sélectionné.')
    })

    it('returns clarification when no template matches but close match found', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'template_select', templateName: 'Bail' },
        {}
      )
      expect(['template_select', 'clarification_request', 'unknown']).toContain(result.intent.type)
    })

    it('returns unknown when no template matches at all', async () => {
      const services = makeServices({ templates: [] })
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'template_select', templateName: 'Nonexistent' },
        {}
      )
      expect(result.intent.type).toBe('unknown')
    })
  })

  describe('field_populate', () => {
    it('returns feedback with contact name', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'field_populate', contactId: 'c1', templateId: 'tpl1' },
        { dossierId: 'dos1' }
      )
      expect(result.feedback).toContain('Contact Exemple')
    })
  })

  describe('document_generate', () => {
    it('calls generateService and returns filename in feedback', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'document_generate', dossierId: 'dos1', templateId: 'tpl1', contactId: 'c1' },
        { dossierId: 'dos1' }
      )
      expect(services.generateService.generateDocument).toHaveBeenCalledWith(
        expect.objectContaining({ dossierId: 'dos1', templateId: 'tpl1', primaryContactId: 'c1' })
      )
      expect(result.feedback).toContain('doc.docx')
    })
  })

  describe('direct_response', () => {
    it('returns the assistant message as feedback', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'direct_response', message: 'Voici la reponse finale.' },
        {}
      )
      expect(result.intent.type).toBe('direct_response')
      expect(result.feedback).toBe('Voici la reponse finale.')
      expect(services.generateService.generateDocument).not.toHaveBeenCalled()
    })
  })

  describe('clarification_request', () => {
    it('returns without executing any action', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        {
          type: 'clarification_request',
          question: 'Which contact?',
          options: ['Contact Exemple-A', 'Contact Exemple-B']
        },
        {}
      )
      expect(result.intent.type).toBe('clarification_request')
      expect(result.feedback).toBe('Which contact?')
      expect(services.generateService.generateDocument).not.toHaveBeenCalled()
      expect(services.contactService.list).not.toHaveBeenCalled()
    })
  })

  describe('unknown', () => {
    it('returns the message as feedback', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'unknown', message: "I couldn't understand that." },
        {}
      )
      expect(result.intent.type).toBe('unknown')
      expect(result.feedback).toBe("I couldn't understand that.")
      expect(services.generateService.generateDocument).not.toHaveBeenCalled()
    })
  })
})
