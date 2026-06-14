import { extractTagPath, normalizeTagPath, stripAccents } from '@shared/templateContent'
import {
  TEMPLATE_ROUTINE_GROUPS,
  type TemplateRoutineEntry,
  type TemplateRoutineGroup
} from '@shared/templateRoutines'

import type { TagSuggestionItem } from './TagAutocompletePopup'

function normalizeNeedle(value: string): string {
  return stripAccents(value).toLowerCase()
}

/**
 * Filters and ranks catalog entries for the `{{` autocomplete: accent/case
 * insensitive substring match over the EN/FR tag paths and descriptions,
 * tag-path matches ranked before description-only matches, grouped in catalog
 * group order.
 */
export function buildTagSuggestionItems(
  entries: TemplateRoutineEntry[],
  query: string,
  language: string,
  localizeTagPath: (path: string) => string,
  groupLabel: (group: TemplateRoutineGroup) => string,
  max = 40
): TagSuggestionItem[] {
  const needle = normalizeNeedle(query.trim())
  const isFrench = language.startsWith('fr')

  const matched: Array<{ entry: TemplateRoutineEntry; rank: number }> = []
  const seenPaths = new Set<string>()

  for (const entry of entries) {
    if (entry.visibility === 'hidden') continue
    const path = normalizeTagPath(extractTagPath(entry.tag))
    if (seenPaths.has(path)) continue

    let rank: number | null = null
    if (!needle) {
      rank = 0
    } else {
      const tagHaystack = normalizeNeedle(`${entry.tag} ${entry.tagFr ?? ''}`)
      const descriptionHaystack = normalizeNeedle(
        `${entry.description} ${entry.descriptionFr ?? ''}`
      )
      if (tagHaystack.includes(needle)) rank = 0
      else if (descriptionHaystack.includes(needle)) rank = 1
    }

    if (rank === null) continue
    seenPaths.add(path)
    matched.push({ entry, rank })
  }

  const groupOrder = new Map(TEMPLATE_ROUTINE_GROUPS.map((group, index) => [group, index]))
  matched.sort((a, b) => {
    const groupDelta = (groupOrder.get(a.entry.group) ?? 99) - (groupOrder.get(b.entry.group) ?? 99)
    if (groupDelta !== 0) return groupDelta
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.entry.tag.localeCompare(b.entry.tag)
  })

  return matched.slice(0, max).map(({ entry }) => {
    const path = normalizeTagPath(extractTagPath(entry.tag))
    return {
      path,
      label: localizeTagPath(path),
      description:
        (isFrench ? (entry.descriptionFr ?? entry.description) : entry.description) ?? '',
      example: entry.example,
      groupLabel: groupLabel(entry.group)
    }
  })
}
