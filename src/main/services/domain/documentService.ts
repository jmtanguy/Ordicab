import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

import type {
  DocumentExtractedContent,
  DocumentFileDeleteInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderRenameInput,
  DocumentMetadataUpdate,
  DocumentTextExtractionStatus,
  DocumentPreview,
  EmailDocumentPreview,
  ImageDocumentPreview,
  DocumentPreviewInput,
  DocumentPreviewSourceType,
  DocumentRecord,
  DossierScopedQuery,
  SemanticSearchQuery,
  SemanticSearchResult
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import {
  dossierMetadataFileSchema,
  dossierScopedQuerySchema,
  documentFileDeleteInputSchema,
  documentFileRenameInputSchema,
  documentFolderCreateInputSchema,
  documentFolderDeleteInputSchema,
  documentFolderRenameInputSchema,
  documentRelocationInputSchema,
  documentMetadataUpdateSchema,
  type DossierMetadataFile,
  type DocumentRelocationInput,
  type StoredDocumentMetadata,
  storedDocumentMetadataSchema
} from '@shared/validation'

import {
  getDomainRegistryPath,
  getDossierMetadataPath,
  ORDICAB_DIRECTORY_NAME
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadDomainState, pathExists } from '../../lib/system/domainState'
import {
  extractDocumentText,
  ensurePlainTextDocumentCache,
  getDocumentContentCachePath,
  isDocumentTextExtractable,
  isPlainTextDocument,
  markDocumentExtractionEmpty,
  readCachedDocumentText,
  type ExtractProgressCallback
} from '../../lib/aiEmbedded/documentContentService'
import { getDossierContentCachePath } from '../../lib/ordicab/ordicabPaths'
import {
  computeFileSha256,
  writeIndexedHashToCache
} from '../../lib/aiEmbedded/embeddings/contentHashStore'
import { indexDocumentEmbeddings } from '../../lib/aiEmbedded/embeddings/embeddingIndexer'
import {
  searchDossier,
  type IndexedDocument
} from '../../lib/aiEmbedded/embeddings/semanticSearchService'
import {
  DEFAULT_EMBEDDING_DIM,
  type EmbeddingServiceConfig
} from '../../lib/aiEmbedded/embeddings/embeddingService'

interface DossierRegistryEntry {
  id: string
  uuid?: string
  name: string
  registeredAt: string
}

interface DossierRegistryFile {
  dossiers: DossierRegistryEntry[]
}

export interface DocumentServiceOptions {
  stateFilePath: string
  tessDataPath?: string
  previewLoaders?: Partial<DocumentPreviewLoaders>
  /** Embedding-model configuration used for both post-extraction indexing and query-time search. */
  embeddingConfig?: EmbeddingServiceConfig
  /**
   * Optional embedder for semantic search. Defaults to the in-process embeddingService.
   * Pass the worker-thread client to keep ONNX off the Electron main thread.
   */
  embedder?: (texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>
}

export interface DocumentService {
  listDocuments: (input: DossierScopedQuery) => Promise<DocumentRecord[]>
  listFolders: (input: DossierScopedQuery) => Promise<string[]>
  getPreview: (input: DocumentPreviewInput) => Promise<DocumentPreview>
  getContentStatus: (input: DocumentPreviewInput) => Promise<DocumentTextExtractionStatus>
  extractContent: (
    input: DocumentPreviewInput,
    onProgress?: ExtractProgressCallback
  ) => Promise<DocumentExtractedContent>
  clearContentCache: (input: DossierScopedQuery) => Promise<void>
  saveMetadata: (input: DocumentMetadataUpdate) => Promise<DocumentRecord>
  relocateMetadata: (input: DocumentRelocationInput) => Promise<DocumentRecord>
  resolveRegisteredDossierRoot: (input: DossierScopedQuery) => Promise<string>
  semanticSearch: (input: SemanticSearchQuery) => Promise<SemanticSearchResult>
  createFolder: (input: DocumentFolderCreateInput) => Promise<string>
  renameFolder: (input: DocumentFolderRenameInput) => Promise<string>
  deleteFolder: (input: DocumentFolderDeleteInput) => Promise<void>
  renameFile: (input: DocumentFileRenameInput) => Promise<DocumentRecord>
  deleteFile: (input: DocumentFileDeleteInput) => Promise<void>
}

interface DocumentFileSnapshot {
  relativePath: string
  filename: string
  byteLength: number
  modifiedAt: string
}

interface DocumentPreviewLoaders {
  extractLegacyDocText: (buffer: Buffer) => Promise<string>
  parseMimeEmail: (buffer: Buffer) => Promise<ParsedEmailPreview>
  parseOutlookMessage: (buffer: Buffer) => Promise<ParsedEmailPreview>
  maxPreviewBytes: number
}

interface ParsedEmailPreview {
  subject: string | null
  from: string | null
  to: string | null
  cc: string | null
  date: string | null
  attachments: string[]
  text: string
}

type ImagePreviewSourceType = ImageDocumentPreview['sourceType']
type OutlookMessageShape = {
  getFileData(): {
    subject?: string
    senderEmail?: string
    senderName?: string
    body?: string
    messageDeliveryTime?: string
    clientSubmitTime?: string
    recipients?: Array<{ recipType?: string; email?: string; name?: string }>
    attachments?: Array<{ fileName?: string; name?: string }>
  }
}
type MsgReaderConstructor = new (arrayBuffer: ArrayBuffer | DataView) => OutlookMessageShape

export class DocumentServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DocumentServiceError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join('/')
}

function validateDossierId(id: string): string {
  const normalized = id.trim()

  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized === ORDICAB_DIRECTORY_NAME ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.startsWith('.')
  ) {
    throw new DocumentServiceError(
      IpcErrorCode.INVALID_INPUT,
      'Dossier registration is limited to direct subfolders of the active domain.'
    )
  }

  return normalized
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
            isRecord(entry) &&
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
      await atomicWrite(registryPath, `${JSON.stringify(normalizedRegistry, null, 2)}\n`)
      return normalizedRegistry
    }

    return { dossiers }
  } catch (error) {
    console.error('[DocumentService] Failed to load dossier registry:', registryPath, error)
    return { dossiers: [] }
  }
}

function resolveRegistryEntryByRef(
  registry: DossierRegistryFile,
  dossierRef: string
): DossierRegistryEntry | null {
  const normalizedRef = dossierRef.trim().toLowerCase()

  return (
    registry.dossiers.find((entry) => entry.id === dossierRef || entry.uuid === dossierRef) ??
    registry.dossiers.find(
      (entry) =>
        entry.id.toLowerCase() === normalizedRef || entry.uuid?.toLowerCase() === normalizedRef
    ) ??
    null
  )
}

function parseStoredDocumentMetadata(value: unknown): StoredDocumentMetadata[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    const parsed = storedDocumentMetadataSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

function normalizeStoredDocumentEntry(
  entry: StoredDocumentMetadata,
  relativePath: string,
  snapshot?: DocumentFileSnapshot
): StoredDocumentMetadata {
  return storedDocumentMetadataSchema.parse({
    uuid: entry.uuid ?? randomUUID(),
    relativePath,
    filename: snapshot?.filename ?? entry.filename,
    byteLength: snapshot?.byteLength ?? entry.byteLength,
    modifiedAt: snapshot?.modifiedAt ?? entry.modifiedAt,
    description: entry.description,
    tags: entry.tags
  })
}

async function createDocumentFileSnapshot(
  dossierPath: string,
  relativePath: string
): Promise<DocumentFileSnapshot> {
  const filePath = join(dossierPath, relativePath)
  const fileStats = await stat(filePath).catch(() => null)

  if (!fileStats?.isFile()) {
    throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The selected document was not found.')
  }

  return {
    relativePath,
    filename: basename(filePath),
    byteLength: fileStats.size,
    modifiedAt: fileStats.mtime.toISOString()
  }
}

function scoreRebindCandidate(
  entry: StoredDocumentMetadata,
  snapshot: DocumentFileSnapshot
): number {
  const filenameMatch = typeof entry.filename === 'string' && entry.filename === snapshot.filename
  const byteLengthMatch =
    typeof entry.byteLength === 'number' && entry.byteLength === snapshot.byteLength
  const modifiedAtMatch =
    typeof entry.modifiedAt === 'string' && entry.modifiedAt === snapshot.modifiedAt

  if (filenameMatch && byteLengthMatch && modifiedAtMatch) {
    return 4
  }

  if (byteLengthMatch && modifiedAtMatch) {
    return 3
  }

  if (filenameMatch && byteLengthMatch) {
    return 2
  }

  if (
    filenameMatch &&
    typeof entry.byteLength !== 'number' &&
    typeof entry.modifiedAt !== 'string'
  ) {
    return 1
  }

  return 0
}

function resolveReboundDocumentEntries(
  storedEntries: Iterable<StoredDocumentMetadata>,
  currentFiles: DocumentFileSnapshot[]
): Map<string, StoredDocumentMetadata> {
  const storedEntriesList = [...storedEntries]
  const filesByRelativePath = new Set(currentFiles.map((file) => file.relativePath))
  const unmatchedEntries = storedEntriesList.filter(
    (entry) => !filesByRelativePath.has(entry.relativePath)
  )
  const unmatchedFiles = currentFiles.filter(
    (file) => !storedEntriesList.some((entry) => entry.relativePath === file.relativePath)
  )
  const candidateByEntry = new Map<string, { file: DocumentFileSnapshot; score: number } | null>()
  const candidateByFile = new Map<string, { entry: StoredDocumentMetadata; score: number } | null>()

  for (const entry of unmatchedEntries) {
    const scored = unmatchedFiles
      .map((file) => ({ file, score: scoreRebindCandidate(entry, file) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
    const best = scored[0] ?? null

    candidateByEntry.set(
      entry.uuid ?? entry.relativePath,
      best && scored[1]?.score !== best.score ? best : scored.length === 1 ? best : null
    )
  }

  for (const file of unmatchedFiles) {
    const scored = unmatchedEntries
      .map((entry) => ({ entry, score: scoreRebindCandidate(entry, file) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
    const best = scored[0] ?? null

    candidateByFile.set(
      file.relativePath,
      best && scored[1]?.score !== best.score ? best : scored.length === 1 ? best : null
    )
  }

  const reboundEntries = new Map<string, StoredDocumentMetadata>()

  for (const entry of unmatchedEntries) {
    const entryKey = entry.uuid ?? entry.relativePath
    const bestForEntry = candidateByEntry.get(entryKey)

    if (!bestForEntry) {
      continue
    }

    const bestForFile = candidateByFile.get(bestForEntry.file.relativePath)

    if (!bestForFile || (bestForFile.entry.uuid ?? bestForFile.entry.relativePath) !== entryKey) {
      continue
    }

    reboundEntries.set(
      bestForEntry.file.relativePath,
      normalizeStoredDocumentEntry(entry, bestForEntry.file.relativePath, bestForEntry.file)
    )
  }

  return reboundEntries
}

function createDefaultDossierMetadata(entry: DossierRegistryEntry): DossierMetadataFile {
  return dossierMetadataFileSchema.parse({
    id: entry.id,
    uuid: entry.uuid ?? randomUUID(),
    name: entry.name,
    registeredAt: entry.registeredAt,
    status: 'active',
    type: '',
    updatedAt: entry.registeredAt,
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    keyDates: [],
    keyReferences: [],
    documents: []
  })
}

type ReadDossierMetadataResult =
  | { ok: true; metadata: DossierMetadataFile }
  | { ok: false; reason: 'no-metadata' | 'unreadable-metadata' | 'invalid-metadata' }

async function readDossierMetadataFile(dossierPath: string): Promise<ReadDossierMetadataResult> {
  const metadataPath = getDossierMetadataPath(dossierPath)
  if (!(await pathExists(metadataPath))) {
    return { ok: false, reason: 'no-metadata' }
  }

  try {
    const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown
    const result = dossierMetadataFileSchema.safeParse(parsed)
    return result.success
      ? { ok: true, metadata: result.data }
      : { ok: false, reason: 'invalid-metadata' }
  } catch (error) {
    console.warn(
      `[DocumentService] could not read dossier metadata at ${metadataPath}:`,
      error instanceof Error ? error.message : error
    )
    return { ok: false, reason: 'unreadable-metadata' }
  }
}

async function writeDossierMetadataFile(
  dossierPath: string,
  metadata: DossierMetadataFile
): Promise<void> {
  const metadataPath = getDossierMetadataPath(dossierPath)
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
}

/**
 * Strict read-or-init: returns the parsed metadata, creates a default when the
 * file is missing, and throws when it exists but is unreadable or invalid.
 * Callers on the write path use this to avoid silently clobbering corrupt data.
 */
async function loadOrInitDossierMetadata(
  dossierPath: string,
  registryEntry: DossierRegistryEntry
): Promise<DossierMetadataFile> {
  const result = await readDossierMetadataFile(dossierPath)
  if (result.ok) return result.metadata
  if (result.reason === 'no-metadata') return createDefaultDossierMetadata(registryEntry)
  throw new DocumentServiceError(
    IpcErrorCode.FILE_SYSTEM_ERROR,
    'Dossier metadata is missing or invalid.'
  )
}

// Per-dossier mutex for metadata read-modify-write sections. Multiple code
// paths (listDocuments, saveMetadata, relocateMetadata) all rewrite the same
// metadata JSON; without this serialization two parallel writers can each read
// a stale copy and the slower one's commit erases the faster one's changes —
// the classic last-writer-wins corruption.
const dossierMetadataLocks = new Map<string, Promise<unknown>>()

function withDossierMetadataLock<T>(dossierPath: string, operation: () => Promise<T>): Promise<T> {
  // Queue behind whatever is currently holding the lock. We gate on a
  // .catch-wrapped copy so a thrown error in one holder doesn't break the
  // chain for everyone queued after it.
  const previous = dossierMetadataLocks.get(dossierPath) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(operation)
  const tail = run.catch(() => undefined)
  dossierMetadataLocks.set(dossierPath, tail)
  void tail.then(() => {
    if (dossierMetadataLocks.get(dossierPath) === tail) {
      dossierMetadataLocks.delete(dossierPath)
    }
  })
  return run
}

async function getSearchCachePath(filePath: string, cacheDir: string): Promise<string> {
  return isPlainTextDocument(filePath)
    ? ensurePlainTextDocumentCache(filePath, cacheDir)
    : getDocumentContentCachePath(cacheDir, filePath)
}

async function indexSearchableDocument(args: {
  filePath: string
  cacheDir: string
  relativePath: string
  embeddingConfig?: EmbeddingServiceConfig
  embedder?: (texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>
}): Promise<void> {
  const cachePath = await getSearchCachePath(args.filePath, args.cacheDir)
  const outcome = await indexDocumentEmbeddings(cachePath, {
    embeddingConfig: args.embeddingConfig,
    embedder: args.embedder,
    dim: DEFAULT_EMBEDDING_DIM
  })

  if (outcome.status === 'skipped') {
    console.debug(
      `[DocumentService] embeddings skipped for ${args.relativePath}: ${outcome.reason}`
    )
  }
}

async function loadStoredDocumentMetadata(
  dossierPath: string
): Promise<Map<string, StoredDocumentMetadata>> {
  const metadataPath = getDossierMetadataPath(dossierPath)

  if (!(await pathExists(metadataPath))) {
    return new Map()
  }

  try {
    const parsed = JSON.parse(await readFile(metadataPath, 'utf8')) as Record<string, unknown>
    const entries = parseStoredDocumentMetadata(parsed.documents).map((entry) =>
      normalizeStoredDocumentEntry(entry, entry.relativePath)
    )
    return new Map(entries.map((entry) => [entry.relativePath, entry]))
  } catch (error) {
    console.error('[DocumentService] Failed to load stored document metadata:', metadataPath, error)
    return new Map()
  }
}

function validateDocumentRelativePath(documentId: string): string {
  const normalized = normalizeRelativePath(documentId)

  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new DocumentServiceError(IpcErrorCode.INVALID_INPUT, 'Invalid document identifier.')
  }

  return normalized
}

async function getDocumentExtractionStatus(
  dossierPath: string,
  relativePath: string
): Promise<DocumentTextExtractionStatus> {
  const filePath = join(dossierPath, relativePath)
  if (!isDocumentTextExtractable(filePath)) {
    return { state: 'not-extractable', isExtractable: false }
  }

  if (isPlainTextDocument(filePath)) {
    return { state: 'extracted', isExtractable: true }
  }

  const cacheDir = getDossierContentCachePath(dossierPath)
  const cachePath = getDocumentContentCachePath(cacheDir, filePath)
  const isExtracted = await pathExists(cachePath)

  return {
    state: isExtracted ? 'extracted' : 'extractable',
    isExtractable: true
  }
}

async function buildDocumentRecord(options: {
  dossierId: string
  dossierPath: string
  relativePath: string
  metadata?: StoredDocumentMetadata
}): Promise<DocumentRecord> {
  const filePath = join(options.dossierPath, options.relativePath)
  const fileStats = await stat(filePath).catch(() => null)

  if (!fileStats?.isFile()) {
    throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The selected document was not found.')
  }

  return {
    id: options.relativePath,
    uuid: options.metadata?.uuid,
    dossierId: options.dossierId,
    filename: basename(filePath),
    byteLength: fileStats.size,
    relativePath: options.relativePath,
    modifiedAt: fileStats.mtime.toISOString(),
    description: options.metadata?.description,
    tags: options.metadata?.tags ?? [],
    textExtraction: await getDocumentExtractionStatus(options.dossierPath, options.relativePath)
  }
}

const STAT_CONCURRENCY_LIMIT = 64
const DEFAULT_MAX_PREVIEW_BYTES = 10 * 1024 * 1024

function getPreviewSourceType(documentPath: string): DocumentPreviewSourceType {
  switch (extname(documentPath).toLowerCase()) {
    case '.pdf':
      return 'pdf'
    case '.docx':
      return 'docx'
    case '.doc':
      return 'doc'
    case '.txt':
      return 'txt'
    case '.eml':
      return 'eml'
    case '.msg':
      return 'msg'
    case '.png':
      return 'png'
    case '.jpg':
      return 'jpg'
    case '.jpeg':
      return 'jpeg'
    case '.gif':
      return 'gif'
    case '.webp':
      return 'webp'
    case '.bmp':
      return 'bmp'
    case '.tif':
      return 'tif'
    case '.tiff':
      return 'tiff'
    default:
      return 'unknown'
  }
}

function getPreviewMimeType(sourceType: DocumentPreviewSourceType): string | null {
  switch (sourceType) {
    case 'pdf':
      return 'application/pdf'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'txt':
      return 'text/plain'
    case 'eml':
      return 'message/rfc822'
    case 'msg':
      return 'application/vnd.ms-outlook'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

function getImagePreviewMimeType(
  sourceType: ImagePreviewSourceType
): ImageDocumentPreview['mimeType'] {
  switch (sourceType) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

async function defaultExtractLegacyDocText(buffer: Buffer): Promise<string> {
  const wordExtractorModule = await import('word-extractor')
  const WordExtractor =
    'default' in wordExtractorModule ? wordExtractorModule.default : wordExtractorModule
  const extractor = new WordExtractor()
  const document = await extractor.extract(buffer)
  return document.getBody().trim()
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\r\n/g, '\n').trim()
  return normalized ? normalized : null
}

function normalizePreviewText(value: string | null | undefined): string {
  return value?.replace(/\r\n/g, '\n').trim() ?? ''
}

function normalizePreviewDate(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null
  }

  const asDate = value instanceof Date ? value : new Date(value)

  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString()
  }

  const normalized = String(value).trim()
  return normalized ? normalized : null
}

async function defaultParseMimeEmail(buffer: Buffer): Promise<ParsedEmailPreview> {
  const { simpleParser } = await import('mailparser')
  const parsed = await simpleParser(buffer)

  return {
    subject: normalizeOptionalText(parsed.subject),
    from: normalizeOptionalText(parsed.from?.text),
    to: normalizeOptionalText(parsed.to?.text),
    cc: normalizeOptionalText(parsed.cc?.text),
    date: normalizePreviewDate(parsed.date),
    attachments:
      parsed.attachments
        ?.map((attachment) => normalizeOptionalText(attachment.filename))
        .filter((value): value is string => value !== null) ?? [],
    text: normalizePreviewText(parsed.text)
  }
}

function resolveMsgReaderConstructor(moduleValue: unknown): MsgReaderConstructor {
  let current: unknown = moduleValue

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current === 'function') {
      return current as MsgReaderConstructor
    }

    if (current && typeof current === 'object' && 'default' in current) {
      current = (current as { default: unknown }).default
      continue
    }

    break
  }

  throw new DocumentServiceError(
    IpcErrorCode.FILE_SYSTEM_ERROR,
    'MsgReader constructor could not be resolved.'
  )
}

async function defaultParseOutlookMessage(buffer: Buffer): Promise<ParsedEmailPreview> {
  const msgReaderModule = await import('@kenjiuno/msgreader')
  const MsgReader = resolveMsgReaderConstructor(msgReaderModule)
  const reader = new MsgReader(toArrayBuffer(buffer))
  const parsed = reader.getFileData()
  const recipients = parsed.recipients ?? []
  const to = recipients
    .filter((recipient) => recipient.recipType === 'to')
    .map((recipient) => normalizeOptionalText(recipient.email ?? recipient.name))
    .filter((value): value is string => value !== null)
    .join(', ')
  const cc = recipients
    .filter((recipient) => recipient.recipType === 'cc')
    .map((recipient) => normalizeOptionalText(recipient.email ?? recipient.name))
    .filter((value): value is string => value !== null)
    .join(', ')

  return {
    subject: normalizeOptionalText(parsed.subject),
    from: normalizeOptionalText(parsed.senderEmail ?? parsed.senderName),
    to: normalizeOptionalText(to),
    cc: normalizeOptionalText(cc),
    date: normalizePreviewDate(parsed.messageDeliveryTime ?? parsed.clientSubmitTime),
    attachments:
      parsed.attachments
        ?.map((attachment) => normalizeOptionalText(attachment.fileName ?? attachment.name))
        .filter((value): value is string => value !== null) ?? [],
    text: normalizePreviewText(parsed.body)
  }
}

function buildEmailPreview(options: {
  documentId: string
  filename: string
  byteLength: number
  sourceType: EmailDocumentPreview['sourceType']
  mimeType: EmailDocumentPreview['mimeType']
  parsed: ParsedEmailPreview
}): EmailDocumentPreview {
  return {
    kind: 'email',
    documentId: options.documentId,
    filename: options.filename,
    byteLength: options.byteLength,
    sourceType: options.sourceType,
    mimeType: options.mimeType,
    subject: options.parsed.subject,
    from: options.parsed.from,
    to: options.parsed.to,
    cc: options.parsed.cc,
    date: options.parsed.date,
    attachments: options.parsed.attachments,
    text: options.parsed.text
  }
}

function buildUnsupportedPreview(options: {
  documentId: string
  filename: string
  byteLength: number
  sourceType: DocumentPreviewSourceType
  reason: 'unsupported-type' | 'file-too-large'
}): DocumentPreview {
  return {
    kind: 'unsupported',
    documentId: options.documentId,
    filename: options.filename,
    byteLength: options.byteLength,
    sourceType: options.sourceType,
    mimeType: getPreviewMimeType(options.sourceType),
    reason: options.reason,
    message:
      options.reason === 'file-too-large'
        ? 'This document is larger than the 10MB in-app preview limit.'
        : 'This document format cannot be previewed in Ordicab yet.'
  }
}

async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = []
  let index = 0

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const taskIndex = index++
      results[taskIndex] = await tasks[taskIndex]!()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

async function collectFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootPath, entry.name)

      if (entry.name.startsWith('.') || entry.name.startsWith('~$') || entry.name === 'CLAUDE.md') {
        return []
      }

      if (entry.isDirectory()) {
        return collectFiles(entryPath)
      }

      if (!entry.isFile()) {
        return []
      }

      return [entryPath]
    })
  )

  return files.flat()
}

async function collectDirectories(rootPath: string): Promise<string[]> {
  const directories: string[] = []

  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const entryPath = join(current, entry.name)
      directories.push(entryPath)
      await walk(entryPath)
    }
  }

  await walk(rootPath)
  return directories
}

function resolveSafePathInDossier(dossierPath: string, relativePath: string): string {
  const target = resolve(join(dossierPath, relativePath))
  const root = resolve(dossierPath)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new DocumentServiceError(IpcErrorCode.INVALID_INPUT, 'Path escapes the dossier root.')
  }
  return target
}

async function resolveActiveDomainPath(stateFilePath: string): Promise<string> {
  const state = await loadDomainState(stateFilePath)
  const selectedDomainPath = state?.selectedDomainPath ?? null

  if (!selectedDomainPath || !(await pathExists(selectedDomainPath))) {
    throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
  }

  return selectedDomainPath
}

export function createDocumentService(options: DocumentServiceOptions): DocumentService {
  const previewLoaders: DocumentPreviewLoaders = {
    extractLegacyDocText:
      options.previewLoaders?.extractLegacyDocText ?? defaultExtractLegacyDocText,
    parseMimeEmail: options.previewLoaders?.parseMimeEmail ?? defaultParseMimeEmail,
    parseOutlookMessage: options.previewLoaders?.parseOutlookMessage ?? defaultParseOutlookMessage,
    maxPreviewBytes: options.previewLoaders?.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW_BYTES
  }

  const resolveRegisteredDossierRoot = async (input: DossierScopedQuery): Promise<string> => {
    const domainPath = await resolveActiveDomainPath(options.stateFilePath)
    const dossierRef = validateDossierId(input.dossierId)
    const registry = await loadRegistry(domainPath)
    const registryEntry = resolveRegistryEntryByRef(registry, dossierRef)

    if (!registryEntry) {
      throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
    }

    return join(domainPath, registryEntry.id)
  }

  return {
    resolveRegisteredDossierRoot,

    listDocuments: async (input): Promise<DocumentRecord[]> => {
      const dossierPath = await resolveRegisteredDossierRoot(input)
      const dossierStats = await stat(dossierPath).catch(() => null)

      if (!dossierStats?.isDirectory()) {
        throw new DocumentServiceError(
          IpcErrorCode.NOT_FOUND,
          'Selected dossier folder was not found.'
        )
      }

      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, input.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      // Walk the filesystem before acquiring the metadata lock — directory
      // traversal + stats can be slow and has no interaction with metadata.
      const filePaths = await collectFiles(dossierPath)
      const fileSnapshots = await withConcurrencyLimit(
        filePaths.map((filePath) => async () => {
          const fileStats = await stat(filePath)
          const relativePath = normalizeRelativePath(relative(dossierPath, filePath))

          return {
            relativePath,
            filename: basename(filePath),
            byteLength: fileStats.size,
            modifiedAt: fileStats.mtime.toISOString()
          } satisfies DocumentFileSnapshot
        }),
        STAT_CONCURRENCY_LIMIT
      )

      // Read-modify-write under the per-dossier lock so concurrent writers
      // (saveMetadata, another listDocuments) can't clobber each other's
      // updates between our read and our write.
      return withDossierMetadataLock(dossierPath, async () => {
        const metadataByRelativePath = await loadStoredDocumentMetadata(dossierPath)
        const reboundEntries = resolveReboundDocumentEntries(
          metadataByRelativePath.values(),
          fileSnapshots
        )
        const normalizedEntries: StoredDocumentMetadata[] = []
        const documents = await Promise.all(
          fileSnapshots.map(async (snapshot) => {
            const storedMetadata =
              metadataByRelativePath.get(snapshot.relativePath) ??
              reboundEntries.get(snapshot.relativePath)
            const normalizedMetadata = normalizeStoredDocumentEntry(
              storedMetadata ??
                storedDocumentMetadataSchema.parse({
                  uuid: randomUUID(),
                  relativePath: snapshot.relativePath,
                  filename: snapshot.filename,
                  byteLength: snapshot.byteLength,
                  modifiedAt: snapshot.modifiedAt,
                  description: undefined,
                  tags: []
                }),
              snapshot.relativePath,
              snapshot
            )
            normalizedEntries.push(normalizedMetadata)

            return {
              id: snapshot.relativePath,
              uuid: normalizedMetadata.uuid,
              dossierId: registryEntry.id,
              filename: snapshot.filename,
              byteLength: snapshot.byteLength,
              relativePath: snapshot.relativePath,
              modifiedAt: snapshot.modifiedAt,
              description: normalizedMetadata.description,
              tags: normalizedMetadata.tags ?? [],
              textExtraction: await getDocumentExtractionStatus(dossierPath, snapshot.relativePath)
            } satisfies DocumentRecord
          })
        )

        const nextDocuments = normalizedEntries.sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )
        const currentEntries = [...metadataByRelativePath.values()].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )

        if (JSON.stringify(nextDocuments) !== JSON.stringify(currentEntries)) {
          const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
          const nextMetadata = dossierMetadataFileSchema.parse({
            ...currentMetadata,
            documents: nextDocuments
          })
          await writeDossierMetadataFile(dossierPath, nextMetadata)
        }

        return documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      })
    },

    getPreview: async (input): Promise<DocumentPreview> => {
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: input.dossierId })
      const relativePath = validateDocumentRelativePath(input.documentId)
      const filePath = join(dossierPath, relativePath)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile()) {
        throw new DocumentServiceError(
          IpcErrorCode.NOT_FOUND,
          'The selected document was not found.'
        )
      }

      const sourceType = getPreviewSourceType(relativePath)
      const filename = basename(filePath)

      if (fileStats.size > previewLoaders.maxPreviewBytes) {
        return buildUnsupportedPreview({
          documentId: relativePath,
          filename,
          byteLength: fileStats.size,
          sourceType,
          reason: 'file-too-large'
        })
      }

      switch (sourceType) {
        case 'pdf': {
          const buffer = await readFile(filePath)
          return {
            kind: 'pdf',
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: 'application/pdf',
            data: toArrayBuffer(buffer)
          }
        }

        case 'txt': {
          const text = await readFile(filePath, 'utf8')
          return {
            kind: 'text',
            documentId: relativePath,
            filename,
            byteLength: fileStats.size,
            sourceType,
            mimeType: 'text/plain',
            text
          }
        }

        case 'docx': {
          const buffer = await readFile(filePath)
          return {
            kind: 'docx',
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            data: toArrayBuffer(buffer)
          }
        }

        case 'doc': {
          const buffer = await readFile(filePath)
          const text = await previewLoaders.extractLegacyDocText(buffer)
          return {
            kind: 'text',
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: 'text/plain',
            text
          }
        }

        case 'eml': {
          const buffer = await readFile(filePath)
          const parsed = await previewLoaders.parseMimeEmail(buffer)
          return buildEmailPreview({
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: 'message/rfc822',
            parsed
          })
        }

        case 'msg': {
          const buffer = await readFile(filePath)
          const parsed = await previewLoaders.parseOutlookMessage(buffer)
          return buildEmailPreview({
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: 'application/vnd.ms-outlook',
            parsed
          })
        }

        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
        case 'bmp':
        case 'tif':
        case 'tiff': {
          const buffer = await readFile(filePath)
          return {
            kind: 'image',
            documentId: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: getImagePreviewMimeType(sourceType),
            data: toArrayBuffer(buffer)
          }
        }

        default:
          return buildUnsupportedPreview({
            documentId: relativePath,
            filename,
            byteLength: fileStats.size,
            sourceType,
            reason: 'unsupported-type'
          })
      }
    },

    getContentStatus: async (input): Promise<DocumentTextExtractionStatus> => {
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: input.dossierId })
      const relativePath = validateDocumentRelativePath(input.documentId)
      const filePath = join(dossierPath, relativePath)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile()) {
        throw new DocumentServiceError(
          IpcErrorCode.NOT_FOUND,
          'The selected document was not found.'
        )
      }

      return getDocumentExtractionStatus(dossierPath, relativePath)
    },

    extractContent: async (input, onProgress): Promise<DocumentExtractedContent> => {
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: input.dossierId })
      const relativePath = validateDocumentRelativePath(input.documentId)
      const filePath = join(dossierPath, relativePath)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile()) {
        throw new DocumentServiceError(
          IpcErrorCode.NOT_FOUND,
          'The selected document was not found.'
        )
      }

      if (!isDocumentTextExtractable(filePath)) {
        throw new DocumentServiceError(
          IpcErrorCode.INVALID_INPUT,
          'This document format does not support text extraction.'
        )
      }

      if (fileStats.size === 0) {
        const cacheDir = getDossierContentCachePath(dossierPath)
        await markDocumentExtractionEmpty(filePath, cacheDir)
        const status = await getDocumentExtractionStatus(dossierPath, relativePath)
        return {
          documentId: relativePath,
          filename: basename(filePath),
          text: '',
          textLength: 0,
          method: 'cached',
          status
        }
      }

      const cacheDir = getDossierContentCachePath(dossierPath)
      if (input.forceRefresh && !isPlainTextDocument(filePath)) {
        const cachePath = getDocumentContentCachePath(cacheDir, filePath)
        await rm(cachePath, { force: true })
      }
      let result: Awaited<ReturnType<typeof extractDocumentText>>
      let extractedHash: string | null = null

      try {
        if (input.readCacheOnly) {
          const cached = await readCachedDocumentText(filePath, cacheDir)
          if (!cached) {
            throw new DocumentServiceError(
              IpcErrorCode.NOT_FOUND,
              'The extracted text cache is not available.'
            )
          }
          result = cached
        } else {
          // Hash in parallel with extraction: cost is dominated by OCR/parsing
          // and the streamed sha256 over the same file pages doesn't compete
          // for CPU meaningfully. The hash is captured at extraction time so a
          // later edit will be detected as a mismatch by the indexing queue.
          const [hash, extractResult] = await Promise.all([
            computeFileSha256(filePath),
            extractDocumentText(filePath, cacheDir, options.tessDataPath, onProgress)
          ])
          extractedHash = hash
          result = extractResult
        }
      } catch (error) {
        if (error instanceof DocumentServiceError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        console.warn(
          `[DocumentService] Extraction failed for "${relativePath}", storing empty extracted content: ${message}`
        )
        await markDocumentExtractionEmpty(filePath, cacheDir)
        try {
          const failedHash = await computeFileSha256(filePath)
          const failedCachePath = await getSearchCachePath(filePath, cacheDir)
          await writeIndexedHashToCache(failedCachePath, failedHash, fileStats.size)
        } catch {
          // best-effort tag: the next file event will retry.
        }
        const status = await getDocumentExtractionStatus(dossierPath, relativePath)

        return {
          documentId: relativePath,
          filename: basename(filePath),
          text: '',
          textLength: 0,
          method: 'cached',
          status
        }
      }

      const status = await getDocumentExtractionStatus(dossierPath, relativePath)

      if (extractedHash !== null) {
        try {
          const cachePath = await getSearchCachePath(filePath, cacheDir)
          await writeIndexedHashToCache(cachePath, extractedHash, fileStats.size)
        } catch (error) {
          console.warn(
            `[DocumentService] hash tag failed for ${relativePath}:`,
            error instanceof Error ? error.message : error
          )
        }
      }

      // Post-extraction hook: trigger the embeddings indexing pass in the
      // background. Fire-and-forget — failures are logged inside the indexer
      // and the user-facing extract call must not wait on model inference.
      void indexSearchableDocument({
        filePath,
        cacheDir,
        relativePath,
        embeddingConfig: options.embeddingConfig,
        embedder: options.embedder
      }).catch((error) => {
        console.warn(
          `[DocumentService] embeddings failed for ${relativePath}:`,
          error instanceof Error ? error.message : error
        )
      })

      return {
        documentId: relativePath,
        filename: basename(filePath),
        text: result.text,
        textLength: result.text.length,
        method: result.method,
        status
      }
    },

    clearContentCache: async (input): Promise<void> => {
      const parsed = dossierScopedQuerySchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const cacheDir = getDossierContentCachePath(dossierPath)
      await rm(cacheDir, { recursive: true, force: true })
    },

    saveMetadata: async (input): Promise<DocumentRecord> => {
      const parsed = documentMetadataUpdateSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const canonicalDossierId = registryEntry.id
      const relativePath = validateDocumentRelativePath(parsed.documentId)
      const snapshot = await createDocumentFileSnapshot(dossierPath, relativePath)

      return withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const existingEntry = currentMetadata.documents.find(
          (entry) => entry.relativePath === relativePath
        )
        const nextEntry = storedDocumentMetadataSchema.parse({
          uuid: existingEntry?.uuid ?? randomUUID(),
          relativePath,
          filename: snapshot.filename,
          byteLength: snapshot.byteLength,
          modifiedAt: snapshot.modifiedAt,
          description: parsed.description,
          tags: parsed.tags
        })

        const documentsByRelativePath = new Map(
          currentMetadata.documents.map((entry) => [entry.relativePath, entry])
        )
        documentsByRelativePath.set(relativePath, nextEntry)

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: [...documentsByRelativePath.values()].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath)
          )
        })

        await writeDossierMetadataFile(dossierPath, nextMetadata)

        return buildDocumentRecord({
          dossierId: canonicalDossierId,
          dossierPath,
          relativePath,
          metadata: nextEntry
        })
      })
    },

    relocateMetadata: async (input): Promise<DocumentRecord> => {
      const parsed = documentRelocationInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const canonicalDossierId = registryEntry.id
      const targetRelativePath = validateDocumentRelativePath(parsed.toDocumentId)
      const targetSnapshot = await createDocumentFileSnapshot(dossierPath, targetRelativePath)

      return withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)

        const matchingEntry = currentMetadata.documents.find(
          (entry) => entry.uuid === parsed.documentUuid
        )

        if (!matchingEntry) {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This document was not found.')
        }

        if (parsed.fromDocumentId && matchingEntry.relativePath !== parsed.fromDocumentId) {
          throw new DocumentServiceError(
            IpcErrorCode.NOT_FOUND,
            'The document no longer matches the expected previous location.'
          )
        }

        const conflictingEntry = currentMetadata.documents.find(
          (entry) => entry.relativePath === targetRelativePath && entry.uuid !== parsed.documentUuid
        )

        if (conflictingEntry) {
          throw new DocumentServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'Another document is already registered at the target location.'
          )
        }

        const nextEntry = normalizeStoredDocumentEntry(
          { ...matchingEntry, relativePath: targetRelativePath },
          targetRelativePath,
          targetSnapshot
        )

        const nextDocuments = currentMetadata.documents
          .filter(
            (entry) =>
              entry.uuid !== parsed.documentUuid && entry.relativePath !== targetRelativePath
          )
          .concat(nextEntry)
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: nextDocuments
        })

        await writeDossierMetadataFile(dossierPath, nextMetadata)

        return buildDocumentRecord({
          dossierId: canonicalDossierId,
          dossierPath,
          relativePath: targetRelativePath,
          metadata: nextEntry
        })
      })
    },

    listFolders: async (input): Promise<string[]> => {
      const parsed = dossierScopedQuerySchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot(parsed)
      const dossierStats = await stat(dossierPath).catch(() => null)

      if (!dossierStats?.isDirectory()) {
        throw new DocumentServiceError(
          IpcErrorCode.NOT_FOUND,
          'Selected dossier folder was not found.'
        )
      }

      const absoluteDirectories = await collectDirectories(dossierPath)
      return absoluteDirectories
        .map((absolutePath) => normalizeRelativePath(relative(dossierPath, absolutePath)))
        .filter((relativePath) => relativePath.length > 0)
        .sort((left, right) => left.localeCompare(right))
    },

    createFolder: async (input): Promise<string> => {
      const parsed = documentFolderCreateInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const parentPath = parsed.parentPath ?? ''
      const newRelativePath = parentPath ? `${parentPath}/${parsed.name}` : parsed.name
      const absoluteTarget = resolveSafePathInDossier(dossierPath, newRelativePath)

      if (parentPath) {
        const parentAbsolute = resolveSafePathInDossier(dossierPath, parentPath)
        const parentStats = await stat(parentAbsolute).catch(() => null)
        if (!parentStats?.isDirectory()) {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The parent folder was not found.')
        }
      }

      const existing = await stat(absoluteTarget).catch(() => null)
      if (existing) {
        throw new DocumentServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'A file or folder with that name already exists.'
        )
      }

      await mkdir(absoluteTarget, { recursive: false })
      return newRelativePath
    },

    renameFolder: async (input): Promise<string> => {
      const parsed = documentFolderRenameInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const fromPath = parsed.fromPath
      const parentPath = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
      const newPath = parentPath ? `${parentPath}/${parsed.newName}` : parsed.newName

      if (newPath === fromPath) {
        return newPath
      }

      const fromAbsolute = resolveSafePathInDossier(dossierPath, fromPath)
      const toAbsolute = resolveSafePathInDossier(dossierPath, newPath)

      const fromStats = await stat(fromAbsolute).catch(() => null)
      if (!fromStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The folder was not found.')
      }

      const conflict = await stat(toAbsolute).catch(() => null)
      if (conflict) {
        throw new DocumentServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'A file or folder with that name already exists.'
        )
      }

      await rename(fromAbsolute, toAbsolute)

      await withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const prefix = `${fromPath}/`
        const nextDocuments = currentMetadata.documents.map((entry) => {
          if (entry.relativePath === fromPath || entry.relativePath.startsWith(prefix)) {
            const tail = entry.relativePath.slice(fromPath.length)
            return normalizeStoredDocumentEntry(
              { ...entry, relativePath: `${newPath}${tail}` },
              `${newPath}${tail}`
            )
          }
          return entry
        })

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: nextDocuments.sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath)
          )
        })
        await writeDossierMetadataFile(dossierPath, nextMetadata)
      })

      return newPath
    },

    deleteFolder: async (input): Promise<void> => {
      const parsed = documentFolderDeleteInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const absoluteTarget = resolveSafePathInDossier(dossierPath, parsed.path)

      const targetStats = await stat(absoluteTarget).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The folder was not found.')
      }

      const filesInside = await collectFiles(absoluteTarget)
      if (filesInside.length > 0) {
        throw new DocumentServiceError(IpcErrorCode.VALIDATION_FAILED, 'The folder is not empty.')
      }

      await rm(absoluteTarget, { recursive: true, force: true })
    },

    renameFile: async (input): Promise<DocumentRecord> => {
      const parsed = documentFileRenameInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const canonicalDossierId = registryEntry.id
      const fromRelativePath = validateDocumentRelativePath(parsed.documentId)
      const parentDir = fromRelativePath.includes('/')
        ? fromRelativePath.slice(0, fromRelativePath.lastIndexOf('/'))
        : ''
      const toRelativePath = parentDir ? `${parentDir}/${parsed.newFilename}` : parsed.newFilename

      if (toRelativePath === fromRelativePath) {
        const metadata = (await loadStoredDocumentMetadata(dossierPath)).get(fromRelativePath)
        return buildDocumentRecord({
          dossierId: canonicalDossierId,
          dossierPath,
          relativePath: fromRelativePath,
          metadata
        })
      }

      const fromAbsolute = resolveSafePathInDossier(dossierPath, fromRelativePath)
      const toAbsolute = resolveSafePathInDossier(dossierPath, toRelativePath)

      const fromStats = await stat(fromAbsolute).catch(() => null)
      if (!fromStats?.isFile()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
      }

      const conflict = await stat(toAbsolute).catch(() => null)
      if (conflict) {
        throw new DocumentServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'A file with that name already exists.'
        )
      }

      await rename(fromAbsolute, toAbsolute)

      return withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const snapshot = await createDocumentFileSnapshot(dossierPath, toRelativePath)

        const existingEntry = currentMetadata.documents.find(
          (entry) => entry.relativePath === fromRelativePath
        )
        const nextEntry = normalizeStoredDocumentEntry(
          existingEntry
            ? { ...existingEntry, relativePath: toRelativePath }
            : storedDocumentMetadataSchema.parse({
                uuid: randomUUID(),
                relativePath: toRelativePath,
                filename: snapshot.filename,
                byteLength: snapshot.byteLength,
                modifiedAt: snapshot.modifiedAt,
                description: undefined,
                tags: []
              }),
          toRelativePath,
          snapshot
        )

        const nextDocuments = currentMetadata.documents
          .filter((entry) => entry.relativePath !== fromRelativePath)
          .concat(nextEntry)
          .sort((left, right) => left.relativePath.localeCompare(right.relativePath))

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: nextDocuments
        })
        await writeDossierMetadataFile(dossierPath, nextMetadata)

        return buildDocumentRecord({
          dossierId: canonicalDossierId,
          dossierPath,
          relativePath: toRelativePath,
          metadata: nextEntry
        })
      })
    },

    deleteFile: async (input): Promise<void> => {
      const parsed = documentFileDeleteInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const relativePath = validateDocumentRelativePath(parsed.documentId)
      const absolute = resolveSafePathInDossier(dossierPath, relativePath)
      const fileStats = await stat(absolute).catch(() => null)

      if (!fileStats?.isFile()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
      }

      const cacheDir = getDossierContentCachePath(dossierPath)
      const cachePath = getDocumentContentCachePath(cacheDir, absolute)

      await rm(absolute, { force: true })
      await rm(cachePath, { force: true })

      await withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const nextDocuments = currentMetadata.documents.filter(
          (entry) => entry.relativePath !== relativePath
        )

        if (nextDocuments.length === currentMetadata.documents.length) {
          return
        }

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: nextDocuments
        })
        await writeDossierMetadataFile(dossierPath, nextMetadata)
      })
    },

    semanticSearch: async (input): Promise<SemanticSearchResult> => {
      const parsed = dossierScopedQuerySchema.parse({ dossierId: input.dossierId })
      const dossierPath = await resolveRegisteredDossierRoot(parsed)
      const cacheDir = getDossierContentCachePath(dossierPath)

      const documents = await listDocumentsForSemanticSearch(
        dossierPath,
        cacheDir,
        options.embeddingConfig,
        options.embedder
      )
      const hits = await searchDossier({
        documents,
        query: input.query,
        topK: input.topK,
        embeddingConfig: options.embeddingConfig,
        dim: DEFAULT_EMBEDDING_DIM,
        embedder: options.embedder
      })

      return {
        dossierId: input.dossierId,
        query: input.query,
        hits: hits.map((hit) => ({
          documentId: hit.documentId,
          filename: hit.displayName ?? basename(hit.documentId),
          charStart: hit.charStart,
          charEnd: hit.charEnd,
          score: hit.score,
          snippet: hit.snippet,
          snippetMatchStart: hit.snippetMatchStart,
          snippetMatchEnd: hit.snippetMatchEnd
        }))
      }
    }
  }
}

async function listDocumentsForSemanticSearch(
  dossierPath: string,
  cacheDir: string,
  embeddingConfig?: EmbeddingServiceConfig,
  embedder?: (texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>
): Promise<IndexedDocument[]> {
  // Walk the dossier directory looking for extractable documents. The
  // semanticSearch path deliberately does not consume listDocuments here —
  // embeddings exist irrespective of metadata state, and we want to search
  // every indexed cache entry whose source file still lives in the dossier.
  const documents: IndexedDocument[] = []

  async function walk(current: string, relPrefix: string): Promise<void> {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const rel = relPrefix ? `${relPrefix}${sep}${entry.name}` : entry.name
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === ORDICAB_DIRECTORY_NAME) continue
        await walk(absolute, rel)
        continue
      }
      if (!entry.isFile()) continue
      if (!isDocumentTextExtractable(absolute)) continue
      const cachePath = await getSearchCachePath(absolute, cacheDir)
      // Asymmetric lazy indexing: plain-text formats (.txt/.md/…) are cheap
      // enough to extract + embed on demand at search time, so we build the
      // cache right here if it's missing. Binary formats (PDF/DOCX/…) require
      // the heavyweight extractor and explicit user action via extractContent
      // — their cache is produced by the normal extraction pipeline, and
      // unindexed binary docs are silently skipped by searchDossier (fail-open).
      if (isPlainTextDocument(absolute)) {
        await indexSearchableDocument({
          filePath: absolute,
          cacheDir,
          relativePath: rel,
          embeddingConfig,
          embedder
        })
      }
      documents.push({
        documentId: rel,
        displayName: entry.name,
        cachePath
      })
    }
  }

  await walk(dossierPath, '')
  return documents
}
