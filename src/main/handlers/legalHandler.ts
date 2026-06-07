import { IPC_CHANNELS, IpcErrorCode, type IpcResult } from '@shared/types'
import {
  judilibreConsultSchema,
  judilibreSearchSchema,
  judilibreTaxonomySchema,
  legalConnectionStatusSchema,
  legalReferenceCheckSchema,
  legalSettingsSaveSchema,
  legifranceConsultSchema,
  legifranceSearchSchema
} from '@shared/validation/legal'

import type { LegalService } from '../services/legal/legalService'
import { mapIpcError, type IpcMainLike } from './ipc'

function mapLegalError(error: unknown, fallback: string): IpcResult<never> {
  return mapIpcError(error, fallback, {
    validationMessage: 'Invalid legal search input.',
    fallbackCode: IpcErrorCode.REMOTE_API_ERROR
  }) as IpcResult<never>
}

export function registerLegalHandlers(options: {
  ipcMain: IpcMainLike
  legalService: LegalService
}): void {
  const { ipcMain, legalService } = options

  ipcMain.handle(IPC_CHANNELS.legalSearch.settingsGet, async () => {
    try {
      return { success: true, data: await legalService.getSettings() }
    } catch (error) {
      return mapLegalError(error, 'Unable to load legal search settings.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.settingsSave, async (_event, input) => {
    try {
      await legalService.saveSettings(legalSettingsSaveSchema.parse(input))
      return { success: true, data: null }
    } catch (error) {
      return mapLegalError(error, 'Unable to save legal search settings.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.credentialsDelete, async () => {
    try {
      await legalService.deleteCredentials()
      return { success: true, data: null }
    } catch (error) {
      return mapLegalError(error, 'Unable to delete legal search credentials.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.connectionStatus, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.connectionStatus(
          typeof input === 'undefined' ? undefined : legalConnectionStatusSchema.parse(input)
        )
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to verify PISTE connection.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.searchLegifrance, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.searchLegifrance(legifranceSearchSchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to search Légifrance.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.consultLegifrance, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.consultLegifrance(legifranceConsultSchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to consult Légifrance.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.searchJudilibre, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.searchJudilibre(judilibreSearchSchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to search Judilibre.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.consultJudilibre, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.consultJudilibre(judilibreConsultSchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to consult Judilibre.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.taxonomyJudilibre, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.taxonomyJudilibre(judilibreTaxonomySchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to load Judilibre taxonomy.')
    }
  })

  ipcMain.handle(IPC_CHANNELS.legalSearch.verifyReferences, async (_event, input) => {
    try {
      return {
        success: true,
        data: await legalService.verifyReferences(legalReferenceCheckSchema.parse(input))
      }
    } catch (error) {
      return mapLegalError(error, 'Unable to verify legal references.')
    }
  })
}
