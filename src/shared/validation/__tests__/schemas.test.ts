import { describe, expect, it } from 'vitest'

import {
  dossierDetailSchema,
  dossierMetadataFileSchema,
  dossierKeyDateDeleteInputSchema,
  dossierKeyDateUpsertInputSchema,
  dossierKeyReferenceDeleteInputSchema,
  dossierKeyReferenceUpsertInputSchema,
  contactUpsertInputSchema,
  documentMetadataDraftSchema,
  documentRelocationInputSchema,
  documentMetadataUpdateSchema,
  dossierEligibleFolderSchema,
  dossierRegistrationInputSchema,
  dossierSchema,
  dossierStatusSchema,
  dossierUpdateInputSchema,
  entityProfileSchema,
  entityProfileDraftSchema,
  aiCommandInputSchema,
  aiSettingsSaveSchema,
  keyDateSchema,
  keyReferenceSchema,
  templateDraftSchema
} from '../index'

describe('schema contracts', () => {
  it('validates dossier summary/detail fields and rejects unsupported statuses', () => {
    expect(
      dossierSchema.parse({
        id: 'dos-1',
        name: 'LASTNAME-A',
        type: '',
        status: 'active',
        updatedAt: '2026-03-11T12:00:00Z',
        lastOpenedAt: null,
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      })
    ).toMatchObject({ id: 'dos-1', name: 'LASTNAME-A' })

    expect(
      dossierDetailSchema.parse({
        id: 'dos-1',
        name: 'LASTNAME-A',
        registeredAt: '2026-03-11T11:00:00Z',
        type: '',
        status: 'pending',
        updatedAt: '2026-03-11T12:00:00Z',
        lastOpenedAt: null,
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null,
        information: '  Current status and summary  ',
        keyDates: [],
        keyReferences: []
      })
    ).toMatchObject({ status: 'pending', type: '', information: 'Current status and summary' })

    expect(
      dossierMetadataFileSchema.parse({
        id: 'dos-1',
        name: 'LASTNAME-A',
        registeredAt: '2026-03-11T11:00:00Z',
        type: '',
        status: 'pending',
        updatedAt: '2026-03-11T12:00:00Z',
        lastOpenedAt: null,
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null,
        information: '  Ongoing note  ',
        keyDates: [],
        keyReferences: []
      })
    ).toMatchObject({ documents: [], information: 'Ongoing note' })

    expect(dossierStatusSchema.parse('archived')).toBe('archived')

    expect(() =>
      dossierRegistrationInputSchema.parse({
        id: ''
      })
    ).toThrowError()

    expect(
      dossierEligibleFolderSchema.parse({
        id: 'dos-1',
        name: 'LASTNAME-A',
        path: '/tmp/domain/LASTNAME-A'
      })
    ).toMatchObject({ id: 'dos-1' })

    expect(
      dossierUpdateInputSchema.parse({
        id: 'dos-1',
        status: 'completed',
        type: 'Civil litigation',
        information: '  Updated summary  '
      })
    ).toMatchObject({ status: 'completed', information: 'Updated summary' })

    expect(() => dossierStatusSchema.parse('registered')).toThrowError()
    expect(() =>
      dossierUpdateInputSchema.parse({
        id: 'dos-1',
        status: 'registered',
        type: ''
      })
    ).toThrowError()
  })

  it('preserves extended AI settings and command context fields', () => {
    expect(
      aiSettingsSaveSchema.parse({
        mode: 'remote',
        remoteProvider: 'https://api.example.com/v1',
        piiEnabled: true,
        piiWordlist: ['Société discrète', 'Projet Alpha'],
        claudeCoworkEnabled: true
      })
    ).toMatchObject({
      mode: 'remote',
      piiWordlist: ['Société discrète', 'Projet Alpha'],
      claudeCoworkEnabled: true
    })

    expect(
      aiCommandInputSchema.parse({
        command: 'Analyse @assignation.pdf',
        context: {
          dossierId: 'dos-1',
          pendingTagPaths: ['dossier.keyDate.audience.long'],
          documentMentions: [{ uuid: 'doc-uuid-1', filename: 'assignation.pdf' }]
        }
      })
    ).toMatchObject({
      context: {
        pendingTagPaths: ['dossier.keyDate.audience.long'],
        documentMentions: [{ uuid: 'doc-uuid-1', filename: 'assignation.pdf' }]
      }
    })
  })

  it('accepts optional contact id for upsert and validates dossier binding', () => {
    expect(
      contactUpsertInputSchema.parse({
        dossierId: 'dos-1',
        displayName: 'Camille LASTNAME-B',
        gender: 'F',
        institution: '  LASTNAME-B SARL  ',
        email: '',
        information: '  Main client contact  '
      })
    ).toMatchObject({
      dossierId: 'dos-1',
      gender: 'F',
      institution: 'LASTNAME-B SARL',
      email: undefined,
      information: 'Main client contact'
    })

    expect(
      contactUpsertInputSchema.parse({
        dossierId: 'dos-1',
        displayName: 'Camille LASTNAME-B',
        role: 'Client',
        gender: 'M',
        email: 'contact@example.com'
      })
    ).toMatchObject({ email: 'contact@example.com', gender: 'M' })

    expect(() =>
      contactUpsertInputSchema.parse({
        dossierId: '',
        displayName: 'Camille LASTNAME-B',
        role: 'Client'
      })
    ).toThrowError()

    expect(() =>
      contactUpsertInputSchema.parse({
        dossierId: 'dos-1',
        displayName: 'Camille LASTNAME-B',
        role: 'Client',
        email: 'invalid'
      })
    ).toThrowError()

    expect(
      contactUpsertInputSchema.parse({
        dossierId: 'dos-1',
        displayName: 'Institution',
        gender: ''
      })
    ).toMatchObject({ gender: undefined })

    expect(() =>
      contactUpsertInputSchema.parse({
        dossierId: 'dos-1',
        displayName: 'Camille LASTNAME-B',
        gender: 'X'
      })
    ).toThrowError()
  })

  it('applies lawyer managed contact field defaults for entity profiles', () => {
    const entity = entityProfileSchema.parse({
      firmName: 'Cabinet ABC'
    })

    expect(entity.managedFields!.contacts!.map((entry) => entry.label)).toEqual([
      'Prénoms complémentaires',
      'Nom de jeune fille',
      'Date de naissance',
      'Nationalité',
      'Pays de naissance',
      'Profession',
      'N° sécurité sociale'
    ])
    expect(entity.managedFields!.keyDates!.map((entry) => entry.label)).toEqual([
      "Date d'audience",
      'Date de délibéré',
      'Date de renvoi'
    ])
    expect(entity.managedFields!.keyReferences!.map((entry) => entry.label)).toEqual([
      'Juridiction',
      'Tribunal',
      'N° dossier',
      'N° RG',
      'N° Portalis',
      'N° dossier adverse'
    ])
  })

  it('validates template format contract and metadata-like schema contracts', () => {
    expect(
      templateDraftSchema.parse({
        name: 'Courrier',
        content: 'Bonjour {{client}}'
      })
    ).toMatchObject({ name: 'Courrier' })

    expect(
      templateDraftSchema.parse({
        name: 'Courrier',
        content: ''
      })
    ).toMatchObject({ name: 'Courrier', content: '' })

    expect(
      keyDateSchema.parse({
        id: 'kd-1',
        dossierId: 'dos-1',
        label: 'Audience',
        date: '2026-05-02'
      })
    ).toMatchObject({ id: 'kd-1' })

    expect(
      keyReferenceSchema.parse({
        id: 'kr-1',
        dossierId: 'dos-1',
        label: 'Tribunal',
        value: 'TJ Paris'
      })
    ).toMatchObject({ id: 'kr-1' })

    expect(
      dossierKeyDateUpsertInputSchema.parse({
        dossierId: 'dos-1',
        label: 'Hearing',
        date: '2026-05-02'
      })
    ).toMatchObject({ dossierId: 'dos-1' })

    expect(
      dossierKeyDateDeleteInputSchema.parse({
        dossierId: 'dos-1',
        keyDateId: 'kd-1'
      })
    ).toMatchObject({ keyDateId: 'kd-1' })

    expect(
      dossierKeyReferenceUpsertInputSchema.parse({
        dossierId: 'dos-1',
        label: 'Case number',
        value: 'RG 26/001'
      })
    ).toMatchObject({ dossierId: 'dos-1' })

    expect(
      dossierKeyReferenceDeleteInputSchema.parse({
        dossierId: 'dos-1',
        keyReferenceId: 'kr-1'
      })
    ).toMatchObject({ keyReferenceId: 'kr-1' })
  })

  it('enforces entity profile and document metadata payload shape', () => {
    expect(
      entityProfileSchema.parse({
        firmName: 'Cabinet LASTNAME-B',
        address: '12 rue de la Paix, 75001 Paris',
        vatNumber: 'FR12345678901',
        email: 'contact@example.com',
        phone: '+33 1 02 03 04 05'
      })
    ).toMatchObject({ firmName: 'Cabinet LASTNAME-B', vatNumber: 'FR12345678901' })

    expect(() =>
      entityProfileDraftSchema.parse({
        firmName: 'Cabinet LASTNAME-B',
        email: 'invalid',
        phone: '+33 1 02 03 04 05'
      })
    ).toThrowError()

    expect(() =>
      entityProfileSchema.parse({
        firmName: '',
        email: 'contact@example.com'
      })
    ).toThrowError()

    expect(
      documentMetadataUpdateSchema.parse({
        dossierId: 'dos-1',
        documentId: 'doc-1',
        description: '  Incoming note  ',
        tags: [' urgent ', 'urgent', 'client']
      })
    ).toMatchObject({ description: 'Incoming note', tags: ['urgent', 'client'] })

    expect(
      documentMetadataDraftSchema.parse({
        description: '  Ready to file  ',
        tagsInput: ' urgent, client, urgent ,, filing '
      })
    ).toMatchObject({
      description: 'Ready to file',
      tags: ['urgent', 'client', 'filing']
    })

    expect(
      documentRelocationInputSchema.parse({
        dossierId: 'dos-1',
        documentUuid: 'doc-uuid-1',
        fromDocumentId: 'old/path/note.txt',
        toDocumentId: 'new/path/note.txt'
      })
    ).toMatchObject({
      dossierId: 'dos-1',
      documentUuid: 'doc-uuid-1',
      fromDocumentId: 'old/path/note.txt',
      toDocumentId: 'new/path/note.txt'
    })
  })
})
