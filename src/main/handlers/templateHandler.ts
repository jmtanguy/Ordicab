import { randomUUID } from 'node:crypto'

import { dialog, shell } from 'electron'

import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type IpcResult,
  type TemplateDeleteInput,
  type TemplateDocxInput,
  type TemplateDraft,
  type TemplateRecord,
  type TemplateUpdate
} from '@shared/types'

import {
  templateDeleteInputSchema,
  templateDocxInputSchema,
  templateDraftSchema,
  templateUpdateSchema
} from '@shared/validation'

import { type TemplateService, TemplateServiceError } from '../services/domain/templateService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

class TemplateHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TemplateHandlerError'
  }
}

function mapTemplateError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid template input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof TemplateServiceError || error instanceof TemplateHandlerError) {
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

const PICK_TOKEN_TTL_MS = 5 * 60 * 1000

export function registerTemplateHandlers(options: {
  templateService: TemplateService
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
        return { success: true, data: await templateService.getContent(parsed.id) }
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
            description: parsed.description
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
            id: parsed.id,
            name: parsed.name,
            content: parsed.content,
            description: parsed.description
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
        await templateService.delete({ id: parsed.id })
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
            id: parsed.id,
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

        if (!(await templateService.hasDocxSource(parsed.id))) {
          throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'DOCX source was not found.')
        }

        const docxPath = await templateService.getDocxPath(parsed.id)
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
        return { success: true, data: await templateService.removeDocx({ id: parsed.id }) }
      } catch (error) {
        return mapTemplateError(error, 'Unable to remove DOCX source.')
      }
    }
  )
}
