import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type ClaudeMdStatus, type IpcResult } from '@shared/types'

import { DelegatedInstructionsGeneratorError } from '../../lib/aiDelegated/aiDelegatedInstructionsGenerator'
import { DocumentServiceError } from '../../services/domain/documentService'
import { registerInstructionsHandlers } from '../instructionsHandler'

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

describe('instructionsHandler', () => {
  it('regenerates the domain-root CLAUDE.md when dossierId is omitted', async () => {
    const harness = createIpcMainHarness()
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn<() => ClaudeMdStatus>(() => ({
        status: 'idle',
        updatedAt: '2026-03-20T12:00:00.000Z'
      }))
    }

    registerInstructionsHandlers({
      ipcMain: harness.ipcMain,
      instructionsGenerator,
      documentService: {
        resolveRegisteredDossierRoot: vi.fn()
      }
    })

    await expect(harness.invoke(IPC_CHANNELS.claudeMd.regenerate, {})).resolves.toEqual({
      success: true,
      data: null
    })

    expect(instructionsGenerator.generateDomainRoot).toHaveBeenCalledTimes(1)
    expect(instructionsGenerator.generateDomainRoot).toHaveBeenCalledWith()
  })

  it('validates dossierId then regenerates only the domain root when dossierId is provided', async () => {
    const harness = createIpcMainHarness()
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => undefined),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn<() => ClaudeMdStatus>(() => ({
        status: 'idle',
        updatedAt: null
      }))
    }
    const documentService = {
      resolveRegisteredDossierRoot: vi.fn(async () => '/tmp/domain/Client Alpha')
    }

    registerInstructionsHandlers({
      ipcMain: harness.ipcMain,
      instructionsGenerator,
      documentService
    })

    await expect(
      harness.invoke(IPC_CHANNELS.claudeMd.regenerate, {
        dossierId: 'Client Alpha'
      })
    ).resolves.toEqual({
      success: true,
      data: null
    })

    expect(documentService.resolveRegisteredDossierRoot).toHaveBeenCalledWith({
      dossierId: 'Client Alpha'
    })
    expect(instructionsGenerator.generateDossier).not.toHaveBeenCalled()
    expect(instructionsGenerator.generateDomainRoot).toHaveBeenCalledWith()
  })

  it('returns NOT_FOUND when dossierId does not resolve to a registered dossier', async () => {
    const harness = createIpcMainHarness()
    const instructionsGenerator = {
      generateDossier: vi.fn(),
      generateDomainRoot: vi.fn(),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn<() => ClaudeMdStatus>(() => ({
        status: 'idle',
        updatedAt: null
      }))
    }

    registerInstructionsHandlers({
      ipcMain: harness.ipcMain,
      instructionsGenerator,
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
        })
      }
    })

    await expect(
      harness.invoke(IPC_CHANNELS.claudeMd.regenerate, {
        dossierId: 'Client Alpha'
      })
    ).resolves.toEqual({
      success: false,
      error: 'This dossier is not registered.',
      code: IpcErrorCode.NOT_FOUND
    })
  })

  it('returns generator status and maps generation failures', async () => {
    const harness = createIpcMainHarness()
    const instructionsGenerator = {
      generateDossier: vi.fn(async () => undefined),
      generateDomainRoot: vi.fn(async () => {
        throw new DelegatedInstructionsGeneratorError(
          IpcErrorCode.NOT_FOUND,
          'Active domain is not configured.'
        )
      }),
      generateForMode: vi.fn(async () => undefined),
      getStatus: vi.fn<() => ClaudeMdStatus>(() => ({
        status: 'error',
        updatedAt: '2026-03-20T12:00:00.000Z'
      }))
    }

    registerInstructionsHandlers({
      ipcMain: harness.ipcMain,
      instructionsGenerator,
      documentService: {
        resolveRegisteredDossierRoot: vi.fn()
      }
    })

    await expect(harness.invoke(IPC_CHANNELS.claudeMd.status)).resolves.toEqual({
      success: true,
      data: {
        status: 'error',
        updatedAt: '2026-03-20T12:00:00.000Z'
      }
    } satisfies IpcResult<ClaudeMdStatus>)

    await expect(harness.invoke(IPC_CHANNELS.claudeMd.regenerate, {})).resolves.toEqual({
      success: false,
      error: 'Active domain is not configured.',
      code: IpcErrorCode.NOT_FOUND
    })
  })
})
