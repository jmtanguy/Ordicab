import type { DossierSummary } from '@shared/types'

import type { DossierSection, SidebarDestination } from './Sidebar'

type CommandPaletteAction = 'new-dossier'

export type CommandPaletteItem =
  | { kind: 'dossier'; dossierId: string; label: string; sublabel: string | null }
  | { kind: 'destination'; destination: SidebarDestination; label: string }
  | { kind: 'section'; section: DossierSection; label: string }
  | { kind: 'action'; action: CommandPaletteAction; label: string }

type CommandPaletteGroupKey = 'recent' | 'dossiers' | 'navigation' | 'sections' | 'actions'

export interface CommandPaletteGroup {
  key: CommandPaletteGroupKey
  label: string
  items: CommandPaletteItem[]
}

export interface CommandPaletteEntry<TId extends string> {
  id: TId
  label: string
}

export interface BuildCommandPaletteGroupsOptions {
  query: string
  dossiers: DossierSummary[]
  destinations: ReadonlyArray<CommandPaletteEntry<SidebarDestination>>
  /** Detail sections of the currently open dossier; empty when none is open. */
  sections: ReadonlyArray<CommandPaletteEntry<DossierSection>>
  actions: ReadonlyArray<CommandPaletteEntry<CommandPaletteAction>>
  groupLabels: Record<CommandPaletteGroupKey, string>
  recentLimit?: number
}

const DEFAULT_RECENT_LIMIT = 5

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

/**
 * Ranks how well `query` matches `text` (both raw): prefix (3) > word-start
 * (2) > substring (1) > in-order subsequence (0). Returns null on no match.
 * Diacritics are ignored so "modeles" matches "Modèles".
 */
export function matchScore(query: string, text: string): number | null {
  const normalizedQuery = normalize(query.trim())
  if (normalizedQuery.length === 0) {
    return null
  }

  const normalizedText = normalize(text)
  const index = normalizedText.indexOf(normalizedQuery)
  if (index === 0) {
    return 3
  }
  if (index > 0) {
    return /[\s\-_'.,/(]/.test(normalizedText.charAt(index - 1)) ? 2 : 1
  }

  // Fuzzy fallback: every query character appears in order in the text.
  let cursor = 0
  for (const char of normalizedQuery) {
    cursor = normalizedText.indexOf(char, cursor)
    if (cursor === -1) {
      return null
    }
    cursor += 1
  }
  return 0
}

/** Dossiers opened at least once, most recently opened first. */
export function selectRecentDossiers(
  dossiers: ReadonlyArray<DossierSummary>,
  limit = DEFAULT_RECENT_LIMIT
): DossierSummary[] {
  return dossiers
    .filter((dossier) => dossier.lastOpenedAt !== null)
    .sort((left, right) =>
      (right.lastOpenedAt as string).localeCompare(left.lastOpenedAt as string)
    )
    .slice(0, limit)
}

/** Dossiers matching `query` on name or type, best matches first. */
export function filterDossiers(
  dossiers: ReadonlyArray<DossierSummary>,
  query: string
): DossierSummary[] {
  return rankByScore(dossiers, (dossier) => {
    const nameScore = matchScore(query, dossier.name)
    const typeScore = dossier.type ? matchScore(query, dossier.type) : null
    return maxScore(nameScore, typeScore)
  }).map(({ value }) => value)
}

function maxScore(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right
  }
  return right === null ? left : Math.max(left, right)
}

function rankByScore<T>(
  values: ReadonlyArray<T>,
  score: (value: T) => number | null
): { value: T; score: number }[] {
  return values
    .map((value) => ({ value, score: score(value) }))
    .filter((entry): entry is { value: T; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score)
}

function filterEntries<TId extends string>(
  entries: ReadonlyArray<CommandPaletteEntry<TId>>,
  query: string
): CommandPaletteEntry<TId>[] {
  return rankByScore(entries, (entry) => matchScore(query, entry.label)).map(({ value }) => value)
}

function toDossierItem(dossier: DossierSummary): CommandPaletteItem {
  return {
    kind: 'dossier',
    dossierId: dossier.slug,
    label: dossier.name,
    sublabel: dossier.type || null
  }
}

export function buildCommandPaletteGroups(
  options: BuildCommandPaletteGroupsOptions
): CommandPaletteGroup[] {
  const { dossiers, destinations, sections, actions, groupLabels } = options
  const query = options.query.trim()
  const hasQuery = query.length > 0

  const groups: CommandPaletteGroup[] = hasQuery
    ? [
        {
          key: 'dossiers',
          label: groupLabels.dossiers,
          items: filterDossiers(dossiers, query).map(toDossierItem)
        },
        {
          key: 'navigation',
          label: groupLabels.navigation,
          items: filterEntries(destinations, query).map((entry) => ({
            kind: 'destination',
            destination: entry.id,
            label: entry.label
          }))
        },
        {
          key: 'sections',
          label: groupLabels.sections,
          items: filterEntries(sections, query).map((entry) => ({
            kind: 'section',
            section: entry.id,
            label: entry.label
          }))
        },
        {
          key: 'actions',
          label: groupLabels.actions,
          items: filterEntries(actions, query).map((entry) => ({
            kind: 'action',
            action: entry.id,
            label: entry.label
          }))
        }
      ]
    : [
        {
          key: 'recent',
          label: groupLabels.recent,
          items: selectRecentDossiers(dossiers, options.recentLimit).map(toDossierItem)
        },
        {
          key: 'navigation',
          label: groupLabels.navigation,
          items: destinations.map((entry) => ({
            kind: 'destination',
            destination: entry.id,
            label: entry.label
          }))
        },
        {
          key: 'sections',
          label: groupLabels.sections,
          items: sections.map((entry) => ({
            kind: 'section',
            section: entry.id,
            label: entry.label
          }))
        },
        {
          key: 'actions',
          label: groupLabels.actions,
          items: actions.map((entry) => ({
            kind: 'action',
            action: entry.id,
            label: entry.label
          }))
        }
      ]

  return groups.filter((group) => group.items.length > 0)
}
