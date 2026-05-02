/**
 * contactService — service for reading and mutating contacts on the file system.
 *
 * Contacts are stored per-dossier in a JSON file resolved by getDossierContactsPath().
 * This service is used by intentDispatcher and aiService to access contact data
 * directly from the service layer, without going through the contactHandler IPC path.
 *
 * The existing contactHandler still handles IPC-triggered CRUD from the renderer.
 * This service handles the same operations for AI-initiated commands (server-side).
 *
 * Called by: intentDispatcher (contact_lookup, contact_upsert, contact_delete intents)
 *            aiService (context enrichment for system prompt)
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { ContactRecord, ContactUpsertInput } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { contactRecordSchema } from '@shared/validation'
import type { DocumentService } from './documentService'
import { pathExists } from '../../lib/system/domainState'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { getDossierContactsPath } from '../../lib/ordicab/ordicabPaths'

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

  async function loadContacts(contactsPath: string): Promise<ContactRecord[]> {
    if (!(await pathExists(contactsPath))) return []

    let raw: string
    try {
      raw = await readFile(contactsPath, 'utf8')
    } catch {
      throw new ContactServiceError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read contacts.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return []
    }

    const result = contactRecordSchema.array().safeParse(parsed)
    return result.success ? result.data : []
  }

  async function saveContacts(contactsPath: string, contacts: ContactRecord[]): Promise<void> {
    await atomicWrite(contactsPath, `${JSON.stringify(contacts, null, 2)}\n`)
  }

  return {
    async list(dossierId: string): Promise<ContactRecord[]> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      const contactsPath = getDossierContactsPath(dossierPath)
      return loadContacts(contactsPath)
    },

    async upsert(input: ContactUpsertInput): Promise<ContactRecord> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({
        dossierId: input.dossierId
      })
      const contactsPath = getDossierContactsPath(dossierPath)
      const contacts = await loadContacts(contactsPath)

      const existingIndex = input.id ? contacts.findIndex((c) => c.uuid === input.id) : -1

      if (input.id && existingIndex === -1) {
        throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
      }

      const nextContact = contactRecordSchema.parse({ ...input, uuid: input.id ?? randomUUID() })
      const nextContacts = [...contacts]

      if (existingIndex >= 0) {
        nextContacts[existingIndex] = nextContact
      } else {
        nextContacts.push(nextContact)
      }

      await saveContacts(contactsPath, nextContacts)
      return nextContact
    },

    async delete(dossierId: string, contactId: string): Promise<void> {
      const dossierPath = await documentService.resolveRegisteredDossierRoot({ dossierId })
      const contactsPath = getDossierContactsPath(dossierPath)
      const contacts = await loadContacts(contactsPath)

      if (!contacts.some((c) => c.uuid === contactId)) {
        throw new ContactServiceError(IpcErrorCode.NOT_FOUND, 'Contact not found.')
      }

      await saveContacts(
        contactsPath,
        contacts.filter((c) => c.uuid !== contactId)
      )
    }
  }
}
