/**
 * aiSdkAgentRuntime — SDK-native runtime used by aiService.
 *
 * Usage in the app:
 *   1. aiService builds prompts + tool executors.
 *   2. aiSdkAgentRuntime runs the model through Vercel AI SDK.
 *   3. The SDK executes tools, returns terminal actions, and streams text when needed.
 *
 * This file is intentionally transport-agnostic:
 *   - local mode receives a prebuilt LanguageModel (Ollama/OpenAI-compatible wrapper)
 *   - remote mode receives a prebuilt LanguageModel (OpenAI-compatible wrapper)
 *
 * The interface stays close to the old runtime so aiService and AiPage do not need a full rewrite.
 */
import type { AiCommandContext, InternalAiCommand } from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import { generateText as sdkGenerateText, stepCountIs, streamText as sdkStreamText } from 'ai'
import type { AssistantModelMessage, LanguageModel, ModelMessage, ToolModelMessage } from 'ai'

import {
  STALE_TOOL_NAMES_AFTER_ACTION,
  TERMINAL_ACTION_TOOL_NAMES,
  buildBatchableActionTools,
  buildDataTools,
  terminalActionTools
} from './aiToolDefinitions'
import { deepStripCitationAnnotations } from './pii/citationStrip'

export type AiChatHistoryEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiHistoryToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name?: string }

export interface AiHistoryToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiAgentRuntimePayload {
  command: string
  context: AiCommandContext
  locale?: 'fr' | 'en'
  systemPrompt: string
  toolSystemPrompt?: string
  model?: string
  history?: AiChatHistoryEntry[]
  domainPath?: string
  executeDataTool?: (toolName: string, args: Record<string, unknown>) => Promise<string>
  executeActionTool?: (toolName: string, args: Record<string, unknown>) => Promise<string>
  /** Called with intermediate assistant text emitted between tool calls. Ephemeral — not persisted. */
  onReflection?: (text: string) => void
}

function resolveRuntimeLocale(locale?: string): 'fr' | 'en' {
  return locale === 'en' ? 'en' : 'fr'
}

export interface AiAgentRuntimeOptions {
  localLanguageModel?: LanguageModel
  remoteLanguageModel?: LanguageModel
}

export interface AiAgentRuntime {
  sendCommand(payload: AiAgentRuntimePayload, mode: 'local' | 'remote'): Promise<InternalAiCommand>
  getDebugTrace(): string | null
  getLastToolLoopEntries(): AiChatHistoryEntry[]
  cancelCommand(): void
  appendHistory(entries: AiChatHistoryEntry[], dispatchedAction?: string): void
  resetConversation(): Promise<void>
  setLocalLanguageModel(model: LanguageModel | null): void
  setRemoteLanguageModel(model: LanguageModel | null): void
  generateText(
    prompt: string,
    systemPrompt: string,
    history?: AiChatHistoryEntry[],
    mode?: 'local' | 'remote'
  ): Promise<string>
  /**
   * One-shot text generation that bypasses the persisted conversation history.
   * Use for isolated sub-LLM calls (e.g. per-document batch tasks) where each
   * call must start with a fresh context to avoid token bloat.
   */
  generateOneShot(prompt: string, systemPrompt: string, mode?: 'local' | 'remote'): Promise<string>
  streamText(
    prompt: string,
    systemPrompt: string,
    history?: AiChatHistoryEntry[],
    onToken?: (token: string) => void,
    mode?: 'local' | 'remote'
  ): Promise<string>
  dispose(): void
}

export class AiRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: IpcErrorCode
  ) {
    super(message)
    this.name = 'AiRuntimeError'
  }
}

const MAX_HISTORY_ENTRY_CHARS = 4000
const MAX_MESSAGES_TOTAL_CHARS = 24000

function truncateForModelInput(value: string, maxChars = MAX_HISTORY_ENTRY_CHARS): string {
  if (value.length <= maxChars) return value
  const omitted = value.length - maxChars
  return `${value.slice(0, maxChars)}\n[... truncated ${omitted} chars ...]`
}

function estimateMessageChars(message: ModelMessage): number {
  if (typeof message.content === 'string') return message.content.length
  if (!Array.isArray(message.content)) return 0

  let total = 0
  for (const part of message.content) {
    if (part.type === 'text') {
      total += part.text.length
      continue
    }
    if (part.type === 'tool-call') {
      total += part.toolName.length
      total += JSON.stringify(part.input).length
      continue
    }
    if (part.type === 'tool-result') {
      total += part.toolName.length
      total += JSON.stringify(part.output).length
    }
  }

  return total
}

function compactMessagesForContextWindow(
  messages: ModelMessage[],
  maxTotalChars = MAX_MESSAGES_TOTAL_CHARS
): ModelMessage[] {
  if (messages.length <= 1) return messages

  const kept: ModelMessage[] = []
  let total = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    const estimated = estimateMessageChars(message)

    if (kept.length === 0 || total + estimated <= maxTotalChars) {
      kept.push(message)
      total += estimated
      continue
    }

    // Keep a contiguous suffix of the conversation. Skipping a message in the
    // middle can break tool-call/tool-result pairing and trigger provider errors.
    break
  }

  return kept.reverse()
}

function sanitizeHistoryToolIntegrity(history: AiChatHistoryEntry[]): AiChatHistoryEntry[] {
  if (history.length === 0) return history

  // Track tool results available in this history (by toolCallId).
  const resolvedToolCallIds = new Set(
    history
      .filter(
        (entry): entry is Extract<AiChatHistoryEntry, { role: 'tool' }> => entry.role === 'tool'
      )
      .map((entry) => entry.toolCallId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  )

  const sanitized: AiChatHistoryEntry[] = []
  for (const entry of history) {
    if (entry.role !== 'assistant' || !entry.toolCalls || entry.toolCalls.length === 0) {
      sanitized.push(entry)
      continue
    }

    const keptToolCalls = entry.toolCalls.filter((toolCall) => resolvedToolCallIds.has(toolCall.id))
    if (keptToolCalls.length > 0) {
      sanitized.push({ ...entry, toolCalls: keptToolCalls })
      continue
    }

    // If no tool calls remain, keep assistant text only when non-empty.
    if (entry.content.trim().length > 0) {
      sanitized.push({ role: 'assistant', content: entry.content })
    }
  }

  return sanitized
}

class TruncatedToolCallsError extends Error {
  constructor() {
    super('Truncated [TOOL_CALLS] payload due to length limit.')
    this.name = 'TruncatedToolCallsError'
  }
}

type ProviderRetryableErrorType = 'rate_limit' | 'network_error' | 'timeout_error'

function getProviderUserMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const userMessage = (error as { userMessage?: unknown }).userMessage
  return typeof userMessage === 'string' && userMessage.trim() ? userMessage : null
}

function serializeUnknownError(error: unknown): string {
  try {
    if (error instanceof Error) {
      return error.stack && error.stack.trim().length > 0 ? error.stack : error.message
    }
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

// Some models prepend hidden reasoning in <think> blocks. We strip it before
// trying to parse text as JSON or as a narrated tool request.
function stripReasoningBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function stripJsonFences(raw: string): string {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return match ? (match[1] ?? '').trim() : raw.trim()
}

function normalizeJsonCandidate(raw: string): string {
  return stripJsonFences(stripReasoningBlocks(raw))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function buildDataToolCacheKey(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'document_search') {
    const query = typeof args['query'] === 'string' ? args['query'].trim().toLowerCase() : ''
    const dossierId = typeof args['dossierId'] === 'string' ? args['dossierId'].trim() : ''
    if (query.length > 0) return `document_search:${query}:${dossierId}`
  }

  return `${toolName}:${stableSerialize(args)}`
}

function extractFirstBalancedJsonObject(raw: string, startIndex = 0): string | null {
  const start = raw.indexOf('{', startIndex)
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]
    if (!ch) continue

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        return raw.slice(start, i + 1)
      }
    }
  }

  return null
}

// Fallback for weaker OpenAI-compatible models that emit tool requests as
// plain text instead of native tool-call content.
function parseBracketedToolCallsText(raw: string): InternalAiCommand | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[TOOL_CALLS]')) return null

  try {
    const json = trimmed.slice('[TOOL_CALLS]'.length).trim()
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr) || arr.length === 0) return null

    const first = arr[0] as unknown
    if (!isRecord(first)) return null

    const name = (first as { name?: unknown }).name
    if (typeof name !== 'string') return null

    let args = (first as { arguments?: unknown }).arguments ?? {}
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }

    if (!isRecord(args)) args = {}
    const cleaned = deepStripCitationAnnotations(args) as Record<string, unknown>
    return { type: name, ...cleaned } as unknown as InternalAiCommand
  } catch {
    // Lenient fallback for partially malformed JSON payloads.
    const nameMatch = trimmed.match(/"name"\s*:\s*"([^"]+)"/)
    const name = nameMatch?.[1]?.trim()
    if (!name) return null

    const argumentsIndex = trimmed.search(/"arguments"\s*:/)
    if (argumentsIndex < 0) return null
    const argsObject = extractFirstBalancedJsonObject(trimmed, argumentsIndex)
    if (!argsObject) return null

    try {
      const parsedArgs = JSON.parse(argsObject) as unknown
      if (!isRecord(parsedArgs)) return null
      const cleaned = deepStripCitationAnnotations(parsedArgs) as Record<string, unknown>
      return { type: name, ...cleaned } as unknown as InternalAiCommand
    } catch {
      return null
    }
  }
}

function parseInternalAiCommand(raw: string): InternalAiCommand | null {
  const fromToolCalls = parseBracketedToolCallsText(raw)
  if (fromToolCalls) return fromToolCalls

  try {
    const parsed = JSON.parse(normalizeJsonCandidate(raw)) as unknown
    if (isRecord(parsed) && typeof (parsed as { type: unknown }).type === 'string') {
      return parsed as unknown as InternalAiCommand
    }
    return null
  } catch {
    return null
  }
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(normalizeJsonCandidate(raw)) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractNarratedToolRequest(raw: string): {
  assistantText: string
  toolRequest: { type: string } & Record<string, unknown>
} | null {
  const content = stripReasoningBlocks(raw)
  if (!content) return null

  const blocks = Array.from(content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))

  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]?.[1]?.trim()
    if (!block) continue

    const lines = block.split('\n')
    const toolName = lines[0]?.trim()
    if (!toolName || !TERMINAL_ACTION_TOOL_NAMES.has(toolName)) continue

    const payload = tryParseJsonObject(lines.slice(1).join('\n').trim())
    if (!payload) continue

    return {
      assistantText: content.replace(blocks[i]?.[0] ?? '', '').trim(),
      toolRequest: { type: toolName, ...payload }
    }
  }

  return null
}

function historyToSdkMessages(history: AiChatHistoryEntry[]): ModelMessage[] {
  const messages: ModelMessage[] = []

  for (const entry of history) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: truncateForModelInput(entry.content) })
      continue
    }

    if (entry.role === 'assistant') {
      if ((!entry.toolCalls || entry.toolCalls.length === 0) && entry.content.trim().length === 0) {
        continue
      }
      if (entry.toolCalls && entry.toolCalls.length > 0) {
        // Vercel AI SDK expects prior assistant tool calls in structured content form.
        // We keep our persisted history compact, then expand it back into SDK messages here.
        const assistantMessage: AssistantModelMessage = {
          role: 'assistant',
          content: [
            ...(entry.content
              ? [{ type: 'text' as const, text: truncateForModelInput(entry.content) }]
              : []),
            ...entry.toolCalls.map((toolCall) => ({
              type: 'tool-call' as const,
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              input: (() => {
                try {
                  return JSON.parse(toolCall.function.arguments) as unknown
                } catch {
                  return {}
                }
              })()
            }))
          ]
        }
        messages.push(assistantMessage)
      } else {
        messages.push({ role: 'assistant', content: truncateForModelInput(entry.content) })
      }
      continue
    }

    const toolMessage: ToolModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: entry.toolCallId,
          toolName: entry.name ?? '',
          output: { type: 'text' as const, value: truncateForModelInput(entry.content) }
        }
      ]
    }
    messages.push(toolMessage)
  }

  return messages
}

export function createAiSdkAgentRuntime(options: AiAgentRuntimeOptions): AiAgentRuntime {
  let localLanguageModel: LanguageModel | undefined = options.localLanguageModel
  let remoteLanguageModel: LanguageModel | undefined = options.remoteLanguageModel
  let conversationHistory: AiChatHistoryEntry[] = []
  let debugTrace: string | null = null
  let lastToolLoopEntries: AiChatHistoryEntry[] = []
  let currentAbortController: AbortController | null = null

  function resolveLanguageModel(mode: 'local' | 'remote'): LanguageModel | null {
    if (mode === 'local') return localLanguageModel ?? null
    return remoteLanguageModel ?? null
  }

  function resolveHistory(
    history?: AiChatHistoryEntry[],
    useConversationHistory = true
  ): AiChatHistoryEntry[] {
    if (useConversationHistory && conversationHistory.length > 0) return conversationHistory
    return history && history.length > 0 ? history : []
  }

  function buildSdkMessages(
    command: string,
    history?: AiChatHistoryEntry[],
    useConversationHistory = true
  ): ModelMessage[] {
    // The SDK wants the full conversational state as ModelMessage[] on each call.
    // We rebuild it from our persisted runtime history, then append the current user turn.
    const messages = historyToSdkMessages(
      sanitizeHistoryToolIntegrity(resolveHistory(history, useConversationHistory))
    )
    const last = messages[messages.length - 1]

    if (
      !last ||
      last.role !== 'user' ||
      (typeof last.content === 'string' && last.content !== command)
    ) {
      messages.push({ role: 'user', content: command })
    }

    return compactMessagesForContextWindow(messages)
  }

  function resetDebugTrace(
    command: string,
    mode: 'local' | 'remote',
    requestedModel?: string
  ): void {
    debugTrace = null
    appendDebugTrace('╔══ AI SDK RUNTIME START ══════════════════════════════════')
    appendDebugTrace(`║ command    : ${command}`)
    if (mode === 'remote') {
      appendDebugTrace(`║ mode       : ${mode} (model: ${requestedModel?.trim() || 'default'})`)
    } else {
      appendDebugTrace(`║ mode       : ${mode}`)
    }
    appendDebugTrace('╚══════════════════════════════════════════════════════════')
  }

  function appendDebugTrace(trace: string): void {
    debugTrace = (debugTrace ?? '') + '\n' + trace
  }

  function stringifyForDebugTrace(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  // Data tools that are safe to call repeatedly with identical arguments in one turn.
  const LOOP_SAFE_REPEATED_DATA_TOOLS = new Set<string>()

  // Maximum `document_analyze` calls allowed per turn before redirecting the
  // model to a batch tool. Why: single-document inspection is fine, but fan-out
  // across many documents bloats context and, on weaker models, triggers
  // [TOOL_CALLS] truncation (Mistral chat-template parallel-call bug).
  const DOCUMENT_ANALYZE_MAX_PER_TURN = 3

  async function runSdkToolLoop(
    payload: AiAgentRuntimePayload,
    mode: 'local' | 'remote',
    signal: AbortSignal,
    historyStrategy: 'normal' | 'fresh' = 'normal'
  ): Promise<InternalAiCommand | null> {
    const model = resolveLanguageModel(mode)
    if (!model) return null

    lastToolLoopEntries = []
    resetDebugTrace(payload.command, mode, payload.model)

    const dataToolCallCounts = new Map<string, number>()
    const dataToolResultsByKey = new Map<string, string>()
    let documentAnalyzeCallCount = 0
    const dataTools = buildDataTools(async (name, args) => {
      const key = buildDataToolCacheKey(name, args)
      const count = (dataToolCallCounts.get(key) ?? 0) + 1
      dataToolCallCounts.set(key, count)

      if (count >= 2 && !LOOP_SAFE_REPEATED_DATA_TOOLS.has(name)) {
        // Duplicate data tool calls are allowed but could be optimized
        // by reusing previous results instead of re-executing
      }

      if (name === 'document_analyze') {
        documentAnalyzeCallCount += 1
        if (documentAnalyzeCallCount > DOCUMENT_ANALYZE_MAX_PER_TURN) {
          const locale = resolveRuntimeLocale(payload.locale)
          const redirect =
            locale === 'en'
              ? `BLOCKED: too many document_analyze calls this turn (${documentAnalyzeCallCount}). Stop fan-out. For content questions across many documents call document_search ONCE with a query. For per-document tagging/summary call document_metadata_batch or document_summary_batch ONCE (omit documentIds to target every document). Do not retry document_analyze.`
              : `BLOQUE: trop d'appels document_analyze sur ce tour (${documentAnalyzeCallCount}). Arrete le fan-out. Pour une question de contenu sur plusieurs documents, appelle document_search UNE fois avec une requete. Pour etiqueter/resumer chaque document, appelle document_metadata_batch ou document_summary_batch UNE fois (omets documentIds pour cibler tous les documents). Ne relance pas document_analyze.`
          appendDebugTrace(
            `[guardrail] document_analyze blocked (count=${documentAnalyzeCallCount}, max=${DOCUMENT_ANALYZE_MAX_PER_TURN})`
          )
          return JSON.stringify({
            error: 'guardrail_document_analyze_fanout',
            message: redirect
          })
        }
      }

      const result = await payload.executeDataTool!(name, args)
      dataToolResultsByKey.set(key, result)
      return result
    })

    // The SDK may emit multiple tool calls in one step and execute them concurrently.
    // For mutating action tools (e.g. contact_upsert), we must serialize execution to
    // avoid read-modify-write races in persistence layers.
    let actionToolExecutionChain: Promise<void> = Promise.resolve()
    async function runBatchableActionSerially<T>(task: () => Promise<T>): Promise<T> {
      const previous = actionToolExecutionChain
      let release: (() => void) | undefined
      actionToolExecutionChain = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      try {
        return await task()
      } finally {
        if (release) release()
      }
    }

    const batchableTools = buildBatchableActionTools(async (name, args) => {
      const result = await runBatchableActionSerially(() => payload.executeActionTool!(name, args))
      const locale = resolveRuntimeLocale(payload.locale)

      if (name === 'contact_upsert') {
        const parsed = tryParseJsonObject(result)
        if (parsed?.hasMoreContactCandidates) {
          const remaining = parsed.remainingContactCandidates as number | undefined
          const nextBranchPrompt =
            typeof (parsed.nextCandidateBranch as { prompt?: unknown } | undefined)?.prompt ===
            'string'
              ? ((parsed.nextCandidateBranch as { prompt: string }).prompt ?? '')
              : ''
          const hint = remaining
            ? locale === 'en'
              ? `\n\nINSTRUCTION: ${remaining} candidate(s) remain. Continue immediately with the next sub-branch from the SAME running extraction.${nextBranchPrompt ? `\nSub-branch: ${nextBranchPrompt}` : ''}`
              : `\n\nINSTRUCTION: Il reste ${remaining} candidat(s). Continue immédiatement avec la sous-branche suivante de la MEME extraction en cours.${nextBranchPrompt ? `\nSous-branche: ${nextBranchPrompt}` : ''}`
            : locale === 'en'
              ? `\n\nINSTRUCTION: All candidates from the current extraction are processed.`
              : `\n\nINSTRUCTION: Tous les candidats de l'extraction en cours sont traités.`
          return result + hint
        }
      }

      return result
    })

    const tools = { ...dataTools, ...batchableTools, ...terminalActionTools }
    const toolSystemPrompt = payload.toolSystemPrompt ?? payload.systemPrompt
    const sdkMessages = buildSdkMessages(
      payload.command,
      payload.history,
      historyStrategy === 'normal'
    )
    const toolNames = Object.keys(tools)
    let sawTruncatedToolCallsText = false

    appendDebugTrace(`[llm:request] system=\n${toolSystemPrompt}`)
    appendDebugTrace(`[llm:request] tools=${toolNames.join(',') || 'none'}`)
    appendDebugTrace(`[llm:request] messages=\n${stringifyForDebugTrace(sdkMessages)}`)

    const result = await sdkGenerateText({
      model,
      system: toolSystemPrompt,
      messages: sdkMessages,
      tools,
      maxOutputTokens: 2048,
      stopWhen: stepCountIs(32),
      abortSignal: signal,
      onStepFinish: ({ toolCalls, toolResults, text, finishReason }) => {
        // We persist the SDK step transcript in our own compact shape so aiService
        // can append it to conversation history and reuse prior tool results next turn.
        if (toolCalls && toolCalls.length > 0) {
          lastToolLoopEntries.push({
            role: 'assistant',
            content: text ?? '',
            toolCalls: toolCalls.map((toolCall) => ({
              id: toolCall.toolCallId,
              type: 'function' as const,
              function: { name: toolCall.toolName, arguments: JSON.stringify(toolCall.input) }
            }))
          })

          if (toolResults) {
            for (const toolResult of toolResults) {
              const output = (toolResult as { output?: unknown }).output
              lastToolLoopEntries.push({
                role: 'tool',
                content: typeof output === 'string' ? output : JSON.stringify(output),
                toolCallId: toolResult.toolCallId,
                name: toolResult.toolName
              })
            }
          }
        } else if (text) {
          lastToolLoopEntries.push({ role: 'assistant', content: text })
        }

        appendDebugTrace(
          `[step] finish=${finishReason} tools=${toolCalls?.map((toolCall) => toolCall.toolName).join(',') ?? 'none'}`
        )
        if (toolCalls && toolCalls.length > 0) {
          appendDebugTrace(`[step:toolCalls] ${stringifyForDebugTrace(toolCalls)}`)
        }
        if (toolResults && toolResults.length > 0) {
          appendDebugTrace(`[step:toolResults] ${stringifyForDebugTrace(toolResults)}`)
        }
        if (text) {
          appendDebugTrace(`[step:text] ${text}`)
          const trimmed = text.trim()
          if (
            finishReason === 'length' &&
            (!toolCalls || toolCalls.length === 0) &&
            trimmed.startsWith('[TOOL_CALLS]')
          ) {
            sawTruncatedToolCallsText = true
          }
        }

        // Stream intermediate reasoning to the renderer. Only emit when the model
        // actually produced reasoning text for this step — bare tool-name summaries
        // are meaningless to the user. The terminal step (finishReason=stop with no
        // tool calls) is the final response and arrives via the command result.
        if (payload.onReflection) {
          const hasTools = Boolean(toolCalls && toolCalls.length > 0)
          const isTerminal = finishReason === 'stop' && !hasTools
          if (!isTerminal) {
            const trimmedText = text?.trim() ?? ''
            if (trimmedText) {
              payload.onReflection(trimmedText)
            }
          }
        }
      }
    })

    for (const step of result.steps) {
      for (const toolCall of step.toolCalls) {
        if (TERMINAL_ACTION_TOOL_NAMES.has(toolCall.toolName)) {
          return {
            type: toolCall.toolName,
            ...(toolCall.input as Record<string, unknown>)
          } as unknown as InternalAiCommand
        }
      }
    }

    const finalText = result.text.trim()
    if (finalText) {
      const parsedIntent = parseInternalAiCommand(finalText)
      if (parsedIntent) {
        if (parsedIntent.type === 'direct_response') {
          const message = (parsedIntent as { message?: unknown }).message
          if (typeof message === 'string' && message.trim().length > 0) {
            const embeddedTool = parseInternalAiCommand(message)
            if (embeddedTool) return embeddedTool
          }
        }
        return parsedIntent
      }

      const narrated = extractNarratedToolRequest(finalText)
      if (narrated) {
        return narrated.toolRequest as unknown as InternalAiCommand
      }

      if (sawTruncatedToolCallsText && finalText.startsWith('[TOOL_CALLS]')) {
        throw new TruncatedToolCallsError()
      }

      return { type: 'direct_response', message: finalText } as unknown as InternalAiCommand
    }

    return null
  }
  return {
    getDebugTrace(): string | null {
      return debugTrace
    },

    getLastToolLoopEntries(): AiChatHistoryEntry[] {
      return lastToolLoopEntries
    },

    async sendCommand(
      payload: AiAgentRuntimePayload,
      mode: 'local' | 'remote'
    ): Promise<InternalAiCommand> {
      const abortController = new AbortController()
      currentAbortController = abortController

      if (!resolveLanguageModel(mode)) {
        throw new AiRuntimeError(
          `No ${mode} AI model configured.`,
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      try {
        const executeWithRetryOnTruncatedToolCalls =
          async (): Promise<InternalAiCommand | null> => {
            for (let attempt = 1; attempt <= 2; attempt += 1) {
              try {
                return await runSdkToolLoop(payload, mode, abortController.signal)
              } catch (error) {
                if (!(error instanceof TruncatedToolCallsError) || attempt === 2) throw error
                appendDebugTrace('[retry] detected truncated [TOOL_CALLS]; retrying once.')
              }
            }
            return null
          }

        const sdkIntent = await executeWithRetryOnTruncatedToolCalls().catch(async (error) => {
          if (error instanceof DOMException && error.name === 'AbortError') throw error

          const providerUserMessage = getProviderUserMessage(error)
          if (providerUserMessage) {
            throw new AiRuntimeError(providerUserMessage, IpcErrorCode.REMOTE_API_ERROR)
          }

          const providerErrorMessage = error instanceof Error ? error.message : String(error)
          const providerErrorDetails = serializeUnknownError(error)
          const hasBadRequestSignature =
            /badrequesterror|failed after \d+ attempts|http\s*400|\b400\b/i.test(
              `${providerErrorMessage}\n${providerErrorDetails}`
            )
          const appendTrace = (baseMessage: string): string => {
            const trace = debugTrace?.trim()
            if (!trace) return baseMessage
            return `${baseMessage}\n\nAI debug trace:\n${trace}`
          }
          if (
            /max_tokens must be at least 1/i.test(providerErrorMessage) ||
            /context length|maximum context|prompt is too long|too many tokens/i.test(
              providerErrorMessage
            )
          ) {
            appendDebugTrace('[retry] context window exceeded; retrying once with fresh history.')
            const freshIntent = await runSdkToolLoop(
              { ...payload, history: [] },
              mode,
              abortController.signal,
              'fresh'
            )
            if (freshIntent) return freshIntent
            throw new AiRuntimeError(
              'The prompt is too large for the selected model context window. Please retry with a shorter request or reduced history.',
              IpcErrorCode.REMOTE_API_ERROR
            )
          }

          if (hasBadRequestSignature) {
            const summary =
              providerErrorMessage && providerErrorMessage.trim().length > 0
                ? providerErrorMessage.trim()
                : 'Remote provider returned an invalid request error.'
            const details =
              providerErrorDetails && providerErrorDetails !== providerErrorMessage
                ? `\n\nProvider error details:\n${providerErrorDetails}`
                : ''
            throw new AiRuntimeError(
              appendTrace(`${summary}${details}`),
              IpcErrorCode.REMOTE_API_ERROR
            )
          }

          const errType = (error as { type?: unknown }).type as
            | ProviderRetryableErrorType
            | undefined
          if (
            errType === 'network_error' ||
            errType === 'timeout_error' ||
            errType === 'rate_limit'
          ) {
            const retryDelayMs = errType === 'rate_limit' ? 3000 : 1000
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
            return runSdkToolLoop(payload, mode, abortController.signal)
          }

          throw new AiRuntimeError(
            appendTrace(error instanceof Error ? error.message : 'AI runtime is unavailable.'),
            IpcErrorCode.AI_RUNTIME_UNAVAILABLE
          )
        })

        if (sdkIntent) return sdkIntent

        throw new AiRuntimeError(
          'AI could not interpret your command. Please try rephrasing.',
          IpcErrorCode.INTENT_PARSE_FAILED
        )
      } finally {
        if (currentAbortController === abortController) {
          currentAbortController = null
        }
      }
    },

    cancelCommand(): void {
      currentAbortController?.abort()
    },

    setLocalLanguageModel(model: LanguageModel | null): void {
      localLanguageModel = model ?? undefined
    },

    setRemoteLanguageModel(model: LanguageModel | null): void {
      remoteLanguageModel = model ?? undefined
    },

    appendHistory(entries: AiChatHistoryEntry[], dispatchedAction?: string): void {
      if (entries.length === 0) return

      const staleNames = dispatchedAction
        ? new Set(STALE_TOOL_NAMES_AFTER_ACTION[dispatchedAction] ?? [])
        : null

      const isStale = (entry: AiChatHistoryEntry): boolean =>
        staleNames !== null &&
        staleNames.size > 0 &&
        entry.role === 'tool' &&
        'name' in entry &&
        staleNames.has(entry.name ?? '')

      const pruned = conversationHistory.filter((entry) => !isStale(entry))
      conversationHistory = sanitizeHistoryToolIntegrity([
        ...pruned,
        ...entries.filter((entry) => !isStale(entry))
      ]).slice(-12)
    },

    async resetConversation(): Promise<void> {
      conversationHistory = []
    },

    async generateText(
      prompt: string,
      systemPrompt: string,
      history?: AiChatHistoryEntry[],
      mode: 'local' | 'remote' = 'local'
    ): Promise<string> {
      const sdkModel = resolveLanguageModel(mode)
      if (!sdkModel) {
        throw new AiRuntimeError(
          `No ${mode} AI model configured.`,
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      const result = await sdkGenerateText({
        model: sdkModel,
        system: systemPrompt,
        messages: buildSdkMessages(prompt, history)
      })
      return result.text
    },

    async generateOneShot(
      prompt: string,
      systemPrompt: string,
      mode: 'local' | 'remote' = 'local'
    ): Promise<string> {
      const sdkModel = resolveLanguageModel(mode)
      if (!sdkModel) {
        throw new AiRuntimeError(
          `No ${mode} AI model configured.`,
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      const result = await sdkGenerateText({
        model: sdkModel,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
      return result.text
    },

    async streamText(
      prompt: string,
      systemPrompt: string,
      history?: AiChatHistoryEntry[],
      onToken?: (token: string) => void,
      mode: 'local' | 'remote' = 'local'
    ): Promise<string> {
      const sdkModel = resolveLanguageModel(mode)
      if (!sdkModel) {
        throw new AiRuntimeError(
          `No ${mode} AI model configured.`,
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }

      const abortController = new AbortController()
      currentAbortController = abortController

      try {
        const result = sdkStreamText({
          model: sdkModel,
          system: systemPrompt,
          messages: buildSdkMessages(prompt, history),
          abortSignal: abortController.signal
        })

        let full = ''
        for await (const chunk of result.textStream) {
          full += chunk
          onToken?.(chunk)
        }
        return full
      } finally {
        if (currentAbortController === abortController) {
          currentAbortController = null
        }
      }
    },

    dispose(): void {
      // No subprocess to tear down.
    }
  }
}
