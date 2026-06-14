import { dialog, shell } from 'electron'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type EntityProfile,
  type EntityProfileDraft,
  type IpcResult
} from '@shared/types'

import { entityProfileDraftSchema } from '@shared/validation'

import { type EntityService, EntityServiceError } from '../services/domain/entityService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapEntityError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid entity input.',
    errorClasses: [EntityServiceError]
  })

export function registerEntityHandlers(options: {
  entityService: EntityService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.entity.get,
    async (): Promise<IpcResult<EntityProfile | null>> => {
      try {
        return { success: true, data: await options.entityService.get() }
      } catch (error) {
        return mapEntityError(error, 'Unable to load professional entity profile.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.update,
    async (_event, input: unknown): Promise<IpcResult<EntityProfile>> => {
      try {
        const parsed = entityProfileDraftSchema.parse(input) as EntityProfileDraft
        return { success: true, data: await options.entityService.update(parsed) }
      } catch (error) {
        return mapEntityError(error, 'Unable to save professional entity profile.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.importDefaultTemplate,
    async (): Promise<IpcResult<EntityProfile | null>> => {
      try {
        if (!dialog?.showOpenDialog) {
          return {
            success: false,
            error: 'DOCX import is unavailable in this environment.',
            code: IpcErrorCode.NOT_IMPLEMENTED
          }
        }
        const picker = await dialog.showOpenDialog({
          filters: [{ name: 'Word Documents', extensions: ['docx'] }],
          properties: ['openFile']
        })
        const sourcePath = picker.canceled ? undefined : picker.filePaths[0]
        if (!sourcePath) {
          return { success: true, data: null }
        }
        return {
          success: true,
          data: await options.entityService.importDefaultTemplate(sourcePath)
        }
      } catch (error) {
        return mapEntityError(error, 'Unable to import default Word template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.openDefaultTemplate,
    async (): Promise<IpcResult<null>> => {
      try {
        if (!shell?.openPath) {
          return {
            success: false,
            error: 'Opening files is unavailable in this environment.',
            code: IpcErrorCode.NOT_IMPLEMENTED
          }
        }
        const docxPath = await options.entityService.getDefaultTemplatePath()
        const openResult = await shell.openPath(docxPath)
        if (openResult) {
          return {
            success: false,
            error: openResult,
            code: IpcErrorCode.FILE_SYSTEM_ERROR
          }
        }
        return { success: true, data: null }
      } catch (error) {
        return mapEntityError(error, 'Unable to open default Word template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.removeDefaultTemplate,
    async (): Promise<IpcResult<EntityProfile>> => {
      try {
        return { success: true, data: await options.entityService.removeDefaultTemplate() }
      } catch (error) {
        return mapEntityError(error, 'Unable to remove default Word template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.importStamp,
    async (): Promise<IpcResult<EntityProfile | null>> => {
      try {
        if (!dialog?.showOpenDialog) {
          return {
            success: false,
            error: 'Stamp import is unavailable in this environment.',
            code: IpcErrorCode.NOT_IMPLEMENTED
          }
        }
        const picker = await dialog.showOpenDialog({
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
          properties: ['openFile']
        })
        const sourcePath = picker.canceled ? undefined : picker.filePaths[0]
        if (!sourcePath) {
          return { success: true, data: null }
        }
        return { success: true, data: await options.entityService.importStamp(sourcePath) }
      } catch (error) {
        return mapEntityError(error, 'Unable to import the stamp image.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.removeStamp,
    async (): Promise<IpcResult<EntityProfile>> => {
      try {
        return { success: true, data: await options.entityService.removeStamp() }
      } catch (error) {
        return mapEntityError(error, 'Unable to remove the stamp image.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.getStampDataUrl,
    async (): Promise<IpcResult<string | null>> => {
      try {
        return { success: true, data: await options.entityService.getStampDataUrl() }
      } catch (error) {
        return mapEntityError(error, 'Unable to read the stamp image.')
      }
    }
  )
}
