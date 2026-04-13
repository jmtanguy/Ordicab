import { dialog } from 'electron'
import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DossierAiExportAnalyzeResult,
  type DossierAiExportInput,
  type DossierAiExportResult,
  type DossierAiImportAnalyzeInput,
  type DossierAiImportAnalyzeResult,
  type DossierAiImportInput,
  type DossierAiImportResult,
  type IpcError,
  type IpcResult
} from '@shared/types'

import {
  dossierAiExportInputSchema,
  dossierAiImportAnalyzeInputSchema,
  dossierAiImportInputSchema,
  dossierScopedQuerySchema,
  type DossierScopedQuery
} from '@renderer/schemas'

import {
  DossierTransferServiceError,
  type DossierTransferService
} from '../services/domain/dossierTransferService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapTransferError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid dossier transfer input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof DossierTransferServiceError) {
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
        return {
          success: true,
          data: result.canceled ? null : (result.filePaths[0] ?? null)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to pick export directory.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.analyzeAiExport,
    async (_event, input: unknown): Promise<IpcResult<DossierAiExportAnalyzeResult>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.dossierTransferService.analyzeExport(parsed)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to analyze dossier AI export.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.exportForAi,
    async (_event, input: unknown): Promise<IpcResult<DossierAiExportResult>> => {
      try {
        const parsed = dossierAiExportInputSchema.parse(input) as DossierAiExportInput
        return {
          success: true,
          data: await options.dossierTransferService.exportForAi(parsed)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to export dossier for AI.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.pickImportSource,
    async (): Promise<IpcResult<string | null>> => {
      try {
        const result = await showOpenDialog({
          properties: ['openDirectory']
        })
        return {
          success: true,
          data: result.canceled ? null : (result.filePaths[0] ?? null)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to pick import directory.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.analyzeAiImport,
    async (_event, input: unknown): Promise<IpcResult<DossierAiImportAnalyzeResult>> => {
      try {
        const parsed = dossierAiImportAnalyzeInputSchema.parse(input) as DossierAiImportAnalyzeInput
        return {
          success: true,
          data: await options.dossierTransferService.analyzeImport(parsed)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to analyze dossier AI import.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.dossier.importAiProduction,
    async (_event, input: unknown): Promise<IpcResult<DossierAiImportResult>> => {
      try {
        const parsed = dossierAiImportInputSchema.parse(input) as DossierAiImportInput
        return {
          success: true,
          data: await options.dossierTransferService.importProduction(parsed)
        }
      } catch (error) {
        return mapTransferError(error, 'Unable to import AI production files.')
      }
    }
  )
}
