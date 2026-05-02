/**
 * documentBatchProcessor — generic per-document sub-LLM batch runner.
 *
 * Used to perform the same isolated LLM task on N documents without polluting
 * the main conversation context with every document's raw text. Each per-doc
 * call is a one-shot generation with its own focused prompt.
 *
 * Adapters provide task-specific prompt building, response parsing, and result
 * application. The metadata adapter ships with this module; future adapters can
 * be plugged in (contact extraction, key-date extraction, classification, etc.).
 */
import { join } from 'node:path'

import type { DocumentRecord } from '@shared/types'

import { readCachedDocumentText } from '../../lib/aiEmbedded/documentContentService'
import { getDossierContentCachePath } from '../../lib/ordicab/ordicabPaths'
import type { DocumentServiceLike } from '../../lib/aiEmbedded/aiCommandDispatcher'

export interface DocumentBatchTaskAdapter<TResult> {
  /** Stable task identifier used in logs. */
  readonly taskName: string
  /** System prompt sent on every per-document call. */
  buildSystemPrompt(locale: 'fr' | 'en'): string
  /** User prompt for a single document, given its record + already-loaded text. */
  buildUserPrompt(doc: DocumentRecord, text: string, locale: 'fr' | 'en'): string
  /** Parse the raw LLM response into the task result type, or null if unparseable. */
  parseResult(raw: string): TResult | null
  /** Persist the parsed result for one document; return a one-line human summary. */
  applyResult(doc: DocumentRecord, result: TResult): Promise<string>
}

export interface DocumentBatchProcessorDeps {
  documentService: DocumentServiceLike
  /**
   * One-shot LLM call for a single document. The caller is responsible for
   * model routing and any PII pseudonymization of the prompt + reverting of
   * the response.
   */
  runOneShot(systemPrompt: string, userPrompt: string): Promise<string>
  locale: 'fr' | 'en'
}

export interface DocumentBatchOptions {
  dossierId: string
  /** Document UUIDs (or relative paths) to process. */
  documentIds: string[]
  /** Max chars of document text included in the per-doc prompt. Default: 12 000. */
  textCharLimit?: number
}

export interface DocumentBatchItemOutcome {
  documentId: string
  filename: string
  success: boolean
  summary: string
  error?: string
}

export interface DocumentBatchOutcome {
  total: number
  succeeded: number
  failed: number
  /** One line per document, ready to surface to the user. */
  feedback: string
  perDocument: DocumentBatchItemOutcome[]
}

const DEFAULT_TEXT_CHAR_LIMIT = 12_000

async function loadDocumentText(
  documentService: DocumentServiceLike,
  dossierId: string,
  doc: DocumentRecord,
  charLimit: number
): Promise<{ text: string } | { error: string }> {
  let dossierRoot: string
  try {
    dossierRoot = await documentService.resolveRegisteredDossierRoot({ dossierId })
  } catch {
    return { error: `chemin du dossier introuvable` }
  }

  const absolutePath = join(dossierRoot, doc.relativePath)
  const cacheDir = getDossierContentCachePath(dossierRoot)

  let cached
  try {
    cached = await readCachedDocumentText(absolutePath, cacheDir)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'lecture du cache impossible' }
  }
  if (cached === null) {
    return { error: 'texte non extrait — utilisez "Tout extraire" dans Documents' }
  }
  if (!cached.text.trim()) {
    return { error: 'document vide ou illisible' }
  }
  const sliced = cached.text.length > charLimit ? cached.text.slice(0, charLimit) : cached.text
  return { text: sliced }
}

export async function processDocumentsBatch<TResult>(
  options: DocumentBatchOptions,
  adapter: DocumentBatchTaskAdapter<TResult>,
  deps: DocumentBatchProcessorDeps
): Promise<DocumentBatchOutcome> {
  const charLimit = options.textCharLimit ?? DEFAULT_TEXT_CHAR_LIMIT
  const allDocs = await deps.documentService
    .listDocuments({ dossierId: options.dossierId })
    .catch(() => [] as DocumentRecord[])

  const targets: DocumentRecord[] = []
  for (const id of options.documentIds) {
    const doc = allDocs.find((d) => d.uuid === id || d.id === id)
    if (doc) targets.push(doc)
  }

  const systemPrompt = adapter.buildSystemPrompt(deps.locale)
  const perDocument: DocumentBatchItemOutcome[] = []

  for (const doc of targets) {
    const docId = doc.uuid ?? doc.id
    const loaded = await loadDocumentText(deps.documentService, options.dossierId, doc, charLimit)
    if ('error' in loaded) {
      perDocument.push({
        documentId: docId,
        filename: doc.filename,
        success: false,
        summary: '',
        error: loaded.error
      })
      continue
    }

    const userPrompt = adapter.buildUserPrompt(doc, loaded.text, deps.locale)
    let raw: string
    try {
      raw = await deps.runOneShot(systemPrompt, userPrompt)
    } catch (err) {
      perDocument.push({
        documentId: docId,
        filename: doc.filename,
        success: false,
        summary: '',
        error: err instanceof Error ? err.message : 'échec de la génération'
      })
      continue
    }

    const parsed = adapter.parseResult(raw)
    if (!parsed) {
      perDocument.push({
        documentId: docId,
        filename: doc.filename,
        success: false,
        summary: '',
        error: 'réponse du modèle illisible'
      })
      continue
    }

    try {
      const summary = await adapter.applyResult(doc, parsed)
      perDocument.push({
        documentId: docId,
        filename: doc.filename,
        success: true,
        summary
      })
    } catch (err) {
      perDocument.push({
        documentId: docId,
        filename: doc.filename,
        success: false,
        summary: '',
        error: err instanceof Error ? err.message : 'échec de la persistance'
      })
    }
  }

  const succeeded = perDocument.filter((entry) => entry.success).length
  const failed = perDocument.length - succeeded

  const feedbackLines = perDocument.map((entry) => {
    const status = entry.success ? '✓' : '✗'
    const detail = entry.success ? entry.summary : (entry.error ?? 'erreur inconnue')
    return `${status} ${entry.filename}${detail ? ` — ${detail}` : ''}`
  })

  const header =
    deps.locale === 'en'
      ? `${adapter.taskName}: ${succeeded}/${perDocument.length} succeeded${failed ? `, ${failed} failed` : ''}.`
      : `${adapter.taskName} : ${succeeded}/${perDocument.length} traité(s)${failed ? `, ${failed} en échec` : ''}.`

  return {
    total: perDocument.length,
    succeeded,
    failed,
    feedback: [header, ...feedbackLines].join('\n'),
    perDocument
  }
}
