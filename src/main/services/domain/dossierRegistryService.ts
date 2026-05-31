import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type {
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreement,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
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
import {
  DOSSIER_NAME_REFERENCE_LABEL,
  IpcErrorCode,
  isDossierNameReferenceLabel
} from '@shared/types'
import { computeBillingItemTotals } from '@shared/billingCalculations'
import {
  billingItemIndexSchema,
  dossierBillingItemSchema,
  dossierMetadataFileSchema,
  feeAgreementSchema,
  keyDateIndexSchema,
  keyDateSchema,
  keyReferenceSchema,
  type DossierMetadataFile
} from '@shared/validation'
import type {
  BillingItemIndex,
  BillingItemIndexEntry,
  KeyDateIndex,
  KeyDateIndexEntry
} from '@shared/validation'

import {
  getDomainRegistryPath,
  getDossierBillingItemIndexPath,
  getDossierBillingItemRecordPath,
  getDossierBillingItemsDirectoryPath,
  getDossierKeyDateIndexPath,
  getDossierKeyDateRecordPath,
  getDossierKeyDatesDirectoryPath,
  getDossierMetadataPath,
  getDossierOrdicabPath,
  ORDICAB_DIRECTORY_NAME
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadDomainState, pathExists } from '../../lib/system/domainState'
import {
  deleteRecord,
  loadAllRecords,
  loadIndex,
  saveIndex,
  saveRecord
} from '../../lib/system/perFileStore'

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
  /** Called after a dossier is successfully registered. */
  onDossierRegistered?: (dossierId: string, dossierPath: string) => void
  /** Called after a dossier is successfully unregistered. */
  onDossierUnregistered?: (dossierId: string) => void
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
  upsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<DossierDetail>
  deleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<DossierDetail>
  archiveFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<DossierDetail>
  setActiveFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<DossierDetail>
  upsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<DossierDetail>
  deleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<DossierDetail>
  markBillingItemsInvoiced: (input: {
    dossierId: string
    billingItemIds: string[]
    invoiceId: string
    invoiceNumber: string
  }) => Promise<DossierDetail>
  unmarkBillingItemsInvoiced: (input: {
    dossierId: string
    invoiceId: string
  }) => Promise<DossierDetail>
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
    feeAgreements: [],
    billingItems: [],
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

function toDetail(
  metadata: DossierMetadataFile,
  billingItems: DossierBillingItem[],
  keyDates: KeyDate[]
): DossierDetail {
  return {
    ...toSummary(metadata),
    registeredAt: metadata.registeredAt,
    information: metadata.information,
    juridiction: metadata.juridiction,
    tribunal: metadata.tribunal,
    feeAgreements: metadata.feeAgreements,
    billingItems,
    keyDates,
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

function parseKeyReferences(value: unknown): KeyReference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const parsed = keyReferenceSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

function parseFeeAgreements(
  parsed: Record<string, unknown>,
  fallbackTimestamp: string
): DossierFeeAgreement[] {
  if (Array.isArray(parsed.feeAgreements)) {
    return parsed.feeAgreements.flatMap((entry) => {
      const validated = feeAgreementSchema.safeParse(entry)
      return validated.success ? [validated.data] : []
    })
  }

  const legacy = parsed.feeAgreement
  if (legacy && typeof legacy === 'object') {
    const candidate = {
      id: randomUUID(),
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
      isActive: true,
      archivedAt: undefined,
      generatedDocumentUuid: undefined,
      signedDocumentUuid: undefined,
      ...(legacy as Record<string, unknown>)
    }
    const validated = feeAgreementSchema.safeParse(candidate)
    return validated.success ? [validated.data] : []
  }

  return []
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function cloneMetadata(metadata: DossierMetadataFile): DossierMetadataFile {
  return {
    ...metadata,
    documents: [...metadata.documents],
    feeAgreements: metadata.feeAgreements.map((entry) => ({ ...entry })),
    billingItems: [],
    keyDates: [],
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

    const keyReferences = parseKeyReferences(parsed.keyReferences)
    const feeAgreements = parseFeeAgreements(parsed, parsed.updatedAt)
    // billingItems and keyDates are now stored per-file; pass empty arrays here
    // (they are loaded separately via loadBillingItems / loadKeyDates)
    const validatedMetadata = dossierMetadataFileSchema.safeParse({
      id: parsed.id,
      uuid: typeof parsed.uuid === 'string' ? parsed.uuid : randomUUID(),
      name: parsed.name,
      registeredAt: parsed.registeredAt,
      status: normalizeStatus(typeof parsed.status === 'string' ? parsed.status : undefined),
      type: parsed.type,
      updatedAt: parsed.updatedAt,
      lastOpenedAt: typeof parsed.lastOpenedAt === 'string' ? parsed.lastOpenedAt : null,
      nextUpcomingKeyDate: null,
      nextUpcomingKeyDateLabel: null,
      information: normalizeOptionalText(
        typeof parsed.information === 'string' ? parsed.information : undefined
      ),
      juridiction: normalizeOptionalText(
        typeof parsed.juridiction === 'string' ? parsed.juridiction : undefined
      ),
      tribunal: normalizeOptionalText(
        typeof parsed.tribunal === 'string' ? parsed.tribunal : undefined
      ),
      feeAgreements,
      billingItems: [],
      keyDates: [],
      keyReferences,
      documents: parsed.documents
    })

    if (!validatedMetadata.success) {
      if (options.strict) {
        throw invalidMetadataError
      }

      return null
    }

    const needsLegacyFeeAgreementMigration =
      !Array.isArray(parsed.feeAgreements) && parsed.feeAgreement !== undefined
    if (typeof parsed.uuid !== 'string' || needsLegacyFeeAgreementMigration) {
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
  const toWrite = { ...metadata, billingItems: [], keyDates: [] }
  const validatedMetadata = dossierMetadataFileSchema.parse(toWrite)
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

/**
 * Returns the metadata with a guaranteed dossier-name key reference present.
 */
function ensureDossierNameReference(
  metadata: DossierMetadataFile,
  dossierPath: string
): DossierMetadataFile {
  const existing = metadata.keyReferences.find((entry) => isDossierNameReferenceLabel(entry.label))
  if (existing) return metadata
  return {
    ...metadata,
    keyReferences: [
      ...metadata.keyReferences,
      keyReferenceSchema.parse({
        id: randomUUID(),
        dossierId: metadata.id,
        label: DOSSIER_NAME_REFERENCE_LABEL,
        value: metadata.name || basename(dossierPath)
      })
    ]
  }
}

const EMPTY_BILLING_ITEM_INDEX: BillingItemIndex = {
  items: [],
  updatedAt: new Date(0).toISOString()
}
const EMPTY_KEY_DATE_INDEX: KeyDateIndex = { keyDates: [], updatedAt: new Date(0).toISOString() }

// ---------------------------------------------------------------------------
// Per-file billing item helpers
// ---------------------------------------------------------------------------

async function loadBillingItems(dossierPath: string): Promise<DossierBillingItem[]> {
  return loadAllRecords(getDossierBillingItemsDirectoryPath(dossierPath), dossierBillingItemSchema)
}

async function saveBillingItem(dossierPath: string, item: DossierBillingItem): Promise<void> {
  return saveRecord(
    getDossierBillingItemsDirectoryPath(dossierPath),
    getDossierBillingItemRecordPath(dossierPath, item.id),
    item
  )
}

async function deleteBillingItemFile(dossierPath: string, id: string): Promise<void> {
  return deleteRecord(getDossierBillingItemRecordPath(dossierPath, id))
}

async function updateBillingItemIndex(
  dossierPath: string,
  item: DossierBillingItem,
  op: 'upsert' | 'remove',
  nowIso: string
): Promise<void> {
  const index = await loadIndex(
    getDossierBillingItemIndexPath(dossierPath),
    billingItemIndexSchema,
    EMPTY_BILLING_ITEM_INDEX
  )
  const entry: BillingItemIndexEntry = {
    id: item.id,
    dossierId: item.dossierId,
    label: item.label,
    status: item.status,
    date: item.date,
    totalTtcCents: item.totalTtcCents,
    invoiceId: item.invoiceId,
    updatedAt: item.updatedAt
  }
  const filtered = index.items.filter((e) => e.id !== item.id)
  await saveIndex(getDossierBillingItemIndexPath(dossierPath), {
    ...index,
    items: op === 'upsert' ? [...filtered, entry] : filtered,
    updatedAt: nowIso
  })
}

// ---------------------------------------------------------------------------
// Per-file key date helpers
// ---------------------------------------------------------------------------

async function loadKeyDates(dossierPath: string): Promise<KeyDate[]> {
  return loadAllRecords(getDossierKeyDatesDirectoryPath(dossierPath), keyDateSchema)
}

async function saveKeyDate(dossierPath: string, keyDate: KeyDate): Promise<void> {
  return saveRecord(
    getDossierKeyDatesDirectoryPath(dossierPath),
    getDossierKeyDateRecordPath(dossierPath, keyDate.id),
    keyDate
  )
}

async function deleteKeyDateFile(dossierPath: string, id: string): Promise<void> {
  return deleteRecord(getDossierKeyDateRecordPath(dossierPath, id))
}

async function updateKeyDateIndex(
  dossierPath: string,
  keyDate: KeyDate,
  op: 'upsert' | 'remove',
  nowIso: string
): Promise<void> {
  const index = await loadIndex(
    getDossierKeyDateIndexPath(dossierPath),
    keyDateIndexSchema,
    EMPTY_KEY_DATE_INDEX
  )
  const entry: KeyDateIndexEntry = {
    id: keyDate.id,
    dossierId: keyDate.dossierId,
    label: keyDate.label,
    date: keyDate.date,
    isClosed: keyDate.isClosed,
    updatedAt: nowIso
  }
  const filtered = index.keyDates.filter((e) => e.id !== keyDate.id)
  await saveIndex(getDossierKeyDateIndexPath(dossierPath), {
    ...index,
    keyDates: op === 'upsert' ? [...filtered, entry] : filtered,
    updatedAt: nowIso
  })
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

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
      (await readMetadata(dossierPath, { strict: true })) ??
      createDefaultMetadata({
        id: normalizedDossierId,
        uuid: existingEntry.uuid,
        name: existingEntry.name || basename(normalizedDossierId),
        registeredAt: existingEntry.registeredAt
      })

    return {
      dossierPath,
      metadata: ensureDossierNameReference(metadata, dossierPath)
    }
  }

  async function loadDossierDetail(dossierId: string): Promise<{
    dossierPath: string
    metadata: DossierMetadataFile
    billingItems: DossierBillingItem[]
    keyDates: KeyDate[]
  }> {
    const { dossierPath, metadata } = await loadRegisteredMetadata(dossierId)
    const [billingItems, keyDates] = await Promise.all([
      loadBillingItems(dossierPath),
      loadKeyDates(dossierPath)
    ])
    return { dossierPath, metadata, billingItems, keyDates }
  }

  async function mutateDossierMeta(
    dossierId: string,
    mutate: (metadata: DossierMetadataFile) => DossierMetadataFile
  ): Promise<{ dossierPath: string; metadata: DossierMetadataFile }> {
    const { dossierPath, metadata } = await loadRegisteredMetadata(dossierId)
    const nextMetadata = mutate(cloneMetadata(metadata))
    const updatedMetadata: DossierMetadataFile = {
      ...nextMetadata,
      updatedAt: now().toISOString()
    }
    const saved = await saveMetadata(dossierPath, updatedMetadata)
    return { dossierPath, metadata: saved }
  }

  async function buildDetail(dossierId: string): Promise<DossierDetail> {
    const { dossierPath, metadata, billingItems, keyDates } = await loadDossierDetail(dossierId)
    const nextKeyDate = deriveNextUpcomingKeyDate(keyDates, now())
    if (
      metadata.nextUpcomingKeyDate !== (nextKeyDate?.date ?? null) ||
      metadata.nextUpcomingKeyDateLabel !== (nextKeyDate?.label ?? null)
    ) {
      const updated: DossierMetadataFile = {
        ...metadata,
        nextUpcomingKeyDate: nextKeyDate?.date ?? null,
        nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
      }
      await saveMetadata(dossierPath, updated)
      return toDetail(updated, billingItems, keyDates)
    }
    return toDetail(metadata, billingItems, keyDates)
  }

  async function markDossierOpened(dossierId: string): Promise<DossierDetail> {
    const { dossierPath, metadata, billingItems, keyDates } = await loadDossierDetail(dossierId)
    const keyDatesForUpcoming = keyDates
    const nextKeyDate = deriveNextUpcomingKeyDate(keyDatesForUpcoming, now())
    const updatedMetadata: DossierMetadataFile = {
      ...cloneMetadata(metadata),
      lastOpenedAt: now().toISOString(),
      nextUpcomingKeyDate: nextKeyDate?.date ?? null,
      nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
    }
    const saved = await saveMetadata(dossierPath, updatedMetadata)
    return toDetail(saved, billingItems, keyDates)
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
            (await readMetadata(join(domainPath, entry.id))) ??
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
      return buildDetail(input.dossierId)
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
      const dossierBaseName = basename(dossierPath)
      const metadata = createDefaultMetadata({
        id: dossierId,
        name: dossierBaseName,
        registeredAt
      })
      metadata.keyReferences = [
        ...metadata.keyReferences,
        keyReferenceSchema.parse({
          id: randomUUID(),
          dossierId,
          label: DOSSIER_NAME_REFERENCE_LABEL,
          value: dossierBaseName
        })
      ]
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

      options.onDossierRegistered?.(dossierId, dossierPath)
      return toSummary(metadata)
    },

    updateDossier: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(input.id, (metadata) => ({
        ...metadata,
        status: input.status,
        type: input.type.trim(),
        information: normalizeOptionalText(input.information),
        juridiction: normalizeOptionalText(input.juridiction),
        tribunal: normalizeOptionalText(input.tribunal)
      }))
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
    },

    upsertKeyDate: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const keyDates = await loadKeyDates(dossierPath)
      const existingEntry = input.id ? keyDates.find((entry) => entry.id === input.id) : undefined

      if (input.id && !existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      const nextEntry = keyDateSchema.parse({
        id: input.id ?? randomUUID(),
        dossierId: input.dossierId,
        label: input.label.trim(),
        date: input.date,
        time: input.time ?? existingEntry?.time,
        duration: input.duration ?? existingEntry?.duration,
        tags: input.tags ?? existingEntry?.tags,
        isClosed: input.isClosed ?? existingEntry?.isClosed,
        note: normalizeOptionalText(input.note) ?? existingEntry?.note
      })

      await saveKeyDate(dossierPath, nextEntry)
      await updateKeyDateIndex(dossierPath, nextEntry, 'upsert', nowIso)

      const allKeyDates = upsertById(keyDates, nextEntry)
      const nextKeyDate = deriveNextUpcomingKeyDate(allKeyDates, now())
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso,
        nextUpcomingKeyDate: nextKeyDate?.date ?? null,
        nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      return toDetail(saved, billingItems, allKeyDates)
    },

    deleteKeyDate: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const keyDates = await loadKeyDates(dossierPath)
      if (!keyDates.some((entry) => entry.id === input.keyDateId)) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      await deleteKeyDateFile(dossierPath, input.keyDateId)
      const removedEntry = keyDates.find((e) => e.id === input.keyDateId)!
      await updateKeyDateIndex(dossierPath, removedEntry, 'remove', nowIso)

      const remainingKeyDates = keyDates.filter((entry) => entry.id !== input.keyDateId)
      const nextKeyDate = deriveNextUpcomingKeyDate(remainingKeyDates, now())
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso,
        nextUpcomingKeyDate: nextKeyDate?.date ?? null,
        nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      return toDetail(saved, billingItems, remainingKeyDates)
    },

    upsertKeyReference: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const existingEntry = input.id
            ? metadata.keyReferences.find((entry) => entry.id === input.id)
            : undefined

          if (input.id && !existingEntry) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This key reference was not found.'
            )
          }

          const trimmedLabel = input.label.trim()
          const trimmedValue = input.value.trim()
          const isNameReference =
            isDossierNameReferenceLabel(trimmedLabel) ||
            (existingEntry ? isDossierNameReferenceLabel(existingEntry.label) : false)

          if (
            !existingEntry &&
            isDossierNameReferenceLabel(trimmedLabel) &&
            metadata.keyReferences.some((entry) => isDossierNameReferenceLabel(entry.label))
          ) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'A dossier-name reference already exists.'
            )
          }

          if (
            existingEntry &&
            isDossierNameReferenceLabel(existingEntry.label) &&
            !isNameReference
          ) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'The dossier-name reference label cannot be changed.'
            )
          }

          const resolvedLabel = isNameReference ? DOSSIER_NAME_REFERENCE_LABEL : trimmedLabel
          const fallbackName = basename(metadata.id)
          const resolvedValue = isNameReference ? trimmedValue || fallbackName : trimmedValue

          if (!resolvedValue) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'A key reference value is required.'
            )
          }

          const nextEntry = keyReferenceSchema.parse({
            id: existingEntry?.id ?? randomUUID(),
            dossierId: input.dossierId,
            label: resolvedLabel,
            value: resolvedValue,
            note: normalizeOptionalText(input.note) ?? existingEntry?.note
          })

          return {
            ...metadata,
            name: isNameReference ? resolvedValue : metadata.name,
            keyReferences: upsertById(metadata.keyReferences, nextEntry)
          }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
    },

    upsertFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const nowIso = now().toISOString()
          const existing = input.id
            ? metadata.feeAgreements.find((entry) => entry.id === input.id)
            : undefined

          if (input.id && !existing) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This fee agreement was not found.'
            )
          }

          const shouldBeActive = input.setActive ?? (existing ? existing.isActive : true)

          const nextEntry: DossierFeeAgreement = feeAgreementSchema.parse({
            id: existing?.id ?? randomUUID(),
            createdAt: existing?.createdAt ?? nowIso,
            updatedAt: nowIso,
            isActive: shouldBeActive,
            archivedAt: shouldBeActive ? undefined : (existing?.archivedAt ?? nowIso),
            generatedDocumentUuid:
              normalizeOptionalText(input.generatedDocumentUuid) ?? existing?.generatedDocumentUuid,
            signedDocumentUuid:
              normalizeOptionalText(input.signedDocumentUuid) ?? existing?.signedDocumentUuid,
            status: input.status,
            matterLabel: input.matterLabel.trim(),
            scopeDescription: input.scopeDescription.trim(),
            clientContactUuid: normalizeOptionalText(input.clientContactUuid),
            signatoryContactUuid: normalizeOptionalText(input.signatoryContactUuid),
            billingType: input.billingType,
            sourceServicePresetId: normalizeOptionalText(input.sourceServicePresetId),
            flatFeeHtCents: input.flatFeeHtCents,
            hourlyRateHtCents: input.hourlyRateHtCents,
            estimatedHours: input.estimatedHours,
            retainerHtCents: input.retainerHtCents,
            successFeePercentBasisPoints: input.successFeePercentBasisPoints,
            successFeeClause: normalizeOptionalText(input.successFeeClause),
            discountKind: input.discountKind,
            discountPercentBasisPoints:
              input.discountKind === 'percent'
                ? (input.discountPercentBasisPoints ?? 0)
                : undefined,
            discountAmountHtCents:
              input.discountKind === 'amount' ? (input.discountAmountHtCents ?? 0) : undefined,
            vatRateBasisPoints: input.vatRateBasisPoints,
            paymentTerms: normalizeOptionalText(input.paymentTerms),
            expenseTerms: normalizeOptionalText(input.expenseTerms),
            terminationTerms: normalizeOptionalText(input.terminationTerms),
            sentAt: input.sentAt,
            signedAt: input.signedAt,
            notes: normalizeOptionalText(input.notes)
          })

          let feeAgreements = upsertById(metadata.feeAgreements, nextEntry)
          if (nextEntry.isActive) {
            feeAgreements = feeAgreements.map((entry) =>
              entry.id === nextEntry.id
                ? entry
                : entry.isActive
                  ? { ...entry, isActive: false, archivedAt: entry.archivedAt ?? nowIso }
                  : entry
            )
          }

          return { ...metadata, feeAgreements }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
    },

    deleteFeeAgreement: async (input): Promise<DossierDetail> => {
      const { dossierPath } = await loadRegisteredMetadata(input.dossierId)
      const billingItems = await loadBillingItems(dossierPath)

      const linkedBillingItems = billingItems.filter(
        (item) => item.sourceFeeAgreementId === input.feeAgreementId
      )
      if (linkedBillingItems.length > 0) {
        throw new DossierRegistryError(
          IpcErrorCode.INTEGRITY_CONFLICT,
          `Cannot delete fee agreement: ${linkedBillingItems.length} billing item(s) still reference it. Archive the fee agreement or remove the billing items first.`
        )
      }

      const { metadata: saved } = await mutateDossierMeta(input.dossierId, (metadata) => {
        if (!metadata.feeAgreements.some((entry) => entry.id === input.feeAgreementId)) {
          throw new DossierRegistryError(
            IpcErrorCode.NOT_FOUND,
            'This fee agreement was not found.'
          )
        }
        return {
          ...metadata,
          feeAgreements: metadata.feeAgreements.filter((entry) => entry.id !== input.feeAgreementId)
        }
      })
      const keyDates = await loadKeyDates(dossierPath)
      return toDetail(saved, billingItems, keyDates)
    },

    archiveFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.feeAgreements.find((entry) => entry.id === input.feeAgreementId)
          if (!target) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This fee agreement was not found.'
            )
          }

          const nowIso = now().toISOString()
          return {
            ...metadata,
            feeAgreements: metadata.feeAgreements.map((entry) =>
              entry.id === input.feeAgreementId
                ? {
                    ...entry,
                    isActive: false,
                    archivedAt: entry.archivedAt ?? nowIso,
                    updatedAt: nowIso
                  }
                : entry
            )
          }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
    },

    setActiveFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.feeAgreements.find((entry) => entry.id === input.feeAgreementId)
          if (!target) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This fee agreement was not found.'
            )
          }

          const nowIso = now().toISOString()
          return {
            ...metadata,
            feeAgreements: metadata.feeAgreements.map((entry) => {
              if (entry.id === input.feeAgreementId) {
                return {
                  ...entry,
                  isActive: true,
                  archivedAt: undefined,
                  updatedAt: nowIso
                }
              }
              return entry.isActive
                ? {
                    ...entry,
                    isActive: false,
                    archivedAt: entry.archivedAt ?? nowIso,
                    updatedAt: nowIso
                  }
                : entry
            })
          }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
    },

    upsertBillingItem: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const existing = input.id ? billingItems.find((entry) => entry.id === input.id) : undefined

      if (input.id && !existing) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This billing item was not found.')
      }
      if (existing?.status === 'billed') {
        throw new DossierRegistryError(
          IpcErrorCode.VALIDATION_FAILED,
          'This billing item is already invoiced and cannot be edited. Create a credit note or corrective invoice instead.'
        )
      }

      const discountKind = input.discountKind
      const discountPercentBasisPoints =
        discountKind === 'percent' ? (input.discountPercentBasisPoints ?? 0) : undefined
      const discountAmountHtCents =
        discountKind === 'amount' ? (input.discountAmountHtCents ?? 0) : undefined

      const totals = computeBillingItemTotals({
        quantity: input.quantity,
        unitPriceHtCents: input.unitPriceHtCents,
        vatRateBasisPoints: input.vatRateBasisPoints,
        discountKind,
        discountPercentBasisPoints,
        discountAmountHtCents
      })

      const nextEntry: DossierBillingItem = dossierBillingItemSchema.parse({
        id: existing?.id ?? randomUUID(),
        dossierId: input.dossierId,
        date: input.date,
        label: input.label.trim(),
        description: normalizeOptionalText(input.description),
        sourceServicePresetId: normalizeOptionalText(input.sourceServicePresetId),
        quantity: input.quantity,
        quantityUnit: input.quantityUnit,
        unitPriceHtCents: input.unitPriceHtCents,
        discountKind,
        discountPercentBasisPoints,
        discountAmountHtCents,
        subtotalHtCents: totals.subtotalHtCents,
        discountHtCents: totals.discountHtCents,
        totalHtCents: totals.totalHtCents,
        vatRateBasisPoints: input.vatRateBasisPoints,
        totalTtcCents: totals.totalTtcCents,
        status: input.status,
        sourceKeyDateId: normalizeOptionalText(input.sourceKeyDateId),
        sourceFeeAgreementId: normalizeOptionalText(input.sourceFeeAgreementId),
        sourceFeeAgreementBillingKind: input.sourceFeeAgreementBillingKind,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso
      })

      await saveBillingItem(dossierPath, nextEntry)
      await updateBillingItemIndex(dossierPath, nextEntry, 'upsert', nowIso)

      const allBillingItems = upsertById(billingItems, nextEntry)
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return toDetail(saved, allBillingItems, keyDates)
    },

    deleteBillingItem: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const existing = billingItems.find((entry) => entry.id === input.billingItemId)
      if (!existing) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This billing item was not found.')
      }
      if (existing.status === 'billed') {
        throw new DossierRegistryError(
          IpcErrorCode.VALIDATION_FAILED,
          'This billing item is already invoiced and cannot be deleted. Create a credit note or corrective invoice instead.'
        )
      }

      await deleteBillingItemFile(dossierPath, input.billingItemId)
      await updateBillingItemIndex(dossierPath, existing, 'remove', nowIso)

      const remainingItems = billingItems.filter((entry) => entry.id !== input.billingItemId)
      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return toDetail(saved, remainingItems, keyDates)
    },

    markBillingItemsInvoiced: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const targetIds = new Set(input.billingItemIds)
      const missing = input.billingItemIds.filter(
        (id) => !billingItems.some((entry) => entry.id === id)
      )
      if (missing.length > 0) {
        throw new DossierRegistryError(
          IpcErrorCode.NOT_FOUND,
          `Some billing items were not found: ${missing.join(', ')}`
        )
      }

      const updatedItems = await Promise.all(
        billingItems.map(async (entry) => {
          if (!targetIds.has(entry.id)) return entry
          const updated: DossierBillingItem = {
            ...entry,
            status: 'billed' as const,
            invoiceId: input.invoiceId,
            invoiceNumber: input.invoiceNumber,
            updatedAt: nowIso
          }
          await saveBillingItem(dossierPath, updated)
          await updateBillingItemIndex(dossierPath, updated, 'upsert', nowIso)
          return updated
        })
      )

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return toDetail(saved, updatedItems, keyDates)
    },

    unmarkBillingItemsInvoiced: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const updatedItems = await Promise.all(
        billingItems.map(async (entry) => {
          if (entry.invoiceId !== input.invoiceId) return entry
          const updated: DossierBillingItem = {
            ...entry,
            status: 'draft' as const,
            invoiceId: undefined,
            invoiceNumber: undefined,
            updatedAt: nowIso
          }
          await saveBillingItem(dossierPath, updated)
          await updateBillingItemIndex(dossierPath, updated, 'upsert', nowIso)
          return updated
        })
      )

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return toDetail(saved, updatedItems, keyDates)
    },

    deleteKeyReference: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.keyReferences.find((entry) => entry.id === input.keyReferenceId)
          if (!target) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This key reference was not found.'
            )
          }

          if (isDossierNameReferenceLabel(target.label)) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'The dossier-name reference cannot be deleted.'
            )
          }

          return {
            ...metadata,
            keyReferences: metadata.keyReferences.filter(
              (entry) => entry.id !== input.keyReferenceId
            )
          }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return toDetail(saved, billingItems, keyDates)
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

      options.onDossierUnregistered?.(dossierId)
      return null
    }
  }
}
