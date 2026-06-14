import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type {
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierCreateInput,
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
  DossierLegalAid,
  DossierRegistrationInput,
  DossierScopedQuery,
  DossierStatus,
  DossierSummary,
  DossierUnregisterInput,
  DossierUpdateInput,
  DossierNote,
  DossierNoteDeleteInput,
  DossierNoteUpsertInput,
  GeneralKeyDate,
  GeneralKeyDateDeleteInput,
  GeneralKeyDateUpsertInput,
  KeyDate,
  KeyDateMoveInput,
  KeyReference
} from '@shared/types'
import {
  DOSSIER_INFORMATION_REFERENCE_LABEL,
  DOSSIER_JURIDICTION_REFERENCE_LABEL,
  DOSSIER_NAME_REFERENCE_LABEL,
  DOSSIER_REQUIRED_REFERENCE_LABELS,
  DOSSIER_STATUS_REFERENCE_LABEL,
  DOSSIER_TRIBUNAL_REFERENCE_LABEL,
  DOSSIER_TYPE_REFERENCE_LABEL,
  IpcErrorCode,
  isDossierNameReferenceLabel,
  isDossierRequiredReferenceLabel
} from '@shared/types'
import { computeBillingItemTotals } from '@shared/billingCalculations'
import {
  dossierBillingItemSchema,
  dossierLegalAidSchema,
  dossierMetadataFileSchema,
  dossierNoteSchema,
  feeAgreementSchema,
  generalKeyDateSchema,
  keyDateSchema,
  keyReferenceSchema,
  type DossierMetadataFile
} from '@shared/validation'

import {
  getDomainGeneralKeyDateRecordPath,
  getDomainGeneralKeyDatesDirectoryPath,
  getDomainRegistryPath,
  getDossierBillingItemRecordPath,
  getDossierBillingItemsDirectoryPath,
  getDossierKeyDateRecordPath,
  getDossierKeyDatesDirectoryPath,
  getDossierNoteEmbeddingCachePath,
  getDossierNoteRecordPath,
  getDossierNotesDirectoryPath,
  getDossierMetadataPath,
  getDossierOrdicabPath,
  ORDICAB_DIRECTORY_NAME
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadDomainState, pathExists } from '../../lib/system/domainState'
import { deleteRecord, loadAllRecords, saveRecord } from '../../lib/system/perFileStore'

interface DossierRegistryEntry {
  slug: string
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
  /**
   * Compute/refresh a note's embeddings after it is created or updated.
   * Best-effort and awaited so the returned DossierDetail reflects a fresh
   * index; failures inside must not throw. Omitted in tests/headless runs that
   * do not need semantic search.
   */
  indexNote?: (dossierPath: string, note: DossierNote) => Promise<void>
  /**
   * Hybrid (keyword + semantic) search over a dossier's notes. Injected so the
   * embedding worker lives in the container; omitted in tests that don't search.
   */
  searchNotesInDossier?: (input: {
    dossierPath: string
    notes: DossierNote[]
    query: string
    topK?: number
  }) => Promise<NoteSearchResult[]>
}

interface NoteSearchResult {
  noteUuid: string
  title: string
  snippet: string
  score: number
  matchKind: string
  kind?: DossierNote['kind']
  status?: DossierNote['status']
  /** True when `snippet` is a truncated prefix of the note's full content. */
  truncated?: boolean
}

/**
 * Max characters of note content surfaced inline in a search/list result.
 * Beyond this the snippet is truncated and `truncated:true` is set so the
 * caller (the AI) knows to fetch the full note by id when the tail matters.
 */
export const NOTE_SNIPPET_MAX_LENGTH = 280

/** Build a snippet from note content, flagging truncation. */
function buildNoteSnippet(content: string): { snippet: string; truncated: boolean } {
  if (content.length <= NOTE_SNIPPET_MAX_LENGTH) return { snippet: content, truncated: false }
  return { snippet: content.slice(0, NOTE_SNIPPET_MAX_LENGTH), truncated: true }
}

export interface DossierRegistryService {
  listEligibleFolders: () => Promise<DossierEligibleFolder[]>
  listRegisteredDossiers: () => Promise<DossierSummary[]>
  getDossier: (input: DossierScopedQuery) => Promise<DossierDetail>
  openDossier: (input: DossierScopedQuery) => Promise<DossierDetail>
  registerDossier: (input: DossierRegistrationInput) => Promise<DossierSummary>
  createDossier: (input: DossierCreateInput) => Promise<DossierSummary>
  unregisterDossier: (input: DossierUnregisterInput) => Promise<null>
  updateDossier: (input: DossierUpdateInput) => Promise<DossierDetail>
  updateLegalAid: (input: {
    dossierId: string
    legalAid: DossierLegalAid
  }) => Promise<DossierDetail>
  upsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<DossierDetail>
  deleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<DossierDetail>
  /**
   * Déplace un événement d'un rattachement à un autre (dossier ou « hors
   * dossier »), en conservant son uuid. Renvoie `null` : l'appelant recharge la
   * chronologie et resynchronise le détail ouvert.
   */
  moveKeyDate: (input: KeyDateMoveInput) => Promise<null>
  listGeneralKeyDates: () => Promise<GeneralKeyDate[]>
  upsertGeneralKeyDate: (input: GeneralKeyDateUpsertInput) => Promise<GeneralKeyDate[]>
  deleteGeneralKeyDate: (input: GeneralKeyDateDeleteInput) => Promise<GeneralKeyDate[]>
  upsertNote: (input: DossierNoteUpsertInput) => Promise<DossierDetail>
  deleteNote: (input: DossierNoteDeleteInput) => Promise<DossierDetail>
  searchNotes: (input: {
    dossierId: string
    query: string
    kind?: DossierNote['kind']
    status?: DossierNote['status']
    topK?: number
  }) => Promise<NoteSearchResult[]>
  upsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<DossierDetail>
  deleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<DossierDetail>
  archiveFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<DossierDetail>
  setActiveFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<DossierDetail>
  upsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<DossierDetail>
  deleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<DossierDetail>
  markBillingItemsInvoiced: (input: {
    dossierId: string
    billingItemUuids: string[]
    invoiceUuid: string
    invoiceNumber: string
  }) => Promise<DossierDetail>
  unmarkBillingItemsInvoiced: (input: {
    dossierId: string
    invoiceUuid: string
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
  slug: string
  uuid?: string
  name: string
  registeredAt: string
}): DossierMetadataFile {
  return {
    slug: options.slug,
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
    notes: [],
    documents: [],
    pieces: []
  }
}

function toSummary(metadata: DossierMetadataFile): DossierSummary {
  return {
    slug: metadata.slug,
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
  keyDates: KeyDate[],
  notes: DossierNote[]
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
    keyReferences: metadata.keyReferences,
    notes
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

function parseFeeAgreements(parsed: Record<string, unknown>): DossierFeeAgreement[] {
  if (!Array.isArray(parsed.feeAgreements)) {
    return []
  }
  return parsed.feeAgreements.flatMap((entry) => {
    const validated = feeAgreementSchema.safeParse(entry)
    return validated.success ? [validated.data] : []
  })
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

/** Trim, drop blanks, and de-duplicate note tags. Returns undefined when empty. */
function normalizeNoteTags(tags: string[] | undefined): string[] | undefined {
  if (!Array.isArray(tags)) return undefined
  const cleaned = Array.from(new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0)))
  return cleaned.length > 0 ? cleaned : undefined
}

function cloneMetadata(metadata: DossierMetadataFile): DossierMetadataFile {
  return {
    ...metadata,
    documents: [...metadata.documents],
    pieces: metadata.pieces.map((entry) => ({ ...entry })),
    feeAgreements: metadata.feeAgreements.map((entry) => ({ ...entry })),
    billingItems: [],
    keyDates: [],
    keyReferences: [...metadata.keyReferences],
    // Notes are stored per-file like key dates; never persisted in dossier.json.
    notes: []
  }
}

function upsertByUuid<T extends { uuid: string }>(entries: T[], nextEntry: T): T[] {
  const existingIndex = entries.findIndex((entry) => entry.uuid === nextEntry.uuid)

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

/**
 * Turns a free-text dossier name into a filesystem-safe folder name by replacing
 * path separators with a dash and stripping characters that are illegal on common
 * filesystems. The original text is kept separately as the dossier display name.
 */
function sanitizeDossierFolderName(name: string): string {
  return name
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
            typeof entry.slug === 'string' &&
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
      typeof parsed.slug !== 'string' ||
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
    const feeAgreements = parseFeeAgreements(parsed)
    // billingItems and keyDates are now stored per-file; pass empty arrays here
    // (they are loaded separately via loadBillingItems / loadKeyDates)
    const validatedMetadata = dossierMetadataFileSchema.safeParse({
      slug: parsed.slug,
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
      documents: parsed.documents,
      // Inline payloads that MUST round-trip through every registry write
      // (open/lastOpenedAt, status, references…): omitting them here lets the
      // schema default/strip them and the next saveMetadata erases the data.
      pieces: parsed.pieces,
      legalAid: parsed.legalAid
    })

    if (!validatedMetadata.success) {
      if (options.strict) {
        throw invalidMetadataError
      }

      return null
    }

    // Backfill a missing uuid on first read (one-time, idempotent).
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
  const toWrite = { ...metadata, billingItems: [], keyDates: [], notes: [] }
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

function getRequiredDossierReferenceValue(
  metadata: DossierMetadataFile,
  dossierPath: string,
  label: (typeof DOSSIER_REQUIRED_REFERENCE_LABELS)[number]
): string {
  switch (label) {
    case DOSSIER_NAME_REFERENCE_LABEL:
      return metadata.name || basename(dossierPath)
    case DOSSIER_STATUS_REFERENCE_LABEL:
      return metadata.status
    case DOSSIER_TYPE_REFERENCE_LABEL:
      return metadata.type
    case DOSSIER_JURIDICTION_REFERENCE_LABEL:
      return metadata.juridiction ?? ''
    case DOSSIER_TRIBUNAL_REFERENCE_LABEL:
      return metadata.tribunal ?? ''
    case DOSSIER_INFORMATION_REFERENCE_LABEL:
      return metadata.information ?? ''
  }
}

function getRequiredReferenceByLabel(
  references: KeyReference[],
  label: (typeof DOSSIER_REQUIRED_REFERENCE_LABELS)[number]
): KeyReference | undefined {
  return references.find(
    (entry) => entry.label.trim().toLocaleLowerCase('fr-FR') === label.toLocaleLowerCase('fr-FR')
  )
}

function normalizeRequiredReferenceStatus(value: string): DossierStatus {
  return normalizeStatus(value.trim())
}

function syncDossierFieldsFromRequiredReferences(
  metadata: DossierMetadataFile
): DossierMetadataFile {
  const nameReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_NAME_REFERENCE_LABEL
  )
  const statusReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_STATUS_REFERENCE_LABEL
  )
  const typeReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_TYPE_REFERENCE_LABEL
  )
  const juridictionReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_JURIDICTION_REFERENCE_LABEL
  )
  const tribunalReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_TRIBUNAL_REFERENCE_LABEL
  )
  const informationReference = getRequiredReferenceByLabel(
    metadata.keyReferences,
    DOSSIER_INFORMATION_REFERENCE_LABEL
  )

  return {
    ...metadata,
    name: nameReference?.value.trim() || metadata.name,
    status: statusReference
      ? normalizeRequiredReferenceStatus(statusReference.value)
      : metadata.status,
    type: typeReference?.value.trim() ?? metadata.type,
    juridiction: normalizeOptionalText(juridictionReference?.value),
    tribunal: normalizeOptionalText(tribunalReference?.value),
    information: normalizeOptionalText(informationReference?.value)
  }
}

function setRequiredDossierReferenceValue(
  metadata: DossierMetadataFile,
  label: (typeof DOSSIER_REQUIRED_REFERENCE_LABELS)[number],
  value: string
): DossierMetadataFile {
  const existing = getRequiredReferenceByLabel(metadata.keyReferences, label)
  const nextEntry = keyReferenceSchema.parse({
    uuid: existing?.uuid ?? randomUUID(),
    dossierId: metadata.slug,
    label: existing?.label ?? label,
    value
  })

  return {
    ...metadata,
    keyReferences: upsertByUuid(metadata.keyReferences, nextEntry)
  }
}

/**
 * Returns metadata with guaranteed dossier parameter key references present.
 */
function ensureRequiredDossierReferences(
  metadata: DossierMetadataFile,
  dossierPath: string
): DossierMetadataFile {
  const keyReferences = [...metadata.keyReferences]

  for (const label of DOSSIER_REQUIRED_REFERENCE_LABELS) {
    if (getRequiredReferenceByLabel(keyReferences, label)) continue
    keyReferences.push(
      keyReferenceSchema.parse({
        uuid: randomUUID(),
        dossierId: metadata.slug,
        label,
        value: getRequiredDossierReferenceValue(metadata, dossierPath, label)
      })
    )
  }

  return syncDossierFieldsFromRequiredReferences({
    ...metadata,
    keyReferences
  })
}

// ---------------------------------------------------------------------------
// Per-file billing item helpers
// ---------------------------------------------------------------------------

async function loadBillingItems(dossierPath: string): Promise<DossierBillingItem[]> {
  return loadAllRecords(getDossierBillingItemsDirectoryPath(dossierPath), dossierBillingItemSchema)
}

async function saveBillingItem(dossierPath: string, item: DossierBillingItem): Promise<void> {
  return saveRecord(
    getDossierBillingItemsDirectoryPath(dossierPath),
    getDossierBillingItemRecordPath(dossierPath, item.uuid),
    item
  )
}

async function deleteBillingItemFile(dossierPath: string, id: string): Promise<void> {
  return deleteRecord(getDossierBillingItemRecordPath(dossierPath, id))
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
    getDossierKeyDateRecordPath(dossierPath, keyDate.uuid),
    keyDate
  )
}

async function deleteKeyDateFile(dossierPath: string, id: string): Promise<void> {
  return deleteRecord(getDossierKeyDateRecordPath(dossierPath, id))
}

// ---------------------------------------------------------------------------
// General (hors-dossier) key date helpers — one file per record, no index.
// ---------------------------------------------------------------------------

async function loadGeneralKeyDates(domainPath: string): Promise<GeneralKeyDate[]> {
  return loadAllRecords(getDomainGeneralKeyDatesDirectoryPath(domainPath), generalKeyDateSchema)
}

async function saveGeneralKeyDate(domainPath: string, keyDate: GeneralKeyDate): Promise<void> {
  return saveRecord(
    getDomainGeneralKeyDatesDirectoryPath(domainPath),
    getDomainGeneralKeyDateRecordPath(domainPath, keyDate.uuid),
    keyDate
  )
}

async function deleteGeneralKeyDateFile(domainPath: string, id: string): Promise<void> {
  return deleteRecord(getDomainGeneralKeyDateRecordPath(domainPath, id))
}

// ---------------------------------------------------------------------------
// Per-file note helpers
// ---------------------------------------------------------------------------

async function loadNotes(dossierPath: string): Promise<DossierNote[]> {
  // Embedding caches live in the notes/embeddings/ subfolder, so this
  // non-recursive scan only sees real note records. Sort newest-first.
  const notes = await loadAllRecords(getDossierNotesDirectoryPath(dossierPath), dossierNoteSchema)
  return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function saveNote(dossierPath: string, note: DossierNote): Promise<void> {
  return saveRecord(
    getDossierNotesDirectoryPath(dossierPath),
    getDossierNoteRecordPath(dossierPath, note.uuid),
    note
  )
}

async function deleteNoteFiles(dossierPath: string, id: string): Promise<void> {
  await deleteRecord(getDossierNoteRecordPath(dossierPath, id))
  // Drop the embedding cache too so a re-created id never reuses stale vectors.
  await deleteRecord(getDossierNoteEmbeddingCachePath(dossierPath, id))
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
    const existingEntry = registry.dossiers.find((entry) => entry.slug === normalizedDossierId)

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
        slug: normalizedDossierId,
        uuid: existingEntry.uuid,
        name: existingEntry.name || basename(normalizedDossierId),
        registeredAt: existingEntry.registeredAt
      })

    const ensuredMetadata = ensureRequiredDossierReferences(metadata, dossierPath)
    const shouldPersistEnsuredMetadata =
      ensuredMetadata.keyReferences.length !== metadata.keyReferences.length ||
      ensuredMetadata.name !== metadata.name ||
      ensuredMetadata.status !== metadata.status ||
      ensuredMetadata.type !== metadata.type ||
      ensuredMetadata.juridiction !== metadata.juridiction ||
      ensuredMetadata.tribunal !== metadata.tribunal ||
      ensuredMetadata.information !== metadata.information

    return {
      dossierPath,
      metadata: shouldPersistEnsuredMetadata
        ? await saveMetadata(dossierPath, ensuredMetadata)
        : ensuredMetadata
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

  /**
   * Assemble a DossierDetail, loading the per-file notes from disk. Every
   * mutation returns through here so notes are always present in the response,
   * regardless of which sub-entity changed.
   */
  async function detailWithNotes(
    dossierPath: string,
    metadata: DossierMetadataFile,
    billingItems: DossierBillingItem[],
    keyDates: KeyDate[]
  ): Promise<DossierDetail> {
    const notes = await loadNotes(dossierPath)
    return toDetail(metadata, billingItems, keyDates, notes)
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
      return detailWithNotes(dossierPath, updated, billingItems, keyDates)
    }
    return detailWithNotes(dossierPath, metadata, billingItems, keyDates)
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
    return detailWithNotes(dossierPath, saved, billingItems, keyDates)
  }

  async function finalizeRegistration(
    domainPath: string,
    dossierId: string,
    dossierPath: string,
    displayName?: string
  ): Promise<DossierSummary> {
    const registry = await loadRegistry(domainPath)
    if (registry.dossiers.some((entry) => entry.slug === dossierId)) {
      throw new DossierRegistryError(
        IpcErrorCode.INVALID_INPUT,
        'This dossier is already registered.'
      )
    }

    const registeredAt = now().toISOString()
    const dossierBaseName = displayName?.trim() || basename(dossierPath)
    const metadata = createDefaultMetadata({
      slug: dossierId,
      name: dossierBaseName,
      registeredAt
    })
    metadata.keyReferences = ensureRequiredDossierReferences(metadata, dossierPath).keyReferences
    const nextRegistry: DossierRegistryFile = {
      dossiers: [
        ...registry.dossiers,
        {
          slug: dossierId,
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
  }

  return {
    listEligibleFolders: async (): Promise<DossierEligibleFolder[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        return []
      }

      const registry = await loadRegistry(domainPath)
      const registeredIds = new Set(registry.dossiers.map((entry) => entry.slug))
      const entries = await readdir(domainPath, { withFileTypes: true })

      return entries
        .filter((entry) => entry.isDirectory() && !isHiddenFolderName(entry.name))
        .filter((entry) => !registeredIds.has(entry.name))
        .map((entry) => ({
          slug: entry.name,
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
            (await readMetadata(join(domainPath, entry.slug))) ??
            createDefaultMetadata({
              slug: entry.slug,
              uuid: entry.uuid,
              name: entry.name || basename(entry.slug),
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

      const dossierId = validateDirectChildId(input.slug)
      const dossierPath = join(domainPath, dossierId)
      const dossierStats = await stat(dossierPath).catch(() => null)

      if (!dossierStats?.isDirectory()) {
        throw new DossierRegistryError(
          IpcErrorCode.NOT_FOUND,
          'Selected dossier folder was not found.'
        )
      }

      return finalizeRegistration(domainPath, dossierId, dossierPath)
    },

    createDossier: async (input): Promise<DossierSummary> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const displayName = input.name.trim()
      const dossierId = validateDirectChildId(sanitizeDossierFolderName(input.name))
      const dossierPath = join(domainPath, dossierId)
      const existing = await stat(dossierPath).catch(() => null)

      if (existing) {
        throw new DossierRegistryError(
          IpcErrorCode.INVALID_INPUT,
          'A folder with this name already exists.'
        )
      }

      await mkdir(dossierPath, { recursive: false })

      return finalizeRegistration(domainPath, dossierId, dossierPath, displayName)
    },

    updateDossier: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(input.slug, (metadata) => {
        const nextMetadata = {
          ...metadata,
          legalAid: input.legalAid ?? metadata.legalAid
        }
        const withStatus = setRequiredDossierReferenceValue(
          nextMetadata,
          DOSSIER_STATUS_REFERENCE_LABEL,
          input.status
        )
        const withType = setRequiredDossierReferenceValue(
          withStatus,
          DOSSIER_TYPE_REFERENCE_LABEL,
          input.type.trim()
        )
        const withInformation = setRequiredDossierReferenceValue(
          withType,
          DOSSIER_INFORMATION_REFERENCE_LABEL,
          normalizeOptionalText(input.information) ?? ''
        )
        const withJuridiction = setRequiredDossierReferenceValue(
          withInformation,
          DOSSIER_JURIDICTION_REFERENCE_LABEL,
          normalizeOptionalText(input.juridiction) ?? ''
        )
        const withTribunal = setRequiredDossierReferenceValue(
          withJuridiction,
          DOSSIER_TRIBUNAL_REFERENCE_LABEL,
          normalizeOptionalText(input.tribunal) ?? ''
        )

        return syncDossierFieldsFromRequiredReferences(withTribunal)
      })
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    updateLegalAid: async (input): Promise<DossierDetail> => {
      const legalAid = dossierLegalAidSchema.parse(input.legalAid)
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => ({
          ...metadata,
          legalAid
        })
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    upsertKeyDate: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const keyDates = await loadKeyDates(dossierPath)
      const existingEntry = input.uuid
        ? keyDates.find((entry) => entry.uuid === input.uuid)
        : undefined

      if (input.uuid && !existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      const nextEntry = keyDateSchema.parse({
        uuid: input.uuid ?? randomUUID(),
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

      const allKeyDates = upsertByUuid(keyDates, nextEntry)
      const nextKeyDate = deriveNextUpcomingKeyDate(allKeyDates, now())
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso,
        nextUpcomingKeyDate: nextKeyDate?.date ?? null,
        nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      return detailWithNotes(dossierPath, saved, billingItems, allKeyDates)
    },

    deleteKeyDate: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const keyDates = await loadKeyDates(dossierPath)
      if (!keyDates.some((entry) => entry.uuid === input.keyDateUuid)) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      await deleteKeyDateFile(dossierPath, input.keyDateUuid)

      const remainingKeyDates = keyDates.filter((entry) => entry.uuid !== input.keyDateUuid)
      const nextKeyDate = deriveNextUpcomingKeyDate(remainingKeyDates, now())
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso,
        nextUpcomingKeyDate: nextKeyDate?.date ?? null,
        nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      return detailWithNotes(dossierPath, saved, billingItems, remainingKeyDates)
    },

    moveKeyDate: async (input: KeyDateMoveInput): Promise<null> => {
      const nowIso = now().toISOString()

      // 1. Retrait à la source (suppression best-effort + métadonnées du dossier
      //    source rafraîchies si c'était un dossier).
      if (input.fromDossierId === null) {
        const domainPath = await resolveActiveDomainPath(options.stateFilePath)
        if (!domainPath) {
          throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
        }
        await deleteGeneralKeyDateFile(domainPath, input.keyDateUuid)
      } else {
        const { dossierPath, metadata } = await loadRegisteredMetadata(input.fromDossierId)
        await deleteKeyDateFile(dossierPath, input.keyDateUuid)
        const remaining = await loadKeyDates(dossierPath)
        const nextKeyDate = deriveNextUpcomingKeyDate(remaining, now())
        await saveMetadata(dossierPath, {
          ...metadata,
          updatedAt: nowIso,
          nextUpcomingKeyDate: nextKeyDate?.date ?? null,
          nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
        })
      }

      // 2. Création à la cible, uuid conservé, avec les champs (éventuellement) édités.
      if (input.toDossierId === null) {
        const domainPath = await resolveActiveDomainPath(options.stateFilePath)
        if (!domainPath) {
          throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
        }
        const nextEntry = generalKeyDateSchema.parse({
          uuid: input.keyDateUuid,
          label: input.label.trim(),
          date: input.date,
          time: input.time,
          duration: input.duration,
          tags: input.tags,
          isClosed: input.isClosed,
          note: normalizeOptionalText(input.note)
        })
        await saveGeneralKeyDate(domainPath, nextEntry)
      } else {
        const { dossierPath, metadata } = await loadRegisteredMetadata(input.toDossierId)
        const nextEntry = keyDateSchema.parse({
          uuid: input.keyDateUuid,
          dossierId: input.toDossierId,
          label: input.label.trim(),
          date: input.date,
          time: input.time,
          duration: input.duration,
          tags: input.tags,
          isClosed: input.isClosed,
          note: normalizeOptionalText(input.note)
        })
        await saveKeyDate(dossierPath, nextEntry)
        const allKeyDates = await loadKeyDates(dossierPath)
        const nextKeyDate = deriveNextUpcomingKeyDate(allKeyDates, now())
        await saveMetadata(dossierPath, {
          ...metadata,
          updatedAt: nowIso,
          nextUpcomingKeyDate: nextKeyDate?.date ?? null,
          nextUpcomingKeyDateLabel: nextKeyDate?.label ?? null
        })
      }

      return null
    },

    listGeneralKeyDates: async (): Promise<GeneralKeyDate[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) return []
      return loadGeneralKeyDates(domainPath)
    },

    upsertGeneralKeyDate: async (input: GeneralKeyDateUpsertInput): Promise<GeneralKeyDate[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const keyDates = await loadGeneralKeyDates(domainPath)
      const existingEntry = input.uuid
        ? keyDates.find((entry) => entry.uuid === input.uuid)
        : undefined

      if (input.uuid && !existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      const nextEntry = generalKeyDateSchema.parse({
        uuid: input.uuid ?? randomUUID(),
        label: input.label.trim(),
        date: input.date,
        time: input.time ?? existingEntry?.time,
        duration: input.duration ?? existingEntry?.duration,
        tags: input.tags ?? existingEntry?.tags,
        isClosed: input.isClosed ?? existingEntry?.isClosed,
        note: normalizeOptionalText(input.note) ?? existingEntry?.note
      })

      await saveGeneralKeyDate(domainPath, nextEntry)
      return upsertByUuid(keyDates, nextEntry)
    },

    deleteGeneralKeyDate: async (input: GeneralKeyDateDeleteInput): Promise<GeneralKeyDate[]> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const keyDates = await loadGeneralKeyDates(domainPath)
      if (!keyDates.some((entry) => entry.uuid === input.keyDateUuid)) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This key date was not found.')
      }

      await deleteGeneralKeyDateFile(domainPath, input.keyDateUuid)
      return keyDates.filter((entry) => entry.uuid !== input.keyDateUuid)
    },

    upsertNote: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const notes = await loadNotes(dossierPath)
      const existingEntry = input.uuid
        ? notes.find((entry) => entry.uuid === input.uuid)
        : undefined

      if (input.uuid && !existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This note was not found.')
      }

      const nextEntry = dossierNoteSchema.parse({
        uuid: input.uuid ?? randomUUID(),
        dossierId: input.dossierId,
        title: input.title.trim(),
        content: input.content ?? existingEntry?.content ?? '',
        kind: input.kind ?? existingEntry?.kind ?? 'note',
        status: input.status ?? existingEntry?.status,
        tags: normalizeNoteTags(input.tags) ?? existingEntry?.tags,
        pinned: input.pinned ?? existingEntry?.pinned,
        source: input.source ?? existingEntry?.source ?? 'user',
        createdAt: existingEntry?.createdAt ?? nowIso,
        updatedAt: nowIso
      })

      await saveNote(dossierPath, nextEntry)
      // Refresh embeddings so semantic search reflects the new content. Awaited
      // but best-effort: indexNote swallows its own failures.
      await options.indexNote?.(dossierPath, nextEntry)

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    deleteNote: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const notes = await loadNotes(dossierPath)
      const removedEntry = notes.find((entry) => entry.uuid === input.noteUuid)
      if (!removedEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This note was not found.')
      }

      await deleteNoteFiles(dossierPath, input.noteUuid)

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const billingItems = await loadBillingItems(dossierPath)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    searchNotes: async (input): Promise<NoteSearchResult[]> => {
      const { dossierPath } = await loadRegisteredMetadata(input.dossierId)
      const query = input.query.trim()

      let notes = await loadNotes(dossierPath)
      if (input.kind) notes = notes.filter((note) => note.kind === input.kind)
      if (input.status) notes = notes.filter((note) => note.status === input.status)
      if (notes.length === 0) return []

      const toResult = (note: DossierNote): NoteSearchResult => {
        const { snippet, truncated } = buildNoteSnippet(note.content)
        return {
          noteUuid: note.uuid,
          title: note.title,
          snippet,
          score: 1,
          matchKind: 'keyword',
          kind: note.kind,
          status: note.status,
          truncated
        }
      }

      // No real query (empty or the "*" wildcard) → list ALL notes (optionally
      // filtered by kind/status). This is how "synthèse / liste des notes" works:
      // pinned first, then most recently updated. Capped by topK.
      if (!query || query === '*') {
        return [...notes]
          .sort((a, b) => {
            if ((a.pinned ?? false) !== (b.pinned ?? false)) return a.pinned ? -1 : 1
            return b.updatedAt.localeCompare(a.updatedAt)
          })
          .slice(0, input.topK ?? 50)
          .map(toResult)
      }

      if (!options.searchNotesInDossier) {
        // No embedder wired (e.g. headless): fall back to a simple case-insensitive
        // title/content substring scan so note recall still works.
        const needle = query.toLocaleLowerCase('fr-FR')
        return notes
          .filter(
            (note) =>
              note.title.toLocaleLowerCase('fr-FR').includes(needle) ||
              note.content.toLocaleLowerCase('fr-FR').includes(needle)
          )
          .slice(0, input.topK ?? 10)
          .map(toResult)
      }

      // Hybrid path: the embedding engine builds its own snippets and scores, but
      // knows nothing about kind/status/full content. Enrich each hit from the
      // loaded note so callers get the same metadata and a correct truncation flag.
      const notesById = new Map(notes.map((note) => [note.uuid, note]))
      const hits = await options.searchNotesInDossier({
        dossierPath,
        notes,
        query,
        topK: input.topK
      })
      return hits.map((hit) => {
        const note = notesById.get(hit.noteUuid)
        if (!note) return hit
        return {
          ...hit,
          kind: note.kind,
          status: note.status,
          truncated: note.content.length > hit.snippet.length
        }
      })
    },

    upsertKeyReference: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const existingEntryById = input.uuid
            ? metadata.keyReferences.find((entry) => entry.uuid === input.uuid)
            : undefined

          if (input.uuid && !existingEntryById) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This key reference was not found.'
            )
          }

          const trimmedLabel = input.label.trim()
          const trimmedValue = input.value.trim()
          const existingRequiredEntryByLabel = isDossierRequiredReferenceLabel(trimmedLabel)
            ? metadata.keyReferences.find(
                (entry) =>
                  entry.label.trim().toLocaleLowerCase('fr-FR') ===
                  trimmedLabel.toLocaleLowerCase('fr-FR')
              )
            : undefined
          const existingEntry = existingEntryById ?? existingRequiredEntryByLabel
          const isRequiredReference =
            isDossierRequiredReferenceLabel(trimmedLabel) ||
            (existingEntry ? isDossierRequiredReferenceLabel(existingEntry.label) : false)

          if (
            !existingEntry &&
            isDossierRequiredReferenceLabel(trimmedLabel) &&
            metadata.keyReferences.some(
              (entry) =>
                entry.label.trim().toLocaleLowerCase('fr-FR') ===
                trimmedLabel.toLocaleLowerCase('fr-FR')
            )
          ) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'This required dossier reference already exists.'
            )
          }

          if (
            existingEntry &&
            isDossierRequiredReferenceLabel(existingEntry.label) &&
            !isRequiredReference
          ) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'A required dossier reference label cannot be changed.'
            )
          }

          const resolvedLabel = isRequiredReference
            ? existingEntry?.label && isDossierRequiredReferenceLabel(existingEntry.label)
              ? existingEntry.label
              : trimmedLabel
            : trimmedLabel
          const fallbackName = basename(metadata.slug)
          const resolvedValue = isDossierNameReferenceLabel(resolvedLabel)
            ? trimmedValue || fallbackName
            : trimmedValue

          if (!resolvedValue && !isRequiredReference) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'A key reference value is required.'
            )
          }

          const nextEntry = keyReferenceSchema.parse({
            uuid: existingEntry?.uuid ?? randomUUID(),
            dossierId: input.dossierId,
            label: resolvedLabel,
            value: resolvedValue,
            note: normalizeOptionalText(input.note) ?? existingEntry?.note
          })

          return syncDossierFieldsFromRequiredReferences({
            ...metadata,
            keyReferences: upsertByUuid(metadata.keyReferences, nextEntry)
          })
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    upsertFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const nowIso = now().toISOString()
          const existing = input.uuid
            ? metadata.feeAgreements.find((entry) => entry.uuid === input.uuid)
            : undefined

          if (input.uuid && !existing) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This fee agreement was not found.'
            )
          }

          const shouldBeActive = input.setActive ?? (existing ? existing.isActive : true)

          const nextEntry: DossierFeeAgreement = feeAgreementSchema.parse({
            uuid: existing?.uuid ?? randomUUID(),
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
            sourceServicePresetUuid: normalizeOptionalText(input.sourceServicePresetUuid),
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
            notes: normalizeOptionalText(input.notes),
            legalAidMode: input.legalAidMode,
            legalAidType: input.legalAidMode ? input.legalAidType : undefined,
            legalAidShareBasisPoints: input.legalAidMode
              ? input.legalAidShareBasisPoints
              : undefined,
            stateRetributionHtCents: input.legalAidMode ? input.stateRetributionHtCents : undefined,
            complementHtCents:
              input.legalAidMode && input.legalAidType === 'partial'
                ? input.complementHtCents
                : undefined,
            complementCapHtCents: input.legalAidMode ? input.complementCapHtCents : undefined,
            legalAidVatExempt: input.legalAidMode ? input.legalAidVatExempt : undefined
          })

          let feeAgreements = upsertByUuid(metadata.feeAgreements, nextEntry)
          if (nextEntry.isActive) {
            feeAgreements = feeAgreements.map((entry) =>
              entry.uuid === nextEntry.uuid
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
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    deleteFeeAgreement: async (input): Promise<DossierDetail> => {
      const { dossierPath } = await loadRegisteredMetadata(input.dossierId)
      const billingItems = await loadBillingItems(dossierPath)

      const linkedBillingItems = billingItems.filter(
        (item) => item.sourceFeeAgreementUuid === input.feeAgreementUuid
      )
      if (linkedBillingItems.length > 0) {
        throw new DossierRegistryError(
          IpcErrorCode.INTEGRITY_CONFLICT,
          `Cannot delete fee agreement: ${linkedBillingItems.length} billing item(s) still reference it. Archive the fee agreement or remove the billing items first.`
        )
      }

      const { metadata: saved } = await mutateDossierMeta(input.dossierId, (metadata) => {
        if (!metadata.feeAgreements.some((entry) => entry.uuid === input.feeAgreementUuid)) {
          throw new DossierRegistryError(
            IpcErrorCode.NOT_FOUND,
            'This fee agreement was not found.'
          )
        }
        return {
          ...metadata,
          feeAgreements: metadata.feeAgreements.filter(
            (entry) => entry.uuid !== input.feeAgreementUuid
          )
        }
      })
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    archiveFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.feeAgreements.find(
            (entry) => entry.uuid === input.feeAgreementUuid
          )
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
              entry.uuid === input.feeAgreementUuid
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
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    setActiveFeeAgreement: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.feeAgreements.find(
            (entry) => entry.uuid === input.feeAgreementUuid
          )
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
              if (entry.uuid === input.feeAgreementUuid) {
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
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    upsertBillingItem: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const existing = input.uuid
        ? billingItems.find((entry) => entry.uuid === input.uuid)
        : undefined

      if (input.uuid && !existing) {
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
        uuid: existing?.uuid ?? randomUUID(),
        dossierId: input.dossierId,
        date: input.date,
        label: input.label.trim(),
        description: normalizeOptionalText(input.description),
        sourceServicePresetUuid: normalizeOptionalText(input.sourceServicePresetUuid),
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
        sourceKeyDateUuid: normalizeOptionalText(input.sourceKeyDateUuid),
        sourceFeeAgreementUuid: normalizeOptionalText(input.sourceFeeAgreementUuid),
        sourceFeeAgreementBillingKind: input.sourceFeeAgreementBillingKind,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso
      })

      await saveBillingItem(dossierPath, nextEntry)

      const allBillingItems = upsertByUuid(billingItems, nextEntry)
      const updatedMetadata: DossierMetadataFile = {
        ...metadata,
        updatedAt: nowIso
      }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, allBillingItems, keyDates)
    },

    deleteBillingItem: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const existing = billingItems.find((entry) => entry.uuid === input.billingItemUuid)
      if (!existing) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This billing item was not found.')
      }
      if (existing.status === 'billed') {
        throw new DossierRegistryError(
          IpcErrorCode.VALIDATION_FAILED,
          'This billing item is already invoiced and cannot be deleted. Create a credit note or corrective invoice instead.'
        )
      }

      await deleteBillingItemFile(dossierPath, input.billingItemUuid)

      const remainingItems = billingItems.filter((entry) => entry.uuid !== input.billingItemUuid)
      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, remainingItems, keyDates)
    },

    markBillingItemsInvoiced: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const targetIds = new Set(input.billingItemUuids)
      const missing = input.billingItemUuids.filter(
        (id) => !billingItems.some((entry) => entry.uuid === id)
      )
      if (missing.length > 0) {
        throw new DossierRegistryError(
          IpcErrorCode.NOT_FOUND,
          `Some billing items were not found: ${missing.join(', ')}`
        )
      }

      const updatedItems = await Promise.all(
        billingItems.map(async (entry) => {
          if (!targetIds.has(entry.uuid)) return entry
          const updated: DossierBillingItem = {
            ...entry,
            status: 'billed' as const,
            invoiceUuid: input.invoiceUuid,
            invoiceNumber: input.invoiceNumber,
            updatedAt: nowIso
          }
          await saveBillingItem(dossierPath, updated)
          return updated
        })
      )

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, updatedItems, keyDates)
    },

    unmarkBillingItemsInvoiced: async (input): Promise<DossierDetail> => {
      const { dossierPath, metadata } = await loadRegisteredMetadata(input.dossierId)
      const nowIso = now().toISOString()

      const billingItems = await loadBillingItems(dossierPath)
      const updatedItems = await Promise.all(
        billingItems.map(async (entry) => {
          if (entry.invoiceUuid !== input.invoiceUuid) return entry
          const updated: DossierBillingItem = {
            ...entry,
            status: 'draft' as const,
            invoiceUuid: undefined,
            invoiceNumber: undefined,
            updatedAt: nowIso
          }
          await saveBillingItem(dossierPath, updated)
          return updated
        })
      )

      const updatedMetadata: DossierMetadataFile = { ...metadata, updatedAt: nowIso }
      const saved = await saveMetadata(dossierPath, updatedMetadata)
      const keyDates = await loadKeyDates(dossierPath)
      return detailWithNotes(dossierPath, saved, updatedItems, keyDates)
    },

    deleteKeyReference: async (input): Promise<DossierDetail> => {
      const { metadata: saved, dossierPath } = await mutateDossierMeta(
        input.dossierId,
        (metadata) => {
          const target = metadata.keyReferences.find(
            (entry) => entry.uuid === input.keyReferenceUuid
          )
          if (!target) {
            throw new DossierRegistryError(
              IpcErrorCode.NOT_FOUND,
              'This key reference was not found.'
            )
          }

          if (isDossierRequiredReferenceLabel(target.label)) {
            throw new DossierRegistryError(
              IpcErrorCode.VALIDATION_FAILED,
              'Required dossier references cannot be deleted.'
            )
          }

          return {
            ...metadata,
            keyReferences: metadata.keyReferences.filter(
              (entry) => entry.uuid !== input.keyReferenceUuid
            )
          }
        }
      )
      const [billingItems, keyDates] = await Promise.all([
        loadBillingItems(dossierPath),
        loadKeyDates(dossierPath)
      ])
      return detailWithNotes(dossierPath, saved, billingItems, keyDates)
    },

    unregisterDossier: async (input): Promise<null> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      if (!domainPath) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
      }

      const dossierId = validateDirectChildId(input.slug)
      const dossierPath = join(domainPath, dossierId)
      const registry = await loadRegistry(domainPath)
      const existingEntry = registry.dossiers.find((entry) => entry.slug === dossierId)

      if (!existingEntry) {
        throw new DossierRegistryError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const nextRegistry: DossierRegistryFile = {
        dossiers: registry.dossiers.filter((entry) => entry.slug !== dossierId)
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
