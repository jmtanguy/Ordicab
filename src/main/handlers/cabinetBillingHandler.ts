import {
  IPC_CHANNELS,
  type IpcError,
  type CabinetBillingCatalog,
  type CabinetBillingDefaultInput,
  type CabinetServicePresetDeleteInput,
  type CabinetServicePresetUpsertInput,
  type IpcResult
} from '@shared/types'
import {
  cabinetBillingDefaultInputSchema,
  cabinetServicePresetDeleteInputSchema,
  cabinetServicePresetUpsertInputSchema
} from '@shared/validation'

import {
  CabinetBillingServiceError,
  type CabinetBillingService
} from '../services/domain/cabinetBillingService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapCabinetBillingError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid cabinet billing input.',
    errorClasses: [CabinetBillingServiceError]
  })

export function registerCabinetBillingHandlers(options: {
  cabinetBillingService: CabinetBillingService
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.cabinetBilling.get,
    async (): Promise<IpcResult<CabinetBillingCatalog>> => {
      try {
        return { success: true, data: await options.cabinetBillingService.get() }
      } catch (error) {
        return mapCabinetBillingError(error, 'Unable to load cabinet billing catalog.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.cabinetBilling.upsertService,
    async (_event, input: unknown): Promise<IpcResult<CabinetBillingCatalog>> => {
      try {
        const parsed = cabinetServicePresetUpsertInputSchema.parse(
          input
        ) as CabinetServicePresetUpsertInput
        return { success: true, data: await options.cabinetBillingService.upsertService(parsed) }
      } catch (error) {
        return mapCabinetBillingError(error, 'Unable to save cabinet service preset.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.cabinetBilling.deleteService,
    async (_event, input: unknown): Promise<IpcResult<CabinetBillingCatalog>> => {
      try {
        const parsed = cabinetServicePresetDeleteInputSchema.parse(
          input
        ) as CabinetServicePresetDeleteInput
        return { success: true, data: await options.cabinetBillingService.deleteService(parsed) }
      } catch (error) {
        return mapCabinetBillingError(error, 'Unable to delete cabinet service preset.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.cabinetBilling.setDefaultService,
    async (_event, input: unknown): Promise<IpcResult<CabinetBillingCatalog>> => {
      try {
        const parsed = cabinetBillingDefaultInputSchema.parse(input) as CabinetBillingDefaultInput
        return {
          success: true,
          data: await options.cabinetBillingService.setDefaultService(parsed)
        }
      } catch (error) {
        return mapCabinetBillingError(error, 'Unable to set cabinet default service preset.')
      }
    }
  )
}
