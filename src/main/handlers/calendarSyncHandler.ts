import { IPC_CHANNELS, type IpcError } from '@shared/types'
import {
  calendarSyncOptionsInputSchema,
  calendarSyncSettingsSaveInputSchema
} from '@shared/validation/calendarSync'

import { CalendarSyncError, type CalendarSyncService } from '../services/domain/calendarSyncService'
import { mapIpcError, registerIpcHandler, type IpcMainLike } from './ipc'

const mapCalendarSyncError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid calendar sync input.',
    errorClasses: [CalendarSyncError]
  })

export function registerCalendarSyncHandlers(options: {
  calendarSyncService: CalendarSyncService
  ipcMain: IpcMainLike
}): void {
  const { calendarSyncService, ipcMain } = options

  registerIpcHandler({
    ipcMain,
    channel: IPC_CHANNELS.calendarSync.statusGet,
    fallback: 'Unable to load calendar sync status.',
    mapError: mapCalendarSyncError,
    handle: () => calendarSyncService.getStatus()
  })

  registerIpcHandler({
    ipcMain,
    channel: IPC_CHANNELS.calendarSync.settingsSave,
    schema: calendarSyncSettingsSaveInputSchema,
    fallback: 'Unable to save calendar sync settings.',
    mapError: mapCalendarSyncError,
    handle: (input) => calendarSyncService.saveSettings(input)
  })

  registerIpcHandler({
    ipcMain,
    channel: IPC_CHANNELS.calendarSync.credentialsDelete,
    fallback: 'Unable to delete calendar sync credentials.',
    mapError: mapCalendarSyncError,
    handle: () => calendarSyncService.deleteCredentials()
  })

  registerIpcHandler({
    ipcMain,
    channel: IPC_CHANNELS.calendarSync.setOptions,
    schema: calendarSyncOptionsInputSchema,
    fallback: 'Unable to update calendar sync options.',
    mapError: mapCalendarSyncError,
    handle: (input) => calendarSyncService.setOptions(input)
  })

  registerIpcHandler({
    ipcMain,
    channel: IPC_CHANNELS.calendarSync.syncNow,
    fallback: 'Calendar sync failed.',
    mapError: mapCalendarSyncError,
    handle: () => calendarSyncService.syncNow()
  })
}
