import { randomUUID } from 'node:crypto'

import { dialog, shell } from 'electron'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type IpcResult,
  type TemplateDeleteInput,
  type TemplateDocxInput,
  type TemplateDraft,
  type TemplateRecord,
  type TemplateTagifyAnalyzeResult,
  type TemplateTagifyApplyResult,
  type TemplateUpdate
} from '@shared/types'

import {
  templateDeleteInputSchema,
  templateDocxInputSchema,
  templateDraftSchema,
  templateTagifyAnalyzeInputSchema,
  templateTagifyApplyInputSchema,
  templateUpdateSchema
} from '@shared/validation'

import { type TemplateService, TemplateServiceError } from '../services/domain/templateService'
import {
  TemplateTagifyError,
  type TemplateTagifyService
} from '../services/aiEmbedded/templateTagifyService'
import { AiRuntimeError } from '../lib/aiEmbedded/aiSdkAgentRuntime'
import { type IpcMainLike, mapIpcError } from './ipc'

class TemplateHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TemplateHandlerError'
  }
}

const mapTemplateError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid template input.',
    errorClasses: [TemplateServiceError, TemplateHandlerError, TemplateTagifyError, AiRuntimeError]
  })

const PICK_TOKEN_TTL_MS = 5 * 60 * 1000

export function registerTemplateHandlers(options: {
  templateService: TemplateService
  tagifyService?: TemplateTagifyService
  ipcMain: IpcMainLike
  showOpenDialog?: typeof dialog.showOpenDialog
  openPath?: (path: string) => Promise<string>
}): void {
  const { templateService } = options
  const pickedFilePaths = new Map<string, { filePath: string; expiresAt: number }>()

  function consumePickToken(token: string): string | undefined {
    const entry = pickedFilePaths.get(token)
    pickedFilePaths.delete(token)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) return undefined
    return entry.filePath
  }

  function recordPickedFile(filePath: string): string {
    const token = randomUUID()
    const now = Date.now()
    for (const [key, entry] of pickedFilePaths) {
      if (entry.expiresAt < now) pickedFilePaths.delete(key)
    }
    pickedFilePaths.set(token, { filePath, expiresAt: now + PICK_TOKEN_TTL_MS })
    return token
  }
  const showOpenDialog =
    options.showOpenDialog ??
    (async (...args: Parameters<typeof dialog.showOpenDialog>) => {
      if (!dialog?.showOpenDialog) {
        throw new TemplateHandlerError(
          IpcErrorCode.NOT_IMPLEMENTED,
          'DOCX import is unavailable in this environment.'
        )
      }
      return dialog.showOpenDialog(...args)
    })
  const openPath =
    options.openPath ??
    (async (path: string) => {
      if (!shell?.openPath) {
        throw new TemplateHandlerError(
          IpcErrorCode.NOT_IMPLEMENTED,
          'Native DOCX open is unavailable in this environment.'
        )
      }
      return shell.openPath(path)
    })

  options.ipcMain.handle(
    IPC_CHANNELS.template.list,
    async (): Promise<IpcResult<TemplateRecord[]>> => {
      try {
        return { success: true, data: await templateService.list() }
      } catch (error) {
        return mapTemplateError(error, 'Unable to load templates.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.getContent,
    async (_event, input: unknown): Promise<IpcResult<string>> => {
      try {
        const parsed = templateDeleteInputSchema.parse(input)
        return { success: true, data: await templateService.getContent(parsed.uuid) }
      } catch (error) {
        return mapTemplateError(error, 'Unable to load template content.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.create,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDraftSchema.parse(input) as TemplateDraft
        return {
          success: true,
          data: await templateService.create({
            name: parsed.name,
            content: parsed.content,
            description: parsed.description,
            tags: parsed.tags,
            documentKind: parsed.documentKind,
            category: parsed.category
          })
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to create template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.update,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateUpdateSchema.parse(input) as TemplateUpdate
        return {
          success: true,
          data: await templateService.update({
            uuid: parsed.uuid,
            name: parsed.name,
            content: parsed.content,
            description: parsed.description,
            tags: parsed.tags,
            documentKind: parsed.documentKind,
            category: parsed.category
          })
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to update template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.delete,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = templateDeleteInputSchema.parse(input) as TemplateDeleteInput
        await templateService.delete({ uuid: parsed.uuid })
        return { success: true, data: null }
      } catch (error) {
        return mapTemplateError(error, 'Unable to delete template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.pickDocxFile,
    async (): Promise<IpcResult<{ pickToken: string; fileName: string; html: string } | null>> => {
      try {
        const pickerResult = await showOpenDialog({
          filters: [{ name: 'Word Documents', extensions: ['docx'] }],
          properties: ['openFile']
        })

        const filePath = pickerResult.canceled ? undefined : pickerResult.filePaths[0]
        if (!filePath) {
          return { success: true, data: null }
        }

        const html = await templateService.convertDocxToHtml(filePath)
        const pickToken = recordPickedFile(filePath)
        const { basename } = await import('node:path')
        return { success: true, data: { pickToken, fileName: basename(filePath), html } }
      } catch (error) {
        return mapTemplateError(error, 'Unable to open file picker.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.importDocx,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput

        let sourceFilePath: string | undefined

        if (parsed.pickToken) {
          sourceFilePath = consumePickToken(parsed.pickToken)
          if (!sourceFilePath) {
            throw new TemplateHandlerError(
              IpcErrorCode.INVALID_INPUT,
              'Pick token has expired or is invalid. Please pick the file again.'
            )
          }
        } else {
          const pickerResult = await showOpenDialog({
            filters: [{ name: 'Word Documents', extensions: ['docx'] }],
            properties: ['openFile']
          })

          const pickedPath = pickerResult.canceled ? undefined : pickerResult.filePaths[0]
          if (!pickedPath) {
            return {
              success: false,
              error: 'Cancelled by user',
              code: IpcErrorCode.VALIDATION_FAILED
            }
          }

          sourceFilePath = pickedPath
        }

        return {
          success: true,
          data: await templateService.importDocxFromPath({
            uuid: parsed.uuid,
            sourceFilePath
          })
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to import DOCX source.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.openDocx,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput

        if (!(await templateService.hasDocxSource(parsed.uuid))) {
          throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'DOCX source was not found.')
        }

        const docxPath = await templateService.getDocxPath(parsed.uuid)
        const openResult = await openPath(docxPath)
        if (openResult) {
          throw new TemplateHandlerError(IpcErrorCode.FILE_SYSTEM_ERROR, openResult)
        }

        return { success: true, data: null }
      } catch (error) {
        return mapTemplateError(error, 'Unable to open DOCX source.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.removeDocx,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput
        return { success: true, data: await templateService.removeDocx({ uuid: parsed.uuid }) }
      } catch (error) {
        return mapTemplateError(error, 'Unable to remove DOCX source.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.applyCabinetDefaultDocx,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput
        return {
          success: true,
          data: await templateService.applyCabinetDefaultDocx({ uuid: parsed.uuid })
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to apply cabinet default DOCX template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.applyCabinetDocxToAllExisting,
    async (): Promise<IpcResult<{ updated: number; skipped: number; failed: string[] }>> => {
      try {
        return {
          success: true,
          data: await templateService.applyCabinetDocxToAllExisting()
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to apply cabinet DOCX to all existing templates.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.tagifyAnalyze,
    async (_event, input: unknown): Promise<IpcResult<TemplateTagifyAnalyzeResult>> => {
      try {
        if (!options.tagifyService) {
          throw new TemplateHandlerError(
            IpcErrorCode.NOT_IMPLEMENTED,
            'AI tag detection is unavailable in this environment.'
          )
        }
        const parsed = templateTagifyAnalyzeInputSchema.parse(input)
        return { success: true, data: await options.tagifyService.analyze(parsed) }
      } catch (error) {
        return mapTemplateError(error, 'Unable to analyze the template for tags.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.tagifyApply,
    async (_event, input: unknown): Promise<IpcResult<TemplateTagifyApplyResult>> => {
      try {
        if (!options.tagifyService) {
          throw new TemplateHandlerError(
            IpcErrorCode.NOT_IMPLEMENTED,
            'AI tag detection is unavailable in this environment.'
          )
        }
        const parsed = templateTagifyApplyInputSchema.parse(input)
        return { success: true, data: await options.tagifyService.apply(parsed) }
      } catch (error) {
        return mapTemplateError(error, 'Unable to apply the tag replacements.')
      }
    }
  )
}
