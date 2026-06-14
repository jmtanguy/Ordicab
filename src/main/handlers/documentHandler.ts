import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type DocumentExtractedContent,
  type DocumentExtractProgressEvent,
  type DocumentMetadataUpdate,
  type DocumentFolderDeleteResult,
  type DocumentImportResult,
  type DocumentMoveResult,
  type DocumentTrashEntry,
  type DocumentTrashResult,
  type DocumentTrashRestoreResult,
  type EmailAttachmentSaveResult,
  type PdfOperationResult,
  type DocumentPreview,
  type DocumentRecord,
  type DocumentTextExtractionStatus,
  type DocumentWatchStatus,
  type DossierScopedQuery,
  type GlobalSearchResult,
  type IpcResult,
  type SemanticSearchResult
} from '@shared/types'

import {
  dossierScopedQuerySchema,
  documentFileMoveInputSchema,
  documentFileRenameInputSchema,
  documentFolderCreateInputSchema,
  documentFolderDeleteInputSchema,
  documentFolderMoveInputSchema,
  documentFolderRenameInputSchema,
  documentImportInputSchema,
  documentTrashInputSchema,
  documentTrashRestoreInputSchema,
  emailAttachmentSaveInputSchema,
  pdfExtractPagesInputSchema,
  pdfMergeInputSchema,
  pdfSplitInputSchema,
  documentMetadataUpdateSchema,
  documentPreviewInputSchema,
  globalSearchQuerySchema,
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

        void options.documentService.purgeExpiredTrash(parsed).catch(() => undefined)

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
    ): Promise<IpcResult<{ documentPath: string; status: DocumentTextExtractionStatus }>> => {
      try {
        const parsed = documentPreviewInputSchema.parse(input)
        return {
          success: true,
          data: {
            documentPath: parsed.documentPath,
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
              documentPath: parsed.documentPath,
              phase: progress.phase,
              page: progress.page,
              totalPages: progress.totalPages
            }
            event.sender.send(IPC_CHANNELS.document.extractProgress, payload)
          })
        }
      } catch (error) {
        // DEBUG: log full stack trace to identify the failing document
        console.error('[extractContent] Failed for document:', parsed.documentPath, '\n', error)
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
    IPC_CHANNELS.document.searchAll,
    async (_event, input: unknown): Promise<IpcResult<GlobalSearchResult>> => {
      try {
        const parsed = globalSearchQuerySchema.parse(input)
        const data = await options.documentService.searchAllDossiers(parsed)
        return { success: true, data }
      } catch (error) {
        return mapDocumentError(error, 'Unable to run cross-dossier search.')
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
    async (_event, input: unknown): Promise<IpcResult<DocumentFolderDeleteResult>> => {
      try {
        const parsed = documentFolderDeleteInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.deleteFolder(parsed)
        }
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
    IPC_CHANNELS.document.trashFiles,
    async (_event, input: unknown): Promise<IpcResult<DocumentTrashResult>> => {
      try {
        const parsed = documentTrashInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.trashFiles(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to move documents to the trash.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.restoreTrash,
    async (_event, input: unknown): Promise<IpcResult<DocumentTrashRestoreResult>> => {
      try {
        const parsed = documentTrashRestoreInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.restoreTrash(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to restore documents from the trash.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.moveFiles,
    async (_event, input: unknown): Promise<IpcResult<DocumentMoveResult>> => {
      try {
        const parsed = documentFileMoveInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.moveFiles(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to move documents.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.moveFolder,
    async (_event, input: unknown): Promise<IpcResult<{ path: string }>> => {
      try {
        const parsed = documentFolderMoveInputSchema.parse(input)
        const path = await options.documentService.moveFolder(parsed)
        return { success: true, data: { path } }
      } catch (error) {
        return mapDocumentError(error, 'Unable to move folder.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.importFiles,
    async (_event, input: unknown): Promise<IpcResult<DocumentImportResult>> => {
      try {
        const parsed = documentImportInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.importFiles(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to import files into the dossier.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.saveEmailAttachments,
    async (_event, input: unknown): Promise<IpcResult<EmailAttachmentSaveResult>> => {
      try {
        const parsed = emailAttachmentSaveInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.saveEmailAttachments(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to save email attachments.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.listTrash,
    async (_event, input: unknown): Promise<IpcResult<DocumentTrashEntry[]>> => {
      try {
        const parsed = dossierScopedQuerySchema.parse(input) as DossierScopedQuery
        return {
          success: true,
          data: await options.documentService.listTrash(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to list the dossier trash.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.deleteTrashEntry,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = documentTrashRestoreInputSchema.parse(input)
        await options.documentService.deleteTrashEntry(parsed)
        return { success: true, data: null }
      } catch (error) {
        return mapDocumentError(error, 'Unable to delete the trash entry.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.pdfExtractPages,
    async (_event, input: unknown): Promise<IpcResult<PdfOperationResult>> => {
      try {
        const parsed = pdfExtractPagesInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.extractPdfPages(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to extract PDF pages.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.pdfMerge,
    async (_event, input: unknown): Promise<IpcResult<PdfOperationResult>> => {
      try {
        const parsed = pdfMergeInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.mergePdfs(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to merge PDF documents.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.document.pdfSplit,
    async (_event, input: unknown): Promise<IpcResult<PdfOperationResult>> => {
      try {
        const parsed = pdfSplitInputSchema.parse(input)
        return {
          success: true,
          data: await options.documentService.splitPdf(parsed)
        }
      } catch (error) {
        return mapDocumentError(error, 'Unable to split the PDF document.')
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
        const relativePath = parsed.documentPath
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
