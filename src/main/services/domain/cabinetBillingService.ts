import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  type CabinetBillingCatalog,
  type CabinetBillingDefaultInput,
  type CabinetServicePreset,
  type CabinetServicePresetDeleteInput,
  type CabinetServicePresetUpsertInput,
  IpcErrorCode,
  type DomainStatusSnapshot
} from '@shared/types'
import {
  cabinetBillingCatalogSchema,
  cabinetServicePresetUpsertInputSchema
} from '@shared/validation'

import { getDomainCabinetBillingPath } from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { pathExists } from '../../lib/system/domainState'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

export interface CabinetBillingService {
  get(): Promise<CabinetBillingCatalog>
  upsertService(input: CabinetServicePresetUpsertInput): Promise<CabinetBillingCatalog>
  deleteService(input: CabinetServicePresetDeleteInput): Promise<CabinetBillingCatalog>
  setDefaultService(input: CabinetBillingDefaultInput): Promise<CabinetBillingCatalog>
}

export class CabinetBillingServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CabinetBillingServiceError'
  }
}

function createEmptyCatalog(now: () => Date): CabinetBillingCatalog {
  return {
    services: [],
    updatedAt: now().toISOString()
  }
}

function ensureValidDefaultService(catalog: CabinetBillingCatalog): CabinetBillingCatalog {
  if (!catalog.defaultServiceUuid) {
    return catalog
  }

  const hasDefault = catalog.services.some((service) => service.uuid === catalog.defaultServiceUuid)
  if (hasDefault) {
    return catalog
  }

  return {
    ...catalog,
    defaultServiceUuid: undefined
  }
}

export function createCabinetBillingService(options: {
  domainService: DomainServiceLike
  now?: () => Date
}): CabinetBillingService {
  const { domainService } = options
  const now = options.now ?? (() => new Date())

  async function resolveActiveDomainPath(): Promise<string> {
    const status = await domainService.getStatus()
    if (!status.registeredDomainPath) {
      throw new CabinetBillingServiceError(
        IpcErrorCode.NOT_FOUND,
        'Active domain is not configured.'
      )
    }
    if (!status.isAvailable) {
      throw new CabinetBillingServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
    }
    return status.registeredDomainPath
  }

  async function loadCatalog(catalogPath: string): Promise<CabinetBillingCatalog> {
    if (!(await pathExists(catalogPath))) {
      return createEmptyCatalog(now)
    }

    let raw: string
    try {
      raw = await readFile(catalogPath, 'utf8')
    } catch {
      throw new CabinetBillingServiceError(
        IpcErrorCode.FILE_SYSTEM_ERROR,
        'Unable to read cabinet billing catalog.'
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new CabinetBillingServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored cabinet billing catalog is invalid.'
      )
    }

    const result = cabinetBillingCatalogSchema.safeParse(parsed)
    if (!result.success) {
      throw new CabinetBillingServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored cabinet billing catalog is invalid.'
      )
    }

    return ensureValidDefaultService(result.data)
  }

  async function saveCatalog(
    catalogPath: string,
    catalog: CabinetBillingCatalog
  ): Promise<CabinetBillingCatalog> {
    const normalized = ensureValidDefaultService(catalog)
    const validated = cabinetBillingCatalogSchema.parse(normalized)
    await mkdir(dirname(catalogPath), { recursive: true })
    await atomicWrite(catalogPath, `${JSON.stringify(validated, null, 2)}\n`)
    return validated
  }

  function toStoredPreset(
    input: CabinetServicePresetUpsertInput,
    existing?: CabinetServicePreset
  ): CabinetServicePreset {
    const parsed = cabinetServicePresetUpsertInputSchema.parse(input)
    return {
      ...existing,
      ...parsed,
      uuid: existing?.uuid ?? parsed.uuid ?? randomUUID(),
      updatedAt: now().toISOString()
    } satisfies CabinetServicePreset
  }

  return {
    async get(): Promise<CabinetBillingCatalog> {
      const domainPath = await resolveActiveDomainPath()
      return loadCatalog(getDomainCabinetBillingPath(domainPath))
    },

    async upsertService(input): Promise<CabinetBillingCatalog> {
      const domainPath = await resolveActiveDomainPath()
      const catalogPath = getDomainCabinetBillingPath(domainPath)
      const catalog = await loadCatalog(catalogPath)
      const existing = input.uuid
        ? catalog.services.find((service) => service.uuid === input.uuid)
        : undefined

      if (input.uuid && !existing) {
        throw new CabinetBillingServiceError(
          IpcErrorCode.NOT_FOUND,
          'This cabinet service preset was not found.'
        )
      }

      const nextPreset = toStoredPreset(input, existing)
      const existingIndex = catalog.services.findIndex(
        (service) => service.uuid === nextPreset.uuid
      )
      const services =
        existingIndex === -1
          ? [...catalog.services, nextPreset]
          : catalog.services.map((service, index) =>
              index === existingIndex ? nextPreset : service
            )

      return saveCatalog(catalogPath, {
        ...catalog,
        services,
        updatedAt: now().toISOString()
      })
    },

    // Deleting a preset does not cascade into existing dossiers: fee agreements
    // and billing items snapshot the preset values at creation time, so they
    // keep working. The only side effect is that `sourceServicePresetUuid` on
    // existing entries becomes a stale pointer (origin tooltip will not
    // resolve). This is intentional — see the code review notes on cascade
    // strategy for fee agreements (block) vs presets (silent detach).
    async deleteService(input): Promise<CabinetBillingCatalog> {
      const domainPath = await resolveActiveDomainPath()
      const catalogPath = getDomainCabinetBillingPath(domainPath)
      const catalog = await loadCatalog(catalogPath)
      const hasService = catalog.services.some((service) => service.uuid === input.uuid)

      if (!hasService) {
        throw new CabinetBillingServiceError(
          IpcErrorCode.NOT_FOUND,
          'This cabinet service preset was not found.'
        )
      }

      return saveCatalog(catalogPath, {
        services: catalog.services.filter((service) => service.uuid !== input.uuid),
        defaultServiceUuid:
          catalog.defaultServiceUuid === input.uuid ? undefined : catalog.defaultServiceUuid,
        updatedAt: now().toISOString()
      })
    },

    async setDefaultService(input): Promise<CabinetBillingCatalog> {
      const domainPath = await resolveActiveDomainPath()
      const catalogPath = getDomainCabinetBillingPath(domainPath)
      const catalog = await loadCatalog(catalogPath)

      if (input.serviceUuid) {
        const exists = catalog.services.some((service) => service.uuid === input.serviceUuid)
        if (!exists) {
          throw new CabinetBillingServiceError(
            IpcErrorCode.NOT_FOUND,
            'This cabinet service preset was not found.'
          )
        }
      }

      return saveCatalog(catalogPath, {
        ...catalog,
        defaultServiceUuid: input.serviceUuid,
        updatedAt: now().toISOString()
      })
    }
  }
}
