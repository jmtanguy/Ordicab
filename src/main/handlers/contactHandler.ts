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
  contactUpsertInputSchema,
  dossierScopedQuerySchema
} from '@shared/validation'

import { type ContactService, ContactServiceError } from '../services/domain/contactService'
import { DocumentServiceError } from '../services/domain/documentService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapContactError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid contact input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof ContactServiceError || error instanceof DocumentServiceError) {
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

export function registerContactHandlers(options: {
  contactService: ContactService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.contact.list,
    async (_event, input: unknown): Promise<IpcResult<ContactRecord[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return { success: true, data: await options.contactService.list(parsed.dossierId) }
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
        return { success: true, data: await options.contactService.upsert(parsed) }
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
        await options.contactService.delete(parsed.dossierId, parsed.contactUuid)
        return { success: true, data: null }
      } catch (error) {
        return mapContactError(error, 'Unable to delete dossier contact.')
      }
    }
  )
}
