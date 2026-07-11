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
  normalizeTagPath,
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

const MAX_DOCUMENT_CHARS = 12_000

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

const modelOutputSchema = z.preprocess(normalizeProposalKeys, z.array(modelProposalSchema))

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
  const lines = templateRoutineCatalog
    .filter((entry) => entry.visibility !== 'hidden')
    .map((entry) => {
      const path = normalizeTagPath(extractTagPath(entry.tag))
      const description = isFrench ? (entry.descriptionFr ?? entry.description) : entry.description
      return `- ${path} — ${description} (ex: ${entry.example})`
    })
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
    '- contact.<role>.<field> for a contact with a specific role (e.g. contact.client.displayName, contact.adversaire.addressFormatted)',
    '- dossier.keyDate.<label> with optional .formatted/.long/.short variant for chronology dates (e.g. dossier.keyDate.audience.long)',
    '- date.today+N for computed offsets from today',
    '',
    'Rules:',
    '- originalText MUST be copied verbatim from the document (an exact substring, including accents and punctuation).',
    '- Prefer the most specific tag (a client name → contact.client.displayName, not contact.displayName, when the letter clearly addresses a client).',
    '- Do not propose tags for generic prose, legal boilerplate, or values that should stay fixed in the template (e.g. the law firm letterhead if it is part of the cabinet branding — actually entity.* tags ARE appropriate for firm identity).',
    '- Skip values shorter than 3 characters.',
    '',
    'Output STRICT JSON only — an array of objects, no markdown, no commentary:',
    '[{"originalText": "...", "suggestedTag": "contact.client.displayName", "confidence": "high"}]',
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
      const { mode, piiEnabled, piiWordlist } = await readAiSettings(stateFilePath)
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
      const documentText = htmlToPlainText(html).slice(0, MAX_DOCUMENT_CHARS)
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

      const safeSystem = await pseudonymize(buildSystemPrompt(locale))
      const safeUser = await pseudonymize(documentText)
      const raw = await aiAgentRuntime.generateOneShot(safeUser, safeSystem)

      // Parse the pseudonymized output first: pseudonyms are JSON-safe tokens,
      // so the structure is intact. Reverting the whole string before parsing
      // would re-inject real values that may contain quotes, backslashes, or
      // newlines and corrupt the JSON. We revert each field after parsing.
      const extracted = extractJsonArray(raw)
      const parsed = modelOutputSchema.safeParse(extracted)
      if (!parsed.success) {
        // Output is valid JSON but the wrong shape. Log the PII-free extracted
        // value and the validation issues to pin down what the model returned.
        console.error(
          `[tagify] Proposal shape mismatch.\nExtracted: ${JSON.stringify(extracted).slice(0, 2000)}\nIssues: ${JSON.stringify(parsed.error.issues).slice(0, 1000)}`
        )
        throw new TemplateTagifyError(
          IpcErrorCode.UNKNOWN,
          'The AI response did not match the expected proposal format.'
        )
      }

      const proposalsBySourceText = new Map<string, TemplateTagifyProposal>()
      const confidenceRank = { high: 0, medium: 1, low: 2 } as const
      for (const candidate of parsed.data) {
        const proposedText = revert(candidate.originalText).trim()
        if (proposedText.length < 3) continue
        const originalText = resolveVerbatimSourceText(documentText, proposedText)
        if (!originalText || originalText.trim().length < 3) continue

        const suggestedTag = normalizeTagPath(extractTagPath(revert(candidate.suggestedTag)))
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
        const tagPath = normalizeTagPath(extractTagPath(replacement.tagPath))
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
