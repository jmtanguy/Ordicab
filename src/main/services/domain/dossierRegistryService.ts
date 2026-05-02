import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type {
  DossierDetail,
  DossierEligibleFolder,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierStatus,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput,
  KeyDate,
  KeyReference
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import {
  dossierMetadataFileSchema,
  keyDateSchema,
  keyReferenceSchema,
  type DossierMetadataFile
} from '@shared/validation'

import {
  getDomainRegistryPath,
  getDossierMetadataPath,
  getDossierOrdicabPath,
  ORDICAB_DIRECTORY_NAME
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadDomainState, pathExists } from '../../lib/system/domainState'

interface DossierRegistryEntry {
  id: string
  uuid?: string
  name: string
  registeredAt: string
}

interface DossierRegistryFile {
  dossiers: DossierRegistryEntry[]
}

export interface DossierRegistryServiceOptions {
  stateFilePath: string
  now?: () => Date
}

export interface DossierRegistryService {
  listEligibleFolders: () => Promise<DossierEligibleFolder[]>
  listRegisteredDossiers: () => Promise<DossierSummary[]>
  getDossier: (input: DossierScopedQuery) => Promise<DossierDetail>
  openDossier: (input: DossierScopedQuery) => Promise<DossierDetail>
  registerDossier: (input: DossierRegistrationInput) => Promise<DossierSummary>
  unregisterDossier: (input: DossierUnregisterInput) => Promise<null>
  updateDossier: (input: DossierUpdateInput) => Promise<DossierDetail>
  upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<DossierDetail>
  deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<DossierDetail>
  upsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<DossierDetail>
  deleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<DossierDetail>
}

export class DossierRegistryError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DossierRegistryError'
  }
}

function isHiddenFolderName(name: string): boolean {
  return name.startsWith('.')
}

function createDefaultMetadata(options: {
  id: string
  uuid?: string
  name: string
  registeredAt: string
}): DossierMetadataFile {
  return {
    id: options.id,
    uuid: options.uuid ?? randomUUID(),
    name: options.name,
    registeredAt: options.registeredAt,
    status: 'active',
    type: '',
    information: undefined,
    updatedAt: options.registeredAt,
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    keyDates: [],
    keyReferences: [],
    documents: []
  }
}

function toSummary(metadata: DossierMetadataFile): DossierSummary {
  return {
    id: metadata.id,
    uuid: metadata.uuid,
    name: metadata.name,
    status: metadata.status,
    type: metadata.type,
    updatedAt: metadata.updatedAt,
    lastOpenedAt: metadata.lastOpenedAt,
    nextUpcomingKeyDate: metadata.nextUpcomingKeyDate,
    nextUpcomingKeyDateLabel: metadata.nextUpcomingKeyDateLabel
  }
}

function toDetail(metadata: DossierMetadataFile): DossierDetail {
  return {
    ...toSummary(metadata),
    registeredAt: metadata.registeredAt,
    information: metadata.information,
    keyDates: metadata.keyDates,
    keyReferences: metadata.keyReferences
  }
}

function normalizeStatus(status: string | undefined): DossierStatus {
  if (status === 'pending' || status === 'completed' || status === 'archived') {
    return status
  }

  return 'active'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function cloneMetadata(metadata: DossierMetadataFile): DossierMetadataFile {
  return {
    ...metadata,
    documents: [...metadata.documents],
    keyDates: [...metadata.keyDates],
    keyReferences: [...metadata.keyReferences]
  }
}

function upsertById<T extends { id: string }>(entries: T[], nextEntry: T): T[] {
  const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id)

  if (existingIndex === -1) {
    return [...entries, nextEntry]
  }

  const nextEntries = [...entries]
  nextEntries[existingIndex] = nextEntry
  return nextEntries
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

function validateDirectChildId(id: string): string {
  const normalizedId = id.trim()

  if (!normalizedId || normalizedId === ORDICAB_DIRECTORY_NAME) {
    throw new DossierRegistryError(
      IpcErrorCode.INVALID_INPUT,
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  }

  if (normalizedId === '.' || normalizedId === '..') {
    throw new DossierRegistryError(
      IpcErrorCode.INVALID_INPUT,
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  }

  if (normalizedId.includes('/') || normalizedId.includes('\\')) {
    throw new DossierRegistryError(
      IpcErrorCode.INVALID_INPUT,
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  }

  if (isHiddenFolderName(normalizedId)) {
    throw new DossierRegistryError(
      IpcErrorCode.INVALID_INPUT,
      'Hidden folders cannot be registered as dossiers.'
    )
  }

  return normalizedId
}

async function resolveActiveDomainPath(stateFilePath: string): Promise<string | null> {
  const state = await loadDomainState(stateFilePath)
  const selectedDomainPath = state?.selectedDomainPath ?? null

  if (!selectedDomainPath) {
    return null
  }

  return (await pathExists(selectedDomainPath)) ? selectedDomainPath : null
}

async function loadRegistry(domainPath: string): Promise<DossierRegistryFile> {
  const registryPath = getDomainRegistryPath(domainPath)

  if (!(await pathExists(registryPath))) {
    return { dossiers: [] }
  }

  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as Partial<DossierRegistryFile>
    const dossiers = Array.isArray(parsed.dossiers)
      ? parsed.dossiers.filter(
          (entry): entry is DossierRegistryEntry =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof entry.id === 'string' &&
            typeof entry.name === 'string' &&
            typeof entry.registeredAt === 'string' &&
            (typeof (entry as { uuid?: unknown }).uuid === 'string' ||
              typeof (entry as { uuid?: unknown }).uuid === 'undefined')
        )
      : []

    if (dossiers.some((entry) => typeof entry.uuid !== 'string')) {
      const normalizedRegistry: DossierRegistryFile = {
        dossiers: dossiers.map((entry) => ({
          ...entry,
          uuid: entry.uuid ?? randomUUID()
        }))
      }
      await saveRegistry(domainPath, normalizedRegistry)
      return normalizedRegistry
    }

    return { dossiers }
  } catch (error) {
    console.error('[DossierRegistryService] Failed to load dossier registry:', registryPath, error)
    return { dossiers: [] }
  }
}

async function saveRegistry(domainPath: string, registry: DossierRegistryFile): Promise<void> {
  await atomicWrite(getDomainRegistryPath(domainPath), `${JSON.stringify(registry, null, 2)}\n`)
}

async function readMetadata(
  dossierPath: string,
  now: () => Date,
  options: {
    strict?: boolean
  } = {}
): Promise<DossierMetadataFile | null> {
  const metadataPath = getDossierMetadataPath(dossierPath)
  if (!(await pathExists(metadataPath))) {
    return null
  }

  const invalidMetadataError = new DossierRegistryError(
    IpcErrorCode.VALIDATION_FAILED,
    'Stored dossier metadata is invalid.'
  )
  const unreadableMetadataError = new DossierRegistryError(
    IpcErrorCode.FILE_SYSTEM_ERROR,
    'Unable to read dossier metadata.'
  )

  try {
    const raw = await readFile(metadataPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      if (options.strict) {
        throw invalidMetadataError
      }
      return null
    }

    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.registeredAt !== 'string' ||
      typeof parsed.type !== 'string' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      if (options.strict) {
        throw invalidMetadataError
      }
      return null
    }

    const keyDates = parseKeyDates(parsed.keyDates)
    const keyReferences = parseKeyReferences(parsed.keyReferences)
    const nextKeyDate = deriveNextUpcomingKeyDate(keyDates, now())
    const validatedMetadata = dossierMetadataFileSchema.safeParse({
      id: parsed.id,
      uuid: typeof parsed.uuid === 'string' ? parsed.uuid : randomUUID(),
      name: parsed.name,
      registeredAt: parsed.registeredAt,
      status: normalizeStatus(typeof parsed.status === 'string' ? parsed.status : undefined),
      type: parsed.type,
      updatedAt: parsed.updatedAt,
      lastOpenedAt: typeof parsed.lastOpenedAt === 'string' ? parsed.lastOpenedAt : null,
      nextUpcomingKeyDate: nextKeyDate?.date ?? null,
      nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null,
      information: normalizeOptionalText(
        typeof parsed.information === 'string' ? parsed.information : undefined
      ),
      keyDates,
      keyReferences,
      documents: parsed.documents
    })

    if (!validatedMetadata.success) {
      if (options.strict) {
        throw invalidMetadataError
      }

      return null
    }

    if (typeof parsed.uuid !== 'string') {
      await saveMetadata(dossierPath, validatedMetadata.data)
    }

    return validatedMetadata.data
  } catch (error) {
    if (error instanceof DossierRegistryError) {
      throw error
    }

    if (options.strict) {
      if (error instanceof SyntaxError) {
        throw invalidMetadataError
      }

      throw unreadableMetadataError
    }

    console.error('[DossierRegistryService] Failed to read dossier metadata:', metadataPath, error)
    return null
  }
}

async function saveMetadata(
  dossierPath: string,
  metadata: DossierMetadataFile
): Promise<DossierMetadataFile> {
  const validatedMetadata = dossierMetadataFileSchema.parse(metadata)
  await atomicWrite(
    getDossierMetadataPath(dossierPath),
    `${JSON.stringify(validatedMetadata, null, 2)}\n`
  )

  return validatedMetadata
}

async function removeDossierMetadata(dossierPath: string): Promise<void> {
  const metadataPath = getDossierMetadataPath(dossierPath)
  const ordicabPath = getDossierOrdicabPath(dossierPath)

  await rm(metadataPath, { force: true })

  if (!(await pathExists(ordicabPath))) {
    return
  }

  const remainingEntries = await readdir(ordicabPath)
  if (remainingEntries.length === 0) {
    await rm(ordicabPath, { recursive: true, force: true })
  }
}

export function createDossierRegistryService(
  options: DossierRegistryServiceOptions
): DossierRegistryService {
  const now = options.now ?? (() => new Date())

  async function loadRegisteredMetadata(dossierId: string): Promise<{
    dossierPath: string
    metadata: DossierMetadataFile
  }> {
    const domainPath = await resolveActiveDomainPath(options.stateFilePath)
    if (!domainPath) {
      throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
    }

    const normalizedDossierId = validateDirectChildId(dossierId)
    const dossierPath = join(domainPath, normalizedDossierId)
    const registry = await loadRegistry(domainPath)
    const existingEntry = registry.dossiers.find((entry) => entry.id === normalizedDossierId)

    if (!existingEntry) {
      throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
    }

    const dossierStats = await stat(dossierPath).catch(() => null)
    if (!dossierStats?.isDirectory()) {
      throw new DossierRegistryError(
        IpcErrorCode.NOT_FOUND,
        'Selected dossier folder was not found.'
      )
    }

    const metadata =
      (await readMetadata(dossierPath, now, { strict: true })) ??
      createDefaultMetadata({
        id: normalizedDossierId,
        uuid: existingEntry.uuid,
        name: existingEntry.name || basename(normalizedDossierId),
        registeredAt: existingEntry.registeredAt
      })

    return {
      dossierPath,
      metadata
    }
  }

  async function mutateDossier(
    dossierId: string,
    mutate: (metadata: DossierMetadataFile) => DossierMetadataFile
  ): Promise<DossierDetail> {
    const { dossierPath, metadata } = await loadRegisteredMetadata(dossierId)
    const nextMetadata = mutate(cloneMetadata(metadata))
    const nextKeyDate = deriveNextUpcomingKeyDate(nextMetadata.keyDates, now())
    const updatedMetadata: DossierMetadataFile = {
      ...nextMetadata,
      updatedAt: now().toISOString(),
      nextUpcomingKeyDate: nextKeyDate?.date ?? null,
      nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
    }

    return toDetail(await saveMetadata(dossierPath, updatedMetadata))
  }

  async function markDossierOpened(dossierId: string): Promise<DossierDetail> {
    const { dossierPath, metadata } = await loadRegisteredMetadata(dossierId)
    const updatedMetadata: DossierMetadataFile = {
      ...cloneMetadata(metadata),
      lastOpenedAt: now().toISOString()
    }

    return toDetail(await saveMetadata(dossierPath, updatedMetadata))
  }

  return {
    listEligibleFolders: async (): Promise<DossierEligibleFolder[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        return []
      }

      const registry = await loadRegistry(domainPath)
      const registeredIds = new Set(registry.dossiers.map((entry) => entry.id))
      const entries = await readdir(domainPath, { withFileTypes: true })

      return entries
        .filter((entry) => entry.isDirectory() && !isHiddenFolderName(entry.name))
        .filter((entry) => !registeredIds.has(entry.name))
        .map((entry) => ({
          id: entry.name,
          name: entry.name,
          path: join(domainPath, entry.name)
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    },

    listRegisteredDossiers: async (): Promise<DossierSummary[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        return []
      }

      const registry = await loadRegistry(domainPath)
      const dossiers = await Promise.all(
        registry.dossiers.map(async (entry) => {
          const metadata =
            (await readMetadata(join(domainPath, entry.id), now)) ??
            createDefaultMetadata({
              id: entry.id,
              uuid: entry.uuid,
              name: entry.name || basename(entry.id),
              registeredAt: entry.registeredAt
            })

          return toSummary(metadata)
        })
      )

      return dossiers.sort((left, right) => left.name.localeCompare(right.name))
    },

    getDossier: async (input): Promise<DossierDetail> => {
      const { metadata } = await loadRegisteredMetadata(input.dossierId)
      return toDetail(metadata)
    },

    openDossier: async (input): Promise<DossierDetail> => {
      return markDossierOpened(input.dossierId)
    },

    registerDossier: async (input): Promise<DossierSummary> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const dossierId = validateDirectChildId(input.id)
      const dossierPath = join(domainPath, dossierId)
      const dossierStats = await stat(dossierPath).catch(() => null)

      if (!dossierStats?.isDirectory()) {
        throw new DossierRegistryError(
          IpcErrorCode.NOT_FOUND,
          'Selected dossier folder was not found.'
        )
      }

      const registry = await loadRegistry(domainPath)
      if (registry.dossiers.some((entry) => entry.id === dossierId)) {
        throw new DossierRegistryError(
          IpcErrorCode.INVALID_INPUT,
          'This dossier is already registered.'
        )
      }

      const registeredAt = now().toISOString()
      const metadata = createDefaultMetadata({
        id: dossierId,
        name: basename(dossierPath),
        registeredAt
      })
      const nextRegistry: DossierRegistryFile = {
        dossiers: [
          ...registry.dossiers,
          {
            id: dossierId,
            uuid: metadata.uuid,
            name: metadata.name,
            registeredAt
          }
        ]
      }

      await saveMetadata(dossierPath, metadata)

      try {
        await saveRegistry(domainPath, nextRegistry)
      } catch (error) {
        await removeDossierMetadata(dossierPath).catch(() => undefined)
        throw error
      }

      return toSummary(metadata)
    },

    updateDossier: async (input): Promise<DossierDetail> => {
      return mutateDossier(input.id, (metadata) => ({
        ...metadata,
        status: input.status,
        type: input.type.trim(),
        information: normalizeOptionalText(input.information)
      }))
    },

    upsertKeyDate: async (input): Promise<DossierDetail> => {
      return mutateDossier(input.dossierId, (metadata) => {
        const existingEntry = input.id
          ? metadata.keyDates.find((entry) => entry.id === input.id)
          : undefined

        if (input.id && !existingEntry) {
          throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
        }

        const nextEntry = keyDateSchema.parse({
          id: input.id ?? randomUUID(),
          dossierId: input.dossierId,
          label: input.label.trim(),
          date: input.date,
          note: normalizeOptionalText(input.note) ?? existingEntry?.note
        })

        return {
          ...metadata,
          keyDates: upsertById(metadata.keyDates, nextEntry)
        }
      })
    },

    deleteKeyDate: async (input): Promise<DossierDetail> => {
      return mutateDossier(input.dossierId, (metadata) => {
        if (!metadata.keyDates.some((entry) => entry.id === input.keyDateId)) {
          throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
        }

        return {
          ...metadata,
          keyDates: metadata.keyDates.filter((entry) => entry.id !== input.keyDateId)
        }
      })
    },

    upsertKeyReference: async (input): Promise<DossierDetail> => {
      return mutateDossier(input.dossierId, (metadata) => {
        const existingEntry = input.id
          ? metadata.keyReferences.find((entry) => entry.id === input.id)
          : undefined

        if (input.id && !existingEntry) {
          throw new DossierRegistryError(
            IpcErrorCode.NOT_FOUND,
            'This key reference was not found.'
          )
        }

        const nextEntry = keyReferenceSchema.parse({
          id: input.id ?? randomUUID(),
          dossierId: input.dossierId,
          label: input.label.trim(),
          value: input.value.trim(),
          note: normalizeOptionalText(input.note) ?? existingEntry?.note
        })

        return {
          ...metadata,
          keyReferences: upsertById(metadata.keyReferences, nextEntry)
        }
      })
    },

    deleteKeyReference: async (input): Promise<DossierDetail> => {
      return mutateDossier(input.dossierId, (metadata) => {
        if (!metadata.keyReferences.some((entry) => entry.id === input.keyReferenceId)) {
          throw new DossierRegistryError(
            IpcErrorCode.NOT_FOUND,
            'This key reference was not found.'
          )
        }

        return {
          ...metadata,
          keyReferences: metadata.keyReferences.filter((entry) => entry.id !== input.keyReferenceId)
        }
      })
    },

    unregisterDossier: async (input): Promise<null> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const dossierId = validateDirectChildId(input.id)
      const dossierPath = join(domainPath, dossierId)
      const registry = await loadRegistry(domainPath)
      const existingEntry = registry.dossiers.find((entry) => entry.id === dossierId)

      if (!existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const nextRegistry: DossierRegistryFile = {
        dossiers: registry.dossiers.filter((entry) => entry.id !== dossierId)
      }

      await saveRegistry(domainPath, nextRegistry)

      try {
        await removeDossierMetadata(dossierPath)
      } catch (error) {
        await saveRegistry(domainPath, registry)
        throw error
      }

      return null
    }
  }
}
