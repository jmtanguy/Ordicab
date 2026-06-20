import { describe, expect, it, vi } from 'vitest'

import type { ContactRecord, TemplateRecord } from '@shared/types'

import { createInternalAICommandDispatcher } from '../aiCommandDispatcher'
import type {
  ContactServiceLike,
  GenerateServiceLike,
  TemplateServiceLike
} from '../aiCommandDispatcher'
import { GenerateServiceError } from '../../../services/domain/generateService'
import { IpcErrorCode } from '@shared/types/ipcErrors'

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
  { uuid: 'tpl1', name: 'NDA Standard' } as unknown as TemplateRecord,
  { uuid: 'tpl2', name: 'Bail commercial' } as unknown as TemplateRecord
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
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', keyReferences: [] }),
  upsertBillingItem: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', billingItems: [] }),
  deleteBillingItem: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', billingItems: [] }),
  upsertNote: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', notes: [] }),
  deleteNote: vi
    .fn()
    .mockResolvedValue({ id: 'dos1', name: 'Test', status: 'active', type: '', notes: [] }),
  searchNotes: vi.fn().mockResolvedValue([])
}
const mockDocumentService = {
  listDocuments: vi.fn().mockResolvedValue([]),
  saveMetadata: vi.fn().mockResolvedValue(undefined),
  relocateMetadata: vi.fn().mockResolvedValue(undefined),
  renameFile: vi.fn().mockResolvedValue({ filename: 'renamed.pdf' }),
  splitPdf: vi.fn().mockResolvedValue({ relativePaths: [] }),
  createFolder: vi.fn().mockResolvedValue('Factures'),
  moveFiles: vi.fn().mockResolvedValue({ moved: [], failed: [] }),
  resolveRegisteredDossierRoot: vi.fn().mockResolvedValue('/path'),
  semanticSearch: vi.fn().mockResolvedValue({ dossierId: '', query: '', hits: [] })
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
    it('resolves a contact even when contactUuid contains a contact name', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'contact_get', contactUuid: 'Contact EXEMPLE-C' },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toContain('Nom: Contact EXEMPLE-C')
      expect(result.feedback).toContain('Téléphone: 0601020304')
    })
  })

  describe('contact_create / contact_update', () => {
    it('merges existing contact fields before persisting an update', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      await dispatcher.dispatch(
        { type: 'contact_update', contactUuid: 'c1', phone: '0600000000' },
        { dossierId: 'dos1' }
      )

      expect(services.contactService.list).toHaveBeenCalledWith('dos1')
      expect(services.contactService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'c1',
          dossierId: 'dos1',
          firstName: 'Contact',
          lastName: 'Exemple',
          role: 'tenant',
          phone: '0600000000'
        })
      )
    })

    it('merges managed custom fields on contact_update', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      await dispatcher.dispatch(
        {
          type: 'contact_update',
          contactUuid: 'c1',
          customFields: {
            Nationalité: 'Française'
          }
        },
        { dossierId: 'dos1', contactUuid: 'c1' }
      )

      expect(services.contactService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: 'c1',
          dossierId: 'dos1',
          firstName: 'Contact',
          lastName: 'Exemple',
          customFields: {
            nationality: 'Française'
          }
        })
      )
    })

    it('returns contact introuvable when contact_update targets an unknown contact', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'contact_update',
          contactUuid: 'unknown-contact',
          customFields: {
            Nationalité: 'Française',
            Profession: 'Sans profession'
          }
        },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toBe('Contact introuvable.')
      expect(services.contactService.upsert).not.toHaveBeenCalled()
    })

    it('creates a new contact through contact_create', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      await dispatcher.dispatch(
        {
          type: 'contact_create',
          firstName: 'Karine',
          lastName: 'Calvez',
          role: 'Avocat de la partie adverse'
        },
        { dossierId: 'dos1' }
      )

      expect(services.contactService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          dossierId: 'dos1',
          firstName: 'Karine',
          lastName: 'Calvez',
          role: 'Avocat de la partie adverse'
        })
      )
    })

    it('rejects contact_create without explicit identity fields', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'contact_create',
          customFields: {
            Nationalité: 'Française'
          }
        },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toBe(
        "Impossible de créer un contact sans élément d'identité explicite."
      )
      expect(services.contactService.upsert).not.toHaveBeenCalled()
    })
  })

  describe('contact_delete', () => {
    it('resolves a contact name to the stored contact id before deleting', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'contact_delete', contactUuid: 'Contact EXEMPLE-C' },
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
        { type: 'contact_delete', contactUuid: 'Merlin' },
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
        { type: 'field_populate', contactUuid: 'c1', templateUuid: 'tpl1' },
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
        { type: 'document_generate', dossierId: 'dos1', templateUuid: 'tpl1', contactUuid: 'c1' },
        { dossierId: 'dos1' }
      )
      expect(services.generateService.generateDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          dossierId: 'dos1',
          templateUuid: 'tpl1',
          primaryContactUuid: 'c1'
        })
      )
      expect(result.feedback).toContain('doc.docx')
    })

    it('auto-fills tagOverrides from dossier key dates and retries on unresolved tags', async () => {
      const services = makeServices()
      services.dossierService.getDossier = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        keyDates: [
          { uuid: 'kd1', dossierId: 'dos1', label: "Date d'audience", date: '2026-04-21' },
          { uuid: 'kd2', dossierId: 'dos1', label: 'Date de renvoi', date: '2026-06-08' }
        ],
        keyReferences: []
      })

      let callCount = 0
      services.generateService.generateDocument = vi.fn().mockImplementation(async (input) => {
        callCount += 1
        if (callCount === 1) {
          throw new GenerateServiceError(IpcErrorCode.VALIDATION_FAILED, 'unresolved', [
            'dossier.keyDate.audience.long',
            'dossier.keyDate.renvoi.long'
          ])
        }
        return { outputPath: `/output/${callCount}.docx`, tagOverrides: input.tagOverrides }
      })

      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'document_generate', dossierId: 'dos1', templateUuid: 'tpl1', contactUuid: 'c1' },
        { dossierId: 'dos1' }
      )

      expect(callCount).toBe(2)
      const secondCall = (services.generateService.generateDocument as ReturnType<typeof vi.fn>)
        .mock.calls[1]![0]
      expect(secondCall.tagOverrides).toEqual({
        'dossier.keyDate.audience.long': '21 avril 2026',
        'dossier.keyDate.renvoi.long': '8 juin 2026'
      })
      expect(result.feedback).toContain('Document généré')
      expect(result.intent.type).toBe('document_generate')
    })

    it('falls back to a clarification listing the dossier dates when auto-resolve fails', async () => {
      const services = makeServices()
      services.dossierService.getDossier = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        keyDates: [
          { uuid: 'kd1', dossierId: 'dos1', label: "Date d'audience", date: '2026-04-21' }
        ],
        keyReferences: []
      })

      services.generateService.generateDocument = vi.fn().mockImplementation(async () => {
        throw new GenerateServiceError(IpcErrorCode.VALIDATION_FAILED, 'unresolved', [
          'dossier.keyDate.delibere.long'
        ])
      })

      const dispatcher = createInternalAICommandDispatcher(services)
      const result = await dispatcher.dispatch(
        { type: 'document_generate', dossierId: 'dos1', templateUuid: 'tpl1', contactUuid: 'c1' },
        { dossierId: 'dos1' }
      )

      expect(result.intent.type).toBe('clarification_request')
      expect(result.feedback).toContain('Dates et références connues')
      expect(result.feedback).toContain("Date d'audience: 2026-04-21")
      expect(result.feedback).toContain('dossier.keyDate.delibere.long')
    })
  })

  describe('document_metadata_save', () => {
    it('refuses empty document metadata saves', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'document_metadata_save', documentUuid: 'doc1', tags: [] },
        { dossierId: 'dos1' }
      )

      expect(result.feedback).toBe('Aucune métadonnée à enregistrer.')
      expect(services.documentService.saveMetadata).not.toHaveBeenCalled()
    })
  })

  describe('dossier updates', () => {
    it('refuses dossier_update with no actual changes', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch({ type: 'dossier_update', id: 'dos1' }, {})

      expect(result.feedback).toBe('Aucune modification de dossier fournie.')
      expect(services.dossierService.updateDossier).not.toHaveBeenCalled()
    })

    it('resolves dossier_update UUID ids to dossier slugs', async () => {
      const services = makeServices()
      services.dossierService.listRegisteredDossiers = vi.fn().mockResolvedValue([
        {
          slug: 'dos1',
          uuid: 'uuid-dos1',
          name: 'Test',
          status: 'active',
          type: ''
        }
      ])
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_update', id: 'uuid-dos1', status: 'active' },
        {}
      )

      expect(result.feedback).toBe('Dossier "dos1" mis à jour.')
      expect(services.dossierService.updateDossier).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'dos1' })
      )
    })

    it('creates and updates key dates through explicit tools', async () => {
      const services = makeServices()
      services.dossierService.upsertKeyDate = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        keyDates: [
          { uuid: 'kd1', label: 'Audience', date: '2026-05-02', note: 'Initiale' },
          { uuid: 'kd2', label: 'Audience', date: '2026-05-02', note: 'Reportee' }
        ],
        keyReferences: []
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const created = await dispatcher.dispatch(
        {
          type: 'dossier_create_key_date',
          dossierId: 'dos1',
          label: 'Audience',
          date: '2026-05-02',
          note: 'Initiale'
        },
        {}
      )

      const updated = await dispatcher.dispatch(
        {
          type: 'dossier_update_key_date',
          dossierId: 'dos1',
          keyDateUuid: 'kd2',
          label: 'Audience',
          date: '2026-05-02',
          note: 'Reportee'
        },
        {}
      )

      expect(services.dossierService.upsertKeyDate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ dossierId: 'dos1', uuid: undefined, label: 'Audience' })
      )
      expect(services.dossierService.upsertKeyDate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ dossierId: 'dos1', uuid: 'kd2', label: 'Audience' })
      )
      expect(created.feedback).toBe('Événement "Audience" ajouté.')
      expect(updated.feedback).toBe('Événement "Audience" mis à jour.')
    })

    it('refuses dossier_update_key_date with no actual changes', async () => {
      const services = makeServices()
      services.dossierService.upsertKeyDate = vi.fn().mockResolvedValue(undefined)
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'dossier_update_key_date',
          dossierId: 'dos1',
          keyDateUuid: 'kd1',
          label: 'Audience',
          date: '2026-05-02'
        },
        {}
      )

      expect(result.feedback).toBe("Aucune modification d'événement fournie.")
      expect(services.dossierService.upsertKeyDate).not.toHaveBeenCalled()
    })

    it('creates and updates key references through explicit tools', async () => {
      const services = makeServices()
      services.dossierService.upsertKeyReference = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        keyDates: [],
        keyReferences: [
          { uuid: 'kr1', label: 'N° RG', value: '24/0001', note: 'Creation' },
          { uuid: 'kr2', label: 'N° RG', value: '24/0001', note: 'Correction' }
        ]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const created = await dispatcher.dispatch(
        {
          type: 'dossier_create_key_reference',
          dossierId: 'dos1',
          label: 'N° RG',
          value: '24/0001',
          note: 'Creation'
        },
        {}
      )

      const updated = await dispatcher.dispatch(
        {
          type: 'dossier_update_key_reference',
          dossierId: 'dos1',
          keyReferenceUuid: 'kr2',
          label: 'N° RG',
          value: '24/0001',
          note: 'Correction'
        },
        {}
      )

      expect(services.dossierService.upsertKeyReference).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ dossierId: 'dos1', uuid: undefined, label: 'N° RG' })
      )
      expect(services.dossierService.upsertKeyReference).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ dossierId: 'dos1', uuid: 'kr2', label: 'N° RG' })
      )
      expect(created.feedback).toBe('Référence clé "N° RG" ajoutée.')
      expect(updated.feedback).toBe('Référence clé "N° RG" mise à jour.')
    })

    it('refuses dossier_update_key_reference with no actual changes', async () => {
      const services = makeServices()
      services.dossierService.upsertKeyReference = vi.fn().mockResolvedValue(undefined)
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'dossier_update_key_reference',
          dossierId: 'dos1',
          keyReferenceUuid: 'kr1',
          label: 'N° RG',
          value: '24/0001'
        },
        {}
      )

      expect(result.feedback).toBe('Aucune modification de référence clé fournie.')
      expect(services.dossierService.upsertKeyReference).not.toHaveBeenCalled()
    })
  })

  describe('billing items (prestations)', () => {
    const baseBillingItemFields = {
      dossierId: 'dos1',
      date: '2026-05-12',
      label: 'Consultation',
      quantity: 2,
      quantityUnit: 'hours' as const,
      unitPriceHtCents: 15000,
      vatRateBasisPoints: 2000,
      status: 'draft' as const
    }

    it('creates a billing item without computing totals itself', async () => {
      const services = makeServices()
      services.dossierService.upsertBillingItem = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        billingItems: [
          {
            uuid: 'bi1',
            label: 'Consultation',
            date: '2026-05-12',
            quantity: 2,
            quantityUnit: 'hours',
            unitPriceHtCents: 15000,
            totalHtCents: 30000,
            totalTtcCents: 36000,
            status: 'draft'
          }
        ]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_create_billing_item', ...baseBillingItemFields },
        {}
      )

      expect(services.dossierService.upsertBillingItem).toHaveBeenCalledWith(
        expect.objectContaining({
          dossierId: 'dos1',
          uuid: undefined,
          label: 'Consultation',
          quantity: 2,
          quantityUnit: 'hours',
          unitPriceHtCents: 15000,
          vatRateBasisPoints: 2000,
          status: 'draft'
        })
      )
      // Totals must never be passed by the assistant — the service computes them.
      const call = services.dossierService.upsertBillingItem.mock.calls[0]?.[0] ?? {}
      expect(call).not.toHaveProperty('totalHtCents')
      expect(call).not.toHaveProperty('totalTtcCents')
      expect(result.feedback).toBe('Prestation "Consultation" ajoutée.')
      expect(result.entity).toEqual(
        expect.objectContaining({ id: 'bi1', totalHtCents: 30000, totalTtcCents: 36000 })
      )
    })

    it('passes the billingItemUuid through on update', async () => {
      const services = makeServices()
      services.dossierService.upsertBillingItem = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        billingItems: [{ uuid: 'bi1', label: 'Consultation', date: '2026-05-12', status: 'draft' }]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_update_billing_item', billingItemUuid: 'bi1', ...baseBillingItemFields },
        {}
      )

      expect(services.dossierService.upsertBillingItem).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: 'bi1', label: 'Consultation' })
      )
      expect(result.feedback).toBe('Prestation "Consultation" mise à jour.')
    })

    it('deletes a billing item', async () => {
      const services = makeServices()
      services.dossierService.deleteBillingItem = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        billingItems: []
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_delete_billing_item', dossierId: 'dos1', billingItemUuid: 'bi1' },
        {}
      )

      expect(services.dossierService.deleteBillingItem).toHaveBeenCalledWith({
        dossierId: 'dos1',
        billingItemUuid: 'bi1'
      })
      expect(result.feedback).toBe('Prestation supprimée.')
    })

    it('surfaces the guard error when editing an already-invoiced prestation', async () => {
      const services = makeServices()
      const guardMessage =
        'This billing item is already invoiced and cannot be edited. Create a credit note or corrective invoice instead.'
      services.dossierService.upsertBillingItem = vi.fn().mockRejectedValue(new Error(guardMessage))
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_update_billing_item', billingItemUuid: 'bi1', ...baseBillingItemFields },
        {}
      )

      // The failure degrades to an `unknown` intent so the LLM knows it did NOT succeed.
      expect(result.intent.type).toBe('unknown')
      expect(result.feedback).toBe(guardMessage)
    })

    it('surfaces the guard error when deleting an already-invoiced prestation', async () => {
      const services = makeServices()
      const guardMessage =
        'This billing item is already invoiced and cannot be deleted. Create a credit note or corrective invoice instead.'
      services.dossierService.deleteBillingItem = vi.fn().mockRejectedValue(new Error(guardMessage))
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'dossier_delete_billing_item', dossierId: 'dos1', billingItemUuid: 'bi1' },
        {}
      )

      expect(result.intent.type).toBe('unknown')
      expect(result.feedback).toBe(guardMessage)
    })
  })

  describe('notes', () => {
    it('creates a note tagged as AI-sourced and reports it', async () => {
      const services = makeServices()
      services.dossierService.upsertNote = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        notes: [{ uuid: 'note-1', title: 'Vérifier la prescription' }]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'note_create',
          dossierId: 'dos1',
          title: 'Vérifier la prescription',
          content: 'Délai possiblement expiré',
          kind: 'to_verify'
        },
        {}
      )

      expect(services.dossierService.upsertNote).toHaveBeenCalledWith(
        expect.objectContaining({
          dossierId: 'dos1',
          title: 'Vérifier la prescription',
          kind: 'to_verify',
          source: 'ai'
        })
      )
      expect(result.feedback).toBe('Note "Vérifier la prescription" ajoutée.')
    })

    it('updates a note by id', async () => {
      const services = makeServices()
      services.dossierService.upsertNote = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        notes: [{ uuid: 'note-1', title: 'Tâche' }]
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'note_update',
          dossierId: 'dos1',
          noteUuid: 'note-1',
          title: 'Tâche',
          status: 'done'
        },
        {}
      )

      expect(services.dossierService.upsertNote).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: 'note-1', status: 'done', source: 'ai' })
      )
      expect(result.feedback).toBe('Note "Tâche" mise à jour.')
    })

    it('deletes a note', async () => {
      const services = makeServices()
      services.dossierService.deleteNote = vi.fn().mockResolvedValue({
        id: 'dos1',
        name: 'Test',
        status: 'active',
        type: '',
        notes: []
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'note_delete', dossierId: 'dos1', noteUuid: 'note-1' },
        {}
      )

      expect(services.dossierService.deleteNote).toHaveBeenCalledWith({
        dossierId: 'dos1',
        noteUuid: 'note-1'
      })
      expect(result.feedback).toBe('Note supprimée.')
    })
  })

  describe('template_update', () => {
    it('refuses template_update with no actual changes', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch({ type: 'template_update', uuid: 'tpl1' }, {})

      expect(result.feedback).toBe('Aucune modification de modèle fournie.')
      expect(services.templateService.update).not.toHaveBeenCalled()
    })
  })

  describe('document_relocate', () => {
    it('refuses a no-op relocation to the same target path', async () => {
      const services = makeServices()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'document_relocate',
          documentUuid: 'doc-uuid-1',
          dossierId: 'dos1',
          fromDocumentPath: 'piece-a.pdf',
          toDocumentPath: 'piece-a.pdf'
        },
        {}
      )

      expect(result.feedback).toBe(
        'La nouvelle localisation du document est identique a l ancienne.'
      )
      expect(services.documentService.relocateMetadata).not.toHaveBeenCalled()
    })
  })

  describe('document_rename', () => {
    it('renames by explicit documentPath and reports the new filename', async () => {
      const services = makeServices()
      services.documentService.renameFile.mockResolvedValue({ filename: 'Facture EDF 2024.pdf' })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'document_rename',
          dossierId: 'dos1',
          documentPath: 'scan-001.pdf',
          newFilename: 'Facture EDF 2024.pdf'
        },
        {}
      )

      expect(services.documentService.renameFile).toHaveBeenCalledWith({
        dossierId: 'dos1',
        documentPath: 'scan-001.pdf',
        newFilename: 'Facture EDF 2024.pdf',
        onCollision: 'suffix'
      })
      expect(result.feedback).toContain('Facture EDF 2024.pdf')
    })

    it('reuses the source extension when the new name omits one', async () => {
      const services = makeServices()
      services.documentService.renameFile.mockResolvedValue({ filename: 'Facture EDF 2024.pdf' })
      const dispatcher = createInternalAICommandDispatcher(services)

      await dispatcher.dispatch(
        {
          type: 'document_rename',
          dossierId: 'dos1',
          documentPath: 'Pièces/scan-001.pdf',
          newFilename: 'Facture EDF 2024'
        },
        {}
      )

      expect(services.documentService.renameFile).toHaveBeenCalledWith({
        dossierId: 'dos1',
        documentPath: 'Pièces/scan-001.pdf',
        newFilename: 'Facture EDF 2024.pdf',
        onCollision: 'suffix'
      })
    })

    it('refuses when neither documentUuid nor documentPath is provided', async () => {
      const services = makeServices()
      services.documentService.renameFile.mockClear()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'document_rename', dossierId: 'dos1', newFilename: 'x.pdf' },
        {}
      )

      expect(services.documentService.renameFile).not.toHaveBeenCalled()
      expect(result.feedback).toContain('UUID ou chemin requis')
    })
  })

  describe('document_split', () => {
    it('splits by named ranges and reports the created files', async () => {
      const services = makeServices()
      services.documentService.splitPdf.mockResolvedValue({
        relativePaths: ['Facture.pdf', 'Contrat.pdf']
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'document_split',
          dossierId: 'dos1',
          documentPath: 'scan-bundle.pdf',
          mode: {
            ranges: [
              { from: 1, to: 2, filename: 'Facture' },
              { from: 3, to: 5, filename: 'Contrat' }
            ]
          }
        },
        {}
      )

      expect(services.documentService.splitPdf).toHaveBeenCalledWith({
        dossierId: 'dos1',
        documentPath: 'scan-bundle.pdf',
        mode: {
          ranges: [
            { from: 1, to: 2, filename: 'Facture' },
            { from: 3, to: 5, filename: 'Contrat' }
          ]
        }
      })
      expect(result.feedback).toContain('2 fichiers')
      expect(result.feedback).toContain('Facture.pdf')
      expect(result.feedback).toContain('Contrat.pdf')
    })
  })

  describe('document_move', () => {
    it('creates the nested target folder then moves the files by path', async () => {
      const services = makeServices()
      services.documentService.createFolder.mockResolvedValue('Factures')
      services.documentService.moveFiles.mockResolvedValue({
        moved: [{ fromPath: 'scan.pdf', record: { filename: 'scan.pdf' } }],
        failed: []
      })
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        {
          type: 'document_move',
          dossierId: 'dos1',
          documentPaths: ['scan.pdf'],
          targetFolderPath: 'Factures/2024'
        },
        {}
      )

      // One createFolder call per path segment (top-down).
      expect(services.documentService.createFolder).toHaveBeenNthCalledWith(1, {
        dossierId: 'dos1',
        parentPath: '',
        name: 'Factures'
      })
      expect(services.documentService.createFolder).toHaveBeenNthCalledWith(2, {
        dossierId: 'dos1',
        parentPath: 'Factures',
        name: '2024'
      })
      expect(services.documentService.moveFiles).toHaveBeenCalledWith({
        dossierId: 'dos1',
        documentPaths: ['scan.pdf'],
        targetFolderPath: 'Factures/2024',
        onCollision: 'suffix'
      })
      expect(result.feedback).toContain('Factures/2024')
    })

    it('refuses when no documents are provided', async () => {
      const services = makeServices()
      services.documentService.moveFiles.mockClear()
      const dispatcher = createInternalAICommandDispatcher(services)

      const result = await dispatcher.dispatch(
        { type: 'document_move', dossierId: 'dos1', targetFolderPath: 'Factures' },
        {}
      )

      expect(services.documentService.moveFiles).not.toHaveBeenCalled()
      expect(result.feedback).toContain('UUID ou chemin requis')
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
