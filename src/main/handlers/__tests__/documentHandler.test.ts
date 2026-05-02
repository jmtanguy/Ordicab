import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode } from '@shared/types'
import type { SemanticSearchResult } from '@shared/types'

import { type DocumentService } from '../../services/domain/documentService'
import { type FileWatcherService } from '../../lib/ordicab/FileWatcherService'
import { registerDocumentHandlers } from '../documentHandler'

interface IpcSenderLike {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
}
type Listener = (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>

function createIpcMainHarness(): {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
  ipcMain: { handle: (channel: string, listener: Listener) => void }
} {
  const handlers = new Map<string, Listener>()
  return {
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      }
    },
    invoke: async (channel, input) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No IPC handler for ${channel}`)
      const event = { sender: { isDestroyed: () => false, send: () => {} } }
      return handler(event, input)
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('documentHandler — semantic search', () => {
  it('forwards well-formed queries to documentService.semanticSearch', async () => {
    const result: SemanticSearchResult = {
      dossierId: 'dos-1',
      query: 'contract indemnity',
      hits: [
        {
          documentId: 'a.pdf',
          filename: 'a.pdf',
          charStart: 0,
          charEnd: 10,
          score: 0.8,
          snippet: 'some text'
        }
      ]
    }
    const semanticSearch = vi.fn(async () => result)
    const documentService = { semanticSearch } as unknown as DocumentService
    const fileWatcherService = {} as unknown as FileWatcherService
    const harness = createIpcMainHarness()

    registerDocumentHandlers({
      documentService,
      fileWatcherService,
      ipcMain: harness.ipcMain,
      openPath: async () => ''
    })

    const res = await harness.invoke(IPC_CHANNELS.document.semanticSearch, {
      dossierId: 'dos-1',
      query: 'contract indemnity',
      topK: 3
    })

    expect(res).toEqual({ success: true, data: result })
    expect(semanticSearch).toHaveBeenCalledWith({
      dossierId: 'dos-1',
      query: 'contract indemnity',
      topK: 3
    })
  })

  it('rejects invalid input without calling the service', async () => {
    const semanticSearch = vi.fn()
    const documentService = { semanticSearch } as unknown as DocumentService
    const fileWatcherService = {} as unknown as FileWatcherService
    const harness = createIpcMainHarness()

    registerDocumentHandlers({
      documentService,
      fileWatcherService,
      ipcMain: harness.ipcMain,
      openPath: async () => ''
    })

    const res = await harness.invoke(IPC_CHANNELS.document.semanticSearch, {
      dossierId: 'dos-1'
    })

    expect(res).toEqual({
      success: false,
      error: 'Invalid document input.',
      code: IpcErrorCode.VALIDATION_FAILED
    })
    expect(semanticSearch).not.toHaveBeenCalled()
  })

  it('maps service errors to a generic IpcResult failure', async () => {
    const semanticSearch = vi.fn(async () => {
      throw new Error('boom')
    })
    const documentService = { semanticSearch } as unknown as DocumentService
    const fileWatcherService = {} as unknown as FileWatcherService
    const harness = createIpcMainHarness()

    registerDocumentHandlers({
      documentService,
      fileWatcherService,
      ipcMain: harness.ipcMain,
      openPath: async () => ''
    })

    const res = (await harness.invoke(IPC_CHANNELS.document.semanticSearch, {
      dossierId: 'dos-1',
      query: 'anything'
    })) as { success: false; error: string }
    expect(res.success).toBe(false)
    expect(res.error).toBe('boom')
  })
})
