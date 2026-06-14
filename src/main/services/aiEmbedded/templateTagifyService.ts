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

const modelOutputSchema = z.array(modelProposalSchema)

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

function extractJsonArray(raw: string): unknown {
  const cleaned = stripReasoningBlocks(raw).trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) {
    throw new TemplateTagifyError(
      IpcErrorCode.UNKNOWN,
      'The AI response did not contain a JSON array.'
    )
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new TemplateTagifyError(IpcErrorCode.UNKNOWN, 'The AI response is not valid JSON.')
  }
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
      const reverted = revert(raw)

      const parsed = modelOutputSchema.safeParse(extractJsonArray(reverted))
      if (!parsed.success) {
        throw new TemplateTagifyError(
          IpcErrorCode.UNKNOWN,
          'The AI response did not match the expected proposal format.'
        )
      }

      const proposals: TemplateTagifyProposal[] = []
      const seen = new Set<string>()
      for (const candidate of parsed.data) {
        const originalText = candidate.originalText.trim()
        if (originalText.length < 3) continue

        const suggestedTag = normalizeTagPath(extractTagPath(candidate.suggestedTag))
        if (!isValidTagPath(suggestedTag, knownTagIndex)) continue

        const occurrences = countOccurrences(documentText, originalText)
        if (occurrences === 0) continue

        const key = `${originalText} ${suggestedTag}`
        if (seen.has(key)) continue
        seen.add(key)

        proposals.push({
          originalText,
          suggestedTag,
          confidence: candidate.confidence,
          occurrences
        })
      }

      const confidenceRank = { high: 0, medium: 1, low: 2 } as const
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
