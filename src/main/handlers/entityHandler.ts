import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DomainStatusSnapshot,
  type EntityProfile,
  type EntityProfileDraft,
  type IpcError,
  type IpcResult
} from '@shared/types'

import { entityProfileDraftSchema, entityProfileSchema } from '@renderer/schemas'

import { atomicWrite } from '../lib/system/atomicWrite'
import { pathExists } from '../lib/system/domainState'
import { getDomainEntityPath } from '../lib/ordicab/ordicabPaths'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

class EntityHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EntityHandlerError'
  }
}

function mapEntityError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid entity input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof EntityHandlerError) {
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

async function resolveActiveDomainPath(domainService: DomainServiceLike): Promise<string> {
  const status = await domainService.getStatus()

  if (!status.registeredDomainPath) {
    throw new EntityHandlerError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
  }

  if (!status.isAvailable) {
    throw new EntityHandlerError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
  }

  return status.registeredDomainPath
}

async function loadEntityProfile(entityPath: string): Promise<EntityProfile | null> {
  if (!(await pathExists(entityPath))) {
    return null
  }

  let raw: string

  try {
    raw = await readFile(entityPath, 'utf8')
  } catch {
    throw new EntityHandlerError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read professional entity profile.'
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new EntityHandlerError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored professional entity profile is invalid.'
    )
  }

  const result = entityProfileSchema.safeParse(parsed)

  if (!result.success) {
    throw new EntityHandlerError(
      IpcErrorCode.VALIDATION_FAILED,
      'Stored professional entity profile is invalid.'
    )
  }

  return result.data as EntityProfile
}

async function saveEntityProfile(
  entityPath: string,
  draft: EntityProfileDraft
): Promise<EntityProfile> {
  // Ensure .ordicab directory exists before writing (domain bootstrap may not have created it yet).
  await mkdir(dirname(entityPath), { recursive: true })
  // Story 4.x relies on these exact keys being available in template context as entity.firmName, etc.
  // See toEntityTemplateContext() in src/renderer/schemas/entity.ts for the tag contract.
  await atomicWrite(entityPath, `${JSON.stringify(draft, null, 2)}\n`)
  return draft
}

export function registerEntityHandlers(options: {
  domainService: DomainServiceLike
  ipcMain: IpcMainLike
}): void {
  options.ipcMain.handle(
    IPC_CHANNELS.entity.get,
    async (): Promise<IpcResult<EntityProfile | null>> => {
      try {
        const domainPath = await resolveActiveDomainPath(options.domainService)
        return {
          success: true,
          data: await loadEntityProfile(getDomainEntityPath(domainPath))
        }
      } catch (error) {
        return mapEntityError(error, 'Unable to load professional entity profile.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.entity.update,
    async (_event, input: unknown): Promise<IpcResult<EntityProfile>> => {
      try {
        const parsed = entityProfileDraftSchema.parse(input) as EntityProfileDraft
        const domainPath = await resolveActiveDomainPath(options.domainService)
        return {
          success: true,
          data: await saveEntityProfile(getDomainEntityPath(domainPath), parsed)
        }
      } catch (error) {
        return mapEntityError(error, 'Unable to save professional entity profile.')
      }
    }
  )
}
