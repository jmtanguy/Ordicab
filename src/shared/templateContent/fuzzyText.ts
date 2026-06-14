/**
 * Accent/case-insensitive tokenization helpers shared by the tag lint
 * (templateContent/tagLint.ts) and the AI-side fuzzy tag resolver
 * (main/lib/aiEmbedded/dossierTagResolver.ts).
 */

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '')
}

export function tokenize(value: string): string[] {
  return stripAccents(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Structural words that carry no identity on their own — matching on them
 * would make every keyDate/reference path look alike.
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

export function distinguishingTokens(value: string): Set<string> {
  return new Set(tokenize(value).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t)))
}
