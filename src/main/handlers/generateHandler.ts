import { dialog } from 'electron'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type DocxPreviewResult,
  type GeneratedDraftResult,
  type GeneratedDocumentResult,
  type IpcResult
} from '@shared/types'
import { previewInvoiceNumber } from '@shared/domain/invoiceNumbering'
import { entityToInvoiceIssuer } from '@shared/domain/invoiceIssuer'

import {
  generateDocumentInputSchema,
  generatePreviewInputSchema,
  generatePreviewInvoiceDocxInputSchema,
  saveGeneratedDocumentInputSchema,
  selectOutputPathInputSchema,
  type GenerateDocumentInput,
  type GeneratePreviewInput,
  type GeneratePreviewInvoiceDocxInput,
  type SaveGeneratedDocumentInput,
  type SelectOutputPathInput
} from '@shared/validation'
import { type GenerateService, GenerateServiceError } from '../services/domain/generateService'
import type { DossierRegistryService } from '../services/domain/dossierRegistryService'
import type { InvoiceService } from '../services/domain/invoiceService'
import type { ContactService } from '../services/domain/contactService'
import type { EntityService } from '../services/domain/entityService'
import { buildInvoiceTemplateInputFromBillingItems } from '../services/domain/invoiceTemplateInput'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapGenerateError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid document generation input.',
    errorClasses: [GenerateServiceError]
  })

export function registerGenerateHandlers(options: {
  generateService: GenerateService
  /**
   * Services required for `generate:preview-invoice-docx`. Optional so legacy tests
   * that only exercise the document/preview channels can omit them.
   */
  dossierRegistryService?: DossierRegistryService
  invoiceService?: InvoiceService
  contactService?: ContactService
  /** Source of truth for the invoice issuer identity, used to populate the preview. */
  entityService?: EntityService
  ipcMain: IpcMainLike
  showSaveDialog?: typeof dialog.showSaveDialog
}): void {
  const showSaveDialog =
    options.showSaveDialog ??
    (async (...args: Parameters<typeof dialog.showSaveDialog>) => {
      if (!dialog?.showSaveDialog) {
        return { canceled: true, filePath: undefined }
      }
      return dialog.showSaveDialog(...args)
    })

  options.ipcMain.handle(
    IPC_CHANNELS.generate.document,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDocumentResult>> => {
      try {
        const parsed = generateDocumentInputSchema.parse(input) as GenerateDocumentInput
        return {
          success: true,
          data: await options.generateService.generateDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to generate document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.preview,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDraftResult>> => {
      try {
        const parsed = generatePreviewInputSchema.parse(input) as GeneratePreviewInput
        return {
          success: true,
          data: await options.generateService.previewDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to build generated draft.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.save,
    async (_event, input: unknown): Promise<IpcResult<GeneratedDocumentResult>> => {
      try {
        const parsed = saveGeneratedDocumentInputSchema.parse(input) as SaveGeneratedDocumentInput
        return {
          success: true,
          data: await options.generateService.saveGeneratedDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to save generated document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.previewDocx,
    async (_event, input: unknown): Promise<IpcResult<DocxPreviewResult>> => {
      try {
        const parsed = generatePreviewInputSchema.parse(input) as GeneratePreviewInput
        return {
          success: true,
          data: await options.generateService.previewDocxDocument(parsed)
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to preview .docx template tags.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.previewInvoiceDocx,
    async (_event, input: unknown): Promise<IpcResult<DocxPreviewResult>> => {
      try {
        const { dossierRegistryService, invoiceService, contactService, entityService } = options
        if (!dossierRegistryService || !invoiceService || !contactService) {
          return {
            success: false,
            error: 'Invoice preview is not available in this context.',
            code: IpcErrorCode.NOT_FOUND
          }
        }
        const parsed = generatePreviewInvoiceDocxInputSchema.parse(
          input
        ) as GeneratePreviewInvoiceDocxInput

        const dossier = await dossierRegistryService.getDossier({
          dossierId: parsed.dossierId
        })
        const items = parsed.billingItemIds.map((id) => {
          const found = dossier.billingItems.find((entry) => entry.id === id)
          if (!found) {
            throw new GenerateServiceError(
              IpcErrorCode.NOT_FOUND,
              `Billing item ${id} was not found in dossier ${parsed.dossierId}.`
            )
          }
          return found
        })

        const settings = await invoiceService.getSettings()
        const contacts = await contactService.list(parsed.dossierId).catch(() => [])
        const entityProfile = entityService ? await entityService.get().catch(() => null) : null
        const issuer = entityToInvoiceIssuer(entityProfile, settings)
        const issuedAtIso = (parsed.issuedAt ?? new Date().toISOString().slice(0, 10)).slice(0, 10)
        const issuedAtDate = new Date(`${issuedAtIso}T12:00:00`)
        const previewNumber = (() => {
          try {
            return previewInvoiceNumber(settings, issuedAtDate)
          } catch {
            return 'FAC-PREVIEW'
          }
        })()

        const invoiceContext = buildInvoiceTemplateInputFromBillingItems({
          items,
          dossier,
          contacts,
          issuer,
          number: previewNumber,
          issuedAt: issuedAtIso,
          notes: parsed.notes
        })

        return {
          success: true,
          data: await options.generateService.previewDocxDocument({
            dossierId: parsed.dossierId,
            templateId: parsed.templateId,
            tagOverrides: parsed.tagOverrides,
            primaryContactId: parsed.primaryContactId,
            contactRoleOverrides: parsed.contactRoleOverrides,
            invoiceContext
          })
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to preview invoice template tags.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.generate.selectOutputPath,
    async (_event, input: unknown): Promise<IpcResult<string | null>> => {
      try {
        const parsed = selectOutputPathInputSchema.parse(input) as SelectOutputPathInput
        const result = await showSaveDialog({
          defaultPath: parsed.defaultFilename ? `${parsed.defaultFilename}.docx` : undefined,
          filters: [{ name: 'Word Document', extensions: ['docx'] }]
        })
        return {
          success: true,
          data: result.canceled || !result.filePath ? null : result.filePath
        }
      } catch (error) {
        return mapGenerateError(error, 'Unable to select output path.')
      }
    }
  )
}
