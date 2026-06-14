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
  type InvoiceExportFecInput,
  type InvoiceExportFecResult,
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
  invoiceExportFecInputSchema,
  invoiceMarkPaidInputSchema,
  invoicePaymentDeleteInputSchema,
  invoicePaymentInputSchema,
  invoicePaymentUpdateInputSchema,
  invoiceSettingsUpdateInputSchema
} from '@shared/validation'

import { z } from 'zod'

import { InvoiceServiceError, type InvoiceService } from '../services/domain/invoiceService'
import { type IpcMainLike, mapIpcError } from './ipc'

const mapError = (error: unknown, fallback: string): IpcError =>
  mapIpcError(error, fallback, {
    validationMessage: 'Invalid invoice input.',
    errorClasses: [InvoiceServiceError]
  })

// Invoice ids flow into `${uuid}.json` / document paths on disk. Validate them
// as real UUIDs at the IPC boundary so a crafted id (e.g. `../../…`) can never
// reach a path join — every other invoice input is already a UUID-checked DTO.
const invoiceUuidSchema = z.string().uuid()

export function registerInvoiceHandlers(options: {
  invoiceService: InvoiceService
  ipcMain: IpcMainLike
  openPath?: (path: string) => Promise<string>
  /** Native "save as" dialog used to let the user choose the export destination. */
  showSaveDialog?: (options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => Promise<{ canceled: boolean; filePath?: string }>
}): void {
  // Shared "pick a destination, then write there" flow for the CSV / FEC
  // exports: validates the input, pops the native save dialog and hands the
  // chosen path to the service. A cancelled dialog resolves to
  // `{ canceled: true }` (no error). The two export inputs are structurally
  // identical (date range + includeCancelled).
  type ExportInput = { dateFrom?: string; dateTo?: string; includeCancelled?: boolean }
  type ExportResult = { canceled: boolean; outputPath?: string; invoiceCount?: number }
  const exportWithSaveDialog = async (
    parse: () => ExportInput,
    suggestedName: string,
    filters: Array<{ name: string; extensions: string[] }>,
    write: (parsed: ExportInput, outputPath: string) => Promise<ExportResult>,
    fallback: string
  ): Promise<IpcResult<ExportResult>> => {
    try {
      const parsed = parse()
      if (!options.showSaveDialog) {
        return {
          success: false,
          error: 'Export is unavailable in this environment.',
          code: IpcErrorCode.NOT_IMPLEMENTED
        }
      }
      const picked = await options.showSaveDialog({ defaultPath: suggestedName, filters })
      if (picked.canceled || !picked.filePath) {
        return { success: true, data: { canceled: true } }
      }
      return { success: true, data: await write(parsed, picked.filePath) }
    } catch (error) {
      return mapError(error, fallback)
    }
  }

  const todayStamp = (): string => new Date().toISOString().slice(0, 10)
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
        const parsed = invoiceUuidSchema.safeParse(input)
        if (!parsed.success) {
          return {
            success: false,
            error: 'Missing or invalid invoice id.',
            code: IpcErrorCode.VALIDATION_FAILED
          }
        }
        return { success: true, data: await options.invoiceService.get(parsed.data) }
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
        const parsed = invoiceUuidSchema.safeParse(
          (input as { invoiceUuid?: unknown } | null | undefined)?.invoiceUuid
        )
        if (!parsed.success) {
          return {
            success: false,
            error: 'Missing or invalid invoice id.',
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
          await options.invoiceService.resolveDocumentAbsolutePath(parsed.data)
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
        const parsed = invoiceUuidSchema.safeParse(
          (input as { invoiceUuid?: unknown } | null | undefined)?.invoiceUuid
        )
        if (!parsed.success) {
          return {
            success: false,
            error: 'Missing or invalid invoice id.',
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
          parsed.data
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
      return exportWithSaveDialog(
        () => invoiceExportCsvInputSchema.parse(input) as InvoiceExportCsvInput,
        `export-facturation-${todayStamp()}.csv`,
        [{ name: 'CSV', extensions: ['csv'] }],
        (parsed, outputPath) => options.invoiceService.exportCsv(parsed, outputPath),
        'Unable to export invoices.'
      )
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.invoice.exportFec,
    async (_event, input: unknown): Promise<IpcResult<InvoiceExportFecResult>> => {
      return exportWithSaveDialog(
        () => invoiceExportFecInputSchema.parse(input) as InvoiceExportFecInput,
        `export-fec-${todayStamp()}.txt`,
        [{ name: 'FEC', extensions: ['txt'] }],
        (parsed, outputPath) => options.invoiceService.exportFec(parsed, outputPath),
        'Unable to export the FEC file.'
      )
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
