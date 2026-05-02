/**
 * documentMetadataBatchAdapter — adapter for processDocumentsBatch that
 * extracts a short description + relevant tags for one document and persists
 * them via documentService.saveMetadata.
 */
import type { DocumentRecord } from '@shared/types'

import type { DocumentServiceLike } from '../../lib/aiEmbedded/aiCommandDispatcher'
import type { DocumentBatchTaskAdapter } from './documentBatchProcessor'

export interface DocumentMetadataResult {
  description: string
  tags: string[]
}

const MAX_TAGS = 5

function stripReasoning(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(trimmed)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

export function createDocumentMetadataBatchAdapter(deps: {
  dossierId: string
  documentService: DocumentServiceLike
}): DocumentBatchTaskAdapter<DocumentMetadataResult> {
  return {
    taskName: 'Indexation des documents',

    buildSystemPrompt(locale) {
      if (locale === 'en') {
        return [
          'You generate concise metadata for a single legal/professional document.',
          'Reply with ONE strict JSON object only — no prose, no markdown fences.',
          'Schema: { "description": string (1–3 sentences), "tags": string[] (max 5, lowercase preferred, no duplicates) }.',
          'The description must summarise the document purpose, key parties, and key dates if present.',
          'Tags must be short, meaningful keywords (e.g. document type, jurisdiction, party type).'
        ].join('\n')
      }
      return [
        'Tu génères des métadonnées concises pour UN document juridique/professionnel.',
        'Réponds par UN UNIQUE objet JSON strict — pas de prose, pas de balises markdown.',
        'Schéma : { "description": string (1 à 3 phrases), "tags": string[] (max 5, sans doublons) }.',
        "La description doit résumer l'objet du document, les parties principales et les dates clés si présentes.",
        'Les tags doivent être courts et significatifs (type de document, juridiction, type de partie, etc.).'
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
      const cleaned = stripReasoning(raw)
      const candidate = extractFirstJsonObject(cleaned) ?? cleaned
      let parsed: unknown
      try {
        parsed = JSON.parse(candidate)
      } catch {
        return null
      }
      if (typeof parsed !== 'object' || parsed === null) return null
      const obj = parsed as Record<string, unknown>
      const description = typeof obj['description'] === 'string' ? obj['description'].trim() : ''
      const tags = normalizeTags(obj['tags'])
      if (!description && tags.length === 0) return null
      return { description, tags }
    },

    async applyResult(doc: DocumentRecord, result) {
      await deps.documentService.saveMetadata({
        dossierId: deps.dossierId,
        documentId: doc.id,
        description: result.description || undefined,
        tags: result.tags
      })
      const tagPart = result.tags.length > 0 ? ` [${result.tags.join(', ')}]` : ''
      return `${result.description}${tagPart}`.trim()
    }
  }
}
