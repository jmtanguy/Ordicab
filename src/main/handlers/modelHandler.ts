import { IPC_CHANNELS, type IpcResult } from '@shared/types'
import type { ModelDownloadStatus } from '@shared/types'

import {
  createModelProvisioningService,
  type ModelProvisioningService
} from '../services/aiEmbedded/modelProvisioningService'
import { type IpcMainLike } from './ipc'

interface WebContentsLike {
  send(channel: string, payload: unknown): void
}

export interface RegisterModelHandlersOptions {
  ipcMain: IpcMainLike
  /** `{userData}/models` — where models are downloaded. */
  modelsRoot: string
  /** Reload the embedding worker + re-index after bge-m3 downloads. */
  onEmbeddingModelReady: () => Promise<void>
  getWebContents: () => WebContentsLike | null | undefined
}

/**
 * Wires the runtime model download/status IPC and kicks off provisioning.
 * Returns the provisioning service so the host can query NER readiness (the
 * remote-AI RGPD gate) and trigger downloads.
 */
export function registerModelHandlers(
  opts: RegisterModelHandlersOptions
): ModelProvisioningService {
  const provisioning = createModelProvisioningService({
    modelsRoot: opts.modelsRoot,
    onEmbeddingModelReady: opts.onEmbeddingModelReady,
    onStatus: (status: ModelDownloadStatus) => {
      opts.getWebContents()?.send(IPC_CHANNELS.models.statusChanged, status)
    }
  })

  opts.ipcMain.handle(
    IPC_CHANNELS.models.status,
    async (): Promise<IpcResult<ModelDownloadStatus>> => {
      return { success: true, data: provisioning.getStatus() }
    }
  )

  opts.ipcMain.handle(IPC_CHANNELS.models.download, async (): Promise<IpcResult<null>> => {
    // Fire-and-forget: progress + completion flow through statusChanged events.
    void provisioning.ensureModels()
    return { success: true, data: null }
  })

  // Start downloading missing models on launch (NER first — it gates remote AI).
  void provisioning.ensureModels()

  return provisioning
}
