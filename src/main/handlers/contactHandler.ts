import { IPC_CHANNELS, type IpcError } from '@shared/types'

import {
  contactDeleteInputSchema,
  contactUpsertInputSchema,
  dossierScopedQuerySchema
} from '@shared/validation'

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
}
