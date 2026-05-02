/**
 * intentHandlers — one handler per intent type, plus the shared context they
 * all consume. Extracted from aiService so the orchestrator can read as a
 * router instead of a 600-LOC pile of inline branches.
 *
 * Each handler returns a complete AiCommandResult. The router in aiService
 * picks the handler from `revertedIntent.type` and falls back to the generic
 * dispatcher otherwise.
 */
import type {
  AiCommandInput,
  AiCommandResult,
  AppLocale,
  DocumentRecord,
  DossierDetail,
  DossierSummary,
  InternalAiCommand,
  TextGenerateIntent
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { AiRuntimeError, type AiAgentRuntime } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import type { InternalAICommandDispatcher } from '../../lib/aiEmbedded/aiCommandDispatcher'
import type { PiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiPseudonymizer'

import type { ActionToolExecutor } from './actionToolExecutor'
import {
  type DataToolExecutor,
  type DataToolHistoryEntry,
  pseudonymizeAnalyzeToolResultAsync
} from './dataToolExecutor'
import { createDocumentMetadataBatchAdapter } from './documentMetadataBatchAdapter'
import { createDocumentSummaryBatchAdapter } from './documentSummaryBatchAdapter'
import { processDocumentsBatch, type DocumentBatchTaskAdapter } from './documentBatchProcessor'
import type { DocumentServiceLike } from '../../lib/aiEmbedded/aiCommandDispatcher'

// ── Context bundle passed to every handler ───────────────────────────────────

export interface IntentHandlerContext {
  // Runtime
  aiAgentRuntime: AiAgentRuntime
  intentDispatcher: InternalAICommandDispatcher
  dataToolExecutor: DataToolExecutor
  actionToolExecutor: ActionToolExecutor
  documentService: DocumentServiceLike

  // PII
  piiPseudo: PiiPseudonymizer | null
  pseudonymizeText: (text: string) => Promise<string>
  revertPiiText: (text: string) => string

  // Dossier-bound state (resolved once per command)
  dossierId: string | null
  dossierDetail: DossierDetail | DossierSummary | null
  documents: DocumentRecord[]
  textGenerationContacts: Array<{ id: string; name: string; role?: string; email?: string }>

  // Per-command state
  appLocale: AppLocale
  runtimeMode: 'local' | 'remote'
  sanitizedCommand: string
  intentDebugTrace: string | undefined
  inputContext: AiCommandInput['context']
  onToken?: (token: string) => void

  /**
   * Append the user message + final feedback to conversation history and
   * snapshot the current PII mapping into the decode ledger so later turns
   * can decode markers echoed back. Every handler must call this exactly
   * once before returning, otherwise the next turn loses context.
   */
  commitIntentToHistory: (feedback: string, intentType: string) => void
}

// ── Inline dispatch summary (direct_response after action tool loop) ─────────

export async function handleInlineDispatchSummary(
  ctx: IntentHandlerContext,
  revertedIntent: InternalAiCommand & { type: 'direct_response' }
): Promise<AiCommandResult> {
  const inlineDispatchResult = ctx.actionToolExecutor.lastInlineDispatchResult
  if (!inlineDispatchResult) {
    throw new AiRuntimeError(
      'handleInlineDispatchSummary called without an inline dispatch result',
      IpcErrorCode.UNKNOWN
    )
  }
  const feedback = ctx.revertPiiText(revertedIntent.message)
  // History must use pseudonymized content. Extra pseudonymize pass catches
  // any known real values the model may have echoed without markers.
  ctx.commitIntentToHistory(
    await ctx.pseudonymizeText(revertedIntent.message),
    inlineDispatchResult.intent.type
  )
  return {
    ...inlineDispatchResult,
    intent: revertedIntent,
    feedback,
    debugContext: ctx.intentDebugTrace
  }
}

// ── text_generate (second free-text LLM call) ────────────────────────────────

export async function handleTextGenerate(
  ctx: IntentHandlerContext,
  intent: TextGenerateIntent
): Promise<AiCommandResult> {
  const { prompt, systemPrompt: textSystemPrompt } = await buildTextGenerationPrompt(
    intent,
    ctx.dossierId ?? undefined,
    ctx.textGenerationContacts,
    ctx.dossierDetail,
    ctx.documents,
    ctx.dataToolExecutor.history
  )
  const safePrompt = await ctx.pseudonymizeText(prompt)
  const safeTextSystemPrompt = await ctx.pseudonymizeText(textSystemPrompt)

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

  const generatedText = await ctx.aiAgentRuntime.streamText(
    safePrompt,
    safeTextSystemPrompt,
    undefined,
    ctx.onToken,
    ctx.runtimeMode
  )
  const feedback = ctx.revertPiiText(generatedText.trim())
  console.log(`\n╔══ AI TEXT RESPONSE (${Date.now() - textT0}ms) ${'═'.repeat(35)}`)
  console.log(`║ ${feedback.split('\n').join('\n║ ')}`)
  console.log('╚══════════════════════════════════════════════════════════')
  // generatedText is already pseudonymized — store it directly in history.
  ctx.commitIntentToHistory(generatedText.trim(), intent.type)
  return {
    intent,
    feedback,
    debugContext: ctx.aiAgentRuntime.getDebugTrace() ?? undefined
  }
}

// ── document_metadata_batch / document_summary_batch ─────────────────────────

type BatchIntent = Extract<
  InternalAiCommand,
  { type: 'document_metadata_batch' } | { type: 'document_summary_batch' }
>

export async function handleDocumentBatch(
  ctx: IntentHandlerContext,
  intent: BatchIntent
): Promise<AiCommandResult> {
  const targetDossierId = intent.dossierId ?? ctx.dossierId ?? ''
  if (!targetDossierId) {
    const feedback =
      ctx.appLocale === 'en'
        ? 'No active dossier — select one before running this batch.'
        : 'Aucun dossier actif — sélectionnez-en un avant de lancer ce traitement.'
    ctx.commitIntentToHistory(feedback, intent.type)
    return { intent, feedback, debugContext: ctx.intentDebugTrace }
  }

  // Resolve target documents. Explicit list wins; otherwise selection
  // depends on the intent: metadata batch picks docs without metadata,
  // every other batch defaults to ALL documents in the dossier.
  const allDocs = await ctx.documentService
    .listDocuments({ dossierId: targetDossierId })
    .catch(() => [] as DocumentRecord[])
  const explicitIds = intent.documentIds ?? []
  const targetIds =
    explicitIds.length > 0
      ? explicitIds
      : intent.type === 'document_metadata_batch'
        ? allDocs
            .filter(
              (d) =>
                !(d.description && d.description.trim().length > 0) &&
                (!Array.isArray(d.tags) || d.tags.length === 0)
            )
            .map((d) => d.uuid ?? d.id)
        : allDocs.map((d) => d.uuid ?? d.id)

  if (targetIds.length === 0) {
    const feedback =
      intent.type === 'document_metadata_batch'
        ? ctx.appLocale === 'en'
          ? 'No documents to index — every document already has metadata.'
          : 'Aucun document à indexer — tous les documents ont déjà des métadonnées.'
        : ctx.appLocale === 'en'
          ? 'No documents in this dossier.'
          : 'Aucun document dans ce dossier.'
    ctx.commitIntentToHistory(feedback, intent.type)
    return { intent, feedback, debugContext: ctx.intentDebugTrace }
  }

  // PII-aware one-shot wrapper: pseudonymize prompts → call runtime → revert response.
  const runOneShot = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const safeSystem = await ctx.pseudonymizeText(systemPrompt)
    const safeUser = await ctx.pseudonymizeText(userPrompt)
    const raw = await ctx.aiAgentRuntime.generateOneShot(safeUser, safeSystem, ctx.runtimeMode)
    return ctx.revertPiiText(raw)
  }

  const adapter: DocumentBatchTaskAdapter<unknown> = (() => {
    switch (intent.type) {
      case 'document_metadata_batch':
        return createDocumentMetadataBatchAdapter({
          dossierId: targetDossierId,
          documentService: ctx.documentService
        }) as DocumentBatchTaskAdapter<unknown>
      case 'document_summary_batch':
        return createDocumentSummaryBatchAdapter({
          dossierId: targetDossierId,
          documentService: ctx.documentService
        }) as DocumentBatchTaskAdapter<unknown>
      default:
        throw new AiRuntimeError(
          `Unhandled batch intent: ${(intent as { type: string }).type}`,
          IpcErrorCode.UNKNOWN
        )
    }
  })()

  const outcome = await processDocumentsBatch(
    { dossierId: targetDossierId, documentIds: targetIds },
    adapter,
    { documentService: ctx.documentService, runOneShot, locale: ctx.appLocale as 'fr' | 'en' }
  )

  console.log(`\n╔══ AI BATCH ${intent.type} ═════════════════════════════════════`)
  console.log(`║ ${outcome.feedback.split('\n').join('\n║ ')}`)
  console.log('╚══════════════════════════════════════════════════════════')

  // Pseudonymize feedback before storing in history (defense-in-depth: filenames
  // or doc-derived summaries may carry PII even though per-doc results are reverted).
  const historyFeedback = ctx.piiPseudo
    ? await ctx.pseudonymizeText(outcome.feedback)
    : outcome.feedback
  ctx.commitIntentToHistory(historyFeedback, intent.type)
  return { intent, feedback: outcome.feedback, debugContext: ctx.intentDebugTrace }
}

// ── document_analyze ─────────────────────────────────────────────────────────

export async function handleDocumentAnalyze(
  ctx: IntentHandlerContext,
  intent: Extract<InternalAiCommand, { type: 'document_analyze' }>
): Promise<AiCommandResult> {
  const targetDossierId = intent.dossierId ?? ctx.dossierId ?? ''
  const resultJson = await ctx.actionToolExecutor.runDocumentAnalysis(
    targetDossierId,
    intent.documentId,
    intent.lineStart,
    intent.lineEnd
  )
  // The returned feedback is local UI data and may contain the real document text.
  // History is reused on later remote LLM calls, so store only the pseudonymized
  // payload there. Mirrors the tool-loop document_analyze path.
  const historyResultJson = ctx.piiPseudo
    ? await pseudonymizeAnalyzeToolResultAsync(resultJson, ctx.pseudonymizeText)
    : resultJson
  ctx.commitIntentToHistory(historyResultJson, intent.type)
  return { intent, feedback: resultJson, debugContext: ctx.intentDebugTrace }
}

// ── Generic dispatch (fallback for everything else) ──────────────────────────

export async function handleGenericDispatch(
  ctx: IntentHandlerContext,
  revertedIntent: InternalAiCommand
): Promise<AiCommandResult> {
  const dispatchResult = await ctx.intentDispatcher.dispatch(revertedIntent, ctx.inputContext)
  console.log(`\n╔══ AI FEEDBACK ═══════════════════════════════════════════`)
  console.log(`║ ${dispatchResult.feedback.split('\n').join('\n║ ')}`)
  console.log('╚══════════════════════════════════════════════════════════')

  const revertedFeedback = ctx.revertPiiText(dispatchResult.feedback)
  // For direct_response, the message is the pseudonymized LLM output (pre-revert).
  // For other intents, dispatchResult.feedback is a dispatcher-generated confirmation —
  // pseudonymize it to replace any real values it may echo back.
  const historyFeedback =
    revertedIntent.type === 'direct_response'
      ? ctx.piiPseudo
        ? await ctx.pseudonymizeText((revertedIntent as { message: string }).message)
        : (revertedIntent as { message: string }).message
      : ctx.piiPseudo
        ? await ctx.pseudonymizeText(dispatchResult.feedback)
        : dispatchResult.feedback
  ctx.commitIntentToHistory(historyFeedback, revertedIntent.type)
  return {
    ...dispatchResult,
    feedback: revertedFeedback,
    intent: revertedIntent,
    debugContext: ctx.intentDebugTrace
  }
}

// ── Text-generation prompt builder (moved from aiService) ────────────────────

async function buildTextGenerationPrompt(
  intent: TextGenerateIntent,
  dossierId: string | undefined,
  contacts: Array<{ id: string; name: string; role?: string; email?: string }>,
  dossier: DossierDetail | DossierSummary | null,
  documents: DocumentRecord[],
  dataToolHistory: DataToolHistoryEntry[]
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
      systemLines.push(`\n[${filename}]\n${excerpt}`)
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
