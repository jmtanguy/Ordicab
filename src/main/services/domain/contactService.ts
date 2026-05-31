/**
 * contactService — service for reading and mutating contacts on the file system.
 *
 * Contacts are stored per-dossier as individual JSON files under contacts/{uuid}.json,
 * with a contacts-index.json for fast listing.
 *
 * Called by: intentDispatcher (contact_lookup, contact_create, contact_update, contact_delete intents)
 *            aiService (context enrichment for system prompt)
 */
import { randomUUID } from 'node:crypto'

import type { ContactRecord, ContactUpsertInput } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'

import { contactIndexSchema, contactRecordSchema } from '@shared/validation'
import type { ContactIndex, ContactIndexEntry } from '@shared/validation'
import type { DocumentService } from './documentService'
import {
  deleteRecord,
  loadAllRecords,
  loadIndex,
  loadRecord,
  saveIndex,
  saveRecord
} from '../../lib/system/perFileStore'
import {
  getDossierContactIndexPath,
  getDossierContactRecordPath,
  getDossierContactsDirectoryPath
} from '../../lib/ordicab/ordicabPaths'

const EMPTY_CONTACT_INDEX: ContactIndex = {
  contacts: [],
  updatedAt: new Date(0).toISOString()
}

/**
 * Reads all contacts for a dossier directly from the per-file storage.
 * Use this from services that have a dossierPath but no ContactService instance.
 */
export async function readContactsForDossierPath(dossierPath: string): Promise<ContactRecord[]> {
  return loadAllRecords(getDossierContactsDirectoryPath(dossierPath), contactRecordSchema)
}

export interface ContactService {
  list(dossierId: string): Promise<ContactRecord[]>
  upsert(input: ContactUpsertInput): Promise<ContactRecord>
  delete(dossierId: string, contactId: string): Promise<void>
}

export class ContactServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ContactServiceError'
  }
}

export function createContactService(options: {
  documentService: DocumentService
}): ContactService {
  const { documentService } = options

  async function loadIdx(dossierPath: string): Promise<ContactIndex> {
    return loadIndex(
      getDossierContactIndexPath(dossierPath),
      contactIndexSchema,
      EMPTY_CONTACT_INDEX
    )
  }

  async function saveIdx(dossierPath: string, index: ContactIndex): Promise<void> {
    return saveIndex(getDossierContactIndexPath(dossierPath), index)
  }

  async function updateIdx(
    dossierPath: string,
    contact: ContactRecord,
    op: 'upsert' | 'remove'
  ): Promise<void> {
    const index = await loadIdx(dossierPath)
    const entry: ContactIndexEntry = {
      uuid: contact.uuid,
      displayName: computeContactDisplayName(contact),
      role: contact.role,
      updatedAt: new Date().toISOString()
    }
    const filtered = index.contacts.filter((e) => e.uuid !== contact.uuid)
    await saveIdx(dossierPath, {
      ...index,
      contacts: op === 'upsert' ? [...filtered, entry] : filtered,
      updatedAt: new Date().toISOString()
    })
  }

  return {
    async list(dossierId: string): Promise<ContactRecord[]> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      return readContactsForDossierPath(dossierPath)
    },

    async upsert(input: ContactUpsertInput): Promise<ContactRecord> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: input.dossierId
      })

      if (input.id) {
        const existing = await loadRecord(
          getDossierContactRecordPath(dossierPath, input.id),
          contactRecordSchema
        )
        if (!existing) {
          throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
        }
      }

      const nextContact = contactRecordSchema.parse({ ...input, uuid: input.id ?? randomUUID() })
      await saveRecord(
        getDossierContactsDirectoryPath(dossierPath),
        getDossierContactRecordPath(dossierPath, nextContact.uuid),
        nextContact
      )
      await updateIdx(dossierPath, nextContact, 'upsert')
      return nextContact
    },

    async delete(dossierId: string, contactId: string): Promise<void> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })

      const existing = await loadRecord(
        getDossierContactRecordPath(dossierPath, contactId),
        contactRecordSchema
      )
      if (!existing) {
        throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
      }

      await deleteRecord(getDossierContactRecordPath(dossierPath, contactId))
      await updateIdx(dossierPath, existing, 'remove')
    }
  }
}
