/**
 * documentSummaryBatchAdapter — adapter for processDocumentsBatch that
 * produces a longer narrative summary for one document and persists it as the
 * document description, preserving any existing tags.
 *
 * Differs from metadata batch: longer (multi-paragraph) summary, no tag
 * generation, never overwrites tags.
 */
import type { DocumentRecord } from '@shared/types'

import type { DocumentServiceLike } from '../../lib/aiEmbedded/aiCommandDispatcher'
import type { DocumentBatchTaskAdapter } from './documentBatchProcessor'

export interface DocumentSummaryResult {
  summary: string
}

const MAX_SUMMARY_CHARS = 1500

function stripReasoning(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

export function createDocumentSummaryBatchAdapter(deps: {
  dossierId: string
  documentService: DocumentServiceLike
}): DocumentBatchTaskAdapter<DocumentSummaryResult> {
  return {
    taskName: 'Résumé des documents',

    buildSystemPrompt(locale) {
      if (locale === 'en') {
        return [
          'You produce a concise narrative summary for ONE legal/professional document.',
          'Reply with PLAIN TEXT — no JSON, no markdown headings, no bullet lists, no quotes.',
          '2 to 4 short paragraphs, ~150–300 words total.',
          'Cover: purpose of the document, parties involved, key facts, and any procedural / financial / scheduling implications.',
          "Skip generic boilerplate (signatures, mailing addresses, footer text) unless they are the document's subject."
        ].join('\n')
      }
      return [
        'Tu produis un résumé narratif concis pour UN document juridique/professionnel.',
        'Réponds en TEXTE BRUT — pas de JSON, pas de titres markdown, pas de puces, pas de guillemets.',
        '2 à 4 paragraphes courts, environ 150–300 mots au total.',
        "Couvre : l'objet du document, les parties impliquées, les faits clés, et les implications procédurales / financières / d'agenda.",
        "Ignore les éléments génériques (signatures, adresses postales, pied de page) sauf s'ils sont l'objet du document."
      ].join('\n')
    },

    buildUserPrompt(doc, text, locale) {
      const header =
        locale === 'en'
          ? `Document filename: ${doc.filename}\n\nExtracted text:`
          : `Nom du document : ${doc.filename}\n\nTexte extrait :`
      return `${header}\n${text}`
    },

    parseResult(raw) {
      const cleaned = stripJsonFences(stripReasoning(raw))
      if (!cleaned) return null
      const truncated =
        cleaned.length > MAX_SUMMARY_CHARS ? cleaned.slice(0, MAX_SUMMARY_CHARS).trim() : cleaned
      return { summary: truncated }
    },

    async applyResult(doc: DocumentRecord, result) {
      const existingTags = Array.isArray(doc.tags) ? doc.tags : []
      await deps.documentService.saveMetadata({
        dossierId: deps.dossierId,
        documentId: doc.id,
        description: result.summary,
        tags: existingTags
      })
      const preview =
        result.summary.length > 120 ? `${result.summary.slice(0, 120)}…` : result.summary
      return preview
    }
  }
}
