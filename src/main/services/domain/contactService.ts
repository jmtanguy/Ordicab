/**
 * contactService — service for reading and mutating contacts on the file system.
 *
 * Contacts are stored per-dossier as individual JSON files under contacts/{uuid}.json.
 * Listing reads the directory directly (loadAllRecords) — there is no index.
 *
 * Called by: intentDispatcher (contact_lookup, contact_create, contact_update, contact_delete intents)
 *            aiService (context enrichment for system prompt)
 */
import { randomUUID } from 'node:crypto'

import type { ContactRecord, ContactUpsertInput } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { contactRecordSchema } from '@shared/validation'
import type { DocumentService } from './documentService'
import { deleteRecord, loadAllRecords, loadRecord, saveRecord } from '../../lib/system/perFileStore'
import {
  getDossierContactRecordPath,
  getDossierContactsDirectoryPath
} from '../../lib/ordicab/ordicabPaths'

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
  delete(dossierId: string, contactUuid: string): Promise<void>
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

  return {
    async list(dossierId: string): Promise<ContactRecord[]> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      return readContactsForDossierPath(dossierPath)
    },

    async upsert(input: ContactUpsertInput): Promise<ContactRecord> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: input.dossierId
      })

      if (input.uuid) {
        const existing = await loadRecord(
          getDossierContactRecordPath(dossierPath, input.uuid),
          contactRecordSchema
        )
        if (!existing) {
          throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
        }
      }

      const nextContact = contactRecordSchema.parse({ ...input, uuid: input.uuid ?? randomUUID() })
      await saveRecord(
        getDossierContactsDirectoryPath(dossierPath),
        getDossierContactRecordPath(dossierPath, nextContact.uuid),
        nextContact
      )
      return nextContact
    },

    async delete(dossierId: string, contactUuid: string): Promise<void> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })

      const existing = await loadRecord(
        getDossierContactRecordPath(dossierPath, contactUuid),
        contactRecordSchema
      )
      if (!existing) {
        throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
      }

      await deleteRecord(getDossierContactRecordPath(dossierPath, contactUuid))
    }
  }
}
