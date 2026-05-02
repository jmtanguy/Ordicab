/**
 * actionToolExecutor — handles batchable action tool calls within the AI agent loop.
 *
 * Batchable action tools are executed inline (result fed back to LLM) rather than
 * terminating the loop.
 *
 * Called by: aiService (via ActionToolExecutor.execute() and ActionToolExecutor.runDocumentAnalysis())
 */
import { join } from 'node:path'

import type {
  AppLocale,
  AiCommandContext,
  AiCommandResult,
  DocumentRecord,
  InternalAiCommand
} from '@shared/types'

import type {
  DocumentServiceLike,
  InternalAICommandDispatcher
} from '../../lib/aiEmbedded/aiCommandDispatcher'

export interface ActionToolExecutorDeps {
  dossierId: string | null
  locale?: AppLocale
  documentService: DocumentServiceLike
  intentDispatcher: InternalAICommandDispatcher
  context: AiCommandContext
}

export class ActionToolExecutor {
  lastInlineDispatchResult: AiCommandResult | null = null

  constructor(private readonly deps: ActionToolExecutorDeps) {}

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (toolName === 'document_analyze') {
      const documentId = typeof args['documentId'] === 'string' ? args['documentId'] : ''
      const targetDossierId =
        typeof args['dossierId'] === 'string' ? args['dossierId'] : (this.deps.dossierId ?? '')
      const charStart = typeof args['charStart'] === 'number' ? args['charStart'] : undefined
      const charEnd = typeof args['charEnd'] === 'number' ? args['charEnd'] : undefined
      const result = await this.runDocumentAnalysis(targetDossierId, documentId, charStart, charEnd)
      this.lastInlineDispatchResult = {
        intent: {
          type: 'document_analyze',
          documentId,
          dossierId: targetDossierId,
          charStart,
          charEnd
        },
        feedback: result,
        debugContext: ''
      }
      return result
    }

    return this._dispatchInline(toolName, args)
  }

  /**
   * Read document text from cache, apply optional character-range slicing, return structured JSON.
   * When charStart/charEnd are provided → chunked read only (character offsets, both inclusive).
   * When omitted → full text returned (capped at 12 000 chars).
   */
  async runDocumentAnalysis(
    targetDossierId: string,
    documentId: string,
    charStart?: number,
    charEnd?: number
  ): Promise<string> {
    const { documentService } = this.deps
    const docs = await documentService
      .listDocuments({ dossierId: targetDossierId })
      .catch(() => [] as DocumentRecord[])
    const doc = docs.find((d) => d.id === documentId || d.uuid === documentId)
    if (!doc) return JSON.stringify({ error: `Document introuvable : ${documentId}` })

    let absolutePath: string
    let dossierRoot: string
    try {
      dossierRoot = await documentService.resolveRegisteredDossierRoot({
        dossierId: targetDossierId
      })
      absolutePath = join(dossierRoot, doc.relativePath)
    } catch {
      return JSON.stringify({ error: `Impossible de résoudre le chemin pour "${doc.filename}".` })
    }

    const { readCachedDocumentText } = await import('../../lib/aiEmbedded/documentContentService')
    const { getDossierContentCachePath } = await import('../../lib/ordicab/ordicabPaths')
    const cacheDir = getDossierContentCachePath(dossierRoot)

    let extractedText: string
    try {
      const cached = await readCachedDocumentText(absolutePath, cacheDir)
      if (cached === null) {
        return JSON.stringify({
          error: `Le texte de "${doc.filename}" n'a pas encore été extrait. Veuillez aller dans l'onglet Documents et utiliser "Tout extraire".`
        })
      }
      extractedText = cached.text
    } catch (err) {
      return JSON.stringify({
        error: `Échec de la lecture du texte extrait pour "${doc.filename}" : ${err instanceof Error ? err.message : 'Erreur inconnue'}`
      })
    }

    if (!extractedText.trim()) {
      return JSON.stringify({
        error: `Aucun texte disponible pour "${doc.filename}". Le document est peut-être vide ou illisible.`
      })
    }

    const totalChars = extractedText.length

    if (charStart !== undefined || charEnd !== undefined) {
      const clampedStart = Math.max(0, Math.min(charStart ?? 0, totalChars))
      const clampedEnd = Math.max(clampedStart, Math.min(charEnd ?? totalChars, totalChars))
      const rawContent = extractedText.slice(clampedStart, clampedEnd)
      return JSON.stringify({
        uuid: doc.uuid,
        rawContent,
        totalChars,
        charsReturned: rawContent.length
      })
    }

    const cText = totalChars > 12000 ? extractedText.slice(0, 12000) + '\n[...]' : extractedText
    return JSON.stringify({
      uuid: doc.uuid,
      rawContent: cText,
      totalChars,
      charsReturned: cText.length
    })
  }

  private async _dispatchInline(toolName: string, args: Record<string, unknown>): Promise<string> {
    const { intentDispatcher, context } = this.deps
    const actionIntent = { type: toolName, ...args } as InternalAiCommand
    console.log(`\n╔══ AI INTENT (inline) ${'═'.repeat(47)}`)
    console.log(`║ type       : ${actionIntent.type}`)
    console.log(
      `║ intent     : ${JSON.stringify(actionIntent, null, 2)
        .split('\n')
        .map((l, i) => (i === 0 ? l : `║             ${l}`))
        .join('\n')}`
    )
    console.log('╚══════════════════════════════════════════════════════════')
    const dispatchResult = await intentDispatcher.dispatch(actionIntent, context)
    console.log(`\n╔══ AI FEEDBACK (inline) ══════════════════════════════════`)
    console.log(`║ ${dispatchResult.feedback.split('\n').join('\n║ ')}`)
    console.log('╚══════════════════════════════════════════════════════════')
    this.lastInlineDispatchResult = { ...dispatchResult, debugContext: '' }

    // The dispatcher mutates intent.type when it can't perform the requested
    // action (e.g. contact_upsert without an active dossier → clarification_request
    // asking "Pour quel dossier ?"). Reporting success:true in that case misleads
    // the LLM into telling the user the contact was added when it was not.
    const requestedType = actionIntent.type
    const resolvedType = dispatchResult.intent.type
    const succeeded = resolvedType === requestedType
    const inlineResult: Record<string, unknown> = {
      success: succeeded,
      feedback: dispatchResult.feedback
    }
    if (!succeeded && resolvedType === 'clarification_request') {
      const clarification = dispatchResult.intent as {
        question?: string
        options?: string[]
      }
      inlineResult.needsClarification = true
      if (clarification.question) inlineResult.question = clarification.question
      if (clarification.options) inlineResult.options = clarification.options
    }
    if (dispatchResult.contextUpdate?.templateId) {
      inlineResult.templateId = dispatchResult.contextUpdate.templateId
    }
    if (dispatchResult.contextUpdate?.dossierId) {
      inlineResult.dossierId = dispatchResult.contextUpdate.dossierId
    }
    if (dispatchResult.contextUpdate?.contactId) {
      inlineResult.contactId = dispatchResult.contextUpdate.contactId
    }
    if (dispatchResult.entity) {
      inlineResult.entity = dispatchResult.entity
    }
    return JSON.stringify(inlineResult)
  }
}
