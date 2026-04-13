import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DocumentExtractedContent,
  type DocumentMetadataUpdate,
  type DocumentPreview,
  type DocumentRecord,
  type DocumentTextExtractionStatus,
  type DocumentWatchStatus,
  type DossierScopedQuery,
  type IpcError,
  type IpcResult
} from '@shared/types'

import {
  dossierScopedQuerySchema,
  documentMetadataUpdateSchema,
  documentPreviewInputSchema
} from '@renderer/schemas'

import { type DocumentService, DocumentServiceError } from '../services/domain/documentService'
import { type FileWatcherService } from '../lib/ordicab/FileWatcherService'

interface IpcSenderLike {
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
}

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

function mapDocumentError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid document input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof DocumentServiceError) {
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

export function registerDocumentHandlers(options: {
  documentService: DocumentService
  fileWatcherService: FileWatcherService
  ipcMain: IpcMainLike
  openPath: (path: string) => Promise<string>
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.document.list,
    async (_event, input: unknown): Promise<IpcResult<DocumentRecord[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.documentService.listDocuments(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to load dossier documents.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.startWatching,
    async (event, input: unknown): Promise<IpcResult<DocumentWatchStatus>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        const dossierPath = await options.documentService.resolveRegisteredDossierRoot(parsed)
        const status = await options.fileWatcherService.subscribe({
          ...parsed,
          dossierPath,
          onDocumentsChanged: (payload) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.document.didChange, payload)
            }
          },
          onAvailabilityChanged: (payload) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.document.availabilityChanged, payload)
            }
          }
        })

        return {
          success: true,
          data: status
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to start dossier file watching.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.preview,
    async (_event, input: unknown): Promise<IpcResult<DocumentPreview>> => {
      try {
        const parsed = documentPreviewInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.getPreview(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to load document preview.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.contentStatus,
    async (
      _event,
      input: unknown
    ): Promise<IpcResult<{ documentId: string; status: DocumentTextExtractionStatus }>> => {
      try {
        const parsed = documentPreviewInputSchema.parse(input)
        return {
          success: true,
          data: {
            documentId: parsed.documentId,
            status: await options.documentService.getContentStatus(parsed)
          }
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to load document extraction status.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.clearContentCache,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input)
        await options.documentService.clearContentCache(parsed)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to clear document content cache.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.extractContent,
    async (_event, input: unknown): Promise<IpcResult<DocumentExtractedContent>> => {
      const parsed = documentPreviewInputSchema.parse(input)
      try {
        return {
          success: true,
          data: await options.documentService.extractContent(parsed)
        }
      } catch (error) {
        // DEBUG: log full stack trace to identify the failing document
        console.error('[extractContent] Failed for document:', parsed.documentId, '\n', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          code: IpcErrorCode.UNKNOWN
        }
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.stopWatching,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        await options.fileWatcherService.unsubscribe(parsed)
        return {
          success: true,
          data: null
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to stop dossier file watching.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.saveMetadata,
    async (_event, input: unknown): Promise<IpcResult<DocumentRecord>> => {
      try {
        const parsed = documentMetadataUpdateSchema.parse(input) as DocumentMetadataUpdate
        return {
          success: true,
          data: await options.documentService.saveMetadata(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to save document metadata.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.openFile,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = documentPreviewInputSchema.parse(input)
        const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
          dossierId: parsed.dossierId
        })
        const relativePath = parsed.documentId
        const { join } = await import('node:path')
        const filePath = join(dossierPath, relativePath)
        await options.openPath(filePath)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to open document.')
      }
    }
  )
}
