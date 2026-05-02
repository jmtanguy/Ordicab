import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type EntityProfile,
  type EntityProfileDraft,
  type IpcError,
  type IpcResult
} from '@shared/types'

import { entityProfileDraftSchema } from '@shared/validation'

import { type EntityService, EntityServiceError } from '../services/domain/entityService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapEntityError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid entity input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof EntityServiceError) {
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

export function registerEntityHandlers(options: {
  entityService: EntityService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.entity.get,
    async (): Promise<IpcResult<EntityProfile | null>> => {
      try {
        return { success: true, data: await options.entityService.get() }
      } catch (error) {
        return mapEntityError(error, 'Unable to load professional entity profile.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.update,
    async (_event, input: unknown): Promise<IpcResult<EntityProfile>> => {
      try {
        const parsed = entityProfileDraftSchema.parse(input) as EntityProfileDraft
        return { success: true, data: await options.entityService.update(parsed) }
      } catch (error) {
        return mapEntityError(error, 'Unable to save professional entity profile.')
      }
    }
  )
}
