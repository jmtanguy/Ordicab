import { randomUUID } from 'node:crypto'
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'

import type {
  DocumentExtractedContent,
  DocumentFileMoveInput,
  DocumentFileRenameInput,
  DocumentFolderCreateInput,
  DocumentFolderDeleteInput,
  DocumentFolderMoveInput,
  DocumentFolderRenameInput,
  DocumentFolderDeleteResult,
  DocumentImportInput,
  DocumentImportResult,
  DocumentMetadataUpdate,
  DocumentMoveResult,
  DocumentTrashEntry,
  DocumentTrashInput,
  DocumentTrashResult,
  DocumentTrashRestoreInput,
  DocumentTrashRestoreResult,
  EmailAttachmentSaveInput,
  EmailAttachmentSaveResult,
  PdfExtractPagesInput,
  PdfMergeInput,
  PdfOperationResult,
  PdfPageRange,
  PdfSplitInput,
  DocumentTextExtractionStatus,
  DocumentPreview,
  EmailAttachmentSummary,
  EmailDocumentPreview,
  ImageDocumentPreview,
  DocumentPageOffset,
  DocumentPreviewInput,
  DocumentPreviewSourceType,
  DocumentRecord,
  DossierScopedQuery,
  GlobalSearchHit,
  GlobalSearchQuery,
  GlobalSearchResult,
  SemanticSearchHit,
  SemanticSearchQuery,
  SemanticSearchResult
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import {
  dossierMetadataFileSchema,
  dossierScopedQuerySchema,
  documentFileMoveInputSchema,
  documentFileRenameInputSchema,
  documentFolderCreateInputSchema,
  documentFolderDeleteInputSchema,
  documentFolderMoveInputSchema,
  documentFolderRenameInputSchema,
  documentImportInputSchema,
  documentTrashInputSchema,
  documentTrashRestoreInputSchema,
  emailAttachmentSaveInputSchema,
  pdfExtractPagesInputSchema,
  pdfMergeInputSchema,
  pdfSplitInputSchema,
  documentRelocationInputSchema,
  documentMetadataUpdateSchema,
  type DossierMetadataFile,
  type DocumentRelocationInput,
  type StoredDocumentMetadata,
  storedDocumentMetadataSchema
} from '@shared/validation'

import {
  COWORK_DIRECTORY_NAME,
  getDomainRegistryPath,
  getDossierMetadataPath,
  ORDICAB_DIRECTORY_NAME
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { mapWithConcurrency } from '../../lib/system/concurrency'
import { loadDomainState, pathExists } from '../../lib/system/domainState'
import {
  extractDocumentText,
  ensurePlainTextDocumentCache,
  getDocumentContentCachePath,
  isDocumentTextExtractable,
  isPlainTextDocument,
  markDocumentExtractionEmpty,
  readCachedDocumentText,
  readContentCachePages,
  pageForOffset,
  pruneOrphanContentCaches,
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
import { keywordSearchDossier } from '../../lib/aiEmbedded/embeddings/keywordSearchService'
import { mergeHybridHits } from '../../lib/aiEmbedded/embeddings/textSearchShared'
import {
  DEFAULT_EMBEDDING_DIM,
  type EmbeddingServiceConfig
} from '../../lib/aiEmbedded/embeddings/embeddingService'

interface DossierRegistryEntry {
  slug: string
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
  searchAllDossiers: (input: GlobalSearchQuery) => Promise<GlobalSearchResult>
  createFolder: (input: DocumentFolderCreateInput) => Promise<string>
  renameFolder: (input: DocumentFolderRenameInput) => Promise<string>
  deleteFolder: (input: DocumentFolderDeleteInput) => Promise<DocumentFolderDeleteResult>
  renameFile: (input: DocumentFileRenameInput) => Promise<DocumentRecord>
  trashFiles: (input: DocumentTrashInput) => Promise<DocumentTrashResult>
  restoreTrash: (input: DocumentTrashRestoreInput) => Promise<DocumentTrashRestoreResult>
  listTrash: (input: DossierScopedQuery) => Promise<DocumentTrashEntry[]>
  deleteTrashEntry: (input: DocumentTrashRestoreInput) => Promise<void>
  purgeExpiredTrash: (input: DossierScopedQuery) => Promise<void>
  moveFiles: (input: DocumentFileMoveInput) => Promise<DocumentMoveResult>
  moveFolder: (input: DocumentFolderMoveInput) => Promise<string>
  importFiles: (input: DocumentImportInput) => Promise<DocumentImportResult>
  saveEmailAttachments: (input: EmailAttachmentSaveInput) => Promise<EmailAttachmentSaveResult>
  extractPdfPages: (input: PdfExtractPagesInput) => Promise<PdfOperationResult>
  mergePdfs: (input: PdfMergeInput) => Promise<PdfOperationResult>
  splitPdf: (input: PdfSplitInput) => Promise<PdfOperationResult>
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
  attachments: EmailAttachmentSummary[]
  text: string
}

type ImagePreviewSourceType = ImageDocumentPreview['sourceType']
type OutlookAttachmentShape = { fileName?: string; name?: string; contentLength?: number }
type OutlookMessageShape = {
  getFileData(): {
    subject?: string
    senderEmail?: string
    senderName?: string
    body?: string
    messageDeliveryTime?: string
    clientSubmitTime?: string
    recipients?: Array<{ recipType?: string; email?: string; name?: string }>
    attachments?: OutlookAttachmentShape[]
  }
  getAttachment(attachment: OutlookAttachmentShape): { fileName: string; content: Uint8Array }
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
    registry.dossiers.find((entry) => entry.slug === dossierRef || entry.uuid === dossierRef) ??
    registry.dossiers.find(
      (entry) =>
        entry.slug.toLowerCase() === normalizedRef || entry.uuid?.toLowerCase() === normalizedRef
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
    slug: entry.slug,
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
    documents: [],
    pieces: []
  })
}

export type ReadDossierMetadataResult =
  | { ok: true; metadata: DossierMetadataFile }
  | { ok: false; reason: 'no-metadata' | 'unreadable-metadata' | 'invalid-metadata' }

export async function readDossierMetadataFile(
  dossierPath: string
): Promise<ReadDossierMetadataResult> {
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

export async function writeDossierMetadataFile(
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

export function withDossierMetadataLock<T>(
  dossierPath: string,
  operation: () => Promise<T>
): Promise<T> {
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

/**
 * The top-level `Cowork/` folder is reserved for the pseudonymized Claude
 * Cowork export: it is excluded from listing/watching, so letting a user
 * create or move a regular folder there would silently hide their documents.
 */
function assertNotReservedCoworkPath(relativePath: string): void {
  const firstSegment = normalizeRelativePath(relativePath).split('/')[0]
  if (firstSegment === COWORK_DIRECTORY_NAME) {
    throw new DocumentServiceError(
      IpcErrorCode.VALIDATION_FAILED,
      `"${COWORK_DIRECTORY_NAME}" is reserved for the Claude Cowork export.`
    )
  }
}

function validateDocumentRelativePath(documentPath: string): string {
  const normalized = normalizeRelativePath(documentPath)

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
    path: options.relativePath,
    uuid: options.metadata?.uuid ?? randomUUID(),
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
      parsed.attachments?.map((attachment, index) => ({
        index,
        filename: normalizeOptionalText(attachment.filename) ?? `piece-jointe-${index + 1}`,
        byteLength: typeof attachment.size === 'number' ? attachment.size : null
      })) ?? [],
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
      parsed.attachments?.map((attachment, index) => ({
        index,
        filename:
          normalizeOptionalText(attachment.fileName ?? attachment.name) ??
          `piece-jointe-${index + 1}`,
        byteLength: typeof attachment.contentLength === 'number' ? attachment.contentLength : null
      })) ?? [],
    text: normalizePreviewText(parsed.body)
  }
}

interface ExtractedEmailAttachment {
  index: number
  filename: string
  content: Buffer | Uint8Array
}

/**
 * Re-parse the raw email and return attachment buffers. Index-based addressing
 * matches the EmailAttachmentSummary list produced by the preview parsers.
 */
async function extractEmailAttachments(
  buffer: Buffer,
  extension: '.eml' | '.msg'
): Promise<ExtractedEmailAttachment[]> {
  if (extension === '.eml') {
    const { simpleParser } = await import('mailparser')
    const parsed = await simpleParser(buffer)
    return (parsed.attachments ?? []).map((attachment, index) => ({
      index,
      filename: normalizeOptionalText(attachment.filename) ?? '',
      content: attachment.content
    }))
  }

  const msgReaderModule = await import('@kenjiuno/msgreader')
  const MsgReader = resolveMsgReaderConstructor(msgReaderModule)
  const reader = new MsgReader(toArrayBuffer(buffer))
  const parsed = reader.getFileData()
  return (parsed.attachments ?? []).map((attachment, index) => {
    const resolved = reader.getAttachment(attachment)
    return {
      index,
      filename:
        normalizeOptionalText(resolved.fileName) ??
        normalizeOptionalText(attachment.fileName ?? attachment.name) ??
        '',
      content: resolved.content
    }
  })
}

/** Load a PDF for page operations, mapping missing files and encrypted PDFs to typed errors. */
async function loadPdfDocument(absolutePath: string): Promise<import('pdf-lib').PDFDocument> {
  const fileStats = await stat(absolutePath).catch(() => null)
  if (!fileStats?.isFile()) {
    throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
  }

  const buffer = await readFile(absolutePath)
  const { PDFDocument } = await import('pdf-lib')
  try {
    return await PDFDocument.load(new Uint8Array(buffer))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.toLowerCase().includes('encrypted')) {
      throw new DocumentServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'This PDF is password-protected and cannot be processed.'
      )
    }
    throw new DocumentServiceError(IpcErrorCode.FILE_SYSTEM_ERROR, 'This PDF could not be read.')
  }
}

/** Expand validated 1-based ranges into 0-based page indexes, bounds-checked against the document. */
function resolvePdfPageIndexes(ranges: PdfPageRange[], pageCount: number): number[] {
  const pageIndexes: number[] = []
  for (const range of ranges) {
    if (range.to > pageCount) {
      throw new DocumentServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        `Page range ${range.from}-${range.to} exceeds the document (${pageCount} pages).`
      )
    }
    for (let page = range.from; page <= range.to; page += 1) {
      pageIndexes.push(page - 1)
    }
  }
  return pageIndexes
}

const ATTACHMENT_FORBIDDEN_CHARS = /[\\/:*?"<>|]/g
// eslint-disable-next-line no-control-regex
const ATTACHMENT_CONTROL_CHARS = /[\u0000-\u001f]/g

function sanitizeAttachmentFilename(raw: string, index: number): string {
  const cleaned = raw
    .replace(ATTACHMENT_FORBIDDEN_CHARS, ' ')
    .replace(ATTACHMENT_CONTROL_CHARS, '')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return cleaned || `piece-jointe-${index + 1}`
}

function buildEmailPreview(options: {
  documentPath: string
  filename: string
  byteLength: number
  sourceType: EmailDocumentPreview['sourceType']
  mimeType: EmailDocumentPreview['mimeType']
  parsed: ParsedEmailPreview
}): EmailDocumentPreview {
  return {
    kind: 'email',
    documentPath: options.documentPath,
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
  documentPath: string
  filename: string
  byteLength: number
  sourceType: DocumentPreviewSourceType
  reason: 'unsupported-type' | 'file-too-large'
}): DocumentPreview {
  return {
    kind: 'unsupported',
    documentPath: options.documentPath,
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
        // Cowork/ holds pseudonymized exports for Claude Cowork — not dossier documents.
        if (entry.name === COWORK_DIRECTORY_NAME) return []
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
      if (entry.name === COWORK_DIRECTORY_NAME) continue
      const entryPath = join(current, entry.name)
      directories.push(entryPath)
      await walk(entryPath)
    }
  }

  await walk(rootPath)
  return directories
}

// App-managed trash under {dossier}/.ordicab/trash/{deletionId}/. The watcher
// ignores .ordicab, so trashing emits only the source unlink; the payload keeps
// its relative layout so restore is a plain rename back. The manifest snapshots
// the stored metadata so description/tags/uuid survive an undo, and the trash
// directory syncs with the dossier on shared drives.
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const TRASH_PAYLOAD_DIRECTORY = 'payload'
const TRASH_MANIFEST_FILENAME = 'manifest.json'

interface TrashManifestItem {
  relativePath: string
  storedMetadata: StoredDocumentMetadata | null
}

interface TrashManifest {
  deletedAt: string
  kind: 'files' | 'folder'
  folderPath?: string
  items: TrashManifestItem[]
}

function getDossierTrashPath(dossierPath: string): string {
  return join(dossierPath, ORDICAB_DIRECTORY_NAME, 'trash')
}

async function readTrashManifest(deletionDir: string): Promise<TrashManifest | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(deletionDir, TRASH_MANIFEST_FILENAME), 'utf8')
    ) as unknown
    if (
      !isRecord(parsed) ||
      typeof parsed.deletedAt !== 'string' ||
      (parsed.kind !== 'files' && parsed.kind !== 'folder') ||
      !Array.isArray(parsed.items)
    ) {
      return null
    }
    return parsed as unknown as TrashManifest
  } catch {
    return null
  }
}

/**
 * Find a non-colliding target path inside `absoluteDir` for `filename`,
 * suffixing ` (2)`, ` (3)`, … before the extension until the name is free.
 */
async function resolveCollisionFreeTarget(absoluteDir: string, filename: string): Promise<string> {
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  let candidate = join(absoluteDir, filename)
  let counter = 2

  while (await pathExists(candidate)) {
    candidate = join(absoluteDir, `${stem} (${counter})${extension}`)
    counter += 1
  }

  return candidate
}

/**
 * Carry the extraction cache over to a file's new name. The cache key is
 * derived from the basename, so this only matters when the basename changes
 * (rename) — moves across folders keep the same key. Best-effort: a missing
 * source cache or a target entry already owned by another same-named file
 * simply leaves the cache to be rebuilt on the next extraction.
 */
async function relocateContentCache(
  dossierPath: string,
  fromAbsolute: string,
  toAbsolute: string
): Promise<void> {
  const cacheDir = getDossierContentCachePath(dossierPath)
  const fromCachePath = getDocumentContentCachePath(cacheDir, fromAbsolute)
  const toCachePath = getDocumentContentCachePath(cacheDir, toAbsolute)

  if (fromCachePath === toCachePath) {
    return
  }

  try {
    if (await pathExists(toCachePath)) {
      return
    }
    await rename(fromCachePath, toCachePath)
  } catch {
    // Best-effort: the next extraction pass recreates the cache.
  }
}

export function resolveSafePathInDossier(dossierPath: string, relativePath: string): string {
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

    return join(domainPath, registryEntry.slug)
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
              path: snapshot.relativePath,
              uuid: normalizedMetadata.uuid,
              dossierId: registryEntry.slug,
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
      const relativePath = validateDocumentRelativePath(input.documentPath)
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
          documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
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
            documentPath: relativePath,
            filename,
            byteLength: buffer.byteLength,
            sourceType,
            mimeType: getImagePreviewMimeType(sourceType),
            data: toArrayBuffer(buffer)
          }
        }

        default:
          return buildUnsupportedPreview({
            documentPath: relativePath,
            filename,
            byteLength: fileStats.size,
            sourceType,
            reason: 'unsupported-type'
          })
      }
    },

    getContentStatus: async (input): Promise<DocumentTextExtractionStatus> => {
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: input.dossierId })
      const relativePath = validateDocumentRelativePath(input.documentPath)
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
      const relativePath = validateDocumentRelativePath(input.documentPath)
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
          documentPath: relativePath,
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
          documentPath: relativePath,
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
        documentPath: relativePath,
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

      const canonicalDossierId = registryEntry.slug
      const relativePath = validateDocumentRelativePath(parsed.documentPath)
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

      const canonicalDossierId = registryEntry.slug
      const targetRelativePath = validateDocumentRelativePath(parsed.toDocumentPath)
      const targetSnapshot = await createDocumentFileSnapshot(dossierPath, targetRelativePath)

      return withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)

        const matchingEntry = currentMetadata.documents.find(
          (entry) => entry.uuid === parsed.documentUuid
        )

        if (!matchingEntry) {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This document was not found.')
        }

        if (parsed.fromDocumentPath && matchingEntry.relativePath !== parsed.fromDocumentPath) {
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
      assertNotReservedCoworkPath(newRelativePath)
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
      assertNotReservedCoworkPath(newPath)

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

    deleteFolder: async (input): Promise<DocumentFolderDeleteResult> => {
      const parsed = documentFolderDeleteInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const absoluteTarget = resolveSafePathInDossier(dossierPath, parsed.path)
      const targetStats = await stat(absoluteTarget).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The folder was not found.')
      }

      const deletionId = randomUUID()
      const deletionDir = join(getDossierTrashPath(dossierPath), deletionId)
      const payloadTarget = join(deletionDir, TRASH_PAYLOAD_DIRECTORY, parsed.path)

      await mkdir(dirname(payloadTarget), { recursive: true })
      await rename(absoluteTarget, payloadTarget)

      await withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const prefix = `${parsed.path}/`
        const items: TrashManifestItem[] = currentMetadata.documents
          .filter((entry) => entry.relativePath.startsWith(prefix))
          .map((entry) => ({ relativePath: entry.relativePath, storedMetadata: entry }))
        const nextDocuments = currentMetadata.documents.filter(
          (entry) => !entry.relativePath.startsWith(prefix)
        )

        if (nextDocuments.length !== currentMetadata.documents.length) {
          const nextMetadata = dossierMetadataFileSchema.parse({
            ...currentMetadata,
            documents: nextDocuments
          })
          await writeDossierMetadataFile(dossierPath, nextMetadata)
        }

        const manifest: TrashManifest = {
          deletedAt: new Date().toISOString(),
          kind: 'folder',
          folderPath: parsed.path,
          items
        }
        await atomicWrite(
          join(deletionDir, TRASH_MANIFEST_FILENAME),
          `${JSON.stringify(manifest, null, 2)}\n`
        )
      })

      return { deletionId }
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

      const canonicalDossierId = registryEntry.slug
      const fromRelativePath = validateDocumentRelativePath(parsed.documentPath)
      const parentDir = fromRelativePath.includes('/')
        ? fromRelativePath.slice(0, fromRelativePath.lastIndexOf('/'))
        : ''
      let toRelativePath = parentDir ? `${parentDir}/${parsed.newFilename}` : parsed.newFilename

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
      let toAbsolute = resolveSafePathInDossier(dossierPath, toRelativePath)

      const fromStats = await stat(fromAbsolute).catch(() => null)
      if (!fromStats?.isFile()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
      }

      const conflict = await stat(toAbsolute).catch(() => null)
      if (conflict) {
        if (parsed.onCollision === 'suffix') {
          // Keep both files: pick the next free " (n)" name instead of overwriting.
          toAbsolute = await resolveCollisionFreeTarget(dirname(toAbsolute), parsed.newFilename)
          toRelativePath = normalizeRelativePath(relative(dossierPath, toAbsolute))
        } else {
          throw new DocumentServiceError(
            IpcErrorCode.VALIDATION_FAILED,
            'A file with that name already exists.'
          )
        }
      }

      await rename(fromAbsolute, toAbsolute)
      await relocateContentCache(dossierPath, fromAbsolute, toAbsolute)

      const record = await withDossierMetadataLock(dossierPath, async () => {
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

      // The old basename is now free — drop any cache it left behind so a future
      // file reusing that name can't inherit stale text/embeddings.
      await pruneOrphanCachesForDossier(dossierPath)

      return record
    },

    trashFiles: async (input): Promise<DocumentTrashResult> => {
      const parsed = documentTrashInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const deletionId = randomUUID()
      const deletionDir = join(getDossierTrashPath(dossierPath), deletionId)
      const payloadDir = join(deletionDir, TRASH_PAYLOAD_DIRECTORY)

      const failed: DocumentTrashResult['failed'] = []
      const trashedPaths: string[] = []

      for (const documentPath of parsed.documentPaths) {
        try {
          const relativePath = validateDocumentRelativePath(documentPath)
          const absolute = resolveSafePathInDossier(dossierPath, relativePath)
          const fileStats = await stat(absolute).catch(() => null)
          if (!fileStats?.isFile()) {
            throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
          }

          // The extraction cache is intentionally kept: a restored file reuses
          // its OCR result instead of re-extracting.
          const payloadTarget = join(payloadDir, relativePath)
          await mkdir(dirname(payloadTarget), { recursive: true })
          await rename(absolute, payloadTarget)
          trashedPaths.push(relativePath)
        } catch (error) {
          failed.push({
            documentPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      if (trashedPaths.length === 0) {
        await rm(deletionDir, { recursive: true, force: true }).catch(() => undefined)
        return { deletionId: null, trashedCount: 0, failed }
      }

      await withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const trashedSet = new Set(trashedPaths)
        const items: TrashManifestItem[] = trashedPaths.map((relativePath) => ({
          relativePath,
          storedMetadata:
            currentMetadata.documents.find((entry) => entry.relativePath === relativePath) ?? null
        }))
        const nextDocuments = currentMetadata.documents.filter(
          (entry) => !trashedSet.has(entry.relativePath)
        )

        if (nextDocuments.length !== currentMetadata.documents.length) {
          const nextMetadata = dossierMetadataFileSchema.parse({
            ...currentMetadata,
            documents: nextDocuments
          })
          await writeDossierMetadataFile(dossierPath, nextMetadata)
        }

        const manifest: TrashManifest = {
          deletedAt: new Date().toISOString(),
          kind: 'files',
          items
        }
        await atomicWrite(
          join(deletionDir, TRASH_MANIFEST_FILENAME),
          `${JSON.stringify(manifest, null, 2)}\n`
        )
      })

      return { deletionId, trashedCount: trashedPaths.length, failed }
    },

    restoreTrash: async (input): Promise<DocumentTrashRestoreResult> => {
      const parsed = documentTrashRestoreInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const deletionDir = join(getDossierTrashPath(dossierPath), parsed.deletionId)
      const manifest = await readTrashManifest(deletionDir)
      if (!manifest) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This trash entry no longer exists.')
      }

      const payloadDir = join(deletionDir, TRASH_PAYLOAD_DIRECTORY)

      if (manifest.kind === 'folder' && manifest.folderPath) {
        const folderPath = manifest.folderPath
        const source = join(payloadDir, folderPath)
        const parentRelative = folderPath.includes('/')
          ? folderPath.slice(0, folderPath.lastIndexOf('/'))
          : ''
        const parentAbsolute = parentRelative ? join(dossierPath, parentRelative) : dossierPath

        await mkdir(parentAbsolute, { recursive: true })
        const target = await resolveCollisionFreeTarget(parentAbsolute, basename(folderPath))
        await rename(source, target)
        const restoredFolderPath = normalizeRelativePath(relative(dossierPath, target))

        await withDossierMetadataLock(dossierPath, async () => {
          const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
          const entriesByPath = new Map(
            currentMetadata.documents.map((entry) => [entry.relativePath, entry])
          )
          for (const item of manifest.items) {
            if (!item.storedMetadata) continue
            const tail = item.relativePath.slice(folderPath.length)
            const restoredPath = `${restoredFolderPath}${tail}`
            entriesByPath.set(
              restoredPath,
              normalizeStoredDocumentEntry(
                { ...item.storedMetadata, relativePath: restoredPath },
                restoredPath
              )
            )
          }

          const nextMetadata = dossierMetadataFileSchema.parse({
            ...currentMetadata,
            documents: [...entriesByPath.values()].sort((left, right) =>
              left.relativePath.localeCompare(right.relativePath)
            )
          })
          await writeDossierMetadataFile(dossierPath, nextMetadata)
        })

        await rm(deletionDir, { recursive: true, force: true }).catch(() => undefined)
        return { restoredCount: Math.max(manifest.items.length, 1) }
      }

      const restored: Array<{ item: TrashManifestItem; restoredPath: string }> = []

      for (const item of manifest.items) {
        const source = join(payloadDir, item.relativePath)
        const sourceStats = await stat(source).catch(() => null)
        if (!sourceStats?.isFile()) {
          continue
        }

        const parentRelative = item.relativePath.includes('/')
          ? item.relativePath.slice(0, item.relativePath.lastIndexOf('/'))
          : ''
        const parentAbsolute = parentRelative ? join(dossierPath, parentRelative) : dossierPath

        await mkdir(parentAbsolute, { recursive: true })
        const target = await resolveCollisionFreeTarget(parentAbsolute, basename(item.relativePath))
        await rename(source, target)
        restored.push({
          item,
          restoredPath: normalizeRelativePath(relative(dossierPath, target))
        })
      }

      if (restored.length > 0) {
        await withDossierMetadataLock(dossierPath, async () => {
          const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
          const entriesByPath = new Map(
            currentMetadata.documents.map((entry) => [entry.relativePath, entry])
          )
          for (const { item, restoredPath } of restored) {
            if (!item.storedMetadata) continue
            const snapshot = await createDocumentFileSnapshot(dossierPath, restoredPath)
            entriesByPath.set(
              restoredPath,
              normalizeStoredDocumentEntry(
                { ...item.storedMetadata, relativePath: restoredPath },
                restoredPath,
                snapshot
              )
            )
          }

          const nextMetadata = dossierMetadataFileSchema.parse({
            ...currentMetadata,
            documents: [...entriesByPath.values()].sort((left, right) =>
              left.relativePath.localeCompare(right.relativePath)
            )
          })
          await writeDossierMetadataFile(dossierPath, nextMetadata)
        })
      }

      await rm(deletionDir, { recursive: true, force: true }).catch(() => undefined)
      return { restoredCount: restored.length }
    },

    listTrash: async (input): Promise<DocumentTrashEntry[]> => {
      const parsed = dossierScopedQuerySchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot(parsed)
      const trashRoot = getDossierTrashPath(dossierPath)

      let entries
      try {
        entries = await readdir(trashRoot, { withFileTypes: true })
      } catch {
        return []
      }

      const result: DocumentTrashEntry[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifest = await readTrashManifest(join(trashRoot, entry.name))
        if (!manifest) continue
        result.push({
          deletionId: entry.name,
          deletedAt: manifest.deletedAt,
          kind: manifest.kind,
          folderPath: manifest.folderPath,
          items: manifest.items.map((item) => ({ relativePath: item.relativePath }))
        })
      }

      return result.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt))
    },

    deleteTrashEntry: async (input): Promise<void> => {
      const parsed = documentTrashRestoreInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const deletionDir = join(getDossierTrashPath(dossierPath), parsed.deletionId)

      const dirStats = await stat(deletionDir).catch(() => null)
      if (!dirStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This trash entry no longer exists.')
      }

      await rm(deletionDir, { recursive: true, force: true })
    },

    purgeExpiredTrash: async (input): Promise<void> => {
      const parsed = dossierScopedQuerySchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot(parsed)
      const trashRoot = getDossierTrashPath(dossierPath)

      let entries
      try {
        entries = await readdir(trashRoot, { withFileTypes: true })
      } catch {
        return
      }

      const now = Date.now()
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const deletionDir = join(trashRoot, entry.name)
        const manifest = await readTrashManifest(deletionDir)
        // Fall back to the directory mtime when the manifest is unreadable
        // (interrupted trash op) so orphaned payloads still age out instead of
        // being purged immediately or kept forever.
        let referenceMs = manifest ? Date.parse(manifest.deletedAt) : Number.NaN
        if (!Number.isFinite(referenceMs)) {
          const dirStats = await stat(deletionDir).catch(() => null)
          referenceMs = dirStats ? dirStats.mtime.getTime() : Number.NaN
        }
        if (Number.isFinite(referenceMs) && now - referenceMs > TRASH_RETENTION_MS) {
          await rm(deletionDir, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    },

    saveEmailAttachments: async (input): Promise<EmailAttachmentSaveResult> => {
      const parsed = emailAttachmentSaveInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const relativePath = validateDocumentRelativePath(parsed.documentPath)
      const absolute = resolveSafePathInDossier(dossierPath, relativePath)

      const extension = extname(absolute).toLowerCase()
      if (extension !== '.eml' && extension !== '.msg') {
        throw new DocumentServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'Attachments can only be extracted from .eml or .msg files.'
        )
      }

      const fileStats = await stat(absolute).catch(() => null)
      if (!fileStats?.isFile()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
      }

      // Reads the raw email directly — the preview size cap does not apply here.
      const buffer = await readFile(absolute)
      const attachments = await extractEmailAttachments(buffer, extension)

      const emailParentPath = relativePath.includes('/')
        ? relativePath.slice(0, relativePath.lastIndexOf('/'))
        : ''
      const targetFolderPath = parsed.targetFolderPath ?? emailParentPath
      const targetDir = targetFolderPath
        ? resolveSafePathInDossier(dossierPath, targetFolderPath)
        : dossierPath

      const targetStats = await stat(targetDir).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The target folder was not found.')
      }

      const indexes = parsed.attachmentIndexes ?? attachments.map((attachment) => attachment.index)
      const saved: EmailAttachmentSaveResult['saved'] = []
      const failed: EmailAttachmentSaveResult['failed'] = []

      for (const index of indexes) {
        const attachment = attachments.find((candidate) => candidate.index === index)
        if (!attachment) {
          failed.push({ index, filename: '', error: 'Attachment index not found.' })
          continue
        }

        try {
          const filename = sanitizeAttachmentFilename(attachment.filename, index)
          const target = await resolveCollisionFreeTarget(targetDir, filename)
          await writeFile(target, attachment.content)
          saved.push({
            index,
            relativePath: normalizeRelativePath(relative(dossierPath, target))
          })
        } catch (error) {
          failed.push({
            index,
            filename: attachment.filename,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      return { saved, failed }
    },

    extractPdfPages: async (input): Promise<PdfOperationResult> => {
      const parsed = pdfExtractPagesInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const relativePath = validateDocumentRelativePath(parsed.documentPath)
      const absolute = resolveSafePathInDossier(dossierPath, relativePath)
      const sourceDocument = await loadPdfDocument(absolute)

      const pageIndexes = resolvePdfPageIndexes(parsed.ranges, sourceDocument.getPageCount())
      const { PDFDocument } = await import('pdf-lib')
      const output = await PDFDocument.create()
      const copiedPages = await output.copyPages(sourceDocument, pageIndexes)
      for (const page of copiedPages) {
        output.addPage(page)
      }

      const stem = basename(relativePath).replace(/\.pdf$/i, '')
      const rangeLabel = parsed.ranges
        .map((range) => (range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`))
        .join(', ')
      const outputFilename = parsed.outputFilename ?? `${stem} (pages ${rangeLabel}).pdf`
      const targetDir = dirname(absolute)
      const target = await resolveCollisionFreeTarget(targetDir, outputFilename)
      await writeFile(target, await output.save())

      return { relativePaths: [normalizeRelativePath(relative(dossierPath, target))] }
    },

    mergePdfs: async (input): Promise<PdfOperationResult> => {
      const parsed = pdfMergeInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })

      const sourcePaths = parsed.documentPaths.map((documentPath) =>
        resolveSafePathInDossier(dossierPath, validateDocumentRelativePath(documentPath))
      )

      const { PDFDocument } = await import('pdf-lib')
      const output = await PDFDocument.create()
      for (const sourcePath of sourcePaths) {
        const source = await loadPdfDocument(sourcePath)
        const copiedPages = await output.copyPages(source, source.getPageIndices())
        for (const page of copiedPages) {
          output.addPage(page)
        }
      }

      const firstRelative = validateDocumentRelativePath(parsed.documentPaths[0]!)
      const defaultDir = firstRelative.includes('/')
        ? firstRelative.slice(0, firstRelative.lastIndexOf('/'))
        : ''
      const targetFolderPath = parsed.targetFolderPath ?? defaultDir
      const targetDir = targetFolderPath
        ? resolveSafePathInDossier(dossierPath, targetFolderPath)
        : dossierPath

      const targetStats = await stat(targetDir).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The target folder was not found.')
      }

      const outputFilename = parsed.outputFilename.toLowerCase().endsWith('.pdf')
        ? parsed.outputFilename
        : `${parsed.outputFilename}.pdf`
      const target = await resolveCollisionFreeTarget(targetDir, outputFilename)
      await writeFile(target, await output.save())

      return { relativePaths: [normalizeRelativePath(relative(dossierPath, target))] }
    },

    splitPdf: async (input): Promise<PdfOperationResult> => {
      const parsed = pdfSplitInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const relativePath = validateDocumentRelativePath(parsed.documentPath)
      const absolute = resolveSafePathInDossier(dossierPath, relativePath)
      const sourceDocument = await loadPdfDocument(absolute)
      const pageCount = sourceDocument.getPageCount()

      // `filename`, when provided on a range, names the segment outright; the
      // `.pdf` extension is enforced and any path separators were already
      // rejected by safeFsNameSchema. Otherwise we fall back to the auto label.
      const toSegmentFilename = (filename: string): string =>
        /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`

      const stem = basename(relativePath).replace(/\.pdf$/i, '')
      const segments: Array<{ targetName: string; pageIndexes: number[] }> =
        parsed.mode === 'each-page'
          ? Array.from({ length: pageCount }, (_, index) => ({
              targetName: `${stem} (page ${index + 1}).pdf`,
              pageIndexes: [index]
            }))
          : parsed.mode.ranges.map((range) => ({
              targetName: range.filename
                ? toSegmentFilename(range.filename)
                : `${stem} (${
                    range.from === range.to
                      ? `page ${range.from}`
                      : `pages ${range.from}-${range.to}`
                  }).pdf`,
              pageIndexes: resolvePdfPageIndexes([range], pageCount)
            }))

      const { PDFDocument } = await import('pdf-lib')
      const targetDir = dirname(absolute)
      const relativePaths: string[] = []

      for (const segment of segments) {
        const output = await PDFDocument.create()
        const copiedPages = await output.copyPages(sourceDocument, segment.pageIndexes)
        for (const page of copiedPages) {
          output.addPage(page)
        }
        const target = await resolveCollisionFreeTarget(targetDir, segment.targetName)
        await writeFile(target, await output.save())
        relativePaths.push(normalizeRelativePath(relative(dossierPath, target)))
      }

      return { relativePaths }
    },

    moveFiles: async (input): Promise<DocumentMoveResult> => {
      const parsed = documentFileMoveInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const canonicalDossierId = registryEntry.slug
      const targetFolderPath = parsed.targetFolderPath

      if (targetFolderPath) {
        const targetAbsolute = resolveSafePathInDossier(dossierPath, targetFolderPath)
        const targetStats = await stat(targetAbsolute).catch(() => null)
        if (!targetStats?.isDirectory()) {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The target folder was not found.')
        }
      }

      const failed: DocumentMoveResult['failed'] = []
      const movedPairs: Array<{ from: string; to: string }> = []

      for (const documentPath of parsed.documentPaths) {
        try {
          const fromRelativePath = validateDocumentRelativePath(documentPath)
          const filename = fromRelativePath.includes('/')
            ? fromRelativePath.slice(fromRelativePath.lastIndexOf('/') + 1)
            : fromRelativePath
          let toRelativePath = targetFolderPath ? `${targetFolderPath}/${filename}` : filename

          if (toRelativePath === fromRelativePath) {
            continue
          }

          const fromAbsolute = resolveSafePathInDossier(dossierPath, fromRelativePath)
          let toAbsolute = resolveSafePathInDossier(dossierPath, toRelativePath)

          const fromStats = await stat(fromAbsolute).catch(() => null)
          if (!fromStats?.isFile()) {
            throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The document was not found.')
          }

          const conflict = await stat(toAbsolute).catch(() => null)
          if (conflict) {
            if (parsed.onCollision === 'suffix') {
              // Keep both files: pick the next free " (n)" name in the target folder.
              const targetDirAbsolute = targetFolderPath
                ? resolveSafePathInDossier(dossierPath, targetFolderPath)
                : dossierPath
              toAbsolute = await resolveCollisionFreeTarget(targetDirAbsolute, filename)
              toRelativePath = normalizeRelativePath(relative(dossierPath, toAbsolute))
            } else {
              throw new DocumentServiceError(
                IpcErrorCode.VALIDATION_FAILED,
                'A file with that name already exists in the target folder.'
              )
            }
          }

          await rename(fromAbsolute, toAbsolute)
          // Carry the extraction cache over. A plain move keeps the basename
          // (no-op), but a suffixed move changes it — relocateContentCache then
          // moves the cached text/pages/embeddings so nothing is lost.
          await relocateContentCache(dossierPath, fromAbsolute, toAbsolute)
          movedPairs.push({ from: fromRelativePath, to: toRelativePath })
        } catch (error) {
          failed.push({
            documentPath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      if (movedPairs.length === 0) {
        return { moved: [], failed }
      }

      const moveResult = await withDossierMetadataLock(dossierPath, async () => {
        const currentMetadata = await loadOrInitDossierMetadata(dossierPath, registryEntry)
        const entriesByPath = new Map(
          currentMetadata.documents.map((entry) => [entry.relativePath, entry])
        )
        const moved: DocumentMoveResult['moved'] = []

        for (const { from, to } of movedPairs) {
          const snapshot = await createDocumentFileSnapshot(dossierPath, to)
          const existingEntry = entriesByPath.get(from)
          const nextEntry = normalizeStoredDocumentEntry(
            existingEntry
              ? { ...existingEntry, relativePath: to }
              : storedDocumentMetadataSchema.parse({
                  uuid: randomUUID(),
                  relativePath: to,
                  filename: snapshot.filename,
                  byteLength: snapshot.byteLength,
                  modifiedAt: snapshot.modifiedAt,
                  description: undefined,
                  tags: []
                }),
            to,
            snapshot
          )

          entriesByPath.delete(from)
          entriesByPath.set(to, nextEntry)
          moved.push({
            fromPath: from,
            record: await buildDocumentRecord({
              dossierId: canonicalDossierId,
              dossierPath,
              relativePath: to,
              metadata: nextEntry
            })
          })
        }

        const nextMetadata = dossierMetadataFileSchema.parse({
          ...currentMetadata,
          documents: [...entriesByPath.values()].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath)
          )
        })
        await writeDossierMetadataFile(dossierPath, nextMetadata)

        return { moved, failed }
      })

      // Suffixed moves change a basename, freeing the old key — sweep orphans so
      // a future same-named file can't pick up stale text/embeddings.
      await pruneOrphanCachesForDossier(dossierPath)

      return moveResult
    },

    moveFolder: async (input): Promise<string> => {
      const parsed = documentFolderMoveInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const domainPath = dirname(dossierPath)
      const registry = await loadRegistry(domainPath)
      const registryEntry = resolveRegistryEntryByRef(registry, parsed.dossierId)

      if (!registryEntry) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'This dossier is not registered.')
      }

      const fromPath = parsed.fromPath
      const targetFolderPath = parsed.targetFolderPath
      const folderName = fromPath.includes('/')
        ? fromPath.slice(fromPath.lastIndexOf('/') + 1)
        : fromPath
      const newPath = targetFolderPath ? `${targetFolderPath}/${folderName}` : folderName
      assertNotReservedCoworkPath(newPath)

      if (newPath === fromPath) {
        return newPath
      }

      if (targetFolderPath === fromPath || targetFolderPath.startsWith(`${fromPath}/`)) {
        throw new DocumentServiceError(
          IpcErrorCode.VALIDATION_FAILED,
          'A folder cannot be moved into itself or one of its subfolders.'
        )
      }

      const fromAbsolute = resolveSafePathInDossier(dossierPath, fromPath)
      const toAbsolute = resolveSafePathInDossier(dossierPath, newPath)

      const fromStats = await stat(fromAbsolute).catch(() => null)
      if (!fromStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The folder was not found.')
      }

      if (targetFolderPath) {
        const targetAbsolute = resolveSafePathInDossier(dossierPath, targetFolderPath)
        const targetStats = await stat(targetAbsolute).catch(() => null)
        if (!targetStats?.isDirectory()) {
          throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The target folder was not found.')
        }
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

    importFiles: async (input): Promise<DocumentImportResult> => {
      const parsed = documentImportInputSchema.parse(input)
      const dossierPath = await resolveRegisteredDossierRoot({ dossierId: parsed.dossierId })
      const dossierRoot = resolve(dossierPath)
      const targetFolderPath = parsed.targetFolderPath
      const targetDir = targetFolderPath
        ? resolveSafePathInDossier(dossierPath, targetFolderPath)
        : dossierPath

      const targetStats = await stat(targetDir).catch(() => null)
      if (!targetStats?.isDirectory()) {
        throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The target folder was not found.')
      }

      const imported: DocumentImportResult['imported'] = []
      const failed: DocumentImportResult['failed'] = []

      for (const sourcePath of parsed.sourcePaths) {
        try {
          const resolvedSource = resolve(sourcePath)
          if (resolvedSource === dossierRoot || resolvedSource.startsWith(dossierRoot + sep)) {
            throw new DocumentServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              'The file is already inside the dossier.'
            )
          }

          const sourceStats = await stat(resolvedSource).catch(() => null)
          if (!sourceStats || (!sourceStats.isFile() && !sourceStats.isDirectory())) {
            throw new DocumentServiceError(IpcErrorCode.NOT_FOUND, 'The source was not found.')
          }

          const target = await resolveCollisionFreeTarget(targetDir, basename(resolvedSource))

          if (sourceStats.isDirectory()) {
            await cp(resolvedSource, target, { recursive: true, errorOnExist: true, force: false })
          } else {
            await copyFile(resolvedSource, target)
          }

          imported.push({
            sourcePath,
            relativePath: normalizeRelativePath(relative(dossierPath, target))
          })
        } catch (error) {
          failed.push({
            sourcePath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      return { imported, failed }
    },

    semanticSearch: async (input): Promise<SemanticSearchResult> => {
      const parsed = dossierScopedQuerySchema.parse({ dossierId: input.dossierId })
      const dossierPath = await resolveRegisteredDossierRoot(parsed)
      const hits = await runHybridSearch(
        dossierPath,
        input.query,
        input.topK,
        options.embeddingConfig,
        options.embedder
      )

      return {
        dossierId: input.dossierId,
        query: input.query,
        hits
      }
    },

    searchAllDossiers: async (input): Promise<GlobalSearchResult> => {
      const domainPath = await resolveActiveDomainPath(options.stateFilePath)
      const registry = await loadRegistry(domainPath)

      // Run the same per-dossier hybrid search over every registered dossier,
      // bounded so a large domain doesn't flood the embedder. A failure in one
      // dossier (missing folder, unreadable cache) must not sink the whole
      // search, so each worker fails open to no hits.
      const perDossier = await mapWithConcurrency(
        registry.dossiers,
        GLOBAL_SEARCH_CONCURRENCY,
        async (entry): Promise<GlobalSearchHit[]> => {
          const dossierPath = join(domainPath, entry.slug)
          try {
            const hits = await runHybridSearch(
              dossierPath,
              input.query,
              input.topK,
              options.embeddingConfig,
              options.embedder
            )
            return hits.map((hit) => ({
              ...hit,
              dossierId: entry.slug,
              dossierName: entry.name
            }))
          } catch (error) {
            console.error(
              `[DocumentService] Global search failed for dossier "${entry.slug}":`,
              error
            )
            return []
          }
        }
      )

      // Surface exact (keyword) hits ahead of approximate (semantic) ones, each
      // group ordered by descending score so the strongest matches across all
      // dossiers come first. Scores are only compared within a single matchKind
      // (keyword score is a word count, semantic score a cosine similarity), so
      // the kind ordering is decided before any score comparison. Cap the merged
      // list to keep the payload and the panel responsive.
      const rank = (hit: GlobalSearchHit): number => (hit.matchKind === 'keyword' ? 0 : 1)
      const hits = perDossier
        .flat()
        .sort((a, b) => rank(a) - rank(b) || b.score - a.score)
        .slice(0, GLOBAL_SEARCH_MAX_HITS)

      return { query: input.query, hits }
    }
  }
}

// Cross-dossier search fans out over every registered dossier. Bound the number
// running at once so the embedding worker isn't overwhelmed, and cap the merged
// result so a broad query over a large domain stays responsive.
const GLOBAL_SEARCH_CONCURRENCY = 4
const GLOBAL_SEARCH_MAX_HITS = 50

// One dossier's slice of the hybrid keyword + semantic search, shared by the
// dossier-scoped semanticSearch and the cross-dossier searchAllDossiers.
async function runHybridSearch(
  dossierPath: string,
  query: string,
  topK: number | undefined,
  embeddingConfig: EmbeddingServiceConfig | undefined,
  embedder:
    | ((texts: string[], config?: EmbeddingServiceConfig) => Promise<Float32Array[] | null>)
    | undefined
): Promise<SemanticSearchHit[]> {
  const cacheDir = getDossierContentCachePath(dossierPath)
  const documents = await listDocumentsForSemanticSearch(
    dossierPath,
    cacheDir,
    embeddingConfig,
    embedder
  )

  // Hybrid search. Keyword search is the reliable relevance signal in a
  // tightly-clustered legal corpus (documents that literally contain the
  // query word); semantic search supplements it with meaning-based matches.
  // Keyword runs first and always works (no model required); semantic is
  // best-effort and yields nothing when no embeddings exist yet.
  const [keywordHits, semanticHits] = await Promise.all([
    keywordSearchDossier({ documents, query, topK }),
    searchDossier({
      documents,
      query,
      topK,
      embeddingConfig,
      dim: DEFAULT_EMBEDDING_DIM,
      embedder
    })
  ])

  // Merge: keyword (exact) results first, then semantic results that don't
  // duplicate a keyword hit on the same document span. Shared with note search.
  const merged = mergeHybridHits(keywordHits, semanticHits)

  // Resolve each hit's char offset back to a source page. Read each matched
  // document's page table at most once — only the handful that surfaced in
  // results, not the whole corpus.
  const cachePathByItem = new Map(documents.map((doc) => [doc.itemId, doc.cachePath]))
  const pagesByItem = new Map<string, DocumentPageOffset[] | undefined>()
  for (const { hit } of merged) {
    if (pagesByItem.has(hit.itemId)) continue
    const cachePath = cachePathByItem.get(hit.itemId)
    pagesByItem.set(hit.itemId, cachePath ? await readContentCachePages(cachePath) : undefined)
  }

  return merged.map(({ hit, matchKind }) => ({
    documentPath: hit.itemId,
    filename: hit.displayName ?? basename(hit.itemId),
    charStart: hit.charStart,
    charEnd: hit.charEnd,
    page: pageForOffset(hit.charStart, pagesByItem.get(hit.itemId)),
    score: hit.score,
    snippet: hit.snippet,
    snippetMatchStart: hit.snippetMatchStart,
    snippetMatchEnd: hit.snippetMatchEnd,
    matchKind
  }))
}

/**
 * Walk the dossier and return the absolute path of every extractable file
 * (skipping the .ordicab and cowork reserved trees). Used to tell which content
 * caches still have an owning file when pruning orphans.
 */
async function collectExtractableFilePaths(dossierPath: string): Promise<string[]> {
  const paths: string[] = []

  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === ORDICAB_DIRECTORY_NAME) continue
        if (entry.name === COWORK_DIRECTORY_NAME) continue
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if (isDocumentTextExtractable(absolute)) paths.push(absolute)
    }
  }

  await walk(dossierPath)
  return paths
}

/**
 * Remove content caches with no owning file, best-effort. Called after rename/
 * move so a reused basename can never inherit a previous file's stale text or
 * embeddings. Never throws — the operation that triggered it has already
 * succeeded by this point.
 */
async function pruneOrphanCachesForDossier(dossierPath: string): Promise<void> {
  try {
    const cacheDir = getDossierContentCachePath(dossierPath)
    const existing = await collectExtractableFilePaths(dossierPath)
    await pruneOrphanContentCaches(cacheDir, existing)
  } catch {
    // Best-effort cleanup; a leftover orphan is re-checked on the next op.
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
        if (entry.name === COWORK_DIRECTORY_NAME) continue
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
        itemId: rel,
        displayName: entry.name,
        cachePath
      })
    }
  }

  await walk(dossierPath, '')
  return documents
}
