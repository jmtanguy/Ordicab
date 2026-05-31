import {
  IPC_CHANNELS,
  IpcErrorCode,
  type IpcError,
  type InvoiceArtifactIntegrity,
  type InvoiceCancelInput,
  type InvoiceCreateCorrectiveInput,
  type InvoiceCreateCreditNoteInput,
  type InvoiceCreateInput,
  type InvoiceExportCsvInput,
  type InvoiceExportCsvResult,
  type InvoiceMarkPaidInput,
  type InvoicePaymentDeleteInput,
  type InvoicePaymentInput,
  type InvoicePaymentUpdateInput,
  type InvoiceRecord,
  type InvoiceSettings,
  type InvoiceSettingsUpdateInput,
  type IpcResult
} from '@shared/types'
import {
  invoiceCancelInputSchema,
  invoiceCreateCorrectiveInputSchema,
  invoiceCreateCreditNoteInputSchema,
  invoiceCreateInputSchema,
  invoiceExportCsvInputSchema,
  invoiceMarkPaidInputSchema,
  invoicePaymentDeleteInputSchema,
  invoicePaymentInputSchema,
  invoicePaymentUpdateInputSchema,
  invoiceSettingsUpdateInputSchema
} from '@shared/validation'

import { InvoiceServiceError, type InvoiceService } from '../services/domain/invoiceService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid invoice input.',
    errorClasses: [InvoiceServiceError]
  })

export function registerInvoiceHandlers(options: {
  invoiceService: InvoiceService
  ipcMain: IpcMainLike
  openPath?: (path: string) => Promise<string>
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.invoice.list,
    async (): Promise<IpcResult<InvoiceRecord[]>> => {
      try {
        return { success: true, data: await options.invoiceService.list() }
      } catch (error) {
        return mapError(error, 'Unable to list invoices.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.get,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        if (typeof input !== 'string' || input.length === 0) {
          return {
            success: false,
            error: 'Missing invoice id.',
            code: IpcErrorCode.VALIDATION_FAILED
          }
        }
        return { success: true, data: await options.invoiceService.get(input) }
      } catch (error) {
        return mapError(error, 'Unable to load invoice.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.create,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoiceCreateInputSchema.parse(input) as InvoiceCreateInput
        return { success: true, data: await options.invoiceService.create(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to create invoice.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.cancel,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoiceCancelInputSchema.parse(input) as InvoiceCancelInput
        return { success: true, data: await options.invoiceService.cancel(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to cancel invoice.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.markPaid,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoiceMarkPaidInputSchema.parse(input) as InvoiceMarkPaidInput
        return { success: true, data: await options.invoiceService.markPaid(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to mark invoice as paid.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.createCreditNote,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoiceCreateCreditNoteInputSchema.parse(
          input
        ) as InvoiceCreateCreditNoteInput
        return { success: true, data: await options.invoiceService.createCreditNote(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to create credit note.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.createCorrectiveInvoice,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoiceCreateCorrectiveInputSchema.parse(
          input
        ) as InvoiceCreateCorrectiveInput
        return { success: true, data: await options.invoiceService.createCorrectiveInvoice(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to create corrective invoice.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.addPayment,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoicePaymentInputSchema.parse(input) as InvoicePaymentInput
        return { success: true, data: await options.invoiceService.addPayment(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to add payment.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.updatePayment,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoicePaymentUpdateInputSchema.parse(input) as InvoicePaymentUpdateInput
        return { success: true, data: await options.invoiceService.updatePayment(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to update payment.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.deletePayment,
    async (_event, input: unknown): Promise<IpcResult<InvoiceRecord>> => {
      try {
        const parsed = invoicePaymentDeleteInputSchema.parse(input) as InvoicePaymentDeleteInput
        return { success: true, data: await options.invoiceService.deletePayment(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to delete payment.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.openDocument,
    async (_event, input: unknown): Promise<IpcResult<{ integrity: InvoiceArtifactIntegrity }>> => {
      try {
        const value = input as { invoiceId?: unknown } | null | undefined
        if (!value || typeof value.invoiceId !== 'string' || value.invoiceId.length === 0) {
          return {
            success: false,
            error: 'Missing invoice id.',
            code: IpcErrorCode.VALIDATION_FAILED
          }
        }
        if (!options.openPath) {
          return {
            success: false,
            error: 'Open path is not available.',
            code: IpcErrorCode.FILE_SYSTEM_ERROR
          }
        }
        const { absolutePath, integrity } =
          await options.invoiceService.resolveDocumentAbsolutePath(value.invoiceId)
        const message = await options.openPath(absolutePath)
        if (message) {
          return { success: false, error: message, code: IpcErrorCode.FILE_SYSTEM_ERROR }
        }
        return { success: true, data: { integrity } }
      } catch (error) {
        return mapError(error, 'Unable to open invoice document.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.openPdf,
    async (_event, input: unknown): Promise<IpcResult<{ integrity: InvoiceArtifactIntegrity }>> => {
      try {
        const value = input as { invoiceId?: unknown } | null | undefined
        if (!value || typeof value.invoiceId !== 'string' || value.invoiceId.length === 0) {
          return {
            success: false,
            error: 'Missing invoice id.',
            code: IpcErrorCode.VALIDATION_FAILED
          }
        }
        if (!options.openPath) {
          return {
            success: false,
            error: 'Open path is not available.',
            code: IpcErrorCode.FILE_SYSTEM_ERROR
          }
        }
        const { absolutePath, integrity } = await options.invoiceService.resolvePdfAbsolutePath(
          value.invoiceId
        )
        const message = await options.openPath(absolutePath)
        if (message) {
          return { success: false, error: message, code: IpcErrorCode.FILE_SYSTEM_ERROR }
        }
        return { success: true, data: { integrity } }
      } catch (error) {
        return mapError(error, 'Unable to open invoice PDF.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.exportCsv,
    async (_event, input: unknown): Promise<IpcResult<InvoiceExportCsvResult>> => {
      try {
        const parsed = invoiceExportCsvInputSchema.parse(input) as InvoiceExportCsvInput
        return { success: true, data: await options.invoiceService.exportCsv(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to export invoices.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.getSettings,
    async (): Promise<IpcResult<InvoiceSettings>> => {
      try {
        return { success: true, data: await options.invoiceService.getSettings() }
      } catch (error) {
        return mapError(error, 'Unable to load invoice settings.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.updateSettings,
    async (_event, input: unknown): Promise<IpcResult<InvoiceSettings>> => {
      try {
        const parsed = invoiceSettingsUpdateInputSchema.parse(input) as InvoiceSettingsUpdateInput
        return { success: true, data: await options.invoiceService.updateSettings(parsed) }
      } catch (error) {
        return mapError(error, 'Unable to update invoice settings.')
      }
    }
  )
}
