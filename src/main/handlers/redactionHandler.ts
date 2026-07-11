/**
 * IPC handlers for the « Rédaction assistée » drafting sessions.
 * All heavy lifting lives in redactionSessionService; every mutating call
 * returns the full RedactionSnapshot the page renders from.
 */

import { IPC_CHANNELS, type IpcError, type IpcResult } from '@shared/types'
import type {
  RedactionCommitResult,
  RedactionSessionSummary,
  RedactionSnapshot
} from '@shared/domain/redaction'
import {
  redactionCommitInputSchema,
  redactionCreateInputSchema,
  redactionDecideOpInputSchema,
  redactionListInputSchema,
  redactionManualEditInputSchema,
  redactionSessionQuerySchema,
  redactionSyncChatInputSchema,
  redactionUpdateMetaInputSchema
} from '@shared/validation'

import {
  RedactionOriginalChangedError,
  type RedactionSessionService
} from '../services/domain/redactionSessionService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapRedactionError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid drafting session input.',
    errorClasses: [RedactionOriginalChangedError]
  })

export function registerRedactionHandlers(options: {
  redactionSessionService: RedactionSessionService
  ipcMain: IpcMainLike
}): void {
  const { redactionSessionService: service, ipcMain } = options

  ipcMain.handle(
    IPC_CHANNELS.redaction.list,
    async (_event, input: unknown): Promise<IpcResult<RedactionSessionSummary[]>> => {
      try {
        const parsed = redactionListInputSchema.parse(input)
        return { success: true, data: await service.listSessions(parsed.dossierId) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to list drafting sessions.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.create,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionCreateInputSchema.parse(input)
        return { success: true, data: await service.createSession(parsed) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to create the drafting session.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.get,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionSessionQuerySchema.parse(input)
        return {
          success: true,
          data: await service.getSnapshot(parsed.dossierId, parsed.sessionId)
        }
      } catch (error) {
        return mapRedactionError(error, 'Unable to load the drafting session.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.manualEdit,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionManualEditInputSchema.parse(input)
        return {
          success: true,
          data: await service.manualEdit(parsed.dossierId, parsed.sessionId, parsed.operations)
        }
      } catch (error) {
        return mapRedactionError(error, 'Unable to apply the manual edit.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.decideOp,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionDecideOpInputSchema.parse(input)
        return {
          success: true,
          data: await service.decideOp(
            parsed.dossierId,
            parsed.sessionId,
            parsed.opId,
            parsed.decision
          )
        }
      } catch (error) {
        return mapRedactionError(error, 'Unable to record the revision decision.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.undo,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionSessionQuerySchema.parse(input)
        return { success: true, data: await service.undo(parsed.dossierId, parsed.sessionId) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to undo.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.redo,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionSessionQuerySchema.parse(input)
        return { success: true, data: await service.redo(parsed.dossierId, parsed.sessionId) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to redo.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.updateMeta,
    async (_event, input: unknown): Promise<IpcResult<RedactionSnapshot>> => {
      try {
        const parsed = redactionUpdateMetaInputSchema.parse(input)
        return { success: true, data: await service.updateMeta(parsed) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to update the session settings.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.syncChat,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = redactionSyncChatInputSchema.parse(input)
        await service.syncChat(parsed.dossierId, parsed.sessionId, parsed.chat)
        return { success: true, data: null }
      } catch (error) {
        return mapRedactionError(error, 'Unable to persist the conversation.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.resetChat,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = redactionSessionQuerySchema.parse(input)
        await service.resetConversation(parsed.dossierId, parsed.sessionId)
        return { success: true, data: null }
      } catch (error) {
        return mapRedactionError(error, 'Unable to reset the conversation.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.commit,
    async (_event, input: unknown): Promise<IpcResult<RedactionCommitResult>> => {
      try {
        const parsed = redactionCommitInputSchema.parse(input)
        return { success: true, data: await service.commit(parsed) }
      } catch (error) {
        return mapRedactionError(error, 'Unable to save the document.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.redaction.discard,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = redactionSessionQuerySchema.parse(input)
        await service.discard(parsed.dossierId, parsed.sessionId)
        return { success: true, data: null }
      } catch (error) {
        return mapRedactionError(error, 'Unable to discard the drafting session.')
      }
    }
  )
}
