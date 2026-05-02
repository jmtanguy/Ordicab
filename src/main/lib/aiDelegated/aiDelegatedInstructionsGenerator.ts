import { readFile } from 'node:fs/promises'

import type {
  AiMode,
  ClaudeMdStatus,
  DomainStatusSnapshot,
  KeyDate,
  KeyReference
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import {
  dossierMetadataFileSchema,
  entityProfileSchema,
  keyDateSchema,
  keyReferenceSchema,
  type DossierMetadataFile
} from '@shared/validation'
import { type DocumentService } from '../../services/domain/documentService'
import { atomicWrite } from '../system/atomicWrite'
import { pathExists } from '../system/domainState'
import type { DelegatedOriginDeviceStore } from '../system/delegatedOriginDeviceStore'
import { getAiDelegatedInstructionsPath } from './aiDelegatedInstructions'
import {
  buildDomainRootAiDelegatedInstructions,
  buildTemplateRoutinesGuide,
  type LoadedDossierContextForInstructions
} from './aiDelegatedInstructionsContent'
import {
  getDomainEntityPath,
  getDomainRegistryPath,
  getDomainTemplateRoutinesPath,
  getDossierMetadataPath
} from '../ordicab/ordicabPaths'

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

type DocumentServiceLike = Pick<DocumentService, 'resolveRegisteredDossierRoot'>

interface DossierRegistryEntry {
  id: string
  name: string
  registeredAt: string
}

type LoadedDossierContext = LoadedDossierContextForInstructions

export interface InstructionsGeneratorLike {
  generateDomainRoot: (domainPath?: string) => Promise<void>
  generateForMode: (domainPath: string | undefined, mode: AiMode) => Promise<void>
  generateDossier: (
    domainPath: string | undefined,
    dossierId: string,
    dossierPath?: string
  ) => Promise<void>
  getStatus: () => ClaudeMdStatus
}

export interface InstructionsGeneratorOptions {
  domainService: DomainServiceLike
  documentService: DocumentServiceLike
  delegatedOriginDeviceStore: DelegatedOriginDeviceStore
  now?: () => Date
  writeClaudeMd?: typeof atomicWrite
  logError?: (message: string, error: unknown) => void
}

export class DelegatedInstructionsGeneratorError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'DelegatedInstructionsGeneratorError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function resolveActiveDomainPath(domainService: DomainServiceLike): Promise<string> {
  const status = await domainService.getStatus()

  if (!status.registeredDomainPath) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.NOT_FOUND,
      'Active domain is not configured.'
    )
  }

  if (!status.isAvailable) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.NOT_FOUND,
      'Active domain is unavailable.'
    )
  }

  return status.registeredDomainPath
}

async function loadRegistry(domainPath: string): Promise<DossierRegistryEntry[]> {
  const registryPath = getDomainRegistryPath(domainPath)

  if (!(await pathExists(registryPath))) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(registryPath, 'utf8')) as unknown
  } catch (error) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read dossier registry.',
      { cause: error }
    )
  }

  const dossiers = isRecord(parsed) && Array.isArray(parsed.dossiers) ? parsed.dossiers : null

  if (!dossiers) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored dossier registry is invalid.'
    )
  }

  return dossiers.flatMap((entry) => {
    if (
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.registeredAt === 'string'
    ) {
      const dossierEntry: DossierRegistryEntry = {
        id: entry.id,
        name: entry.name,
        registeredAt: entry.registeredAt
      }

      return [dossierEntry]
    }

    return []
  })
}

function parseKeyDates(value: unknown): KeyDate[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const parsed = keyDateSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

function parseKeyReferences(value: unknown): KeyReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const parsed = keyReferenceSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

function deriveNextUpcomingKeyDate(
  keyDates: KeyDate[],
  currentDate: Date
): { date: string; label: string } | null {
  const today = currentDate.toISOString().slice(0, 10)
  const upcoming = keyDates
    .filter((entry) => entry.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))

  const next = upcoming[0]
  return next ? { date: next.date, label: next.label } : null
}

async function loadDossierMetadata(
  dossierPath: string,
  now: () => Date = () => new Date()
): Promise<DossierMetadataFile> {
  const metadataPath = getDossierMetadataPath(dossierPath)

  if (!(await pathExists(metadataPath))) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.NOT_FOUND,
      'Dossier metadata was not found.'
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown
  } catch (error) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Unable to read dossier metadata.',
      { cause: error }
    )
  }

  if (!isRecord(parsed)) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored dossier metadata is invalid.'
    )
  }

  const keyDates = parseKeyDates(parsed.keyDates)
  const keyReferences = parseKeyReferences(parsed.keyReferences)
  const nextKeyDate = deriveNextUpcomingKeyDate(keyDates, now())

  const result = dossierMetadataFileSchema.safeParse({
    ...parsed,
    lastOpenedAt: typeof parsed.lastOpenedAt === 'string' ? parsed.lastOpenedAt : null,
    nextUpcomingKeyDate: nextKeyDate?.date ?? null,
    nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null,
    keyDates,
    keyReferences
  })

  if (!result.success) {
    throw new DelegatedInstructionsGeneratorError(
      IpcErrorCode.FILE_SYSTEM_ERROR,
      'Stored dossier metadata is invalid.'
    )
  }

  return result.data
}

function isFileAccessError(value: unknown): value is NodeJS.ErrnoException {
  return (
    value instanceof Error &&
    typeof (value as NodeJS.ErrnoException).code === 'string' &&
    ['EACCES', 'EBUSY', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(
      (value as NodeJS.ErrnoException).code!
    )
  )
}

const gracefulDossierFileSystemMessages = new Set([
  'Stored dossier metadata is invalid.',
  'Unable to read dossier metadata.',
  'Stored dossier contacts are invalid.',
  'Unable to read dossier contacts.'
])

function isGracefulDossierError(error: unknown): boolean {
  if (isFileAccessError(error)) {
    return true
  }

  return (
    error instanceof DelegatedInstructionsGeneratorError &&
    (error.code === IpcErrorCode.NOT_FOUND ||
      (error.code === IpcErrorCode.FILE_SYSTEM_ERROR &&
        gracefulDossierFileSystemMessages.has(error.message)) ||
      isFileAccessError(error.cause))
  )
}

function shouldLogGracefulDossierSkip(error: unknown): boolean {
  if (
    error instanceof DelegatedInstructionsGeneratorError &&
    error.code === IpcErrorCode.NOT_FOUND
  ) {
    return false
  }

  return true
}

export function createInstructionsGenerator(
  options: InstructionsGeneratorOptions
): InstructionsGeneratorLike {
  const now = options.now ?? (() => new Date())
  const writeClaudeMd = options.writeClaudeMd ?? atomicWrite
  const logError =
    options.logError ??
    ((message: string, error: unknown) => {
      console.error(message, error)
    })
  let status: ClaudeMdStatus = {
    status: 'idle',
    updatedAt: null
  }
  let generationQueue: Promise<void> = Promise.resolve()
  let activeRuns = 0
  // Track whether any concurrent run failed so the final status reflects the
  // error even if a later run (e.g. generateDomainRoot) succeeds after the
  // failing run (e.g. generateDossier) has already called finishRun.
  let pendingError = false

  function startRun(): void {
    activeRuns += 1
    status = {
      status: 'running',
      updatedAt: status.updatedAt
    }
  }

  function finishRun(nextStatus: 'idle' | 'error', updatedAt?: string): void {
    activeRuns = Math.max(0, activeRuns - 1)
    if (nextStatus === 'error') pendingError = true
    const resolvedUpdatedAt = updatedAt ?? status.updatedAt

    if (activeRuns > 0) {
      status = { status: 'running', updatedAt: resolvedUpdatedAt }
    } else {
      const finalStatus = pendingError ? 'error' : nextStatus
      pendingError = false
      status = { status: finalStatus, updatedAt: resolvedUpdatedAt }
    }
  }

  async function writeClaudeMdIfChanged(targetPath: string, content: string): Promise<void> {
    const currentContent = await readFile(targetPath, 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      throw error
    })

    if (currentContent === content) {
      return
    }

    await writeClaudeMd(targetPath, content)
  }

  async function loadDossiers(domainPath: string): Promise<LoadedDossierContext[]> {
    const registry = await loadRegistry(domainPath)

    const results = await Promise.all(
      registry.map(async (entry) => {
        try {
          const dossierPath = await options.documentService.resolveRegisteredDossierRoot({
            dossierId: entry.id
          })

          const metadata = await loadDossierMetadata(dossierPath, now)

          return {
            dossierPath,
            metadata
          } satisfies LoadedDossierContext
        } catch (error) {
          if (isGracefulDossierError(error)) {
            if (shouldLogGracefulDossierSkip(error)) {
              logError(
                `[InstructionsGenerator] Skipping dossier "${entry.id}" in domain generation.`,
                error
              )
            }
            return null
          }

          throw error
        }
      })
    )

    return results.filter((result): result is LoadedDossierContext => result !== null)
  }

  async function loadEntityProfile(
    domainPath: string
  ): Promise<ReturnType<typeof entityProfileSchema.parse> | null> {
    try {
      const raw = await readFile(getDomainEntityPath(domainPath), 'utf8')
      const parsed = entityProfileSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async function runGenerationForMode(domainPath: string | undefined, mode: AiMode): Promise<void> {
    startRun()
    try {
      const resolvedDomainPath =
        domainPath ?? (await resolveActiveDomainPath(options.domainService))
      const instructionsPath = getAiDelegatedInstructionsPath(resolvedDomainPath, mode)
      if (!instructionsPath) {
        finishRun('idle')
        return
      }
      const generatedAt = now().toISOString()
      const [dossiers, entityProfile] = await Promise.all([
        loadDossiers(resolvedDomainPath),
        loadEntityProfile(resolvedDomainPath)
      ])
      const originDeviceId = await options.delegatedOriginDeviceStore.getOriginDeviceId()

      const content = buildDomainRootAiDelegatedInstructions({
        mode,
        domainPath: resolvedDomainPath,
        dossiers,
        entityCountry: entityProfile?.country ?? undefined,
        contactRoles: entityProfile?.managedFields?.contactRoles,
        originDeviceId
      })
      const templateRoutinesGuide = buildTemplateRoutinesGuide(resolvedDomainPath)

      await writeClaudeMdIfChanged(
        getDomainTemplateRoutinesPath(resolvedDomainPath),
        templateRoutinesGuide
      )
      await writeClaudeMdIfChanged(instructionsPath, content)
      finishRun('idle', generatedAt)
    } catch (error) {
      finishRun('error')
      throw error
    }
  }

  function enqueue(run: () => Promise<void>): Promise<void> {
    const nextRun = generationQueue.then(run, run)
    generationQueue = nextRun.catch(() => undefined)
    return nextRun
  }

  return {
    getStatus: () => ({ ...status }),

    generateDomainRoot: async (domainPath?: string): Promise<void> => {
      return enqueue(() => runGenerationForMode(domainPath, 'claude-code'))
    },

    generateForMode: async (domainPath: string | undefined, mode: AiMode): Promise<void> => {
      return enqueue(() => runGenerationForMode(domainPath, mode))
    },

    generateDossier: async (domainPath: string | undefined): Promise<void> => {
      return enqueue(() => runGenerationForMode(domainPath, 'claude-code'))
    }
  }
}
