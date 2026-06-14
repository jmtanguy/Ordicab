import { IPC_CHANNELS, type IpcError } from '@shared/types'

import {
  conflictCheckInputSchema,
  contactDeleteInputSchema,
  contactUpsertInputSchema,
  dossierScopedQuerySchema
} from '@shared/validation'

import type { ConflictCheckService } from '../services/domain/conflictCheckService'
import { type ContactService, ContactServiceError } from '../services/domain/contactService'
import { DocumentServiceError } from '../services/domain/documentService'
import { type IpcMainLike, mapIpcError, registerIpcCommand, registerIpcHandler } from './ipc'

const mapContactError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid contact input.',
    errorClasses: [ContactServiceError, DocumentServiceError]
  })

export function registerContactHandlers(options: {
  contactService: ContactService
  conflictCheckService: ConflictCheckService
  ipcMain: IpcMainLike
}): void {
  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.contact.list,
    schema: dossierScopedQuerySchema,
    fallback: 'Unable to load dossier contacts.',
    mapError: mapContactError,
    handle: (input) => options.contactService.list(input.dossierId)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.contact.upsert,
    schema: contactUpsertInputSchema,
    fallback: 'Unable to save dossier contact.',
    mapError: mapContactError,
    handle: (input) => options.contactService.upsert(input)
  })

  registerIpcCommand({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.contact.delete,
    schema: contactDeleteInputSchema,
    fallback: 'Unable to delete dossier contact.',
    mapError: mapContactError,
    handle: (input) => options.contactService.delete(input.dossierId, input.contactUuid)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.contact.checkConflicts,
    schema: conflictCheckInputSchema,
    fallback: 'Unable to check for conflicts of interest.',
    mapError: mapContactError,
    handle: (input) => options.conflictCheckService.check(input)
  })
}
