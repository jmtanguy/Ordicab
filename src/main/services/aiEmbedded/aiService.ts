/**
 * aiService — orchestration layer for the AI command pipeline.
 *
 * Responsibilities:
 *   1. Read the active AI mode from the state file on every command (so mode
 *      changes in Settings take effect without restarting).
 *   2. Guard against unsupported modes: 'none' and external modes
 *      (claude-code, copilot, codex) are not handled by this pipeline.
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
 *            | dossierService | documentService | aiSystemPrompt.buildSystemPrompt()
 *            | aiSystemPrompt.buildToolSystemPrompt()
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
  DossierDetail,
  DossierSummary,
  TextGenerateIntent
} from '@shared/types'
import { AI_DELEGATED_MODES, IpcErrorCode } from '@shared/types'
import type { EntityProfile } from '@renderer/schemas/entity'
import { entityProfileSchema } from '@renderer/schemas/entity'

import { PiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiPseudonymizer'
import type { PiiContext } from '../../lib/aiEmbedded/pii/piiPseudonymizer'
import { AiRuntimeError } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import type { AiAgentRuntime, AiChatHistoryEntry } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import { buildSystemPrompt, buildToolSystemPrompt } from '../../lib/aiEmbedded/aiSystemPrompt'
import type {
  ContactServiceLike,
  InternalAICommandDispatcher,
  TemplateServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import { getDomainEntityPath, getDomainRegistryPath } from '../../lib/ordicab/ordicabPaths'
import {
  DataToolExecutor,
  resolveDossierRef,
  pseudonymizeDocumentToolResult,
  pseudonymizeActionToolResult
} from './dataToolExecutor'
import type { DataToolHistoryEntry } from './dataToolExecutor'
import type {
  DocumentServiceLike,
  DossierServiceLike
} from '../../lib/aiEmbedded/aiCommandDispatcher'
import { ActionToolExecutor } from './actionToolExecutor'
import { BATCHABLE_ACTION_TOOL_NAMES } from '../../lib/aiEmbedded/aiToolDefinitions'

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
  const defaultResult: ReadAiSettingsResult = { mode: 'local', piiEnabled: true, piiWordlist: [] }
  if (!(await pathExists(stateFilePath))) return defaultResult

  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as AppStateFile
    const ai = parsed?.ai
    const validModes: AiMode[] = ['none', 'local', 'remote', 'claude-code', 'copilot', 'codex']
    const mode: AiMode =
      typeof ai?.mode === 'string' && (validModes as string[]).includes(ai.mode)
        ? (ai.mode as AiMode)
        : 'local'
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
    onToken?: (token: string) => void
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
  domainService: DomainServiceLike
  localeService: LocaleServiceLike
  stateFilePath: string
  /** Absolute path to the directory containing Tesseract traineddata files. */
  tessDataPath: string
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

function logToolLoopEntries(entries: AiChatHistoryEntry[]): void {
  if (entries.length === 0) return

  console.log(`\n╔══ AI TOOL LOOP (${entries.length} entries) ${'═'.repeat(36)}`)
  let callIndex = 0

  for (const entry of entries) {
    if (entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0) {
      for (const toolCall of entry.toolCalls) {
        callIndex += 1
        const args = truncateForLog(toolCall.function.arguments)
        console.log(`║ [${callIndex}] tool_call  : ${toolCall.function.name}`)
        console.log(`║      toolCallId : ${toolCall.id}`)
        console.log(`║      args       : ${args.split('\n').join('\n║                   ')}`)
      }
      continue
    }

    if (entry.role === 'tool') {
      const output = truncateForLog(entry.content)
      console.log(`║      tool_result: ${entry.name ?? '(unknown tool)'} (${entry.toolCallId})`)
      console.log(`║      output     : ${output.split('\n').join('\n║                   ')}`)
    }
  }

  console.log('╚══════════════════════════════════════════════════════════')
}

// TODO: move this builder to the PII directory (e.g. piiPseudonymizer.ts or a new piiBuilder.ts).
// `contacts` is passed explicitly because it is already loaded at call site as ContactRecord[],
// while dossierDetail.contacts (if it exists) may have a different shape or not be present.
function buildPiiPseudonymizer(
  contacts: ContactRecord[],
  dossierDetail: DossierDetail | null,
  entityProfile: EntityProfile | null,
  templates: Array<{ name: string }>,
  piiWordlist: string[],
  locale: 'fr' | 'en'
): PiiPseudonymizer {
  const piiContext: PiiContext = {
    // Maps ContactRecord to PiiContext.contacts. `customFields` is intentionally omitted here:
    // managed-field values are typically labels/keys that should NOT be pseudonymized
    // (they appear in the PII allowlist via entityProfile.managedFields above).
    contacts: contacts.map((c: ContactRecord) => ({
      id: c.uuid,
      role: c.role,
      gender: c.gender,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      addressLine: c.addressLine,
      addressLine2: c.addressLine2,
      zipCode: c.zipCode,
      city: c.city,
      institution: c.institution,
      information: c.information
    })),
    keyDates:
      dossierDetail?.keyDates?.map((kd: { label: string; date: string; note?: string }) => ({
        label: kd.label,
        value: kd.date,
        note: kd.note
      })) ?? [],
    keyRefs:
      dossierDetail?.keyReferences?.map((kr: { label: string; value: string; note?: string }) => ({
        label: kr.label,
        value: kr.value,
        note: kr.note
      })) ?? [],
    allowlist: [
      ...(entityProfile?.managedFields?.contactRoles ?? []),
      ...(entityProfile?.managedFields?.contacts?.map((field) => field.label) ?? []),
      ...(entityProfile?.managedFields?.keyDates?.map((field) => field.label) ?? []),
      ...(entityProfile?.managedFields?.keyReferences?.map((field) => field.label) ?? []),
      ...templates.map((t) => t.name)
    ],
    wordlist: piiWordlist,
    locale
  }
  return new PiiPseudonymizer(piiContext)
}

interface RegistryFolderEntry {
  id: string
  uuid?: string
  name: string
}

async function loadRegistryFolderMap(domainPath: string): Promise<RegistryFolderEntry[]> {
  try {
    const raw = await readFile(getDomainRegistryPath(domainPath), 'utf8')
    const parsed = JSON.parse(raw) as { dossiers?: unknown[] }
    if (!Array.isArray(parsed.dossiers)) return []

    return parsed.dossiers.flatMap((entry) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string' &&
        typeof (entry as { name?: unknown }).name === 'string'
      ) {
        const record = entry as { id: string; uuid?: unknown; name: string }
        return [
          {
            id: record.id,
            uuid: typeof record.uuid === 'string' ? record.uuid : undefined,
            name: record.name
          }
        ]
      }
      return []
    })
  } catch {
    return []
  }
}

function resolvePromptFolderPath(
  dossier: DossierSummary,
  registryEntries: RegistryFolderEntry[]
): string | undefined {
  return (
    registryEntries.find((entry) => entry.uuid && dossier.uuid && entry.uuid === dossier.uuid)
      ?.id ??
    registryEntries.find((entry) => entry.id === dossier.id)?.id ??
    registryEntries.find((entry) => entry.name === dossier.name)?.id
  )
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

// ── Text generation (second LLM call for text_generate intent) ─────────────

async function buildTextGenerationPrompt(
  intent: TextGenerateIntent,
  dossierId: string | undefined,
  contacts: Array<{ id: string; name: string; role?: string; email?: string }>,
  dossier: DossierDetail | DossierSummary | null,
  documents: DocumentRecord[],
  dataToolHistory: DataToolHistoryEntry[],
  pseudonymize?: (text: string) => string
): Promise<{ prompt: string; systemPrompt: string }> {
  const lang = intent.language ?? 'fr'
  const contact = intent.contactId ? contacts.find((c) => c.id === intent.contactId) : null
  const dossierName = dossier && 'name' in dossier ? dossier.name : (dossierId ?? '')

  const systemLines = [
    `You are a professional legal document writer. Write in ${lang === 'fr' ? 'French' : lang === 'en' ? 'English' : lang}.`,
    'Write ONLY the requested text content. Do not add explanations or commentary.',
    'Be professional, clear, and concise.'
  ]
  if (dossierName) systemLines.push(`Context: Dossier "${dossierName}".`)
  if (contact) {
    const contactDesc = [contact.name, contact.role, contact.email].filter(Boolean).join(', ')
    systemLines.push(`Recipient: ${contactDesc}.`)
  }
  if (documents.length > 0) {
    systemLines.push(`Related documents: ${documents.map((d) => d.filename).join(', ')}.`)
  }

  // Inject document_search excerpts collected during the agent loop so the
  // text generation LLM can ground its output in actual dossier content.
  const searchExcerpts: Array<{ documentId: string; filename: string; excerpt: string }> = []
  for (const entry of dataToolHistory) {
    if (entry.toolName !== 'document_search') continue
    try {
      const parsed = JSON.parse(entry.result) as {
        matches?: Array<{ documentId: string; filename: string; excerpt: string }>
      }
      if (Array.isArray(parsed.matches)) {
        for (const m of parsed.matches) {
          if (!searchExcerpts.some((e) => e.excerpt === m.excerpt)) {
            searchExcerpts.push({
              documentId: m.documentId,
              filename: m.filename,
              excerpt: m.excerpt
            })
          }
        }
      }
    } catch {
      // malformed result — skip
    }
  }
  if (searchExcerpts.length > 0) {
    systemLines.push(
      '\nThe following excerpts were retrieved from the dossier documents. ' +
        'Base your output on this content — do NOT invent facts not present in these excerpts:'
    )
    for (const { filename, excerpt } of searchExcerpts) {
      const safeFilename = pseudonymize ? pseudonymize(filename) : filename
      const safeExcerpt = pseudonymize ? pseudonymize(excerpt) : excerpt
      systemLines.push(`\n[${safeFilename}]\n${safeExcerpt}`)
    }
  }

  const typeLabels: Record<string, string> = {
    email: lang === 'fr' ? 'un email professionnel' : 'a professional email',
    letter: lang === 'fr' ? 'une lettre professionnelle' : 'a professional letter',
    analysis: lang === 'fr' ? 'une analyse' : 'an analysis',
    summary: lang === 'fr' ? 'un résumé' : 'a summary',
    text: lang === 'fr' ? 'un texte' : 'a text'
  }
  const typeLabel = typeLabels[intent.textType] ?? intent.textType
  const prompt =
    lang === 'fr'
      ? `Rédige ${typeLabel} pour: ${intent.instructions}`
      : `Write ${typeLabel} for: ${intent.instructions}`

  return { prompt, systemPrompt: systemLines.join('\n') }
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
    domainService,
    localeService,
    stateFilePath
  } = options

  function sanitizePiiRevertedStringValue(value: string, piiPseudo: PiiPseudonymizer): string {
    const reverted = piiPseudo.revert(value)
    return reverted
      .replace(/\[\[[^\]]+\]\]/g, ' ')
      .replace(/[`'"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function sanitizeContactUpsertArgsAfterPiiRevert(
    args: Record<string, unknown>,
    piiPseudo: PiiPseudonymizer
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...args }
    const textFields = [
      'firstName',
      'lastName',
      'role',
      'email',
      'phone',
      'title',
      'institution',
      'addressLine',
      'addressLine2',
      'city',
      'zipCode',
      'country',
      'information'
    ] as const

    for (const field of textFields) {
      if (typeof out[field] === 'string') {
        out[field] = sanitizePiiRevertedStringValue(out[field] as string, piiPseudo)
      }
    }

    if (out['customFields'] && typeof out['customFields'] === 'object') {
      const customFields = out['customFields'] as Record<string, unknown>
      const sanitizedCustomFields: Record<string, string> = {}
      for (const [key, value] of Object.entries(customFields)) {
        if (typeof value !== 'string') continue
        const sanitizedValue = sanitizePiiRevertedStringValue(value, piiPseudo)
        if (sanitizedValue) sanitizedCustomFields[key] = sanitizedValue
      }
      out['customFields'] = sanitizedCustomFields
    }

    if (typeof out['city'] === 'string' && typeof out['zipCode'] === 'string') {
      const cityValue = out['city'] as string
      const zipValue = out['zipCode'] as string
      const match = cityValue.match(/^(\d{5})\s+(.+)$/)
      if (match) {
        if (!zipValue || zipValue === match[1]) out['zipCode'] = match[1]
        out['city'] = match[2]
      }
    }

    return out
  }

  return {
    cancelCommand(): void {
      aiAgentRuntime.cancelCommand()
    },

    async resetConversation(): Promise<void> {
      await aiAgentRuntime.resetConversation()
    },

    // ── main command entry point ──────────────────────────────────────────────
    async executeCommand(
      input: AiCommandInput,
      onToken?: (token: string) => void // for streamed tokens
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

      // Two embedded modes: 'local' uses Ollama (local LLM), 'remote' uses a remote API
      // (Mistral, OpenAI-compatible, etc.). Delegated modes (claude-code, copilot, codex)
      // are rejected above and never reach this point.
      const runtimeMode = mode === 'remote' ? 'remote' : 'local'
      if (runtimeMode === 'remote' && configureRemoteLanguageModel) {
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

      const [dossiers, templates, entityProfile, registryEntries] = await Promise.all([
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
          : Promise.resolve(null as EntityProfile | null),
        domainStatus.registeredDomainPath
          ? loadRegistryFolderMap(domainStatus.registeredDomainPath).catch(
              () => [] as RegistryFolderEntry[]
            )
          : Promise.resolve([] as RegistryFolderEntry[])
      ])

      const dossierId = resolveDossierRef(rawDossierId, dossiers) ?? rawDossierId ?? null

      // Eagerly load contacts, documents, and dossierDetail for the active dossier.
      // Even though the agent now fetches data via tools, these are still needed here for:
      // - PiiPseudonymizer context (contacts + dossierDetail.keyDates/keyReferences)
      // - buildSystemPrompt dynamic examples (contacts, documents)
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

      // Minimal contact shape for JSON-mode prompt examples (name resolution by the LLM).
      // Phone and managed fields are intentionally omitted — the LLM resolves names to IDs
      // only; full contact details are fetched via contact_get when needed.
      const promptContacts = contacts.map((c: ContactRecord) => ({
        uuid: c.uuid,
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
        role: c.role,
        email: c.email
      }))

      // For buildTextGenerationPrompt which expects id instead of uuid
      const textGenerationContacts = contacts.map((c: ContactRecord) => ({
        id: c.uuid,
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
        role: c.role,
        email: c.email
      }))

      // SystemPromptContext fed into both prompt builders.
      const promptContext = {
        dossierId: dossierId ?? undefined,
        piiEnabled: runtimeMode === 'remote' && piiEnabled,
        currentDate,
        contacts: promptContacts,
        templates,
        dossiers: dossiers.map((d: DossierSummary) => ({
          id: d.id,
          uuid: d.uuid,
          name: d.name,
          status: d.status,
          type: d.type,
          folderPath: resolvePromptFolderPath(d, registryEntries) ?? d.id
        }))
      }
      // Build two prompt variants from the same context:
      // standard mode returns JSON intents, while tool mode swaps in native
      // tool-calling instructions instead of the JSON schema/examples.
      const systemPrompt = buildSystemPrompt(promptContext)
      const toolSystemPrompt = buildToolSystemPrompt(promptContext)

      // ── PII pseudonymization (remote mode only) ───────────────────────────
      // piiPseudo is created here, in this service, for each command.
      // There is no outer/caller-side pseudonymizer: aiService IS the entry point
      // for AI commands and owns the full pseudonymize → revert lifecycle.
      const piiPseudo: PiiPseudonymizer | null =
        runtimeMode === 'remote' && piiEnabled
          ? buildPiiPseudonymizer(
              contacts,
              dossierDetail,
              entityProfile,
              templates,
              piiWordlist,
              appLocale as 'fr' | 'en'
            )
          : null

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
        return intentDispatcher.dispatch(directIntent, input.context)
      }

      const intentT0 = Date.now()
      // console.log('\n╔══ AI REQUEST ════════════════════════════════════════════')
      // console.log(`║ command    : ${input.command}`)
      // console.log(`║ model      : ${input.model ?? '(default)'}`)
      // console.log(`║ mode       : ${runtimeMode}`)
      // if (input.history && input.history.length > 0) {
      //   console.log(`║ history    : ${input.history.length} messages`)
      // }
      // console.log(`║ systemPrompt (${systemPrompt.length} chars):\n${systemPrompt.split('\n').map(l => `║   ${l}`).join('\n')}`)
      // console.log('╚══════════════════════════════════════════════════════════')

      // DataToolExecutor handles read-only tools (contact_lookup, dossier_get, document_search…).
      // Its results are fed back to the LLM as tool messages; the loop continues after each call.
      const dataToolExecutor = new DataToolExecutor({
        dossierId,
        dossiers,
        contactService,
        templateService,
        documentService,
        dossierService,
        entityProfile
      })

      // ActionToolExecutor handles batchable mutation tools (contact_upsert, contact_delete…).
      // Batchable actions are executed inline inside the tool loop — the result is fed back
      // to the LLM so it can chain multiple mutations in one turn (e.g. create several contacts).
      // `lastInlineDispatchResult` tracks the most recently dispatched result so that when the
      // loop ends with a direct_response summary, the inline result's context update is preserved.
      const actionToolExecutor = new ActionToolExecutor({
        dossierId,
        locale: appLocale,
        documentService,
        intentDispatcher,
        context: input.context
      })
      const effectiveCommand = input.command
      const sanitizedCommand = piiPseudo
        ? piiPseudo.pseudonymize(effectiveCommand)
        : effectiveCommand
      const sanitizedHistory =
        input.history && piiPseudo
          ? input.history.map((h: { role: 'user' | 'assistant'; content: string }) => ({
              ...h,
              content: piiPseudo!.pseudonymize(h.content)
            }))
          : input.history
      // Tool result pseudonymization strategy:
      // - managed_fields_get: returned as-is (contains role/field labels that are in the allowlist).
      // - document_list / document_get / document_search: structural fields (id, uuid, relativePath,
      //   dossierId, modifiedAt, byteLength, textExtraction) are preserved verbatim so the LLM can
      //   pass them back as tool arguments; only human-readable text fields are pseudonymized.
      // - all other tools: full auto-pseudonymization via pseudonymizeAuto().
      const pseudonymizeToolResult = piiPseudo
        ? (toolName: string, result: string): string => {
            if (toolName === 'managed_fields_get') {
              return result
            }
            // For document tools, pseudonymize only human-readable fields.
            // Structural fields (id, uuid, relativePath, dossierId, modifiedAt,
            // byteLength, textExtraction) must round-trip verbatim so the LLM
            // can pass them back as arguments without revert failures.
            if (
              toolName === 'document_list' ||
              toolName === 'document_get' ||
              toolName === 'document_search'
            ) {
              return pseudonymizeDocumentToolResult(result, (s) => piiPseudo!.pseudonymize(s))
            }
            // For batchable action tools (contact_upsert, contact_delete, dossier_select…),
            // only pseudonymize the human-readable `feedback` field. Structural fields
            // (contactId, dossierId, templateId, entity.id) are UUIDs that must not be
            // altered — PII detection can match digit sequences inside UUIDs as phone numbers.
            if (BATCHABLE_ACTION_TOOL_NAMES.has(toolName)) {
              return pseudonymizeActionToolResult(result, (s) => piiPseudo!.pseudonymize(s))
            }
            return piiPseudo!.pseudonymizeAuto(result)
          }
        : null

      const wrappedExecuteDataTool = piiPseudo
        ? async (toolName: string, args: Record<string, unknown>): Promise<string> => {
            const revertedArgs = piiPseudo!.revertJson(args) as Record<string, unknown>
            const result = await dataToolExecutor.execute(toolName, revertedArgs)
            return pseudonymizeToolResult!(toolName, result)
          }
        : (toolName: string, args: Record<string, unknown>) =>
            dataToolExecutor.execute(toolName, args)

      const wrappedExecuteActionTool = piiPseudo
        ? async (toolName: string, args: Record<string, unknown>): Promise<string> => {
            console.log(`\n[aiService] executeActionTool:start name=${toolName}`)
            const revertedArgs = piiPseudo!.revertJson(args) as Record<string, unknown>
            const normalizedArgs =
              toolName === 'contact_upsert'
                ? sanitizeContactUpsertArgsAfterPiiRevert(revertedArgs, piiPseudo!)
                : revertedArgs
            const result = await actionToolExecutor.execute(toolName, normalizedArgs)
            console.log(
              `[aiService] executeActionTool:done  name=${toolName} resultSize=${typeof result === 'string' ? result.length : 0}`
            )
            return pseudonymizeToolResult!(toolName, result)
          }
        : (toolName: string, args: Record<string, unknown>) =>
            (async () => {
              console.log(`\n[aiService] executeActionTool:start name=${toolName}`)
              const result = await actionToolExecutor.execute(toolName, args)
              console.log(
                `[aiService] executeActionTool:done  name=${toolName} resultSize=${typeof result === 'string' ? result.length : 0}`
              )
              return result
            })()

      try {
        const intent = await aiAgentRuntime.sendCommand(
          {
            command: sanitizedCommand,
            context: input.context,
            systemPrompt,
            toolSystemPrompt,
            model: input.model,
            history: sanitizedHistory,
            locale: appLocale as 'fr' | 'en',
            domainPath: domainStatus.registeredDomainPath ?? undefined,
            executeDataTool: wrappedExecuteDataTool,
            executeActionTool: wrappedExecuteActionTool
          },
          runtimeMode
        )
        logToolLoopEntries(aiAgentRuntime.getLastToolLoopEntries())
        const intentDebugTrace = aiAgentRuntime.getDebugTrace() ?? undefined
        if (intentDebugTrace && intentDebugTrace.trim().length > 0) {
          // console.log(intentDebugTrace)
        }

        // Revert any [[markers]] the LLM echoed back in the intent fields
        const revertedIntent = piiPseudo ? (piiPseudo.revertJson(intent) as typeof intent) : intent

        console.log(`\n╔══ AI INTENT (${Date.now() - intentT0}ms) ${'═'.repeat(40)}`)
        console.log(`║ type       : ${intent.type}`)
        console.log(
          `║ intent     : ${JSON.stringify(intent, null, 2)
            .split('\n')
            .map((l, i) => (i === 0 ? l : `║             ${l}`))
            .join('\n')}`
        )
        console.log('╚══════════════════════════════════════════════════════════')

        // If all actions were executed inline, the loop ends with a direct_response summary.
        // Return the last dispatched result so context updates propagate, using the model's
        // summary as the visible feedback.
        if (
          revertedIntent.type === 'direct_response' &&
          actionToolExecutor.lastInlineDispatchResult
        ) {
          const inlineDispatchResult: AiCommandResult = actionToolExecutor.lastInlineDispatchResult
          const directResponse = revertedIntent as typeof revertedIntent & {
            type: 'direct_response'
          }
          const feedback = piiPseudo
            ? piiPseudo.revert(directResponse.message)
            : directResponse.message
          // History must use pseudonymized content. Extra pseudonymize pass catches any known
          // real values the model may have echoed without markers (defense-in-depth).
          aiAgentRuntime.appendHistory(
            buildHistoryEntries(
              sanitizedCommand,
              piiPseudo ? piiPseudo.pseudonymize(directResponse.message) : directResponse.message,
              aiAgentRuntime.getLastToolLoopEntries()
            ),
            inlineDispatchResult.intent.type
          )
          return {
            ...inlineDispatchResult,
            intent: revertedIntent,
            feedback,
            debugContext: intentDebugTrace
          }
        }

        // Handle text_generate with a second free-text LLM call
        if (revertedIntent.type === 'text_generate') {
          const intent = revertedIntent
          const { prompt, systemPrompt: textSystemPrompt } = await buildTextGenerationPrompt(
            intent,
            dossierId ?? undefined,
            textGenerationContacts,
            dossierDetail,
            documents,
            dataToolExecutor.history,
            piiPseudo ? (t) => piiPseudo.pseudonymize(t) : undefined
          )
          // Pseudonymise prompt and system prompt before sending to the remote LLM.
          const safePrompt = piiPseudo ? piiPseudo.pseudonymize(prompt) : prompt
          const safeTextSystemPrompt = piiPseudo
            ? piiPseudo.pseudonymize(textSystemPrompt)
            : textSystemPrompt

          const textT0 = Date.now()
          console.log('\n╔══ AI TEXT GENERATION ════════════════════════════════════')
          console.log(`║ prompt     : ${prompt}`)
          console.log(
            `║ systemPrompt (${textSystemPrompt.length} chars):\n${textSystemPrompt
              .split('\n')
              .map((l) => `║   ${l}`)
              .join('\n')}`
          )
          console.log('╚══════════════════════════════════════════════════════════')
          const generatedText = await aiAgentRuntime.streamText(
            safePrompt,
            safeTextSystemPrompt,
            undefined,
            onToken,
            runtimeMode
          )
          console.log(`\n╔══ AI TEXT RESPONSE (${Date.now() - textT0}ms) ${'═'.repeat(35)}`)
          console.log(`║ ${generatedText.trim().split('\n').join('\n║ ')}`)
          console.log('╚══════════════════════════════════════════════════════════')
          const feedback = piiPseudo ? piiPseudo.revert(generatedText.trim()) : generatedText.trim()
          // generatedText is the raw LLM output (pseudonymized) — use it directly for history
          aiAgentRuntime.appendHistory(
            buildHistoryEntries(
              sanitizedCommand,
              generatedText.trim(),
              aiAgentRuntime.getLastToolLoopEntries()
            ),
            intent.type
          )

          return {
            intent,
            feedback,
            debugContext: aiAgentRuntime.getDebugTrace() ?? undefined
          }
        }

        // Handle document_analyze: delegates to runDocumentAnalysis (chunked or full).
        if (intent.type === 'document_analyze') {
          const targetDossierId = intent.dossierId ?? dossierId ?? ''
          const resultJson = await actionToolExecutor.runDocumentAnalysis(
            targetDossierId,
            intent.documentId,
            intent.lineStart,
            intent.lineEnd
          )
          aiAgentRuntime.appendHistory(
            buildHistoryEntries(
              sanitizedCommand,
              resultJson,
              aiAgentRuntime.getLastToolLoopEntries()
            ),
            intent.type
          )
          return { intent, feedback: resultJson, debugContext: intentDebugTrace }
        }

        const dispatchResult = await intentDispatcher.dispatch(revertedIntent, input.context)
        console.log(`\n╔══ AI FEEDBACK ═══════════════════════════════════════════`)
        console.log(`║ ${dispatchResult.feedback.split('\n').join('\n║ ')}`)
        console.log('╚══════════════════════════════════════════════════════════')
        const revertedFeedback = piiPseudo
          ? piiPseudo.revert(dispatchResult.feedback)
          : dispatchResult.feedback
        // For direct_response, the message is the pseudonymized LLM output (pre-revert).
        // For other intents, dispatchResult.feedback is a dispatcher-generated confirmation —
        // pseudonymize it to replace any real values it may echo back.
        const historyFeedback =
          revertedIntent.type === 'direct_response'
            ? piiPseudo
              ? piiPseudo.pseudonymize((revertedIntent as unknown as { message: string }).message)
              : (revertedIntent as unknown as { message: string }).message
            : piiPseudo
              ? piiPseudo.pseudonymize(dispatchResult.feedback)
              : dispatchResult.feedback
        aiAgentRuntime.appendHistory(
          buildHistoryEntries(
            sanitizedCommand,
            historyFeedback,
            aiAgentRuntime.getLastToolLoopEntries()
          ),
          revertedIntent.type
        )
        return {
          ...dispatchResult,
          feedback: revertedFeedback,
          intent: revertedIntent,
          debugContext: intentDebugTrace
        }
      } finally {
        // no-op
      }
    }
  }
}
