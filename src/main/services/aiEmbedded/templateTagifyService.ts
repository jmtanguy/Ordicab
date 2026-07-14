/**
 * templateTagifyService — AI-assisted conversion of an imported letter into a
 * reusable template: the embedded LLM detects concrete values (names,
 * addresses, dates, references, firm info) in the template text and proposes
 * catalog tags to replace them. The user reviews each proposal before apply.
 *
 * Privacy follows the aiService pattern: prompts are pseudonymized before the
 * remote call and the response is reverted locally. Proposals whose
 * originalText does not occur verbatim in the template after revert are
 * dropped, so worst-case model output yields "no proposals", never corruption.
 */

import { readFile } from 'node:fs/promises'

import { convert as htmlToText } from 'html-to-text'
import PizZip from 'pizzip'
import { z } from 'zod'

import { IpcErrorCode } from '@shared/types'
import type {
  TemplateRecord,
  TemplateTagifyAnalyzeInput,
  TemplateTagifyAnalyzeResult,
  TemplateTagifyApplyInput,
  TemplateTagifyApplyResult,
  TemplateTagifyProposal
} from '@shared/types'
import {
  buildKnownTagIndex,
  extractTagPath,
  isValidTagPath,
  replaceHtmlTextWithTags,
  type KnownTagIndex
} from '@shared/templateContent'
import { templateRoutineCatalog } from '@shared/templateRoutines'
import type { EntityProfile } from '@shared/validation'

import { AiRuntimeError } from '../../lib/aiEmbedded/aiSdkAgentRuntime'
import { stripReasoningBlocks } from '../../lib/aiEmbedded/modelTextSanitizers'
import { buildPiiPseudonymizer } from '../../lib/aiEmbedded/pii/piiContextBuilder'
import { revertWithMappingEntriesWithOptions } from '../../lib/aiEmbedded/pii/piiMapping'
import { isModelPresent, NER_MODEL } from '../../lib/aiEmbedded/modelDownloadService'
import { replaceTextWithTags } from '../../lib/docx/docxTextReplace'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { getDomainTemplateDocxPath } from '../../lib/ordicab/ordicabPaths'
import type { TemplateService } from '../domain/templateService'
import { readAiSettings } from './aiService'

// Safety net only, not a working limit: conclusions can run dozens of pages
// and must be analyzed in full. ~200k chars ≈ 50k tokens, well within the 256k
// context of the supported remote models; truncation is logged when it happens.
const MAX_DOCUMENT_CHARS = 200_000

// Remote models occasionally degenerate on a one-shot call (reasoning-only
// output, truncation, gibberish instead of JSON). A single fresh attempt
// recovers nearly all of these stochastic failures.
const MODEL_ATTEMPTS = 2

const modelProposalSchema = z.object({
  originalText: z.string().min(1),
  suggestedTag: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']).catch('medium')
})

// Models vary the field names (and casing) they use for the proposal object.
// Map the common variants back to our canonical keys before validation.
const PROPOSAL_KEY_ALIASES: Record<string, keyof z.infer<typeof modelProposalSchema>> = {
  originaltext: 'originalText',
  original: 'originalText',
  text: 'originalText',
  value: 'originalText',
  source: 'originalText',
  match: 'originalText',
  suggestedtag: 'suggestedTag',
  suggestion: 'suggestedTag',
  tag: 'suggestedTag',
  tagpath: 'suggestedTag',
  path: 'suggestedTag',
  confidence: 'confidence',
  confidencelevel: 'confidence'
}

function normalizeProposalKeys(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(entry as Record<string, unknown>)) {
      const canonical = PROPOSAL_KEY_ALIASES[key.toLowerCase().replace(/[\s_-]/g, '')]
      out[canonical ?? key] = val
    }
    return out
  })
}

type ModelProposal = z.infer<typeof modelProposalSchema>

/**
 * Salvage parsing: models legitimately emit entries we cannot use (e.g.
 * `suggestedTag: null` for "I found a value but have no tag for it"). One bad
 * entry must not discard the whole analysis, so we validate per entry and drop
 * the malformed ones. Returns null when the value is not an array at all.
 */
function parseProposalEntries(value: unknown): { valid: ModelProposal[]; dropped: number } | null {
  const normalized = normalizeProposalKeys(value)
  if (!Array.isArray(normalized)) return null
  const valid: ModelProposal[] = []
  let dropped = 0
  for (const entry of normalized) {
    const parsed = modelProposalSchema.safeParse(entry)
    if (parsed.success) valid.push(parsed.data)
    else dropped += 1
  }
  return { valid, dropped }
}

export class TemplateTagifyError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TemplateTagifyError'
  }
}

interface AiAgentRuntimeLike {
  generateOneShot(prompt: string, systemPrompt?: string): Promise<string>
}

interface DomainServiceLike {
  getStatus(): Promise<{ registeredDomainPath: string | null; isAvailable: boolean }>
}

interface LocaleServiceLike {
  getLocale(): string
}

export interface TemplateTagifyServiceOptions {
  aiAgentRuntime: AiAgentRuntimeLike
  templateService: TemplateService
  domainService: DomainServiceLike
  localeService: LocaleServiceLike
  stateFilePath: string
  /** Same hook as aiService: reconfigures the runtime for a per-call model choice. */
  configureRemoteLanguageModel?: (model?: string) => Promise<void>
  nerModelPath?: string | null
  /** Overridable for tests — defaults to a filesystem check of the NER model. */
  isNerModelReady?: () => Promise<boolean>
  loadEntityProfile?: (domainPath: string) => Promise<EntityProfile | null>
}

export interface TemplateTagifyService {
  analyze(input: TemplateTagifyAnalyzeInput): Promise<TemplateTagifyAnalyzeResult>
  apply(input: TemplateTagifyApplyInput): Promise<TemplateTagifyApplyResult>
}

function htmlToPlainText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  })
}

/**
 * Return the exact source substring to hand to the replacement engine. Models
 * frequently normalize non-breaking spaces or line whitespace; accepting that
 * harmless normalization here makes the proposal actionable without falling
 * back to fuzzy, potentially unsafe replacements.
 */
function resolveVerbatimSourceText(documentText: string, candidate: string): string | null {
  if (documentText.includes(candidate)) return candidate

  const normalized = candidate.trim().replace(/[\s\u00a0]+/g, ' ')
  if (!normalized) return null
  const pattern = normalized
    .split(' ')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\u00a0]+')
  return documentText.match(new RegExp(pattern))?.[0] ?? null
}

function buildCatalogPromptSection(locale: string): string {
  const isFrench = locale.startsWith('fr')
  const seen = new Set<string>()
  const lines: string[] = []
  for (const entry of templateRoutineCatalog) {
    if (entry.visibility === 'hidden') continue
    // French routine paths are the authored form; the EN canonical path is
    // only a render-time alias and must not be proposed to users.
    const path = extractTagPath(entry.tagFr ?? entry.tag)
    if (seen.has(path)) continue
    seen.add(path)
    const description = isFrench ? (entry.descriptionFr ?? entry.description) : entry.description
    // Multi-line examples (formatted addresses) would break the one-line-per-tag
    // list structure the model relies on.
    const example = entry.example.replace(/\n/g, ' ⏎ ')
    lines.push(`- ${path} — ${description} (ex: ${example})`)
  }
  return lines.join('\n')
}

function buildSystemPrompt(locale: string): string {
  return [
    'You convert a real legal letter into a reusable document template.',
    'Identify the concrete values in the document that should become template tags:',
    'person names, salutations, postal addresses, dates, case/file references, court names, firm identity details.',
    '',
    'Available tag paths (use these exact paths, without braces):',
    buildCatalogPromptSection(locale),
    '',
    'Dynamic patterns are also valid:',
    '- contact.<cleRole>.<champ> — <cleRole> is the camelCase key of the contact role label, kept in its original language (French labels stay French): « partie représentée » → partieRepresentee, « avocat de la partie adverse » → avocatDeLaPartieAdverse. NEVER translate a role key into English.',
    '  Common role keys: partieRepresentee, avocatDeLaPartieRepresentee, partieAdverse, avocatDeLaPartieAdverse, juridiction, expertJudiciaire, notaire, huissierDeJustice, assureur.',
    '  Fields: nomAffiche, civiliteNom, formuleAppel, adresseFormatee, email, telephone, prenom, nom.',
    '- date.<label> with optional .formate/.texte/.court variant — <label> is the camelCase key of the chronology event label: « Audience » → audience, « Renvoi » → renvoi, « Expertise » → expertise. NEVER invent or translate a label.',
    '- date.j+N for computed offsets from today (e.g. date.j+15).',
    '',
    'Rules:',
    '- originalText MUST be copied verbatim from the document (an exact substring, including accents and punctuation).',
    '- suggestedTag MUST be a non-empty tag path from above, in its French form. If no tag fits a value, omit that entry entirely — never output null.',
    '- Skip anything already wrapped in {{ … }}: it is already a tag. Never propose a replacement for a tag or for a bare tag path.',
    "- Prefer the most specific tag: the represented party's name → contact.partieRepresentee.nomAffiche rather than contact.nomAffiche when the letter makes the role clear.",
    '- In the letterhead date line (« Nice, le 12 mars 2026 »), only the date itself maps to aujourdhuiTexte; leave the city and « le » in place.',
    '- Do not propose tags for generic prose or legal boilerplate. cabinet.* tags ARE appropriate for the firm identity block (letterhead, signature).',
    '- Skip values shorter than 3 characters.',
    '',
    'Output STRICT JSON only — an array of objects, no markdown, no commentary:',
    '[{"originalText": "...", "suggestedTag": "contact.partieRepresentee.nomAffiche", "confidence": "high"}]',
    'confidence: "high" when the mapping is unambiguous, "medium" when plausible, "low" when uncertain.'
  ].join('\n')
}

function stripCodeFences(text: string): string {
  // ```json\n[...]\n``` or ```\n[...]\n``` — keep only the fenced body.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? text
}

/**
 * From `text[startIdx] === '['`, return the substring up to the matching `]`,
 * tracking string literals so brackets inside JSON strings do not unbalance
 * the scan. Returns null if no balanced close is found.
 */
function balancedArraySlice(text: string, startIdx: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = startIdx; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return text.slice(startIdx, i + 1)
    }
  }
  return null
}

/**
 * Robustly pull the proposal array out of a model response. Models wrap the
 * JSON in prose, markdown fences, citations like "[1]", or trailing commentary;
 * a naive first-'['/last-']' slice then captures invalid JSON. We instead scan
 * every '[' and return the first balanced array that parses and actually holds
 * objects, tolerating trailing commas. Falls back to an empty/primitive array
 * if that is all the model produced.
 */
function extractJsonArray(raw: string): unknown {
  const cleaned = stripCodeFences(stripReasoningBlocks(raw).trim())
  let primitiveFallback: unknown[] | null = null

  for (let i = cleaned.indexOf('['); i >= 0; i = cleaned.indexOf('[', i + 1)) {
    const slice = balancedArraySlice(cleaned, i)
    if (!slice) continue
    for (const candidate of [slice, slice.replace(/,\s*([\]}])/g, '$1')]) {
      let parsed: unknown
      try {
        parsed = JSON.parse(candidate)
      } catch {
        continue
      }
      if (!Array.isArray(parsed)) continue
      // Prefer the array that looks like proposals (objects), not "[1]" citations.
      if (parsed.some((entry) => entry !== null && typeof entry === 'object')) return parsed
      primitiveFallback ??= parsed
      break
    }
  }

  if (primitiveFallback !== null) return primitiveFallback

  // Nothing parsed — log the PII-free pseudonymized output to aid diagnosis.
  console.error(
    `[tagify] Unparseable model output (${cleaned.length} chars):\n${cleaned.slice(0, 2000)}`
  )
  throw new TemplateTagifyError(IpcErrorCode.UNKNOWN, 'The AI response is not valid JSON.')
}

/**
 * True when at least one occurrence of `needle` overlaps a {{…}} tag already
 * present in the document. Replacements are applied to every occurrence, so a
 * single overlapping one would corrupt the existing tag — the whole proposal
 * must be dropped, not just that occurrence.
 */
function overlapsExistingTag(documentText: string, needle: string): boolean {
  const spans: Array<[number, number]> = []
  const tagPattern = /\{\{[\s\S]*?\}\}/g
  for (let match = tagPattern.exec(documentText); match; match = tagPattern.exec(documentText)) {
    spans.push([match.index, match.index + match[0].length])
  }
  if (spans.length === 0) return false

  for (
    let index = documentText.indexOf(needle);
    index >= 0;
    index = documentText.indexOf(needle, index + needle.length)
  ) {
    const end = index + needle.length
    if (spans.some(([start, stop]) => index < stop && end > start)) return true
  }
  return false
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

export function createTemplateTagifyService(
  options: TemplateTagifyServiceOptions
): TemplateTagifyService {
  const {
    aiAgentRuntime,
    templateService,
    domainService,
    localeService,
    stateFilePath,
    configureRemoteLanguageModel,
    nerModelPath
  } = options

  const isNerModelReady =
    options.isNerModelReady ??
    (async () =>
      nerModelPath ? isModelPresent(nerModelPath, NER_MODEL).catch(() => false) : false)

  const knownTagIndex: KnownTagIndex = buildKnownTagIndex(templateRoutineCatalog)

  async function requireTemplate(templateId: string): Promise<TemplateRecord> {
    const templates = await templateService.list()
    const template = templates.find((entry) => entry.uuid === templateId)
    if (!template) {
      throw new TemplateTagifyError(IpcErrorCode.NOT_FOUND, 'Template was not found.')
    }
    return template
  }

  async function requireDomainPath(): Promise<string> {
    const status = await domainService.getStatus()
    if (!status.registeredDomainPath || !status.isAvailable) {
      throw new TemplateTagifyError(IpcErrorCode.NOT_FOUND, 'No domain is configured.')
    }
    return status.registeredDomainPath
  }

  return {
    async analyze(input): Promise<TemplateTagifyAnalyzeResult> {
      const settings = await readAiSettings(stateFilePath)
      const { mode, piiWordlist } = settings
      // The dialog can override the global PII setting for this analysis only.
      const piiEnabled = input.piiEnabled ?? settings.piiEnabled
      if (mode !== 'remote') {
        throw new AiRuntimeError(
          'Configure a remote AI model in Settings to use tag detection.',
          IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        )
      }
      if (piiEnabled && nerModelPath) {
        const ready = await isNerModelReady()
        if (!ready) {
          throw new AiRuntimeError(
            'PII protection is still downloading. Tag detection is paused until it finishes.',
            IpcErrorCode.AI_RUNTIME_UNAVAILABLE
          )
        }
      }

      const template = await requireTemplate(input.templateUuid)
      const html = await templateService.getContent(template.uuid)
      const fullText = htmlToPlainText(html)
      if (fullText.length > MAX_DOCUMENT_CHARS) {
        console.warn(
          `[tagify] Document truncated from ${fullText.length} to ${MAX_DOCUMENT_CHARS} chars — tags beyond the cutoff will not be proposed.`
        )
      }
      const documentText = fullText.slice(0, MAX_DOCUMENT_CHARS)
      if (!documentText.trim()) {
        return { proposals: [] }
      }

      const locale = localeService.getLocale()
      const currentDate = new Date().toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })

      // Template-level pseudonymization context: no dossier is bound, so the
      // detection relies on the NER model + user wordlist.
      let entityProfile: EntityProfile | null = null
      if (options.loadEntityProfile) {
        try {
          entityProfile = await options.loadEntityProfile(await requireDomainPath())
        } catch {
          entityProfile = null
        }
      }

      const piiPseudo = piiEnabled
        ? buildPiiPseudonymizer({
            contacts: [],
            dossierDetail: null,
            entityProfile,
            dossiers: [],
            templates: [{ name: template.name }],
            piiWordlist,
            currentDate,
            locale: (locale === 'fr' ? 'fr' : 'en') as 'fr' | 'en',
            nerModelPath,
            priorEntries: []
          })
        : null

      const pseudonymize = async (text: string): Promise<string> =>
        piiPseudo ? piiPseudo.pseudonymizeAsync(text) : text
      const revert = (text: string): string =>
        piiPseudo
          ? revertWithMappingEntriesWithOptions(text, piiPseudo.exportMapping(), {
              currentTurnEntries: piiPseudo.exportMapping()
            })
          : text

      if (configureRemoteLanguageModel) {
        await configureRemoteLanguageModel(input.model)
      }

      const safeSystem = await pseudonymize(buildSystemPrompt(locale))
      const safeUser = await pseudonymize(documentText)

      // Parse the pseudonymized output first: pseudonyms are JSON-safe tokens,
      // so the structure is intact. Reverting the whole string before parsing
      // would re-inject real values that may contain quotes, backslashes, or
      // newlines and corrupt the JSON. We revert each field after parsing.
      let candidates: ModelProposal[] | null = null
      let lastError: TemplateTagifyError | null = null
      for (let attempt = 1; attempt <= MODEL_ATTEMPTS && !candidates; attempt += 1) {
        const raw = await aiAgentRuntime.generateOneShot(safeUser, safeSystem)
        try {
          const extracted = extractJsonArray(raw)
          const parsed = parseProposalEntries(extracted)
          if (!parsed || (parsed.valid.length === 0 && parsed.dropped > 0)) {
            // Output is valid JSON but nothing in it is usable. Log the PII-free
            // extracted value to pin down what the model returned.
            console.error(
              `[tagify] Proposal shape mismatch.\nExtracted: ${JSON.stringify(extracted).slice(0, 2000)}`
            )
            throw new TemplateTagifyError(
              IpcErrorCode.UNKNOWN,
              'The AI response did not match the expected proposal format.'
            )
          }
          if (parsed.dropped > 0) {
            // Partial salvage (e.g. entries with suggestedTag: null): keep the
            // valid proposals, just record how many were skipped.
            console.warn(
              `[tagify] Dropped ${parsed.dropped} malformed proposal entr${parsed.dropped > 1 ? 'ies' : 'y'}, kept ${parsed.valid.length}.`
            )
          }
          candidates = parsed.valid
        } catch (error) {
          if (!(error instanceof TemplateTagifyError)) throw error
          lastError = error
          if (attempt < MODEL_ATTEMPTS) {
            console.warn(`[tagify] Attempt ${attempt} unusable — retrying with a fresh call.`)
          }
        }
      }
      if (!candidates) {
        throw (
          lastError ??
          new TemplateTagifyError(IpcErrorCode.UNKNOWN, 'The AI response is not valid JSON.')
        )
      }

      const proposalsBySourceText = new Map<string, TemplateTagifyProposal>()
      const confidenceRank = { high: 0, medium: 1, low: 2 } as const
      for (const candidate of candidates) {
        const proposedText = revert(candidate.originalText).trim()
        if (proposedText.length < 3) continue
        const originalText = resolveVerbatimSourceText(documentText, proposedText)
        if (!originalText || originalText.trim().length < 3) continue
        if (overlapsExistingTag(documentText, originalText)) continue

        // Keep the authored (French) form — normalization to the EN canonical
        // path happens at render time only, never in stored template content.
        const suggestedTag = extractTagPath(revert(candidate.suggestedTag)).trim()
        if (!isValidTagPath(suggestedTag, knownTagIndex)) continue

        const occurrences = countOccurrences(documentText, originalText)
        if (occurrences === 0) continue

        const proposal: TemplateTagifyProposal = {
          originalText,
          suggestedTag,
          confidence: candidate.confidence,
          occurrences
        }
        // A literal can only become one routine. Keep the most confident
        // proposal, rather than presenting contradictory replacements that
        // would make the eventual replacement order ambiguous.
        const existing = proposalsBySourceText.get(originalText)
        if (
          !existing ||
          confidenceRank[proposal.confidence] < confidenceRank[existing.confidence]
        ) {
          proposalsBySourceText.set(originalText, proposal)
        }
      }

      const proposals = [...proposalsBySourceText.values()]
      proposals.sort((a, b) => confidenceRank[a.confidence] - confidenceRank[b.confidence])

      return { proposals }
    },

    async apply(input): Promise<TemplateTagifyApplyResult> {
      const template = await requireTemplate(input.templateUuid)

      // Validate and normalize the requested tags up front
      const failed: TemplateTagifyApplyResult['failed'] = []
      const replacements: Array<{ originalText: string; tagPath: string }> = []
      for (const replacement of input.replacements) {
        // Insert the tag as authored (French form); isValidTagPath normalizes
        // internally so FR aliases validate against the canonical index.
        const tagPath = extractTagPath(replacement.tagPath).trim()
        if (!isValidTagPath(tagPath, knownTagIndex)) {
          failed.push({ originalText: replacement.originalText, reason: 'invalid-tag' })
          continue
        }
        replacements.push({ originalText: replacement.originalText, tagPath })
      }

      if (replacements.length === 0) {
        return { applied: 0, failed }
      }

      if (template.hasDocxSource) {
        const domainPath = await requireDomainPath()
        const docxPath = getDomainTemplateDocxPath(domainPath, template.uuid)
        const buffer = await readFile(docxPath)
        const result = replaceTextWithTags(buffer, replacements)

        // Post-apply guard: the produced archive must still parse before we persist.
        new PizZip(result.buffer)

        if (result.applied.length > 0) {
          await atomicWrite(docxPath, result.buffer)
          // Regenerates the stored HTML and macros from the mutated binary.
          await templateService.syncDocx(template.uuid)
        }

        return {
          applied: result.applied.reduce((sum, entry) => sum + entry.occurrences, 0),
          failed: [...failed, ...result.failed]
        }
      }

      const html = await templateService.getContent(template.uuid)
      const result = replaceHtmlTextWithTags(html, replacements)
      if (result.applied.length > 0) {
        await templateService.update({
          uuid: template.uuid,
          name: template.name,
          content: result.html
        })
      }

      return {
        applied: result.applied.reduce((sum, entry) => sum + entry.occurrences, 0),
        failed: [...failed, ...result.failed]
      }
    }
  }
}
