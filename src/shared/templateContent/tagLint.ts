/**
 * Template tag lint — validates the `{{tag}}` paths of a template against the
 * tag catalog and produces "did you mean…" suggestions for unknown paths.
 *
 * Used by the template editor (save-time warnings, unknown-chip styling) and
 * by the AI tagification service to filter model output.
 */

import type { TemplateRoutineEntry } from '../templateRoutines/types'
import { CONTACT_ROLE_FIELD_ALIASES } from '../templateRoutines/types'
import { distinguishingTokens } from './fuzzyText'
import { RAW_TAG_PATTERN, TAG_SPAN_PATTERN, renderSmartTagSpan } from './html'
import {
  buildTagToken,
  extractTagPath,
  normalizeTagPath,
  shouldExposeTemplateTagPath
} from './tagPaths'

export interface KnownTagIndex {
  /** Normalized canonical paths of every catalog entry (EN + FR aliases). */
  paths: Set<string>
  entries: TemplateRoutineEntry[]
}

export interface TagLintIssue {
  /** The path as written in the template (before normalization). */
  rawPath: string
  normalizedPath: string
  /** Closest catalog paths, best first. */
  suggestions: string[]
}

const KNOWN_CONTACT_ROLE_FIELDS = new Set([
  ...CONTACT_ROLE_FIELD_ALIASES.map((alias) => alias.en),
  'email',
  'role'
])

const KEY_DATE_VARIANTS = new Set(['formatted', 'long', 'short', 'label'])
const DATE_OFFSET_PATTERN = /^date\.today\+\d+(?:\.(formatted|long|short))?$/

export function buildKnownTagIndex(entries: TemplateRoutineEntry[]): KnownTagIndex {
  const paths = new Set<string>()
  for (const entry of entries) {
    for (const tag of [entry.tag, entry.tagFr]) {
      if (!tag) continue
      paths.add(normalizeTagPath(extractTagPath(tag)))
    }
  }
  return { paths, entries }
}

/**
 * A path is valid when it resolves to a catalog entry or matches one of the
 * dynamic families the generator resolves at runtime:
 * - `contact.<role>.<knownField>` (role names are free-form)
 * - `dossier.keyDate.<label>(.<variant>)?` (chronology labels are free-form)
 * - `date.today+N(.<variant>)?` (computed offsets)
 * - `dossier.<reference>` (single-segment dossier key references are
 *   per-dossier data the lint cannot verify — never flagged)
 */
export function isValidTagPath(path: string, index: KnownTagIndex): boolean {
  const normalized = normalizeTagPath(extractTagPath(path))
  if (index.paths.has(normalized)) return true

  const segments = normalized.split('.')

  if (segments[0] === 'contact' && segments.length === 3) {
    return KNOWN_CONTACT_ROLE_FIELDS.has(segments[2] as string)
  }

  if (segments[0] === 'dossier' && segments[1] === 'keyDate') {
    if (segments.length === 3) return true
    if (segments.length === 4) return KEY_DATE_VARIANTS.has(segments[3] as string)
    return false
  }

  if (DATE_OFFSET_PATTERN.test(normalized)) return true

  if (segments[0] === 'dossier' && segments.length === 2) return true

  return false
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  const dist = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j += 1) dist[0]![j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost
      )
    }
  }
  return dist[rows - 1]![cols - 1]!
}

function lastSegment(path: string): string {
  return path.split('.').pop() ?? path
}

/**
 * Ranks catalog entries against an unknown path: distinguishing-token overlap
 * first, Levenshtein distance on the last segment as tie-break / fallback.
 */
export function suggestTagPaths(unknownPath: string, index: KnownTagIndex, max = 3): string[] {
  const normalized = normalizeTagPath(extractTagPath(unknownPath))
  const unknownTokens = distinguishingTokens(normalized)
  const unknownLast = lastSegment(normalized).toLowerCase()

  const scored: Array<{ path: string; overlap: number; distance: number }> = []
  const seen = new Set<string>()

  for (const entry of index.entries) {
    const canonical = normalizeTagPath(extractTagPath(entry.tag))
    if (seen.has(canonical)) continue
    seen.add(canonical)

    const candidateTokens = distinguishingTokens(`${entry.tag} ${entry.tagFr ?? ''}`)
    let overlap = 0
    for (const token of unknownTokens) {
      if (candidateTokens.has(token)) overlap += 1
    }
    const distance = levenshtein(unknownLast, lastSegment(canonical).toLowerCase())
    if (overlap > 0 || distance <= 3) {
      scored.push({ path: canonical, overlap, distance })
    }
  }

  scored.sort((a, b) => b.overlap - a.overlap || a.distance - b.distance)
  return scored.slice(0, max).map((item) => item.path)
}

function collectTemplateTagPaths(html: string): string[] {
  const rawPaths: string[] = []
  const spanPattern = new RegExp(TAG_SPAN_PATTERN.source, TAG_SPAN_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = spanPattern.exec(html)) !== null) {
    rawPaths.push(match[2] as string)
  }
  const withoutSpans = html.replace(new RegExp(TAG_SPAN_PATTERN.source, TAG_SPAN_PATTERN.flags), '')
  const rawPattern = new RegExp(RAW_TAG_PATTERN.source, RAW_TAG_PATTERN.flags)
  while ((match = rawPattern.exec(withoutSpans)) !== null) {
    rawPaths.push(match[1] as string)
  }
  return rawPaths
}

export function lintTemplateHtml(html: string, index: KnownTagIndex): TagLintIssue[] {
  const issues: TagLintIssue[] = []
  const reported = new Set<string>()

  for (const rawPath of collectTemplateTagPaths(html)) {
    if (!shouldExposeTemplateTagPath(rawPath)) continue
    const normalizedPath = normalizeTagPath(extractTagPath(rawPath))
    if (reported.has(normalizedPath)) continue
    if (isValidTagPath(normalizedPath, index)) continue
    reported.add(normalizedPath)
    issues.push({
      rawPath: extractTagPath(rawPath),
      normalizedPath,
      suggestions: suggestTagPaths(normalizedPath, index)
    })
  }

  return issues
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces every occurrence of a tag (smart span or raw token) whose path
 * normalizes to `fromPath` with a smart-tag span for `toPath`.
 */
export function replaceTagPathInHtml(html: string, fromPath: string, toPath: string): string {
  const normalizedFrom = normalizeTagPath(extractTagPath(fromPath))
  const replacement = renderSmartTagSpan(toPath)

  const afterSpans = html.replace(
    new RegExp(TAG_SPAN_PATTERN.source, TAG_SPAN_PATTERN.flags),
    (match, _quote: string, spanPath: string) =>
      normalizeTagPath(extractTagPath(spanPath)) === normalizedFrom ? replacement : match
  )

  return afterSpans
    .replace(new RegExp(escapeRegExp(buildTagToken(fromPath)), 'g'), replacement)
    .replace(new RegExp(escapeRegExp(buildTagToken(normalizedFrom)), 'g'), replacement)
}
