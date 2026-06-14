import {
  IPC_CHANNELS,
  type IpcError,
  type IpcResult,
  type PieceGenerateResult,
  type PieceRecord
} from '@shared/types'

import {
  dossierScopedQuerySchema,
  pieceAddInputSchema,
  pieceGenerateInputSchema,
  pieceRemoveInputSchema,
  pieceUpdateInputSchema
} from '@shared/validation'

import { type PiecesService } from '../services/domain/pieces/piecesService'
import { PiecesServiceError } from '../services/domain/pieces/piecesError'
import { DocumentServiceError } from '../services/domain/documentService'
import { type IpcSenderLike, mapIpcError } from './ipc'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

const mapPiecesError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid pieces input.',
    errorClasses: [PiecesServiceError, DocumentServiceError]
  })

export function registerPiecesHandlers(options: {
  piecesService: PiecesService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.pieces.list,
    async (_event, input: unknown): Promise<IpcResult<PieceRecord[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input)
        return { success: true, data: await options.piecesService.list(parsed) }
      } catch (error) {
        return mapPiecesError(error, 'Unable to load the pièces of this dossier.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.pieces.add,
    async (_event, input: unknown): Promise<IpcResult<PieceRecord[]>> => {
      try {
        const parsed = pieceAddInputSchema.parse(input)
        return { success: true, data: await options.piecesService.add(parsed) }
      } catch (error) {
        return mapPiecesError(error, 'Unable to add the selected pièces.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.pieces.update,
    async (_event, input: unknown): Promise<IpcResult<PieceRecord[]>> => {
      try {
        const parsed = pieceUpdateInputSchema.parse(input)
        return { success: true, data: await options.piecesService.update(parsed) }
      } catch (error) {
        return mapPiecesError(error, 'Unable to update this pièce.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.pieces.remove,
    async (_event, input: unknown): Promise<IpcResult<PieceRecord[]>> => {
      try {
        const parsed = pieceRemoveInputSchema.parse(input)
        return { success: true, data: await options.piecesService.remove(parsed) }
      } catch (error) {
        return mapPiecesError(error, 'Unable to remove this pièce.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.pieces.generate,
    async (event, input: unknown): Promise<IpcResult<PieceGenerateResult>> => {
      try {
        const parsed = pieceGenerateInputSchema.parse(input)
        const data = await options.piecesService.generate(parsed, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.pieces.generateProgress, progress)
          }
        })
        return { success: true, data }
      } catch (error) {
        return mapPiecesError(error, 'Unable to generate the pièces deliverables.')
      }
    }
  )
}
