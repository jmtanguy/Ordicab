import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type ContactDeleteInput,
  type ContactRecord,
  type ContactUpsertInput,
  type DossierScopedQuery,
  type IpcError,
  type IpcResult
} from '@shared/types'

import {
  contactDeleteInputSchema,
  contactRecordSchema,
  contactUpsertInputSchema,
  dossierScopedQuerySchema
} from '@renderer/schemas'

import { type DocumentService, DocumentServiceError } from '../services/domain/documentService'
import { pathExists } from '../lib/system/domainState'
import { atomicWrite } from '../lib/system/atomicWrite'
import { getDossierContactsPath } from '../lib/ordicab/ordicabPaths'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

class ContactHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ContactHandlerError'
  }
}

function mapContactError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid contact input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof DocumentServiceError || error instanceof ContactHandlerError) {
    return {
      success: false,
      error: error.message,
      code: error.code
    }
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    code: IpcErrorCode.FILE_SYSTEM_ERROR
  }
}

async function loadContacts(contactsPath: string): Promise<ContactRecord[]> {
  if (!(await pathExists(contactsPath))) {
    return []
  }

  let raw: string

  try {
    raw = await readFile(contactsPath, 'utf8')
  } catch {
    throw new ContactHandlerError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read dossier contacts.'
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new ContactHandlerError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored dossier contacts are invalid.'
    )
  }

  const result = contactRecordSchema.array().safeParse(parsed)

  if (!result.success) {
    throw new ContactHandlerError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored dossier contacts are invalid.'
    )
  }

  return result.data
}

async function saveContacts(contactsPath: string, contacts: ContactRecord[]): Promise<void> {
  await atomicWrite(contactsPath, `${JSON.stringify(contacts, null, 2)}\n`)
}

export function registerContactHandlers(options: {
  documentService: DocumentService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.contact.list,
    async (_event, input: unknown): Promise<IpcResult<ContactRecord[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        const dossierPath = await options.documentService.resolveRegisteredDossierRoot(parsed)
        return {
          success: true,
          data: await loadContacts(getDossierContactsPath(dossierPath))
        }
      } catch (error) {
        return mapContactError(error, 'Unable to load dossier contacts.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.contact.upsert,
    async (_event, input: unknown): Promise<IpcResult<ContactRecord>> => {
      try {
        const parsed = contactUpsertInputSchema.parse(input) as ContactUpsertInput
        const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
          dossierId: parsed.dossierId
        })
        const contactsPath = getDossierContactsPath(dossierPath)
        const contacts = await loadContacts(contactsPath)
        const existingIndex = parsed.id
          ? contacts.findIndex((contact) => contact.uuid === parsed.id)
          : -1

        if (parsed.id && existingIndex === -1) {
          throw new ContactHandlerError(IpcErrorCode.NOT_FOUND, 'This contact was not found.')
        }

        const nextContact = contactRecordSchema.parse({
          ...parsed,
          uuid: parsed.id ?? randomUUID()
        })

        const nextContacts = [...contacts]

        if (existingIndex >= 0) {
          nextContacts[existingIndex] = nextContact
        } else {
          nextContacts.push(nextContact)
        }

        await saveContacts(contactsPath, nextContacts)

        return {
          success: true,
          data: nextContact
        }
      } catch (error) {
        return mapContactError(error, 'Unable to save dossier contact.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.contact.delete,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = contactDeleteInputSchema.parse(input) as ContactDeleteInput
        const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
          dossierId: parsed.dossierId
        })
        const contactsPath = getDossierContactsPath(dossierPath)
        const contacts = await loadContacts(contactsPath)

        if (!contacts.some((contact) => contact.uuid === parsed.contactUuid)) {
          throw new ContactHandlerError(IpcErrorCode.NOT_FOUND, 'This contact was not found.')
        }

        await saveContacts(
          contactsPath,
          contacts.filter((contact) => contact.uuid !== parsed.contactUuid)
        )

        return {
          success: true,
          data: null
        }
      } catch (error) {
        return mapContactError(error, 'Unable to delete dossier contact.')
      }
    }
  )
}
