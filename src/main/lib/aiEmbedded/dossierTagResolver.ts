/**
 * dossierTagResolver — fuzzy-resolves unresolved `dossier.keyDate.*` / `dossier.keyRef.*`
 * template paths against the active dossier's actual key dates and references.
 *
 * Templates are often authored with simplified keys (e.g. `dossier.keyDate.audience.long`)
 * while the dossier stores entries with longer labels ("Date d'audience"), which `labelToKey`
 * converts to `dateDAudience`. The strict resolver in generateService cannot match these,
 * so document generation fails with `unresolvedTags`.
 *
 * This helper bridges that gap: for each unresolved keyDate/keyRef path, it looks for a
 * unique entry whose label tokens contain the slug. When found, it produces a value
 * formatted according to the variant (`long` | `short` | `formatted` | none) so the
 * dispatcher can retry `document_generate` with `tagOverrides` automatically.
 *
 * Used by: aiCommandDispatcher.ts (document_generate catch-and-retry path)
 */

export interface ResolveDossierTagsInput {
  unresolvedTags: string[]
  keyDates?: Array<{ label: string; date: string }>
  keyReferences?: Array<{ label: string; value: string }>
}

export interface ResolveDossierTagsResult {
  /** Tag overrides ready to be merged into the next `document_generate` call. */
  resolvedOverrides: Record<string, string>
  /** Tags that could not be auto-resolved (no candidate or ambiguous match). */
  stillUnresolved: string[]
  /** Per-tag matches kept for diagnostics (e.g. when the dispatcher needs to surface a clarification). */
  ambiguous: Array<{ tag: string; candidates: string[] }>
}

const KEY_DATE_PATH = /^dossier\.keyDate\.([^.]+)(?:\.([^.]+))?$/
const KEY_REF_PATH = /^dossier\.keyRef\.([^.]+)(?:\.([^.]+))?$/

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '')
}

function tokenize(value: string): string[] {
  return stripAccents(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function entryMatchesSlug(label: string, slug: string): boolean {
  const slugLower = stripAccents(slug).toLowerCase()
  if (!slugLower) return false
  const tokens = tokenize(label)
  if (tokens.includes(slugLower)) return true
  // Substring fallback for compound slugs (e.g. "dateAudience" matching "Date d'audience")
  const joined = tokens.join('')
  return joined.length > 0 && joined.includes(slugLower) && slugLower.length >= 4
}

/**
 * Maps "dangling" tagOverride keys (those not present in the template's macros
 * list) to the matching macro path when there is a unique token-based match.
 *
 * Why: the LLM frequently emits short keys like `dateDAudience` instead of the
 * full template path `dossier.keyDate.audience.long`. generateService silently
 * ignores unknown keys, leaving the corresponding macro unresolved — the user
 * sees a "field still required" message even though they answered it.
 *
 * Matching uses distinguishing tokens (after dropping generic structural words
 * like "dossier", "key", "date", "long") — without that, every keyDate macro
 * shares the "date" token and no migration is unique enough to commit.
 */
const GENERIC_TOKENS = new Set([
  'a',
  'an',
  'contact',
  'd',
  'date',
  'dates',
  'dossier',
  'entity',
  'entite',
  'formatted',
  'formate',
  'key',
  'long',
  'name',
  'nom',
  'of',
  'ref',
  'reference',
  'short',
  'court',
  'the',
  'today',
  'value'
])

function distinguishingTokens(value: string): Set<string> {
  return new Set(tokenize(value).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t)))
}

export function migrateDanglingOverrideKeys(
  overrides: Record<string, string>,
  templateMacros: string[]
): {
  migrated: Record<string, string>
  migrations: Array<{ from: string; to: string }>
  dropped: string[]
} {
  const macroSet = new Set(templateMacros)
  const migrated: Record<string, string> = {}
  const migrations: Array<{ from: string; to: string }> = []
  const dropped: string[] = []

  for (const [key, value] of Object.entries(overrides)) {
    if (macroSet.has(key)) {
      migrated[key] = value
      continue
    }
    if (templateMacros.length === 0) {
      // Without a macro list we cannot migrate; keep the override and let
      // generateService handle it (older code path, mostly tests).
      migrated[key] = value
      continue
    }
    const keyTokens = distinguishingTokens(key)
    if (keyTokens.size === 0) {
      dropped.push(key)
      continue
    }
    const candidates = templateMacros.filter((macro) => {
      const macroTokens = distinguishingTokens(macro)
      for (const t of keyTokens) {
        if (macroTokens.has(t)) return true
      }
      return false
    })
    if (candidates.length === 1) {
      const target = candidates[0]!
      if (migrated[target] === undefined) {
        migrated[target] = value
        migrations.push({ from: key, to: target })
        continue
      }
    }
    dropped.push(key)
  }

  return { migrated, migrations, dropped }
}

function formatDateValue(isoDate: string, variant: string | undefined): string {
  if (!isoDate) return ''
  const date = new Date(isoDate.length === 10 ? `${isoDate}T12:00:00` : isoDate)
  if (Number.isNaN(date.getTime())) return isoDate
  switch (variant) {
    case 'long':
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    case 'short':
      return date.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: '2-digit'
      })
    case 'formatted':
      return date.toLocaleDateString('fr-FR')
    default:
      return isoDate
  }
}

/**
 * Tries to fill missing `dossier.keyDate.*` / `dossier.keyRef.*` overrides from the live
 * dossier data. Returns a partition: tags that resolved cleanly, tags that remain
 * unresolved, and tags that matched several entries (left for the caller to surface).
 */
export function resolveDossierTags(input: ResolveDossierTagsInput): ResolveDossierTagsResult {
  const resolvedOverrides: Record<string, string> = {}
  const stillUnresolved: string[] = []
  const ambiguous: Array<{ tag: string; candidates: string[] }> = []
  const keyDates = input.keyDates ?? []
  const keyReferences = input.keyReferences ?? []

  for (const tag of input.unresolvedTags) {
    const dateMatch = tag.match(KEY_DATE_PATH)
    if (dateMatch) {
      const [, slug = '', variant] = dateMatch
      const candidates = keyDates.filter((entry) => entryMatchesSlug(entry.label, slug))
      if (candidates.length === 1) {
        const formatted = formatDateValue(candidates[0]!.date, variant)
        if (formatted) {
          resolvedOverrides[tag] = formatted
          continue
        }
      } else if (candidates.length > 1) {
        ambiguous.push({ tag, candidates: candidates.map((c) => c.label) })
      }
      stillUnresolved.push(tag)
      continue
    }

    const refMatch = tag.match(KEY_REF_PATH)
    if (refMatch) {
      const [, slug = ''] = refMatch
      const candidates = keyReferences.filter((entry) => entryMatchesSlug(entry.label, slug))
      if (candidates.length === 1) {
        const value = candidates[0]!.value
        if (value) {
          resolvedOverrides[tag] = value
          continue
        }
      } else if (candidates.length > 1) {
        ambiguous.push({ tag, candidates: candidates.map((c) => c.label) })
      }
      stillUnresolved.push(tag)
      continue
    }

    stillUnresolved.push(tag)
  }

  return { resolvedOverrides, stillUnresolved, ambiguous }
}
