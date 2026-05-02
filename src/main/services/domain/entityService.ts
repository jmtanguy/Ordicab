/**
 * entityService — service wrapper for the professional-entity profile
 * (`entity.json`) stored under the active domain.
 *
 * Reads the persisted profile, validates it via the shared Zod schema, and
 * persists drafts atomically. Both renderer-triggered IPC and
 * AI-initiated commands consume this service so the I/O stays in one place.
 *
 * Called by: entityHandler (IPC entity.get / entity.update),
 *            aiDelegated/aiEmbedded flows that need entity context.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  IpcErrorCode,
  type DomainStatusSnapshot,
  type EntityProfile,
  type EntityProfileDraft
} from '@shared/types'

import { entityProfileSchema } from '@shared/validation'

import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'
import { getDomainEntityPath } from '../../lib/ordicab/ordicabPaths'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface EntityService {
  get(): Promise<EntityProfile | null>
  update(draft: EntityProfileDraft): Promise<EntityProfile>
}

export class EntityServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EntityServiceError'
  }
}

export function createEntityService(options: { domainService: DomainServiceLike }): EntityService {
  const { domainService } = options

  async function resolveActiveDomainPath(): Promise<string> {
    const status = await domainService.getStatus()
    if (!status.registeredDomainPath) {
      throw new EntityServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
    }
    if (!status.isAvailable) {
      throw new EntityServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
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
      throw new EntityServiceError(
        IpcErrorCode.FILE_SYSTEM_ERROR,
        'Unable to read professional entity profile.'
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new EntityServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored professional entity profile is invalid.'
      )
    }

    const result = entityProfileSchema.safeParse(parsed)
    if (!result.success) {
      throw new EntityServiceError(
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
    // The .ordicab directory may not exist yet on a freshly-bootstrapped domain.
    await mkdir(dirname(entityPath), { recursive: true })
    // Story 4.x relies on these exact keys being available in template context
    // as entity.firmName, etc. See toEntityTemplateContext() in
    // src/shared/validation/entity.ts for the tag contract.
    await atomicWrite(entityPath, `${JSON.stringify(draft, null, 2)}\n`)
    return draft
  }

  return {
    async get(): Promise<EntityProfile | null> {
      const domainPath = await resolveActiveDomainPath()
      return loadEntityProfile(getDomainEntityPath(domainPath))
    },

    async update(draft: EntityProfileDraft): Promise<EntityProfile> {
      const domainPath = await resolveActiveDomainPath()
      return saveEntityProfile(getDomainEntityPath(domainPath), draft)
    }
  }
}
