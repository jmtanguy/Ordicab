import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type IpcResult } from '@shared/types'

import { GenerateServiceError } from '../../services/domain/generateService'
import { registerGenerateHandlers } from '../generateHandler'

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

      if (!handler) {
        throw new Error(`No IPC handler registered for ${channel}`)
      }

      return handler({}, input)
    }
  }
}

describe('generateHandler', () => {
  it('validates input and delegates generation to the service', async () => {
    const harness = createIpcMainHarness()
    const generateService = {
      previewDocument: vi.fn(),
      previewDocxDocument: vi.fn(),
      saveGeneratedDocument: vi.fn(),
      generateDocument: vi.fn(async () => ({
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
      }))
    }

    registerGenerateHandlers({
      ipcMain: harness.ipcMain,
      generateService
    })

    await expect(
      harness.invoke(IPC_CHANNELS.generate.document, {
        dossierId: 'Client Alpha',
        templateId: 'tpl-1'
      })
    ).resolves.toEqual({
      success: true,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
      }
    })

    expect(generateService.generateDocument).toHaveBeenCalledWith({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
  })

  it('rejects invalid payloads before hitting the service', async () => {
    const harness = createIpcMainHarness()
    const generateService = {
      previewDocument: vi.fn(),
      previewDocxDocument: vi.fn(),
      saveGeneratedDocument: vi.fn(),
      generateDocument: vi.fn()
    }

    registerGenerateHandlers({
      ipcMain: harness.ipcMain,
      generateService
    })

    await expect(
      harness.invoke(IPC_CHANNELS.generate.document, {
        dossierId: '',
        templateId: ''
      })
    ).resolves.toEqual({
      success: false,
      error: 'Invalid document generation input.',
      code: IpcErrorCode.VALIDATION_FAILED
    })

    expect(generateService.generateDocument).not.toHaveBeenCalled()
  })

  it('maps known generation failures to IPC errors', async () => {
    const harness = createIpcMainHarness()
    const generateService = {
      previewDocument: vi.fn(),
      previewDocxDocument: vi.fn(),
      saveGeneratedDocument: vi.fn(),
      generateDocument: vi.fn(async () => {
        throw new GenerateServiceError(IpcErrorCode.NOT_FOUND, 'Template was not found.')
      })
    }

    registerGenerateHandlers({
      ipcMain: harness.ipcMain,
      generateService
    })

    await expect(
      harness.invoke(IPC_CHANNELS.generate.document, {
        dossierId: 'Client Alpha',
        templateId: 'missing-template'
      })
    ).resolves.toEqual({
      success: false,
      error: 'Template was not found.',
      code: IpcErrorCode.NOT_FOUND
    } satisfies IpcResult<never>)
  })
})
