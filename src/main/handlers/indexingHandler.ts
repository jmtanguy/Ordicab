import { IPC_CHANNELS, IpcErrorCode, type IpcResult } from '@shared/types'
import type { IndexingStatusSnapshot } from '@shared/types'

import type { IndexingQueueService } from '../services/aiEmbedded/indexingQueueService'
import { type IpcMainLike } from './ipc'

export function registerIndexingHandlers(opts: {
  ipcMain: IpcMainLike
  indexingQueueService: IndexingQueueService
}): void {
  const { ipcMain, indexingQueueService } = opts

  ipcMain.handle(
    IPC_CHANNELS.indexing.status,
    async (): Promise<IpcResult<IndexingStatusSnapshot>> => {
      return { success: true, data: indexingQueueService.getSnapshot() }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.indexing.reindexDossier,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      const value = input as { dossierId?: unknown } | null | undefined
      if (!value || typeof value.dossierId !== 'string' || value.dossierId.trim().length === 0) {
        return { success: false, error: 'Invalid dossierId.', code: IpcErrorCode.INVALID_INPUT }
      }
      try {
        await indexingQueueService.enqueueDossierBatch(value.dossierId.trim(), {
          reason: 'manual-reindex'
        })
        return { success: true, data: null }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to enqueue reindex.',
          code: IpcErrorCode.UNKNOWN
        }
      }
    }
  )
}
