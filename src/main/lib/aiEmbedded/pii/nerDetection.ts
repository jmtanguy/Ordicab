/**
 * nerDetection — optional NER pass used as a POSITION ORACLE for the regex
 * pipeline (not as a direct span producer).
 *
 * Runs an ONNX model in-process (no side-car, no network after first download)
 * via @huggingface/transformers. The model tells us WHERE names / addresses /
 * organisations are; the regex-based detectors in piiDetector then decide HOW
 * to tokenize and tag them. This avoids the LLM seeing bundled "FirstName
 * LastName" (or full addresses) as a single marker — the regex's
 * detectCapitalized already emits one span per name token, which lets the LLM
 * split the identity into distinct firstName / lastName tool-call fields.
 *
 * Wiring: pseudonymizer.pseudonymizeAsync() calls applyNerHints(masked) to get
 *   1. a `hintedText` copy of `masked` with NER-detected regions rewritten to
 *      Title Case (positions preserved — case-only mutation).
 *   2. `nerRegions` — a list of {type, start, end} the regex might miss,
 *      used to build fallback spans for regions with no regex coverage.
 * detectPii then runs on hintedText; fallbacks fill the gaps.
 *
 * Failure mode: if the package isn't installed, the model fails to download,
 * or inference throws, applyNerHints() returns the input text unchanged with
 * zero regions, and the pseudonymizer falls back to regex-only detection.
 *
 * Pipeline loading + caching lives in ../modelRegistry so every embedded-AI
 * feature shares the same dynamic import, pipeline cache, and localModelPath
 * handling.
 */

import {
  __resetModelRegistryForTests,
  getPipeline as getRegistryPipeline,
  warmup as warmupPipeline,
  type PipelineFn
} from '../modelRegistry'
import { HONORIFICS } from './personNameDetection'
import type { DetectedSpan, EntityType } from './piiDetector'

export interface NerConfig {
  /** Master switch. When false, applyNerHints() returns the input unchanged. */
  enabled: boolean
  /**
   * HuggingFace model id or local directory. Default is a multilingual NER
   * model that supports French out of the box. For a French-only deployment,
   * point this at a locally-converted CamemBERT-NER ONNX directory.
   */
  model?: string
  /** Minimum entity confidence score (0-1). Defaults to 0.85. */
  minScore?: number
  /** Optional local filesystem path where the ONNX model lives. */
  modelPath?: string
  /** Use int8-quantized weights (smaller + faster, minor quality hit). */
  quantized?: boolean
}

const DEFAULT_MODEL = 'Xenova/bert-base-multilingual-cased-ner-hrl'
const DEFAULT_MIN_SCORE = 0.85
// Inference can fail repeatedly when the model fails to load on the host (e.g.
// missing native deps). Log only the first failure per process to avoid
// flooding the journal — the regex-only fallback still pseudonymizes. The
// warn-once flag lives in this closure so the only way to flip it is through
// the exposed reset hook (no module-level mutable state leaks).
const inferenceWarnLog = (() => {
  let logged = false
  return {
    warnOnce(err: unknown): void {
      if (logged) return
      logged = true
      console.warn(
        '[pii-ner] inference failed — falling back to regex-only detection. Subsequent failures will not be logged.',
        err instanceof Error ? err.message : err
      )
    },
    reset(): void {
      logged = false
    }
  }
})()
const SHORT_TEXT_MIN_SCORE = 0.72
const SHORT_TEXT_MAX_CHARS = 96
const SHORT_TEXT_MAX_TOKENS = 10

type NerPipelineFn = (
  text: string,
  opts?: Record<string, unknown>
) => Promise<Array<Record<string, unknown>>>

type NerTokenizer = {
  tokenize: (text: string, opts?: Record<string, unknown>) => string[]
  all_special_tokens?: string[]
  special_tokens?: string[]
}

type NerRawEntity = Record<string, unknown>
type NerSpanCandidate = {
  label: string
  score: number
  word: string
  start?: number
  end?: number
  startTokenIndex?: number
  endTokenIndex?: number
}
const TITLE_CASE_TRIGGERS = new Set([
  ...[...HONORIFICS].map((token) => token.toLocaleLowerCase()),
  'avocat',
  'avocate',
  'contact',
  'contacts'
])
// Triggers that sit one or more tokens away from the name (e.g. "contacts X Y"
// for "add to contacts X Y") — we re-case up to MULTI_TOKEN_NAME_LIMIT
// consecutive lowercase word tokens after them so "contacts jean-michel tanguy"
// becomes "contacts Jean-michel Tanguy" for the second NER pass. Honorifics
// stay single-token (they sit immediately next to the surname).
const MULTI_TOKEN_TRIGGERS = new Set(['contact', 'contacts', 'avocat', 'avocate'])
const MULTI_TOKEN_NAME_LIMIT = 3
const QUERY_FALLBACK_TRIGGERS = new Set([
  'pour',
  'for',
  'contre',
  'against',
  'avec',
  'with',
  'chez',
  'contact',
  'contacts'
])
const QUERY_NAME_STOPWORDS = new Set([
  'contact',
  'contacts',
  'information',
  'informations',
  'document',
  'documents',
  'doc',
  'docs',
  'dossier',
  'dossiers',
  'avocat',
  'avocate',
  'lawyer',
  'attorney',
  'pour',
  'for',
  'contre',
  'against',
  'avec',
  'with',
  'chez',
  'the',
  'les',
  'des',
  'dans',
  'de',
  'du',
  'la',
  'le',
  'l',
  'to',
  'sur'
])

async function loadNerPipeline(config: NerConfig): Promise<NerPipelineFn | null> {
  const pipe: PipelineFn | null = await getRegistryPipeline({
    task: 'token-classification',
    model: config.model ?? DEFAULT_MODEL,
    modelPath: config.modelPath,
    quantized: config.quantized
  })
  return pipe as NerPipelineFn | null
}

// Maps the NER model's entity labels to the EntityType vocabulary already used
// by the rest of the pseudonymization pipeline. PER → name, ORG → company,
// LOC → address. MISC is ignored (too noisy to redact safely).
function mapLabel(rawLabel: string): EntityType | null {
  const label = rawLabel.toUpperCase().replace(/^(?:B|I|E|S)-/, '')
  if (label === 'PER' || label === 'PERSON') return 'name'
  if (label === 'ORG' || label === 'ORGANIZATION') return 'company'
  if (label === 'LOC' || label === 'LOCATION') return 'address'
  return null
}

function resolveMinScore(text: string, config: NerConfig): number {
  if (typeof config.minScore === 'number') return config.minScore

  const tokenCount = text.trim().split(/\s+/).filter(Boolean).length
  if (text.length <= SHORT_TEXT_MAX_CHARS && tokenCount <= SHORT_TEXT_MAX_TOKENS) {
    return SHORT_TEXT_MIN_SCORE
  }

  return DEFAULT_MIN_SCORE
}

function capitalizeToken(token: string): string {
  if (!token) return token
  return token.charAt(0).toLocaleUpperCase() + token.slice(1)
}

function isShortQuery(text: string): boolean {
  const tokenCount = text.trim().split(/\s+/).filter(Boolean).length
  return text.length <= SHORT_TEXT_MAX_CHARS && tokenCount <= SHORT_TEXT_MAX_TOKENS
}

function buildTitleCaseCandidate(text: string): string | null {
  const parts = text.split(/(\s+)/)
  let changed = false

  function normalizeTriggerToken(token: string): string {
    return token.replace(/^[^\p{L}.]+|[^\p{L}.]+$/gu, '').toLocaleLowerCase()
  }

  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i]
    if (!token || /^\s+$/u.test(token)) continue
    const normalizedTrigger = normalizeTriggerToken(token)
    if (!TITLE_CASE_TRIGGERS.has(normalizedTrigger)) continue

    // Honorifics sit directly before the name ("monsieur X") and should only
    // re-case the very next word. Broader triggers ("contacts X Y") sit one or
    // more tokens away from the name, so we re-case up to a small cap.
    const maxTokens = MULTI_TOKEN_TRIGGERS.has(normalizedTrigger) ? MULTI_TOKEN_NAME_LIMIT : 1

    let processed = 0
    for (let j = i + 1; j < parts.length && processed < maxTokens; j += 1) {
      const next = parts[j]
      if (!next) continue
      if (/^\s+$/u.test(next)) continue
      if (/^[,.;!?:]/u.test(next)) break
      if (/\d/u.test(next)) break
      if (/^[^\p{L}]*[A-ZÀ-Ÿ]/u.test(next)) break

      // Anchor the regex at the token start so we do not capture "mmanuelle"
      // inside an already-capitalized "Emmanuelle" and corrupt the second-pass
      // input with weird casing like "EMmanuelle".
      const updated = next.replace(/^[a-zà-ÿ][\p{L}'’-]*/u, (name) => {
        const titled = capitalizeToken(name)
        if (titled !== name) changed = true
        return titled
      })
      parts[j] = updated
      processed += 1
      // Trailing sentence-break punctuation ("merlin," or "dupont.") signals the
      // end of the name group — title-case THIS token, then stop.
      if (/[,.;!?:]$/u.test(next)) break
      if (maxTokens === 1) break
    }
  }

  return changed ? parts.join('') : null
}

function buildTriggeredFallbackSpans(text: string): DetectedSpan[] {
  if (!isShortQuery(text)) return []

  const spans: DetectedSpan[] = []
  const tokens = [...text.matchAll(/\S+/g)]

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const trigger = tokens[i]?.[0] ?? ''
    const value = tokens[i + 1]?.[0] ?? ''
    if (!QUERY_FALLBACK_TRIGGERS.has(trigger.toLocaleLowerCase())) continue
    // Require the candidate to start with an uppercase letter. Lowercase tokens
    // after "contacts"/"pour"/etc. are far more often common adjectives or nouns
    // ("contacts supplémentaires", "pour information") than standalone surnames,
    // and the lowercase case is already covered by buildTitleCaseCandidate +
    // NER second pass — this fallback only needs to catch capitalized names that
    // the model failed to tag (e.g. "pour Mercier").
    if (!/^[A-ZÀ-Ÿ][\p{L}'’-]{2,}$/u.test(value)) continue

    const normalized = value.toLocaleLowerCase()
    if (QUERY_NAME_STOPWORDS.has(normalized)) continue

    const start = tokens[i + 1]?.index ?? -1
    if (start < 0) continue

    spans.push({
      type: 'name',
      value,
      start,
      end: start + value.length
    })
  }

  return spans
}

function mapEntitiesToSpans(
  text: string,
  pipe: NerPipelineFn | null,
  raw: NerRawEntity[],
  minScore: number,
  tokenizedText: string = text
): DetectedSpan[] {
  const candidates = normalizeEntities(text, raw)
  const spans: DetectedSpan[] = []
  let searchFrom = 0
  // The entity `index` fields are offsets into the tokenization of the text
  // that was actually passed to the pipeline — which can be the title-case
  // candidate, not the original. Tokenization differs between the two (e.g.
  // "luc" splits to "lu" + "##c" but "Luc" is a single token), so building
  // offsets against the original would map the same `index` to entirely
  // different characters. Title-case mutation is char-for-char (just casing),
  // so positions in `tokenizedText` are valid positions in `text` as well.
  const tokenOffsets = buildTokenOffsets(tokenizedText, pipe)

  for (const entity of candidates) {
    const score = typeof entity.score === 'number' ? entity.score : 1
    if (score < minScore) continue

    const type = mapLabel(entity.label)
    if (!type) continue

    const span = resolveEntitySpan(text, entity, searchFrom, tokenOffsets)
    if (!span) continue

    searchFrom = span.end
    spans.push({ type, value: span.value, start: span.start, end: span.end })
  }

  return spans
}

function normalizeEntities(text: string, raw: NerRawEntity[]): NerSpanCandidate[] {
  const candidates: NerSpanCandidate[] = []
  const unpositioned: NerRawEntity[] = []

  for (const entity of raw) {
    const label = (entity.entity_group ?? entity.entity ?? '') as string
    if (!label) continue

    const start = typeof entity.start === 'number' ? entity.start : undefined
    const end = typeof entity.end === 'number' ? entity.end : undefined
    if (
      start !== undefined &&
      end !== undefined &&
      start >= 0 &&
      end > start &&
      end <= text.length
    ) {
      const word =
        typeof entity.word === 'string' && entity.word.trim().length > 0
          ? entity.word
          : text.slice(start, end)
      candidates.push({
        label,
        score: typeof entity.score === 'number' ? entity.score : 1,
        word,
        start,
        end
      })
      continue
    }

    unpositioned.push(entity)
  }

  return [...candidates, ...aggregateBioEntities(unpositioned)]
}

function aggregateBioEntities(raw: NerRawEntity[]): NerSpanCandidate[] {
  const candidates: NerSpanCandidate[] = []
  let current: {
    label: string
    word: string
    scoreSum: number
    scoreCount: number
    startTokenIndex?: number
    endTokenIndex?: number
  } | null = null

  function flush(): void {
    if (!current || current.word.length < 2) {
      current = null
      return
    }

    candidates.push({
      label: current.label,
      word: current.word,
      score: current.scoreSum / current.scoreCount,
      startTokenIndex: current.startTokenIndex,
      endTokenIndex: current.endTokenIndex
    })
    current = null
  }

  for (const entity of raw) {
    const rawLabel = (entity.entity ?? entity.entity_group ?? '') as string
    const rawWord = typeof entity.word === 'string' ? entity.word : ''
    const isSubwordContinuation = rawWord.startsWith('##')
    const parsed = parseBioLabel(rawLabel)
    const word = cleanWordPiece(rawWord)
    const score = typeof entity.score === 'number' ? entity.score : 1

    // A "##" piece always belongs to the previous wordpiece's entity — it is
    // literally the same input word. The model sometimes labels the tail piece
    // as O (or with a different label than its head), which would truncate the
    // span (e.g. "mer" PER + "##lin" O → candidate "mer" instead of "merlin").
    // Merge into the active span regardless of label so reconstruction follows
    // whole words. Only add the score when the tail agrees with the head's
    // label — otherwise the conflicting O-score would dilute the entity's
    // confidence below the min-score threshold.
    if (isSubwordContinuation && current && word) {
      current.word = appendWordPiece(current.word, rawWord)
      if (parsed && parsed.label === current.label) {
        current.scoreSum += score
        current.scoreCount += 1
      }
      if (typeof entity.index === 'number') {
        current.endTokenIndex = entity.index
      }
      continue
    }

    if (!parsed || !word) {
      flush()
      continue
    }

    const shouldStartNew =
      current === null || parsed.prefix === 'B' || parsed.label !== current.label

    if (shouldStartNew) {
      flush()
      current = {
        label: parsed.label,
        word,
        scoreSum: score,
        scoreCount: 1,
        startTokenIndex: typeof entity.index === 'number' ? entity.index : undefined,
        endTokenIndex: typeof entity.index === 'number' ? entity.index : undefined
      }
      continue
    }

    const active = current
    if (!active) continue

    active.word = appendWordPiece(active.word, rawWord)
    active.scoreSum += score
    active.scoreCount += 1
    if (typeof entity.index === 'number') {
      active.endTokenIndex = entity.index
    }
  }

  flush()
  return candidates
}

function parseBioLabel(rawLabel: string): { prefix: string; label: string } | null {
  if (!rawLabel) return null

  const match = /^(?:(B|I|E|S)-)?(.+)$/.exec(rawLabel.trim())
  if (!match?.[2]) return null

  return { prefix: match[1] ?? '', label: match[2] }
}

function cleanWordPiece(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value
    .replace(/^##/, '')
    .replace(/^[▁Ġ]+/u, '')
    .replace(/<\/w>$/u, '')
    .trim()
}

function appendWordPiece(current: string, rawPiece: unknown): string {
  const raw = typeof rawPiece === 'string' ? rawPiece : ''
  const piece = cleanWordPiece(raw)
  if (!piece) return current
  if (!current) return piece

  const joinToPrevious =
    raw.startsWith('##') || /^[)\]}.,;:!?%/\\'’-]+$/u.test(piece) || /[([{/'"«“‘’-]$/u.test(current)

  return joinToPrevious ? `${current}${piece}` : `${current} ${piece}`
}

function resolveEntitySpan(
  text: string,
  entity: NerSpanCandidate,
  searchFrom: number,
  tokenOffsets: Map<number, { start: number; end: number }>
): { value: string; start: number; end: number } | null {
  if (typeof entity.start === 'number' && typeof entity.end === 'number') {
    const value = text.slice(entity.start, entity.end).trim()
    if (value.length < 2) return null

    const trimmedStart = entity.start + text.slice(entity.start, entity.end).indexOf(value)
    const trimmedEnd = trimmedStart + value.length
    return { value, start: trimmedStart, end: trimmedEnd }
  }

  const word = entity.word.trim()
  if (word.length < 2) return null

  if (typeof entity.startTokenIndex === 'number' && typeof entity.endTokenIndex === 'number') {
    const tokenSpan = resolveSpanFromTokenOffsets(text, entity, tokenOffsets)
    if (tokenSpan) return tokenSpan
  }

  const located = findTextSpan(text, word, searchFrom)
  if (!located) return null

  return { value: text.slice(located.start, located.end), start: located.start, end: located.end }
}

function resolveSpanFromTokenOffsets(
  text: string,
  entity: NerSpanCandidate,
  tokenOffsets: Map<number, { start: number; end: number }>
): { value: string; start: number; end: number } | null {
  const first = tokenOffsets.get(entity.startTokenIndex!)
  const last = tokenOffsets.get(entity.endTokenIndex!)
  if (!first || !last || last.end <= first.start) return null

  const rawValue = text.slice(first.start, last.end)
  const value = rawValue.trim()
  if (value.length < 2) return null

  const trimmedStart = first.start + rawValue.indexOf(value)
  return { value, start: trimmedStart, end: trimmedStart + value.length }
}

function buildTokenOffsets(
  text: string,
  pipe: NerPipelineFn | null
): Map<number, { start: number; end: number }> {
  const tokenizer = (pipe as (NerPipelineFn & { tokenizer?: NerTokenizer }) | null)?.tokenizer
  if (!tokenizer?.tokenize) return new Map()

  const tokens = tokenizer.tokenize(text, { add_special_tokens: true })
  const offsets = new Map<number, { start: number; end: number }>()
  const specialTokens = new Set([
    ...(tokenizer.all_special_tokens ?? []),
    ...(tokenizer.special_tokens ?? [])
  ])

  let cursor = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    if (!token || specialTokens.has(token)) continue

    const piece = cleanWordPiece(token)
    if (!piece) continue

    const startSearch = token.startsWith('##') ? cursor : skipWhitespace(text, cursor)
    const match = findTokenPiece(text, piece, startSearch)
    if (!match) continue

    offsets.set(i, match)
    cursor = match.end
  }

  return offsets
}

function skipWhitespace(text: string, from: number): number {
  let cursor = from
  while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) {
    cursor += 1
  }
  return cursor
}

function findTokenPiece(
  text: string,
  piece: string,
  from: number
): { start: number; end: number } | null {
  const exact = text.indexOf(piece, from)
  if (exact >= 0 && exact - from <= 32) {
    return { start: exact, end: exact + piece.length }
  }

  const lowerText = text.toLocaleLowerCase()
  const lowerPiece = piece.toLocaleLowerCase()
  const lower = lowerText.indexOf(lowerPiece, from)
  if (lower >= 0 && lower - from <= 32) {
    return { start: lower, end: lower + piece.length }
  }

  return null
}

// Drop any span whose character range overlaps one already emitted. Input order
// matters: earlier entries win, which lets the caller express a priority (e.g.
// first-pass spans before second-pass title-case spans). Within overlapping
// candidates we keep the first; for ties on identical ranges the Map would also
// collapse them, but we want real overlap rejection (e.g. 4-21 wins over 4-23).
function dedupeByOverlap(spans: DetectedSpan[]): DetectedSpan[] {
  const kept: DetectedSpan[] = []
  for (const span of spans) {
    const overlaps = kept.some((prev) => span.start < prev.end && prev.start < span.end)
    if (!overlaps) kept.push(span)
  }
  return kept
}

function findTextSpan(
  text: string,
  value: string,
  searchFrom: number
): { start: number; end: number } | null {
  const exactFromCursor = text.indexOf(value, searchFrom)
  if (exactFromCursor >= 0) {
    return { start: exactFromCursor, end: exactFromCursor + value.length }
  }

  const exactAnywhere = text.indexOf(value)
  if (exactAnywhere >= 0) {
    return { start: exactAnywhere, end: exactAnywhere + value.length }
  }

  const lowerText = text.toLocaleLowerCase()
  const lowerValue = value.toLocaleLowerCase()
  const lowerFromCursor = lowerText.indexOf(lowerValue, searchFrom)
  if (lowerFromCursor >= 0) {
    return { start: lowerFromCursor, end: lowerFromCursor + value.length }
  }

  const lowerAnywhere = lowerText.indexOf(lowerValue)
  if (lowerAnywhere >= 0) {
    return { start: lowerAnywhere, end: lowerAnywhere + value.length }
  }

  return null
}

export interface NerHints {
  /**
   * Copy of the input text with NER-detected PER / LOC / ORG regions rewritten
   * to Title Case. Case-only mutation: character positions match the input
   * one-for-one, so spans produced against `hintedText` remain valid against
   * the original.
   */
  hintedText: string
  /**
   * Regions the model flagged. Callers use these to emit fallback spans for
   * regions the regex pipeline doesn't cover (e.g. foreign surnames without a
   * known-first-name anchor, addresses without a leading house number).
   */
  nerRegions: DetectedSpan[]
}

/**
 * Run the NER model and return a capitalization-hinted copy of the text plus
 * the detected regions. Callers run their regex-based detectors against
 * `hintedText` and use `nerRegions` to backfill regions the regex misses.
 *
 * Noop when NER is disabled or the pipeline fails to load.
 */
export async function applyNerHints(
  text: string,
  config: NerConfig = { enabled: false }
): Promise<NerHints> {
  if (!config.enabled) return { hintedText: text, nerRegions: [] }
  if (!text || text.length < 2) return { hintedText: text, nerRegions: [] }

  const pipe = await loadNerPipeline(config)
  if (!pipe) return { hintedText: text, nerRegions: [] }

  try {
    const minScore = resolveMinScore(text, config)
    // ignore_labels: [] — the pipeline defaults to filtering "O" tokens, which
    // silently drops the tail "##" piece of a recognized entity when the model
    // predicts a different label for it (e.g. "mer" PER + "##lin" O). We need
    // every token to run our own subword-continuation merge in aggregateBioEntities.
    const pipeOpts = { ignore_labels: [] as string[] }
    const raw = (await pipe(text, pipeOpts)) as NerRawEntity[]
    const firstPass = mapEntitiesToSpans(text, pipe, raw, minScore)

    const titleCaseCandidate = buildTitleCaseCandidate(text)
    const secondPass = titleCaseCandidate
      ? mapEntitiesToSpans(
          text,
          pipe,
          (await pipe(titleCaseCandidate, pipeOpts)) as NerRawEntity[],
          minScore,
          titleCaseCandidate
        )
      : []

    const nameRegions = [...firstPass, ...secondPass].filter((span) => span.type === 'name')
    const shortQueryFallback = nameRegions.length === 0 ? buildTriggeredFallbackSpans(text) : []

    // First-pass regions win on overlap: the second pass runs on a text mutated
    // by title-case heuristics and can produce over-extended regions that
    // overlap the originals.
    const regions = dedupeByOverlap([...firstPass, ...secondPass, ...shortQueryFallback])
    const hintedText = applyCapitalizationHints(text, regions)
    return { hintedText, nerRegions: regions }
  } catch (err) {
    inferenceWarnLog.warnOnce(err)
    return { hintedText: text, nerRegions: [] }
  }
}

/**
 * Rewrite `text` so each word inside every NER region starts with an uppercase
 * letter. Only the first letter of each word is lifted to upper — inner letters
 * are untouched, and already-capitalized words are left alone. Character
 * positions match the input 1-for-1 so spans produced against the returned
 * string stay valid against the original.
 *
 * Word boundaries inside a region: whitespace, hyphens, apostrophes, and dots
 * (so "jean-michel tanguy" → "Jean-Michel Tanguy", "o'neill" → "O'Neill").
 */
function applyCapitalizationHints(text: string, regions: DetectedSpan[]): string {
  if (regions.length === 0) return text

  const chars = [...text]
  for (const region of regions) {
    let atWordStart = true
    for (let i = region.start; i < region.end && i < chars.length; i += 1) {
      const ch = chars[i] ?? ''
      if (/[\s\-'’.]/u.test(ch)) {
        atWordStart = true
        continue
      }
      if (atWordStart) {
        const upper = ch.toLocaleUpperCase()
        if (upper !== ch) chars[i] = upper
        atWordStart = false
      }
    }
  }
  return chars.join('')
}

/**
 * Preload the NER model so the first user-facing pseudonymization call isn't
 * blocked by a cold start. Safe to call multiple times; the pipeline is cached.
 *
 * Recommended: invoke once at app startup from the main process, non-awaited,
 * so model download happens in the background.
 */
export async function warmupNer(config: NerConfig): Promise<void> {
  if (!config.enabled) return
  await warmupPipeline({
    task: 'token-classification',
    model: config.model ?? DEFAULT_MODEL,
    modelPath: config.modelPath,
    quantized: config.quantized
  })
}

/** Reset the cached pipeline — exposed for tests and for model hot-swap. */
export function __resetNerCacheForTests(): void {
  inferenceWarnLog.reset()
  __resetModelRegistryForTests()
}
