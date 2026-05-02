import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DossierDetail,
  type DossierEligibleFolder,
  type DossierScopedQuery,
  type DossierSummary,
  type DossierUpdateInput,
  type IpcError,
  type IpcResult
} from '@shared/types'

import {
  dossierRegistrationInputSchema,
  dossierScopedQuerySchema,
  dossierUnregisterInputSchema,
  dossierUpdateInputSchema
} from '@shared/validation/dossier'
import {
  dossierKeyDateDeleteInputSchema,
  dossierKeyDateUpsertInputSchema
} from '@shared/validation/keyDate'
import {
  dossierKeyReferenceDeleteInputSchema,
  dossierKeyReferenceUpsertInputSchema
} from '@shared/validation/keyReference'

import {
  DossierRegistryError,
  type DossierRegistryService
} from '../services/domain/dossierRegistryService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapDossierError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid dossier input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof DossierRegistryError) {
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

export function registerDossierHandlers(options: {
  dossierService: DossierRegistryService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.dossier.listEligible,
    async (): Promise<IpcResult<DossierEligibleFolder[]>> => {
      try {
        return {
          success: true,
          data: await options.dossierService.listEligibleFolders()
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to load eligible dossier folders.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.list,
    async (): Promise<IpcResult<DossierSummary[]>> => {
      try {
        return {
          success: true,
          data: await options.dossierService.listRegisteredDossiers()
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to load registered dossiers.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.get,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.dossierService.getDossier(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to load dossier details.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.open,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.dossierService.openDossier(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to open dossier details.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.register,
    async (_event, input: unknown): Promise<IpcResult<DossierSummary>> => {
      try {
        const parsed = dossierRegistrationInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.registerDossier(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to register dossier.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.update,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierUpdateInputSchema.parse(input) as DossierUpdateInput
        return {
          success: true,
          data: await options.dossierService.updateDossier(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to update dossier details.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.upsertKeyDate,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierKeyDateUpsertInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.upsertKeyDate(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to save dossier key date.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.deleteKeyDate,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierKeyDateDeleteInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.deleteKeyDate(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to delete dossier key date.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.upsertKeyReference,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierKeyReferenceUpsertInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.upsertKeyReference(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to save dossier key reference.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.deleteKeyReference,
    async (_event, input: unknown): Promise<IpcResult<DossierDetail>> => {
      try {
        const parsed = dossierKeyReferenceDeleteInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.deleteKeyReference(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to delete dossier key reference.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.unregister,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = dossierUnregisterInputSchema.parse(input)
        return {
          success: true,
          data: await options.dossierService.unregisterDossier(parsed)
        }
      } catch (error) {
        return mapDossierError(error, 'Unable to unregister dossier.')
      }
    }
  )
}
