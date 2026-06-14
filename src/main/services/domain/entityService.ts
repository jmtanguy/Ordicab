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
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

import {
  IpcErrorCode,
  type DomainStatusSnapshot,
  type EntityProfile,
  type EntityProfileDraft
} from '@shared/types'

import { entityProfileSchema } from '@shared/validation'

import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'
import {
  getDomainCabinetDefaultTemplateDocxPath,
  getDomainEntityPath,
  getDomainStampImagePath
} from '../../lib/ordicab/ordicabPaths'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface EntityService {
  get(): Promise<EntityProfile | null>
  update(draft: EntityProfileDraft): Promise<EntityProfile>
  importDefaultTemplate(sourceFilePath: string): Promise<EntityProfile>
  getDefaultTemplatePath(): Promise<string>
  removeDefaultTemplate(): Promise<EntityProfile>
  importStamp(sourceFilePath: string): Promise<EntityProfile>
  removeStamp(): Promise<EntityProfile>
  /** Absolute path of the imported stamp PNG, or null when none was imported. */
  getStampImagePath(): Promise<string | null>
  /** Data URL of the imported stamp for renderer previews, or null when none. */
  getStampDataUrl(): Promise<string | null>
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
    },

    async importDefaultTemplate(sourceFilePath: string): Promise<EntityProfile> {
      const domainPath = await resolveActiveDomainPath()
      const entityPath = getDomainEntityPath(domainPath)
      const current = await loadEntityProfile(entityPath)
      if (!current) {
        throw new EntityServiceError(
          IpcErrorCode.NOT_FOUND,
          'Configure firm information before importing a default template.'
        )
      }

      const destination = getDomainCabinetDefaultTemplateDocxPath(domainPath)
      await mkdir(dirname(destination), { recursive: true })
      try {
        await copyFile(sourceFilePath, destination)
      } catch {
        throw new EntityServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          'Unable to copy the selected Word document.'
        )
      }

      const next: EntityProfileDraft = {
        ...current,
        defaultTemplateFileName: basename(sourceFilePath),
        defaultTemplateImportedAt: new Date().toISOString()
      }
      return saveEntityProfile(entityPath, next)
    },

    async getDefaultTemplatePath(): Promise<string> {
      const domainPath = await resolveActiveDomainPath()
      const docxPath = getDomainCabinetDefaultTemplateDocxPath(domainPath)
      if (!(await pathExists(docxPath))) {
        throw new EntityServiceError(
          IpcErrorCode.NOT_FOUND,
          'No default Word template has been imported.'
        )
      }
      return docxPath
    },

    async importStamp(sourceFilePath: string): Promise<EntityProfile> {
      const domainPath = await resolveActiveDomainPath()
      const entityPath = getDomainEntityPath(domainPath)
      const current = await loadEntityProfile(entityPath)
      if (!current) {
        throw new EntityServiceError(
          IpcErrorCode.NOT_FOUND,
          'Configure firm information before importing a stamp.'
        )
      }

      const destination = getDomainStampImagePath(domainPath)
      await mkdir(dirname(destination), { recursive: true })
      try {
        // Re-encode to PNG whatever the source format (png/jpg), downscaling
        // very large scans: pdf-lib embeds the bytes verbatim, so a 10 MP photo
        // would bloat every generated pièce.
        const { loadImage, createCanvas } = await import('@napi-rs/canvas')
        const image = await loadImage(sourceFilePath)
        const maxEdge = 1200
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = createCanvas(width, height)
        canvas.getContext('2d').drawImage(image, 0, 0, width, height)
        await atomicWrite(destination, await canvas.encode('png'))
      } catch {
        throw new EntityServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Unable to read the selected stamp image.'
        )
      }

      const next: EntityProfileDraft = {
        ...current,
        stampImageFileName: basename(sourceFilePath),
        stampImportedAt: new Date().toISOString()
      }
      return saveEntityProfile(entityPath, next)
    },

    async removeStamp(): Promise<EntityProfile> {
      const domainPath = await resolveActiveDomainPath()
      const entityPath = getDomainEntityPath(domainPath)
      const current = await loadEntityProfile(entityPath)
      if (!current) {
        throw new EntityServiceError(
          IpcErrorCode.NOT_FOUND,
          'No professional entity profile to update.'
        )
      }

      const stampPath = getDomainStampImagePath(domainPath)
      if (await pathExists(stampPath)) {
        try {
          await unlink(stampPath)
        } catch {
          throw new EntityServiceError(
            IpcErrorCode.FILE_SYSTEM_ERROR,
            'Unable to remove the stamp image.'
          )
        }
      }

      const next: EntityProfileDraft = {
        ...current,
        stampImageFileName: undefined,
        stampImportedAt: undefined
      }
      return saveEntityProfile(entityPath, next)
    },

    async getStampImagePath(): Promise<string | null> {
      const domainPath = await resolveActiveDomainPath()
      const stampPath = getDomainStampImagePath(domainPath)
      return (await pathExists(stampPath)) ? stampPath : null
    },

    async getStampDataUrl(): Promise<string | null> {
      const domainPath = await resolveActiveDomainPath()
      const stampPath = getDomainStampImagePath(domainPath)
      if (!(await pathExists(stampPath))) {
        return null
      }
      const bytes = await readFile(stampPath)
      return `data:image/png;base64,${bytes.toString('base64')}`
    },

    async removeDefaultTemplate(): Promise<EntityProfile> {
      const domainPath = await resolveActiveDomainPath()
      const entityPath = getDomainEntityPath(domainPath)
      const current = await loadEntityProfile(entityPath)
      if (!current) {
        throw new EntityServiceError(
          IpcErrorCode.NOT_FOUND,
          'No professional entity profile to update.'
        )
      }

      const docxPath = getDomainCabinetDefaultTemplateDocxPath(domainPath)
      if (await pathExists(docxPath)) {
        try {
          await unlink(docxPath)
        } catch {
          throw new EntityServiceError(
            IpcErrorCode.FILE_SYSTEM_ERROR,
            'Unable to remove the default Word template.'
          )
        }
      }

      const next: EntityProfileDraft = {
        ...current,
        defaultTemplateFileName: undefined,
        defaultTemplateImportedAt: undefined
      }
      return saveEntityProfile(entityPath, next)
    }
  }
}
