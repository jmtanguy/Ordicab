import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type ClaudeMdStatus,
  type IpcError,
  type IpcResult
} from '@shared/types'
import { claudeMdRegenerateInputSchema } from '@shared/validation/claudeMd'

import {
  type InstructionsGeneratorLike,
  DelegatedInstructionsGeneratorError
} from '../lib/aiDelegated/aiDelegatedInstructionsGenerator'
import { type DocumentService, DocumentServiceError } from '../services/domain/documentService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

function mapClaudeMdError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid CLAUDE.md input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof DelegatedInstructionsGeneratorError) {
    return {
      success: false,
      error: error.message,
      code: error.code
    }
  }

  if (error instanceof DocumentServiceError) {
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

export function registerInstructionsHandlers(options: {
  ipcMain: IpcMainLike
  instructionsGenerator: InstructionsGeneratorLike
  documentService: Pick<DocumentService, 'resolveRegisteredDossierRoot'>
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.claudeMd.regenerate,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = claudeMdRegenerateInputSchema.parse(input ?? {})

        if (parsed.dossierId) {
          await options.documentService.resolveRegisteredDossierRoot({
            dossierId: parsed.dossierId
          })
        }

        await options.instructionsGenerator.generateDomainRoot()

        return {
          success: true,
          data: null
        }
      } catch (error) {
        return mapClaudeMdError(error, 'Unable to regenerate CLAUDE.md.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.claudeMd.status,
    async (): Promise<IpcResult<ClaudeMdStatus>> => {
      return {
        success: true,
        data: options.instructionsGenerator.getStatus()
      }
    }
  )
}
