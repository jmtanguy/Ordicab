import chokidar, { type ChokidarOptions } from 'chokidar'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { ZodError, z } from 'zod'

import {
  type DossierDetail,
  IpcErrorCode,
  type DossierRegistrationInput,
  type DossierUpdateInput,
  type DomainStatusSnapshot
} from '@shared/types'

import { type DocumentService } from '../../services/domain/documentService'
import { atomicWrite } from '../system/atomicWrite'
import { pathExists } from '../system/domainState'
import {
  getDomainDelegatedFailedPath,
  getDomainDelegatedInboxPath,
  getDomainDelegatedProcessedCommandsPath,
  getDomainDelegatedProcessingPath,
  getDomainDelegatedResponsesPath,
  getDomainDelegatedStatePath
} from '../ordicab/ordicabPaths'
import { resolveTagDescriptions } from '@shared/templateRoutines'
import type { GenerateService } from '../../services/domain/generateService'
import {
  createFileBackedOrdicabActionContactService,
  createDelegatedAiActionExecutor,
  isDelegatedAiActionNeedsInputError,
  OrdicabActionError
} from './aiDelegatedActionExecutor'
import { delegatedAiActionSchema, type DelegatedAiAction } from './aiDelegatedActionContracts'

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

interface DossierServiceLike {
  getDossier: (input: { dossierId: string }) => Promise<DossierDetail>
  updateDossier: (input: DossierUpdateInput) => Promise<unknown>
  upsertKeyDate: (input: {
    dossierId: string
    id?: string
    label: string
    date: string
    note?: string
  }) => Promise<unknown>
  deleteKeyDate: (input: { dossierId: string; keyDateId: string }) => Promise<unknown>
  upsertKeyReference: (input: {
    dossierId: string
    id?: string
    label: string
    value: string
    note?: string
  }) => Promise<unknown>
  deleteKeyReference: (input: { dossierId: string; keyReferenceId: string }) => Promise<unknown>
  registerDossier: (input: DossierRegistrationInput) => Promise<unknown>
}

type DocumentServiceLike = Pick<
  DocumentService,
  'listDocuments' | 'resolveRegisteredDossierRoot' | 'saveMetadata' | 'relocateMetadata'
>
type GenerateServiceLike = Pick<GenerateService, 'generateDocument'>

export interface DelegatedAiActionFileWatcherLike {
  on(event: string, listener: (...args: unknown[]) => void): this
  close(): Promise<unknown>
}

export type DelegatedAiActionWatchFactory = (
  path: string | readonly string[],
  options: ChokidarOptions
) => DelegatedAiActionFileWatcherLike

export interface DelegatedAiActionProcessorLike {
  watchActiveDomain: () => Promise<void>
  watchDomain: (domainPath: string) => Promise<void>
  dispose: () => Promise<void>
}

export interface DelegatedAiActionProcessorOptions {
  domainService: DomainServiceLike
  dossierService: DossierServiceLike
  documentService: DocumentServiceLike
  generateService: GenerateServiceLike
  now?: () => Date
  stabilityWindowMs?: number
  watchFactory?: DelegatedAiActionWatchFactory
  logError?: (message: string, error: unknown) => void
  tessDataPath?: string
}

interface ProcessedCommandRecord {
  processedAt: string
  action: DelegatedIntentAction | 'unknown'
  originDeviceId?: string
  status?: 'completed' | 'needs_input' | 'failed'
  responseFilename?: string
}

type ProcessedCommandsState = Record<string, ProcessedCommandRecord>

const intentActionSchema = delegatedAiActionSchema

const processedCommandsStateSchema = z.record(
  z.string(),
  z.object({
    processedAt: z.string().min(1),
    action: intentActionSchema.or(z.literal('unknown')),
    originDeviceId: z.string().min(1).optional(),
    status: z.enum(['completed', 'needs_input', 'failed']).optional(),
    responseFilename: z.string().min(1).optional()
  })
)

const intentSequenceSchema = z
  .object({
    groupId: z.string().min(1),
    index: z.number().int().positive(),
    total: z.number().int().positive()
  })
  .refine((value) => value.index <= value.total, {
    message: 'Intent sequence index must be less than or equal to total.'
  })

const intentEnvelopeSchema = z.object({
  version: z.literal(1),
  commandId: z.string().min(1),
  createdAt: z.string().min(1),
  actor: z.literal('claude-delegated'),
  originDeviceId: z.string().min(1),
  action: intentActionSchema,
  payload: z.unknown(),
  sequence: intentSequenceSchema.optional()
})

type DelegatedIntentAction = DelegatedAiAction
type DelegatedIntentEnvelope = z.infer<typeof intentEnvelopeSchema>

const DEFAULT_STABILITY_WINDOW_MS = 250
const FAILED_INTENT_RETENTION_MS = 5 * 24 * 60 * 60 * 1000
type DelegatedResponseStatus = 'completed' | 'needs_input' | 'failed'

interface DelegatedIntentResponseErrorTag {
  path: string
  description: string
}

interface DelegatedIntentResponseErrorObject {
  code: string
  message: string
  unresolvedTags?: DelegatedIntentResponseErrorTag[]
  claudeInstructions?: string
}

interface DelegatedIntentResponse {
  version: 1
  commandId: string
  action?: DelegatedIntentAction
  originDeviceId?: string
  receivedAt: string
  completedAt: string
  status: DelegatedResponseStatus
  intent?: unknown
  raw?: string
  result?: Record<string, unknown>
  error?: DelegatedIntentResponseErrorObject
  nextStep: string
}

export class DelegatedAiActionProcessorError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly claudeInstructions?: string
  ) {
    super(message)
    this.name = 'DelegatedAiActionProcessorError'
  }
}

function resolveErrorCode(error: unknown): IpcErrorCode {
  if (error instanceof DelegatedAiActionProcessorError) {
    return error.code
  }

  if (error instanceof OrdicabActionError) {
    return error.code
  }

  if (error instanceof SyntaxError || error instanceof ZodError) {
    return IpcErrorCode.VALIDATION_FAILED
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: IpcErrorCode }).code
  }

  return IpcErrorCode.FILE_SYSTEM_ERROR
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractIntentDraft(
  raw: string,
  filePath: string
): {
  parsedJson?: Record<string, unknown>
  commandId: string
  action?: DelegatedIntentAction
  originDeviceId?: string
} {
  const fallbackCommandId = basename(filePath, '.json')

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!isRecord(parsed)) {
      return { commandId: fallbackCommandId }
    }

    const action =
      typeof parsed.action === 'string' && intentActionSchema.safeParse(parsed.action).success
        ? (parsed.action as DelegatedIntentAction)
        : undefined

    return {
      parsedJson: parsed,
      commandId:
        typeof parsed.commandId === 'string' && parsed.commandId.length > 0
          ? parsed.commandId
          : fallbackCommandId,
      action,
      originDeviceId:
        typeof parsed.originDeviceId === 'string' && parsed.originDeviceId.length > 0
          ? parsed.originDeviceId
          : undefined
    }
  } catch {
    return { commandId: fallbackCommandId }
  }
}

async function resolveActiveDomainPath(domainService: DomainServiceLike): Promise<string | null> {
  const status = await domainService.getStatus()

  if (!status.registeredDomainPath || !status.isAvailable) {
    return null
  }

  return status.registeredDomainPath
}

async function ensureQueueDirectories(domainPath: string): Promise<void> {
  await Promise.all([
    mkdir(getDomainDelegatedInboxPath(domainPath), { recursive: true }),
    mkdir(getDomainDelegatedProcessingPath(domainPath), { recursive: true }),
    mkdir(getDomainDelegatedResponsesPath(domainPath), { recursive: true }),
    mkdir(getDomainDelegatedFailedPath(domainPath), { recursive: true }),
    mkdir(getDomainDelegatedStatePath(domainPath), { recursive: true })
  ])
}

async function listIntentFiles(dirPath: string): Promise<string[]> {
  if (!(await pathExists(dirPath))) {
    return []
  }

  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

async function pruneExpiredFailedIntents(domainPath: string, now: () => Date): Promise<void> {
  const failedPath = getDomainDelegatedFailedPath(domainPath)
  const failedFiles = await listIntentFiles(failedPath)
  const cutoffTime = now().getTime() - FAILED_INTENT_RETENTION_MS

  await Promise.all(
    failedFiles.map(async (filename) => {
      const filePath = join(failedPath, filename)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile() || fileStats.mtimeMs >= cutoffTime) {
        return
      }

      await rm(filePath, { force: true })
    })
  )
}

async function loadProcessedCommands(domainPath: string): Promise<ProcessedCommandsState> {
  const ledgerPath = getDomainDelegatedProcessedCommandsPath(domainPath)

  if (!(await pathExists(ledgerPath))) {
    return {}
  }

  try {
    const parsed = JSON.parse(await readFile(ledgerPath, 'utf8')) as unknown
    const result = processedCommandsStateSchema.safeParse(parsed)
    return result.success ? (result.data as ProcessedCommandsState) : {}
  } catch {
    return {}
  }
}

async function saveProcessedCommands(
  domainPath: string,
  processedCommands: ProcessedCommandsState
): Promise<void> {
  await atomicWrite(
    getDomainDelegatedProcessedCommandsPath(domainPath),
    `${JSON.stringify(processedCommands, null, 2)}\n`
  )
}

function summarizeExecutionResult(
  action: DelegatedIntentAction,
  result: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(result)) {
    return undefined
  }

  switch (action) {
    case 'contact.upsert':
      return {
        id: result.id,
        dossierId: result.dossierId,
        role: result.role,
        firstName: result.firstName,
        lastName: result.lastName,
        email: result.email
      }
    case 'dossier.create':
      return {
        id: result.id,
        uuid: result.uuid,
        name: result.name,
        registeredAt: result.registeredAt
      }
    case 'dossier.update':
      return {
        id: result.id,
        status: result.status,
        type: result.type,
        updatedAt: result.updatedAt
      }
    case 'document.saveMetadata':
    case 'document.relocate':
      return {
        id: result.id,
        uuid: result.uuid,
        dossierId: result.dossierId,
        relativePath: result.relativePath,
        description: result.description,
        tags: result.tags
      }
    case 'document.analyze':
      // Unlike other actions, delegated document analysis must expose the raw
      // text and derived facts because the external agent needs them to decide
      // the follow-up `document.saveMetadata` intent.
      return {
        dossierId: result.dossierId,
        documentId: result.documentId,
        method: result.method,
        textLength: result.textLength,
        text: result.text,
        metadata: result.metadata,
        analysis: result.analysis
      }
    case 'template.create':
    case 'template.update':
      return {
        id: result.id,
        name: result.name,
        updatedAt: result.updatedAt
      }
    case 'generate.document':
      return {
        outputPath: result.outputPath
      }
    default:
      return undefined
  }
}

function buildCompletedNextStep(action: DelegatedIntentAction): string {
  if (action === 'generate.document') {
    return 'The document has been generated. Continue only if the user asks for another change or follow-up action.'
  }

  if (action === 'document.analyze') {
    // Make the expected two-step workflow explicit in the response itself so
    // external agents do not need to infer the next mutation from instructions alone.
    return 'Read result.text and result.analysis, then emit document.saveMetadata if you want to persist the generated description and tags.'
  }

  return 'The action completed successfully. Read canonical Ordicab files if you need fresh state before the next step.'
}

function classifyErrorStatus(error: unknown): DelegatedResponseStatus {
  return isDelegatedAiActionNeedsInputError(error) ? 'needs_input' : 'failed'
}

function buildResponseErrorObject(error: unknown): DelegatedIntentResponseErrorObject {
  const errorObject: DelegatedIntentResponseErrorObject = {
    code: resolveErrorCode(error),
    message: error instanceof Error ? error.message : 'Intent processing failed.'
  }

  if (
    isDelegatedAiActionNeedsInputError(error) &&
    error.unresolvedTags &&
    error.unresolvedTags.length > 0
  ) {
    const descriptions = resolveTagDescriptions(error.unresolvedTags)
    errorObject.unresolvedTags = error.unresolvedTags.map((path) => ({
      path,
      description: descriptions[path] ?? path
    }))
    errorObject.claudeInstructions =
      'Ask the user for each missing field, then re-emit generate.document with tagOverrides, a new commandId, and the same originDeviceId.'
  } else if (error instanceof OrdicabActionError && error.instructions) {
    errorObject.claudeInstructions = error.instructions
  } else if (error instanceof DelegatedAiActionProcessorError && error.claudeInstructions) {
    errorObject.claudeInstructions = error.claudeInstructions
  }

  return errorObject
}

function buildNextStepFromError(
  status: DelegatedResponseStatus,
  error: DelegatedIntentResponseErrorObject
): string {
  if (status === 'needs_input') {
    return (
      error.claudeInstructions ??
      'Ask the user for the missing values, then emit a new intent with the same originDeviceId.'
    )
  }

  return (
    error.claudeInstructions ??
    'Do not retry automatically. Read the error, correct the request, then emit a new intent with a new commandId if needed.'
  )
}

async function writeDelegatedResponse(
  targetPath: string,
  response: DelegatedIntentResponse
): Promise<void> {
  await atomicWrite(targetPath, `${JSON.stringify(response, null, 2)}\n`)
}

export function createDelegatedAiActionProcessor(
  options: DelegatedAiActionProcessorOptions
): DelegatedAiActionProcessorLike {
  const now = options.now ?? (() => new Date())
  const actionExecutor = createDelegatedAiActionExecutor({
    contactService: createFileBackedOrdicabActionContactService({
      documentService: options.documentService
    }),
    dossierService: options.dossierService,
    documentService: options.documentService,
    generateService: options.generateService,
    resolveDomainPath: async () => {
      const domainPath = await resolveActiveDomainPath(options.domainService)
      if (!domainPath) {
        throw new OrdicabActionError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
      }
      return domainPath
    },
    now,
    tessDataPath: options.tessDataPath
  })
  const stabilityWindowMs = options.stabilityWindowMs ?? DEFAULT_STABILITY_WINDOW_MS
  const logError =
    options.logError ??
    ((message: string, error: unknown) => {
      console.error(message, error)
    })
  const watchFactory =
    options.watchFactory ??
    ((path, watchOptions) => {
      const normalizedPath: string | string[] = typeof path === 'string' ? path : Array.from(path)
      return chokidar.watch(
        normalizedPath,
        watchOptions
      ) as unknown as DelegatedAiActionFileWatcherLike
    })

  let activeDomainPath: string | null = null
  let watcher: DelegatedAiActionFileWatcherLike | null = null
  let processedCommands: ProcessedCommandsState = {}
  let scheduledDrain: ReturnType<typeof setTimeout> | null = null
  let drainQueue = Promise.resolve()

  async function closeWatcher(): Promise<void> {
    if (scheduledDrain) {
      clearTimeout(scheduledDrain)
      scheduledDrain = null
    }

    if (!watcher) {
      return
    }

    const currentWatcher = watcher
    watcher = null
    await currentWatcher.close()
  }

  function scheduleDrain(domainPath: string, delayMs: number = stabilityWindowMs): void {
    if (scheduledDrain) {
      clearTimeout(scheduledDrain)
    }

    scheduledDrain = setTimeout(() => {
      scheduledDrain = null
      drainQueue = drainQueue
        .then(() => drainDomainQueue(domainPath))
        .catch((error) => {
          logError('[DelegatedAiActionProcessor] Failed to process delegated intents.', error)
        })
    }, delayMs)
  }

  async function processClaimedIntent(domainPath: string, filePath: string): Promise<void> {
    const raw = await readFile(filePath, 'utf8')
    const draft = extractIntentDraft(raw, filePath)
    const responseFilename = basename(filePath)
    const responsePath = join(getDomainDelegatedResponsesPath(domainPath), responseFilename)
    const duplicateRecord = processedCommands[draft.commandId]

    if (await pathExists(responsePath)) {
      try {
        const existingResponse = JSON.parse(
          await readFile(responsePath, 'utf8')
        ) as Partial<DelegatedIntentResponse>
        processedCommands[draft.commandId] = {
          processedAt:
            typeof existingResponse.completedAt === 'string'
              ? existingResponse.completedAt
              : now().toISOString(),
          action:
            existingResponse.action && intentActionSchema.safeParse(existingResponse.action).success
              ? existingResponse.action
              : (draft.action ?? 'unknown'),
          originDeviceId:
            typeof existingResponse.originDeviceId === 'string'
              ? existingResponse.originDeviceId
              : draft.originDeviceId,
          status:
            existingResponse.status === 'completed' ||
            existingResponse.status === 'needs_input' ||
            existingResponse.status === 'failed'
              ? existingResponse.status
              : undefined,
          responseFilename
        }
        await saveProcessedCommands(domainPath, processedCommands)
      } catch (error) {
        logError(
          '[DelegatedAiActionProcessor] Failed to reuse an existing delegated response.',
          error
        )
      }

      await rm(filePath, { force: true })
      return
    }

    if (duplicateRecord) {
      await rm(filePath, { force: true })
      return
    }

    let response: DelegatedIntentResponse
    let intent: DelegatedIntentEnvelope

    try {
      intent = intentEnvelopeSchema.parse(draft.parsedJson ?? JSON.parse(raw))
      const executionResult = await actionExecutor.execute(intent.action, intent.payload)

      response = {
        version: 1,
        commandId: intent.commandId,
        action: intent.action,
        // Responses are origin-scoped because synchronized folders can expose the
        // same delegated queue on multiple devices. The external CLI must only
        // consume responses whose originDeviceId matches the device that
        // submitted the intent, otherwise another machine could continue the
        // wrong workflow.
        originDeviceId: intent.originDeviceId,
        receivedAt: intent.createdAt,
        completedAt: now().toISOString(),
        status: 'completed',
        intent,
        result: summarizeExecutionResult(intent.action, executionResult),
        nextStep: buildCompletedNextStep(intent.action)
      }
    } catch (error) {
      const status = classifyErrorStatus(error)
      const responseError = buildResponseErrorObject(error)
      response = {
        version: 1,
        commandId: draft.commandId,
        action: draft.action,
        originDeviceId: draft.originDeviceId,
        receivedAt:
          draft.parsedJson && typeof draft.parsedJson.createdAt === 'string'
            ? draft.parsedJson.createdAt
            : now().toISOString(),
        completedAt: now().toISOString(),
        status,
        ...(draft.parsedJson ? { intent: draft.parsedJson } : { raw }),
        error: responseError,
        nextStep: buildNextStepFromError(status, responseError)
      }
    }

    await writeDelegatedResponse(responsePath, response)

    processedCommands[response.commandId] = {
      processedAt: response.completedAt,
      action: response.action ?? draft.action ?? 'unknown',
      originDeviceId: response.originDeviceId,
      status: response.status,
      responseFilename
    }
    await saveProcessedCommands(domainPath, processedCommands)
    await rm(filePath, { force: true })
  }

  async function claimAndProcessIntent(domainPath: string, filePath: string): Promise<void> {
    const processingPath = join(getDomainDelegatedProcessingPath(domainPath), basename(filePath))

    try {
      await rename(filePath, processingPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }

      throw error
    }

    await processClaimedIntent(domainPath, processingPath)
  }

  async function drainDomainQueue(domainPath: string): Promise<void> {
    if (activeDomainPath !== domainPath) {
      return
    }

    const processingFiles = await listIntentFiles(getDomainDelegatedProcessingPath(domainPath))

    for (const filename of processingFiles) {
      if (activeDomainPath !== domainPath) {
        return
      }

      await processClaimedIntent(
        domainPath,
        join(getDomainDelegatedProcessingPath(domainPath), filename)
      )
    }

    const inboxFiles = await listIntentFiles(getDomainDelegatedInboxPath(domainPath))
    let skippedUnstableFile = false

    for (const filename of inboxFiles) {
      if (activeDomainPath !== domainPath) {
        return
      }

      const filePath = join(getDomainDelegatedInboxPath(domainPath), filename)
      const fileStats = await stat(filePath).catch(() => null)

      if (!fileStats?.isFile()) {
        continue
      }

      if (stabilityWindowMs > 0 && now().getTime() - fileStats.mtimeMs < stabilityWindowMs) {
        skippedUnstableFile = true
        continue
      }

      await claimAndProcessIntent(domainPath, filePath)
    }

    if (skippedUnstableFile && activeDomainPath === domainPath) {
      scheduleDrain(domainPath)
    }
  }

  function attachWatcher(domainPath: string): void {
    const queueWatcher = watchFactory(getDomainDelegatedInboxPath(domainPath), {
      ignoreInitial: true,
      awaitWriteFinish:
        stabilityWindowMs > 0
          ? {
              stabilityThreshold: stabilityWindowMs,
              pollInterval: Math.min(stabilityWindowMs, 100)
            }
          : false
    })

    queueWatcher.on('add', () => {
      scheduleDrain(domainPath)
    })
    queueWatcher.on('change', () => {
      scheduleDrain(domainPath)
    })

    watcher = queueWatcher
  }

  async function watchDomain(domainPath: string): Promise<void> {
    if (activeDomainPath !== domainPath) {
      await closeWatcher()
      activeDomainPath = domainPath
      processedCommands = await loadProcessedCommands(domainPath)
      await ensureQueueDirectories(domainPath)
      await pruneExpiredFailedIntents(domainPath, now)
      attachWatcher(domainPath)
    }

    drainQueue = drainQueue.then(() => drainDomainQueue(domainPath))
    await drainQueue
  }

  return {
    watchActiveDomain: async (): Promise<void> => {
      const domainPath = await resolveActiveDomainPath(options.domainService)

      if (!domainPath) {
        activeDomainPath = null
        processedCommands = {}
        await closeWatcher()
        return
      }

      await watchDomain(domainPath)
    },

    watchDomain,

    dispose: async (): Promise<void> => {
      activeDomainPath = null
      processedCommands = {}
      await closeWatcher()
    }
  }
}
