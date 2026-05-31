import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type DocumentExtractedContent,
  type DocumentExtractProgressEvent,
  type DocumentMetadataUpdate,
  type DocumentPreview,
  type DocumentRecord,
  type DocumentTextExtractionStatus,
  type DocumentWatchStatus,
  type DossierScopedQuery,
  type IpcResult,
  type SemanticSearchResult
} from '@shared/types'

import {
  dossierScopedQuerySchema,
  documentFileDeleteInputSchema,
  documentFileRenameInputSchema,
  documentFolderCreateInputSchema,
  documentFolderDeleteInputSchema,
  documentFolderRenameInputSchema,
  documentMetadataUpdateSchema,
  documentPreviewInputSchema,
  semanticSearchQuerySchema
} from '@shared/validation'

import { type DocumentService, DocumentServiceError } from '../services/domain/documentService'
import { type FileWatcherService } from '../lib/ordicab/FileWatcherService'
import { type IpcSenderLike, mapIpcError } from './ipc'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: { sender: IpcSenderLike }, input?: unknown) => Promise<unknown>
  ) => void
}

const mapDocumentError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid document input.',
    errorClasses: [DocumentServiceError]
  })

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
    async (event, input: unknown): Promise<IpcResult<DocumentExtractedContent>> => {
      const parsed = documentPreviewInputSchema.parse(input)
      try {
        return {
          success: true,
          data: await options.documentService.extractContent(parsed, (progress) => {
            if (event.sender.isDestroyed()) return
            const payload: DocumentExtractProgressEvent = {
              dossierId: parsed.dossierId,
              documentId: parsed.documentId,
              phase: progress.phase,
              page: progress.page,
              totalPages: progress.totalPages
            }
            event.sender.send(IPC_CHANNELS.document.extractProgress, payload)
          })
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
    IPC_CHANNELS.document.semanticSearch,
    async (_event, input: unknown): Promise<IpcResult<SemanticSearchResult>> => {
      try {
        const parsed = semanticSearchQuerySchema.parse(input)
        const data = await options.documentService.semanticSearch(parsed)
        return { success: true, data }
      } catch (error) {
        return mapDocumentError(error, 'Unable to run semantic search.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.listFolders,
    async (_event, input: unknown): Promise<IpcResult<string[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.documentService.listFolders(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to list dossier folders.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.createFolder,
    async (_event, input: unknown): Promise<IpcResult<{ path: string }>> => {
      try {
        const parsed = documentFolderCreateInputSchema.parse(input)
        const path = await options.documentService.createFolder(parsed)
        return { success: true, data: { path } }
      } catch (error) {
        return mapDocumentError(error, 'Unable to create folder.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.renameFolder,
    async (_event, input: unknown): Promise<IpcResult<{ path: string }>> => {
      try {
        const parsed = documentFolderRenameInputSchema.parse(input)
        const path = await options.documentService.renameFolder(parsed)
        return { success: true, data: { path } }
      } catch (error) {
        return mapDocumentError(error, 'Unable to rename folder.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.deleteFolder,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = documentFolderDeleteInputSchema.parse(input)
        await options.documentService.deleteFolder(parsed)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to delete folder.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.renameFile,
    async (_event, input: unknown): Promise<IpcResult<DocumentRecord>> => {
      try {
        const parsed = documentFileRenameInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.renameFile(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to rename document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.deleteFile,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = documentFileDeleteInputSchema.parse(input)
        await options.documentService.deleteFile(parsed)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to delete document.')
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
        const { join, resolve, sep } = await import('node:path')
        const filePath = join(dossierPath, relativePath)
        const resolvedDossier = resolve(dossierPath)
        const resolvedFile = resolve(filePath)
        if (resolvedFile !== resolvedDossier && !resolvedFile.startsWith(resolvedDossier + sep)) {
          throw new DocumentServiceError(
            IpcErrorCode.INVALID_INPUT,
            'Document path escapes the dossier root.'
          )
        }
        await options.openPath(resolvedFile)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to open document.')
      }
    }
  )
}
