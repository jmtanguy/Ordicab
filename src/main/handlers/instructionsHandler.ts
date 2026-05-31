import { IPC_CHANNELS, type ClaudeMdStatus, type IpcError, type IpcResult } from '@shared/types'
import { claudeMdRegenerateInputSchema } from '@shared/validation/claudeMd'

import {
  type InstructionsGeneratorLike,
  DelegatedInstructionsGeneratorError
} from '../lib/aiDelegated/aiDelegatedInstructionsGenerator'
import { type DocumentService, DocumentServiceError } from '../services/domain/documentService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapClaudeMdError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid CLAUDE.md input.',
    errorClasses: [DelegatedInstructionsGeneratorError, DocumentServiceError]
  })

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
