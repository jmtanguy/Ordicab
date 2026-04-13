import { dialog } from 'electron'
import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DocxPreviewResult,
  type GeneratedDraftResult,
  type GeneratedDocumentResult,
  type IpcError,
  type IpcResult
} from '@shared/types'

import {
  generateDocumentInputSchema,
  generatePreviewInputSchema,
  saveGeneratedDocumentInputSchema,
  selectOutputPathInputSchema,
  type GenerateDocumentInput,
  type GeneratePreviewInput,
  type SaveGeneratedDocumentInput,
  type SelectOutputPathInput
} from '@renderer/schemas'
import { type GenerateService, GenerateServiceError } from '../services/domain/generateService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapGenerateError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid document generation input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof GenerateServiceError) {
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

export function registerGenerateHandlers(options: {
  generateService: GenerateService
  ipcMain: IpcMainLike
  showSaveDialog?: typeof dialog.showSaveDialog
}): void {
  const showSaveDialog =
    options.showSaveDialog ??
    (async (...args: Parameters<typeof dialog.showSaveDialog>) => {
      if (!dialog?.showSaveDialog) {
        return { canceled: true, filePath: undefined }
      }
      return dialog.showSaveDialog(...args)
    })

  options.ipcMain.handle(
    IPC_CHANNELS.generate.document,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDocumentResult>> => {
      try {
        const parsed = generateDocumentInputSchema.parse(input) as GenerateDocumentInput
        return {
          success: true,
          data: await options.generateService.generateDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to generate document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.preview,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDraftResult>> => {
      try {
        const parsed = generatePreviewInputSchema.parse(input) as GeneratePreviewInput
        return {
          success: true,
          data: await options.generateService.previewDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to build generated draft.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.save,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDocumentResult>> => {
      try {
        const parsed = saveGeneratedDocumentInputSchema.parse(input) as SaveGeneratedDocumentInput
        return {
          success: true,
          data: await options.generateService.saveGeneratedDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to save generated document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.previewDocx,
    async (_event, input: unknown): Promise<IpcResult<DocxPreviewResult>> => {
      try {
        const parsed = generatePreviewInputSchema.parse(input) as GeneratePreviewInput
        return {
          success: true,
          data: await options.generateService.previewDocxDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to preview .docx template tags.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.selectOutputPath,
    async (_event, input: unknown): Promise<IpcResult<string | null>> => {
      try {
        const parsed = selectOutputPathInputSchema.parse(input) as SelectOutputPathInput
        const result = await showSaveDialog({
          defaultPath: parsed.defaultFilename ? `${parsed.defaultFilename}.docx` : undefined,
          filters: [{ name: 'Word Document', extensions: ['docx'] }]
        })
        return {
          success: true,
          data: result.canceled || !result.filePath ? null : result.filePath
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to select output path.')
      }
    }
  )
}
