import { IPC_CHANNELS, type IpcError, type IpcResult, type ComparisonResult } from '@shared/types'

import { compareRunInputSchema } from '@shared/validation'

import { type ComparisonService } from '../services/domain/compare/comparisonService'
import { DocumentServiceError } from '../services/domain/documentService'
import { type IpcSenderLike, mapIpcError } from './ipc'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

const mapCompareError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid comparison input.',
    errorClasses: [DocumentServiceError]
  })

export function registerCompareHandlers(options: {
  comparisonService: ComparisonService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.compare.run,
    async (event, input: unknown): Promise<IpcResult<ComparisonResult>> => {
      try {
        const parsed = compareRunInputSchema.parse(input)
        const data = await options.comparisonService.compare(parsed, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.compare.progress, progress)
          }
        })
        return { success: true, data }
      } catch (error) {
        return mapCompareError(error, 'Unable to compare the selected documents.')
      }
    }
  )
}
