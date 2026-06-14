import {
  IPC_CHANNELS,
  type CoworkExportProgress,
  type CoworkExportResult,
  type CoworkReimportResult,
  type CoworkStatus,
  type IpcError,
  type IpcResult
} from '@shared/types'

import { coworkScopedInputSchema } from '@shared/validation/cowork'

import {
  CoworkServiceError,
  type CoworkExportService
} from '../services/domain/coworkExportService'
import { type IpcSenderLike, mapIpcError } from './ipc'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

const mapCoworkError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid Cowork input.',
    errorClasses: [CoworkServiceError]
  })

export function registerCoworkHandlers(options: {
  coworkExportService: CoworkExportService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.cowork.export,
    async (event, input: unknown): Promise<IpcResult<CoworkExportResult>> => {
      try {
        const parsed = coworkScopedInputSchema.parse(input)
        const data = await options.coworkExportService.exportDossier(
          parsed,
          (progress: CoworkExportProgress) => {
            if (event.sender.isDestroyed()) return
            event.sender.send(IPC_CHANNELS.cowork.exportProgress, progress)
          }
        )
        return { success: true, data }
      } catch (error) {
        return mapCoworkError(error, 'Unable to export the dossier for Claude Cowork.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.cowork.reimport,
    async (_event, input: unknown): Promise<IpcResult<CoworkReimportResult>> => {
      try {
        const parsed = coworkScopedInputSchema.parse(input)
        const data = await options.coworkExportService.reimportResults(parsed)
        return { success: true, data }
      } catch (error) {
        return mapCoworkError(error, 'Unable to reimport Claude Cowork results.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.cowork.status,
    async (_event, input: unknown): Promise<IpcResult<CoworkStatus>> => {
      try {
        const parsed = coworkScopedInputSchema.parse(input)
        const data = await options.coworkExportService.getStatus(parsed)
        return { success: true, data }
      } catch (error) {
        return mapCoworkError(error, 'Unable to load the Claude Cowork export status.')
      }
    }
  )
}
