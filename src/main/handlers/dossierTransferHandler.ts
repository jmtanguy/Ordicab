import { dialog } from 'electron'

import { IPC_CHANNELS, type IpcError, type IpcResult } from '@shared/types'

import {
  dossierAiExportInputSchema,
  dossierAiImportAnalyzeInputSchema,
  dossierAiImportInputSchema,
  dossierScopedQuerySchema
} from '@shared/validation'

import {
  DossierTransferServiceError,
  type DossierTransferService
} from '../services/domain/dossierTransferService'
import { type IpcMainLike, mapIpcError, registerIpcHandler, success } from './ipc'

const mapTransferError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid dossier transfer input.',
    errorClasses: [DossierTransferServiceError]
  })

export function registerDossierTransferHandlers(options: {
  dossierTransferService: DossierTransferService
  ipcMain: IpcMainLike
  showOpenDialog?: typeof dialog.showOpenDialog
}): void {
  const showOpenDialog =
    options.showOpenDialog ??
    (async (...args: Parameters<typeof dialog.showOpenDialog>) => {
      if (!dialog?.showOpenDialog) {
        return { canceled: true, filePaths: [] }
      }
      return dialog.showOpenDialog(...args)
    })

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.pickExportRoot,
    async (): Promise<IpcResult<string | null>> => {
      try {
        const result = await showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        })
        return success(result.canceled ? null : (result.filePaths[0] ?? null))
      } catch (error) {
        return mapTransferError(error, 'Unable to pick export directory.')
      }
    }
  )

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.analyzeAiExport,
    schema: dossierScopedQuerySchema,
    fallback: 'Unable to analyze dossier AI export.',
    mapError: mapTransferError,
    handle: (input) => options.dossierTransferService.analyzeExport(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.exportForAi,
    schema: dossierAiExportInputSchema,
    fallback: 'Unable to export dossier for AI.',
    mapError: mapTransferError,
    handle: (input) => options.dossierTransferService.exportForAi(input)
  })

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.pickImportSource,
    async (): Promise<IpcResult<string | null>> => {
      try {
        const result = await showOpenDialog({
          properties: ['openDirectory']
        })
        return success(result.canceled ? null : (result.filePaths[0] ?? null))
      } catch (error) {
        return mapTransferError(error, 'Unable to pick import directory.')
      }
    }
  )

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.analyzeAiImport,
    schema: dossierAiImportAnalyzeInputSchema,
    fallback: 'Unable to analyze dossier AI import.',
    mapError: mapTransferError,
    handle: (input) => options.dossierTransferService.analyzeImport(input)
  })

  registerIpcHandler({
    ipcMain: options.ipcMain,
    channel: IPC_CHANNELS.dossier.importAiProduction,
    schema: dossierAiImportInputSchema,
    fallback: 'Unable to import AI production files.',
    mapError: mapTransferError,
    handle: (input) => options.dossierTransferService.importProduction(input)
  })
}
