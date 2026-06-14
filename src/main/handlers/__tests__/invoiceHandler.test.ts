import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, type IpcResult } from '@shared/types'

import { type InvoiceService } from '../../services/domain/invoiceService'
import { registerInvoiceHandlers } from '../invoiceHandler'

function createIpcMainHarness(): {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
  ipcMain: {
    handle: (
      channel: string,
      listener: (_event: unknown, input?: unknown) => Promise<unknown>
    ) => void
  }
} {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()
  return {
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      }
    },
    invoke: async (channel, input) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No IPC handler registered for ${channel}`)
      return handler({}, input)
    }
  }
}

describe('invoiceHandler — CSV/FEC export to a user-chosen location', () => {
  it('writes to the path returned by the save dialog and reports it back', async () => {
    const harness = createIpcMainHarness()
    const exportFec = vi.fn(async (_input: unknown, outputPath: string) => ({
      canceled: false,
      outputPath,
      invoiceCount: 3
    }))
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/chosen/fec.txt' }))

    registerInvoiceHandlers({
      ipcMain: harness.ipcMain,
      invoiceService: { exportFec } as unknown as InvoiceService,
      showSaveDialog
    })

    const result = (await harness.invoke(IPC_CHANNELS.invoice.exportFec, {})) as IpcResult<{
      canceled: boolean
      outputPath?: string
      invoiceCount?: number
    }>

    expect(showSaveDialog).toHaveBeenCalledOnce()
    expect(exportFec).toHaveBeenCalledWith({}, '/tmp/chosen/fec.txt')
    expect(result).toEqual({
      success: true,
      data: { canceled: false, outputPath: '/tmp/chosen/fec.txt', invoiceCount: 3 }
    })
  })

  it('does not write anything when the user cancels the save dialog', async () => {
    const harness = createIpcMainHarness()
    const exportCsv = vi.fn()
    const showSaveDialog = vi.fn(async () => ({ canceled: true }))

    registerInvoiceHandlers({
      ipcMain: harness.ipcMain,
      invoiceService: { exportCsv } as unknown as InvoiceService,
      showSaveDialog
    })

    const result = (await harness.invoke(IPC_CHANNELS.invoice.exportCsv, {})) as IpcResult<{
      canceled: boolean
    }>

    expect(exportCsv).not.toHaveBeenCalled()
    expect(result).toEqual({ success: true, data: { canceled: true } })
  })
})
