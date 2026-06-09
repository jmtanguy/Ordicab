/**
 * aiService — orchestration layer for the AI command pipeline.
 *
 * Responsibilities:
 *   1. Read the active AI mode from the state file on every command (so mode
 *      changes in Settings take effect without restarting).
 *   2. Guard against unsupported modes: 'none' and the delegated mode
 *      (claude-code) are not handled by this pipeline.
 *   3. Enrich the system prompt context: load the current dossiers, contacts,
 *      templates, and documents so the LLM can resolve names to stable IDs
 *      in a single turn.
 *   4. Call aiAgentRuntime.sendCommand() → returns a validated InternalAiCommand.
 *   5. For text_generate intents: make a second free-text LLM call to
 *      generate the actual content (email, letter, analysis, etc.).
 *   6. Delegate to intentDispatcher.dispatch() → returns AiCommandResult.
 *
 * Called by: aiHandler (ai:execute-command IPC handler)
 * Calls:     aiAgentRuntime | intentDispatcher | contactService | templateService
 *            | dossierService | documentService | aiSystemPrompt.buildToolSystemPrompt()
 */
import { readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import type {
  AiCommandInput,
  AiCommandResult,
  AiMode,
  AppLocale,
  ContactRecord,
  DocumentRecord,
  DossierSummary
} from '@shared/types'
import { AI_DELEGATED_MODES, IpcErrorCode } from '@shared/types'
import type { EntityProfile } from '@shared/validation/entity'
import { entityProfileSchema } from '@shared/validation/entity'

import { PiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiPseudonymizer'
import { buildPiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiContextBuilder'
import { isModelPresent, NER_MODEL } from '../../lib/aiEmbedded/modelDownloadService'
import {
  revertJsonValueWithMappingEntries,
  revertWithMappingEntriesWithOptions,
  type MappingSnapshotEntry
} from '../../lib/aiEmbedded/pii/piiMapping'
import { AiRuntimeError } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import type { AiAgentRuntime, AiChatHistoryEntry } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import { buildToolSystemPrompt } from '../../lib/aiEmbedded/aiSystemPrompt'
import type {
  ContactServiceLike,
  InternalAICommandDispatcher,
  TemplateServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import { getDomainEntityPath } from '../../lib/ordicab/ordicabPaths'
import { DataToolExecutor, resolveDossierRef } from './dataToolExecutor'
import type {
  DocumentServiceLike,
  DossierServiceLike,
  InvoiceServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import { ActionToolExecutor } from './actionToolExecutor'
import { createPiiToolGateway, type PiiHelpers } from './piiToolGateway'
import type { LegalService } from '../legal/legalService'
import {
  handleDocumentAnalyze,
  handleDocumentBatch,
  handleDossierSummarize,
  handleGenericDispatch,
  handleInlineDispatchSummary,
  handleTextGenerate,
  type IntentHandlerContext
} from './intentHandlers'

interface AppStateFile {
  ai?: {
    mode?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

interface ReadAiSettingsResult {
  mode: AiMode
  piiEnabled: boolean
  piiWordlist: string[]
}

/**
 * reads persistent settings
 * @param stateFilePath
 * @returns persistent states
 */
async function readAiSettings(stateFilePath: string): Promise<ReadAiSettingsResult> {
  const defaultResult: ReadAiSettingsResult = { mode: 'none', piiEnabled: true, piiWordlist: [] }
  if (!(await pathExists(stateFilePath))) return defaultResult

  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as AppStateFile
    const ai = parsed?.ai
    const validModes: AiMode[] = ['none', 'remote', 'claude-code']
    const mode: AiMode =
      typeof ai?.mode === 'string' && (validModes as string[]).includes(ai.mode)
        ? (ai.mode as AiMode)
        : 'none'
    const piiEnabled: boolean =
      typeof (ai as Record<string, unknown> | undefined)?.['piiEnabled'] === 'boolean'
        ? ((ai as Record<string, unknown>)['piiEnabled'] as boolean)
        : true // default enabled for remote

    // Populated when the user defines custom sensitive terms in AI Settings (e.g. company names,
    // project codes). These are added to PiiPseudonymizer.wordlist alongside auto-detected PII.
    const piiWordlist: string[] = Array.isArray(
      (ai as Record<string, unknown> | undefined)?.['piiWordlist']
    )
      ? ((ai as Record<string, unknown>)['piiWordlist'] as string[])
      : []
    return { mode, piiEnabled, piiWordlist }
  } catch {
    return defaultResult
  }
}

export interface DomainServiceLike {
  getStatus(): Promise<{ registeredDomainPath: string | null; isAvailable: boolean }>
}

export interface LocaleServiceLike {
  getLocale(): AppLocale
}

export interface AiService {
  executeCommand(
    input: AiCommandInput,
    /** Called with each streamed token during text_generate (if backend supports streaming). */
    onToken?: (token: string) => void,
    /** Called with each intermediate assistant reasoning step between tool calls. */
    onReflection?: (text: string) => void
  ): Promise<AiCommandResult>
  cancelCommand(): void
  resetConversation(): Promise<void>
}

export interface AiServiceOptions {
  aiAgentRuntime: AiAgentRuntime
  configureRemoteLanguageModel?: (model?: string) => Promise<void>
  intentDispatcher: InternalAICommandDispatcher
  contactService: ContactServiceLike
  templateService: TemplateServiceLike
  dossierService: DossierServiceLike
  documentService: DocumentServiceLike
  invoiceService: InvoiceServiceLike
  legalService?: LegalService
  domainService: DomainServiceLike
  localeService: LocaleServiceLike
  stateFilePath: string
  /** Absolute path to the directory containing Tesseract traineddata files. */
  tessDataPath: string
  /**
   * Absolute path to the bundled NER model directory (transformers.js
   * `localModelPath` layout). When null/undefined the pseudonymizer falls
   * back to regex-only detection — same observable behavior as before.
   */
  nerModelPath?: string | null
  /**
   * RGPD gate: returns true when the NER model is present and pseudonymisation
   * can run reliably. Remote calls are refused when this is false and PII
   * protection is on. Defaults to a filesystem check of `nerModelPath`;
   * injectable for tests that exercise the pseudonymizer with a mocked model.
   */
  isNerModelReady?: () => Promise<boolean>
}

function formatCurrentDate(locale: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }
  const resolvedLocale = locale === 'en' ? 'en-US' : 'fr-FR'

  try {
    return new Date().toLocaleDateString(resolvedLocale, options)
  } catch {
    return new Date().toLocaleDateString('fr-FR', options)
  }
}

async function loadEntityProfile(domainPath: string): Promise<EntityProfile | null> {
  try {
    const raw = await readFile(getDomainEntityPath(domainPath), 'utf8')
    const parsed = entityProfileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as EntityProfile) : null
  } catch {
    return null
  }
}

function truncateForLog(value: string, maxLength = 1200): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}… [truncated ${value.length - maxLength} chars]`
}

function logToolLoopEntries(
  entries: AiChatHistoryEntry[],
  revertPiiText: (text: string) => string
): void {
  if (entries.length === 0) return

  console.log(`\n╔══ AI TOOL LOOP (${entries.length} entries) ${'═'.repeat(36)}`)
  let callIndex = 0

  for (const entry of entries) {
    if (entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0) {
      for (const toolCall of entry.toolCalls) {
        callIndex += 1
        const args = truncateForLog(revertPiiText(toolCall.function.arguments))
        console.log(`║ [${callIndex}] tool_call  : ${toolCall.function.name}`)
        console.log(`║      toolCallId : ${toolCall.id}`)
        console.log(`║      args       : ${args.split('\n').join('\n║                   ')}`)
      }
      continue
    }

    if (entry.role === 'tool') {
      const output = truncateForLog(revertPiiText(entry.content))
      console.log(`║      tool_result: ${entry.name ?? '(unknown tool)'} (${entry.toolCallId})`)
      console.log(`║      output     : ${output.split('\n').join('\n║                   ')}`)
    }
  }

  console.log('╚══════════════════════════════════════════════════════════')
}

function buildHistoryEntries(
  userCommand: string,
  feedback: string,
  loopEntries: import('../../lib/aiEmbedded/aiSdkAgentRuntime').AiChatHistoryEntry[]
): import('../../lib/aiEmbedded/aiSdkAgentRuntime').AiChatHistoryEntry[] {
  // When the tool loop produced intermediate assistant+tool pairs, persist the full
  // valid sequence so subsequent turns can see that data tools already ran and avoid
  // redundant re-calls (e.g. contact_lookup already fetched on previous turn).
  if (loopEntries.length > 0) {
    // The last loop entry is the terminal action tool call (e.g. clarification_request,
    // document_generate). It has toolCalls set but no corresponding tool result follows —
    // which is invalid for OpenAI-compatible APIs and triggers a 400 on the next turn.
    // Drop that final entry entirely: the feedback message below already represents
    // the assistant's response for history purposes.
    const lastEntry = loopEntries[loopEntries.length - 1]
    const hasUnresolvedToolCall =
      lastEntry?.role === 'assistant' &&
      'toolCalls' in lastEntry &&
      lastEntry.toolCalls &&
      lastEntry.toolCalls.length > 0
    const sanitized = hasUnresolvedToolCall ? loopEntries.slice(0, -1) : loopEntries

    // If the tool loop already contains assistant text, do not append a second
    // assistant feedback message: it causes duplicated responses with a second
    // pseudonymization pass on already-pseudonymized content.
    const hasAssistantTextInLoop = sanitized.some(
      (entry) => entry.role === 'assistant' && entry.content.trim().length > 0
    )
    if (hasAssistantTextInLoop) {
      return [{ role: 'user', content: userCommand }, ...sanitized]
    }

    return [
      { role: 'user', content: userCommand },
      ...sanitized,
      { role: 'assistant', content: feedback }
    ]
  }
  return [
    { role: 'user', content: userCommand },
    { role: 'assistant', content: feedback }
  ]
}

function mergePiiDecodeLedger(
  current: MappingSnapshotEntry[],
  next: MappingSnapshotEntry[]
): MappingSnapshotEntry[] {
  if (next.length === 0) return current
  const byExactEntry = new Map<string, MappingSnapshotEntry>()
  for (const entry of [...current, ...next]) {
    if (!entry.original || !entry.markerPath || !entry.fakeValue) continue
    byExactEntry.set(`${entry.original}\u0000${entry.markerPath}\u0000${entry.fakeValue}`, entry)
  }
  // Bound the ledger because it only exists to decode earlier assistant/tool
  // text in the same conversation, not to become a long-lived archive.
  return Array.from(byExactEntry.values()).slice(-2000)
}

function revertJsonWithPiiEntries(
  obj: unknown,
  entries: MappingSnapshotEntry[],
  currentTurnEntries: MappingSnapshotEntry[] = []
): unknown {
  // Delegated to piiMapping. currentTurnEntries describe the values the LLM
  // just saw and override stale cross-turn collisions in the decode ledger.
  return revertJsonValueWithMappingEntries(obj, entries, { currentTurnEntries })
}

// ── Service factory ────────────────────────────────────────────────────────

export function createAiService(options: AiServiceOptions): AiService {
  const {
    aiAgentRuntime,
    configureRemoteLanguageModel,
    intentDispatcher,
    contactService,
    templateService,
    dossierService,
    documentService,
    invoiceService,
    legalService,
    domainService,
    localeService,
    stateFilePath,
    nerModelPath
  } = options

  // RGPD gate check: present-on-disk by default, overridable for tests.
  const isNerModelReady =
    options.isNerModelReady ??
    (async () =>
      nerModelPath ? isModelPresent(nerModelPath, NER_MODEL).catch(() => false) : false)

  // Keeps prior-turn mappings only for local decoding. It is never passed back
  // into PiiPseudonymizer, so it cannot seed or alter values sent to the LLM.
  let piiDecodeLedger: MappingSnapshotEntry[] = []

  return {
    cancelCommand(): void {
      aiAgentRuntime.cancelCommand()
    },

    async resetConversation(): Promise<void> {
      piiDecodeLedger = []
      await aiAgentRuntime.resetConversation()
    },

    // ── main command entry point ──────────────────────────────────────────────
    async executeCommand(
      input: AiCommandInput,
      onToken?: (token: string) => void, // for streamed tokens
      onReflection?: (text: string) => void // for intermediate reasoning steps
    ): Promise<AiCommandResult> {
      // reads persisent settings
      const { mode, piiEnabled, piiWordlist } = await readAiSettings(stateFilePath)

      // check if AI is disable, it should never be reached as the rendered hides the command
      if (mode === 'none') {
        throw new AiRuntimeError(
          'Configure an AI mode in Settings to use this feature.',
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      // two modes are managed, embedded and delegated to external CLI
      if (AI_DELEGATED_MODES.includes(mode)) {
        throw new AiRuntimeError(
          `You're using ${mode} — run your CLI tool directly to interact with Ordicab.`,
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      // Only 'remote' reaches here: 'none' and the delegated mode (claude-code)
      // are rejected above.

      // RGPD gate: remote calls send pseudonymized text to a third party. The
      // NER model is the position-oracle that makes pseudonymisation reliable;
      // without it, detection silently degrades to regex-only. So when PII
      // protection is enabled, refuse the remote call until the NER model has
      // finished downloading, rather than leak under-redacted text.
      if (piiEnabled && nerModelPath) {
        const nerReady = await isNerModelReady()
        if (!nerReady) {
          throw new AiRuntimeError(
            'PII protection is still downloading. Remote AI is paused until it finishes, to avoid sending under-redacted text.',
            IpcErrorCode.AI_RUNTIME_UNAVAILABLE
          )
        }
      }

      if (configureRemoteLanguageModel) {
        await configureRemoteLanguageModel(input.model)
      }
      const appLocale = localeService.getLocale()
      // `rawDossierId` is the UUID of the dossier selected in the AI panel's dossier selector.
      // It binds the current conversation to a specific dossier so tools default to it.
      // TODO: rename to rawDossierUUID everywhere for clarity (dossierId currently holds a UUID).
      const rawDossierId = input.context.dossierId
      // Helper as current date can be meaningfull in this context to differentiate past from future
      const currentDate = formatCurrentDate(appLocale)

      // resolveDossierRef tries to match rawDossierId against the loaded dossier list (by UUID,
      // then by id, then by name). In practice rawDossierId is always a valid UUID from the UI
      // selector, so this resolution is a safety net for legacy / migrated dossier entries.
      const domainStatus = await domainService
        .getStatus()
        .catch(() => ({ registeredDomainPath: null as string | null, isAvailable: false }))

      const [dossiers, templates, entityProfile] = await Promise.all([
        dossierService.listRegisteredDossiers().catch(() => [] as DossierSummary[]),
        templateService
          .list()
          .then((ts) =>
            ts.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              macros: t.macros
            }))
          )
          .catch(() => []),
        domainStatus.registeredDomainPath
          ? loadEntityProfile(domainStatus.registeredDomainPath).catch(() => null)
          : Promise.resolve(null as EntityProfile | null)
      ])

      const dossierId = resolveDossierRef(rawDossierId, dossiers) ?? rawDossierId ?? null

      // Eagerly load contacts, documents, and dossierDetail for the active dossier.
      // Even though the agent now fetches data via tools, these are still needed here for:
      // - PiiPseudonymizer context (contacts + dossierDetail.keyDates/keyReferences)
      // - text_generate fallback path
      // TODO: consider making this lazy once PII context can be deferred too.
      const [contacts, documents, dossierDetail] = await Promise.all([
        dossierId
          ? contactService.list(dossierId).catch(() => [] as ContactRecord[])
          : Promise.resolve([] as ContactRecord[]),
        dossierId
          ? documentService.listDocuments({ dossierId }).catch(() => [] as DocumentRecord[])
          : Promise.resolve([] as DocumentRecord[]),
        dossierId
          ? dossierService.getDossier({ dossierId }).catch(() => null)
          : Promise.resolve(null)
      ])

      // ── PII pseudonymization (remote mode only) ───────────────────────────
      // piiPseudo is created here, in this service, for each command.
      // There is no outer/caller-side pseudonymizer: aiService IS the entry point
      // for AI commands and owns the full pseudonymize → revert lifecycle.
      const piiPseudo: PiiPseudonymizer | null = piiEnabled
        ? buildPiiPseudonymizer({
            contacts,
            dossierDetail,
            entityProfile,
            dossiers,
            templates,
            piiWordlist,
            currentDate,
            locale: appLocale as 'fr' | 'en',
            nerModelPath,
            // Pre-seed with prior-turn mappings so the new turn keeps stable
            // fakes for already-known originals AND pickUniqueFake dodges
            // fakes taken by other originals — eliminating the cross-turn
            // collisions that produced ambiguous bare-fake decoding.
            priorEntries: piiDecodeLedger
          })
        : null
      // Two helpers sharing the same piiPseudo instance (and thus the same mapping):
      //   • pseudonymizeText — plain-text path, used for prose (system prompts, user
      //     command, history, text_generate prompts) and for selected fields of
      //     tool results that need fine-grained control.
      //   • pseudonymizeAuto — JSON-aware fallback, used as the generic tool-result
      //     path: parses JSON and only pseudonymizes string values, leaving keys
      //     and UUID-shaped structural fields intact.
      const pseudonymizeText = async (text: string): Promise<string> =>
        piiPseudo ? piiPseudo.pseudonymizeAsync(text) : text
      const pseudonymizeAuto = async (text: string): Promise<string> =>
        piiPseudo ? piiPseudo.pseudonymizeAutoAsync(text) : text
      // Merge the current turn's mapping with prior decode-only entries so the
      // UI can still decode values echoed back from older turns, without
      // feeding those older entries back into the next pseudonymization pass.
      const currentPiiDecodeEntries = (): MappingSnapshotEntry[] =>
        piiPseudo ? mergePiiDecodeLedger(piiDecodeLedger, piiPseudo.exportMapping()) : []
      const currentTurnPiiEntries = (): MappingSnapshotEntry[] =>
        piiPseudo ? piiPseudo.exportMapping() : []
      const revertPiiText = (text: string): string =>
        piiPseudo
          ? revertWithMappingEntriesWithOptions(text, currentPiiDecodeEntries(), {
              currentTurnEntries: currentTurnPiiEntries()
            })
          : text
      const revertPiiJson = <T>(obj: T): T =>
        piiPseudo
          ? (revertJsonWithPiiEntries(obj, currentPiiDecodeEntries(), currentTurnPiiEntries()) as T)
          : obj
      const rememberPiiDecodeEntries = (): void => {
        if (piiPseudo) {
          piiDecodeLedger = mergePiiDecodeLedger(piiDecodeLedger, piiPseudo.exportMapping())
        }
      }

      // For buildTextGenerationPrompt which expects id instead of uuid
      const textGenerationContacts = contacts.map((c: ContactRecord) => ({
        id: c.uuid,
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
        role: c.role,
        email: c.email
      }))

      const activePromptDossierId =
        piiPseudo && dossierId
          ? (dossiers.find((d) => d.id === dossierId || d.uuid === dossierId)?.uuid ?? dossierId)
          : (dossierId ?? undefined)
      // id/uuid only: buildToolSystemPrompt resolves the active dossier from this
      // list but never renders dossier names — no PII reaches the prompt, so no
      // pseudonymization pass is needed here.
      const promptDossiers = dossiers.map((d: DossierSummary) => ({
        id: piiPseudo ? (d.uuid ?? d.id) : d.id,
        uuid: d.uuid
      }))

      // `@<filename>` mentions resolved by the renderer carry the document UUID
      // for each filename. Pseudonymize the visible filename so it matches the
      // form the LLM sees in the (sanitized) user message; the UUID is preserved
      // by the pseudonymizer verbatim.
      const rawDocumentMentions = input.context.documentMentions ?? []
      const promptDocumentMentions = piiPseudo
        ? await Promise.all(
            rawDocumentMentions.map(async (m) => ({
              uuid: m.uuid,
              filename: await pseudonymizeText(m.filename)
            }))
          )
        : rawDocumentMentions

      // SystemPromptContext fed into the tool-mode prompt builder.
      const promptContext = {
        dossierId: activePromptDossierId,
        piiEnabled,
        currentDate,
        locale: appLocale as 'fr' | 'en',
        dossiers: promptDossiers,
        documentMentions: promptDocumentMentions
      }
      const toolSystemPrompt = buildToolSystemPrompt(promptContext)
      const safeToolSystemPrompt = toolSystemPrompt

      // ── Tag override shortcut ─────────────────────────────────────────────
      // When pendingTagPaths is set, the user's message is a direct answer to
      // missing template fields. Bypass the LLM and build the intent directly.
      if (input.context.pendingTagPaths && input.context.pendingTagPaths.length > 0) {
        const pendingPaths = input.context.pendingTagPaths
        const userValue = input.command.trim()
        const tagOverrides: Record<string, string> = {}
        for (const path of pendingPaths) {
          tagOverrides[path] = userValue
        }
        const directIntent = {
          type: 'document_generate' as const,
          dossierId: input.context.dossierId ?? '',
          templateId: input.context.templateId ?? '',
          tagOverrides
        }
        rememberPiiDecodeEntries()
        return intentDispatcher.dispatch(directIntent, input.context)
      }

      const intentT0 = Date.now()

      // DataToolExecutor handles read-only tools (contact_lookup, dossier_get, document_search…).
      // Its results are fed back to the LLM as tool messages; the loop continues after each call.
      const dataToolExecutor = new DataToolExecutor({
        dossierId,
        dossiers,
        contactService,
        templateService,
        documentService,
        dossierService,
        invoiceService,
        legalService,
        entityProfile
      })

      // ActionToolExecutor handles batchable mutation tools (contact_create/contact_update, contact_delete…).
      // Batchable actions are executed inline inside the tool loop — the result is fed back
      // to the LLM so it can chain multiple mutations in one turn (e.g. create several contacts).
      // `lastInlineDispatchResult` tracks the most recently dispatched result so that when the
      // loop ends with a direct_response summary, the inline result's context update is preserved.
      const actionToolExecutor = new ActionToolExecutor({
        dossierId,
        dossiers,
        locale: appLocale,
        documentService,
        intentDispatcher,
        context: input.context
      })
      const effectiveCommand = input.command
      const sanitizedCommand = await pseudonymizeText(effectiveCommand)
      const sanitizedHistory =
        input.history && piiPseudo
          ? await Promise.all(
              input.history.map(async (h: { role: 'user' | 'assistant'; content: string }) => ({
                ...h,
                content: await pseudonymizeText(h.content)
              }))
            )
          : input.history
      // Single decision point for PII tool wrapping. With piiPseudo set, the
      // gateway reverts every tool's args before execution and pseudonymizes
      // its result before feeding it back to the LLM, dispatching per-tool
      // strategies (see piiToolGateway.ts). Without it, executors run raw.
      const piiHelpers: PiiHelpers | null = piiPseudo
        ? { pseudonymizeText, pseudonymizeAuto, revertPiiText, revertPiiJson }
        : null
      const toolGateway = createPiiToolGateway(piiHelpers, dataToolExecutor, actionToolExecutor)

      const wrappedOnReflection = onReflection
        ? (text: string): void => {
            // Revert any anonymized values the model emits so the UI shows natural prose.
            onReflection(revertPiiText(text))
          }
        : undefined
      const intent = await aiAgentRuntime.sendCommand({
        command: sanitizedCommand,
        context: input.context,
        toolSystemPrompt: safeToolSystemPrompt,
        model: input.model,
        history: sanitizedHistory,
        locale: appLocale as 'fr' | 'en',
        domainPath: domainStatus.registeredDomainPath ?? undefined,
        executeDataTool: toolGateway.executeDataTool,
        executeActionTool: toolGateway.executeActionTool,
        onReflection: wrappedOnReflection
      })
      logToolLoopEntries(aiAgentRuntime.getLastToolLoopEntries(), revertPiiText)
      const intentDebugTrace = aiAgentRuntime.getDebugTrace() ?? undefined

      // Revert any anonymized values the LLM echoed back in the intent fields.
      const revertedIntent = revertPiiJson(intent)

      console.log(`\n╔══ AI INTENT (${Date.now() - intentT0}ms) ${'═'.repeat(40)}`)
      console.log(`║ type       : ${revertedIntent.type}`)
      console.log(
        `║ intent     : ${JSON.stringify(revertedIntent, null, 2)
          .split('\n')
          .map((l, i) => (i === 0 ? l : `║             ${l}`))
          .join('\n')}`
      )
      console.log('╚══════════════════════════════════════════════════════════')

      // Build the per-command context once and dispatch to a named handler.
      // Every handler MUST call ctx.commitIntentToHistory exactly once before
      // returning, so subsequent turns inherit conversation history and can
      // decode anonymized values echoed back from the LLM.
      const commitIntentToHistory = (feedback: string, intentType: string): void => {
        aiAgentRuntime.appendHistory(
          buildHistoryEntries(sanitizedCommand, feedback, aiAgentRuntime.getLastToolLoopEntries()),
          intentType
        )
        rememberPiiDecodeEntries()
      }
      const ctx: IntentHandlerContext = {
        aiAgentRuntime,
        intentDispatcher,
        dataToolExecutor,
        actionToolExecutor,
        documentService,
        piiPseudo,
        pseudonymizeText,
        revertPiiText,
        dossierId,
        dossierDetail,
        documents,
        textGenerationContacts,
        appLocale,
        sanitizedCommand,
        intentDebugTrace,
        inputContext: input.context,
        onToken,
        commitIntentToHistory
      }

      // Inline dispatch summary takes precedence: when actionToolExecutor
      // ran a terminal action inline, its result must propagate even though
      // the LLM closed the loop with a direct_response narration.
      if (
        revertedIntent.type === 'direct_response' &&
        actionToolExecutor.lastInlineDispatchResult
      ) {
        return handleInlineDispatchSummary(ctx, revertedIntent)
      }

      switch (revertedIntent.type) {
        case 'text_generate':
          return handleTextGenerate(ctx, revertedIntent)
        case 'dossier_summarize':
          return handleDossierSummarize(ctx, revertedIntent)
        case 'document_metadata_batch':
        case 'document_summary_batch':
          return handleDocumentBatch(ctx, revertedIntent)
        case 'document_analyze':
          return handleDocumentAnalyze(ctx, revertedIntent)
        default:
          return handleGenericDispatch(ctx, revertedIntent)
      }
    }
  }
}
