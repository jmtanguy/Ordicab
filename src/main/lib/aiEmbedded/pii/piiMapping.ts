/**
 * PiiMapping — bidirectional map between original values and pseudonymized values.
 *
 * Each entry links:
 *   original value  -> { markerPath, fakeValue }
 *   markerPath      -> internal stable id
 *   fakeValue       -> original value (reversal key)
 *
 * The LLM only sees fakeValue. markerPath stays in the internal ledger for
 * stable allocation and cross-turn bookkeeping.
 */

import {
  buildDiacriticInsensitivePattern,
  normalizeMatchKey,
  normalizeWhitespace
} from './textMatching'
import {
  canonicalDateKey,
  findDateTokens,
  formatDateLike,
  parseDateFlexible,
  type ParsedDate
} from './dateNormalization'

/**
 * Minimum length of a fake value that the revert pass will replace back to its
 * original. Fakes shorter than this are skipped on revert (a 1–3 char token
 * would over-match common standalone words), so any fake we mint MUST be at
 * least this long or it can never be decoded and would leak back verbatim.
 * The pseudonymizer enforces the same floor at generation time
 * (`isFakeCandidateSafe`) and the persona path enforces it in aiHandler.
 */
export const MIN_REVERTIBLE_FAKE_LENGTH = 4

export interface MappingEntry {
  markerPath: string
  fakeValue: string
  /** Raw (un-normalized) original value, used for regex building and export. */
  originalValue: string
}

export interface MappingSnapshotEntry {
  original: string
  markerPath: string
  fakeValue: string
}

export interface RevertWithMappingOptions {
  /**
   * Entries from the current pseudonymization turn. They override stale
   * cross-turn collisions because they describe exactly what the LLM just saw.
   */
  currentTurnEntries?: MappingSnapshotEntry[]
}

function setUniqueMapping(map: Map<string, string | null>, key: string, original: string): void {
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, original)
    return
  }
  if (existing !== null && normalizeMatchKey(existing) !== normalizeMatchKey(original)) {
    map.set(key, null)
  }
}

function getUniqueMapping(map: Map<string, string | null>, key: string): string | undefined {
  const value = map.get(key)
  return value === null ? undefined : value
}

/** Revert fake values using exported mapping entries. */
export function revertWithMappingEntries(text: string, entries: MappingSnapshotEntry[]): string {
  return revertWithMappingEntriesWithOptions(text, entries)
}

export function revertWithMappingEntriesWithOptions(
  text: string,
  entries: MappingSnapshotEntry[],
  options: RevertWithMappingOptions = {}
): string {
  if (!text || entries.length === 0) return text

  const fakeValueToOriginal = new Map<string, string | null>()
  const uniqueEntriesByFake = new Map<string, MappingSnapshotEntry>()

  for (const entry of entries) {
    if (!entry.original) continue
    const fakeKey = normalizeMatchKey(entry.fakeValue)
    if (fakeKey) setUniqueMapping(fakeValueToOriginal, fakeKey, entry.original)
  }

  for (const entry of options.currentTurnEntries ?? []) {
    if (!entry.original) continue
    const fakeKey = normalizeMatchKey(entry.fakeValue)
    if (fakeKey) fakeValueToOriginal.set(fakeKey, entry.original)
  }

  const effectiveEntries = [...entries, ...(options.currentTurnEntries ?? [])]
  for (const entry of effectiveEntries) {
    const fakeKey = normalizeMatchKey(entry.fakeValue)
    if (!fakeKey) continue
    const finalOriginal = getUniqueMapping(fakeValueToOriginal, fakeKey)
    if (finalOriginal === undefined) continue
    if (normalizeMatchKey(finalOriginal) !== normalizeMatchKey(entry.original)) continue
    uniqueEntriesByFake.set(fakeKey, entry)
  }

  const sentinels: string[] = []
  let result = text

  const fakeEntries = Array.from(uniqueEntriesByFake.values())
    .filter(
      ({ fakeValue }) =>
        fakeValue.length >= MIN_REVERTIBLE_FAKE_LENGTH && parseDateFlexible(fakeValue) === null
    )
    .sort((a, b) => b.fakeValue.length - a.fakeValue.length)

  for (const { original, fakeValue } of fakeEntries) {
    const escaped = buildDiacriticInsensitivePattern(fakeValue)
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
    result = result.replace(re, original)
  }

  const dateLookup = new Map<string, ParsedDate | null>()
  for (const entry of Array.from(uniqueEntriesByFake.values())) {
    if (!entry.original || !entry.fakeValue) continue
    const fakeParsed = parseDateFlexible(entry.fakeValue)
    if (!fakeParsed) continue
    const originalParsed = parseDateFlexible(entry.original)
    if (!originalParsed) continue
    const key = canonicalDateKey(fakeParsed)
    const existing = dateLookup.get(key)
    if (existing === undefined) {
      dateLookup.set(key, originalParsed)
      continue
    }
    if (existing !== null && canonicalDateKey(existing) !== canonicalDateKey(originalParsed)) {
      dateLookup.set(key, null)
    }
  }

  if (dateLookup.size > 0) {
    const tokens = findDateTokens(result)
    if (tokens.length > 0) {
      let rebuilt = ''
      let cursor = 0
      for (const token of tokens) {
        const parsed = parseDateFlexible(token.value)
        if (!parsed) continue
        const match = dateLookup.get(canonicalDateKey(parsed))
        if (!match) continue
        const replacement = formatDateLike(match, token.value)
        const idx = sentinels.push(replacement) - 1
        rebuilt += result.slice(cursor, token.start) + `__ORDICAB_PII_SENTINEL_${idx}__`
        cursor = token.end
      }
      rebuilt += result.slice(cursor)
      result = rebuilt
    }
  }

  return result.replace(
    /__ORDICAB_PII_SENTINEL_(\d+)__/g,
    (_match, i: string) => sentinels[Number(i)] ?? ''
  )
}

/** Walk a JSON value and reapply fake-value revert against every string and key. */
export function revertJsonValueWithMappingEntries(
  value: unknown,
  entries: MappingSnapshotEntry[],
  options: RevertWithMappingOptions = {}
): unknown {
  return revertJsonRecursive(value, entries, options)
}

function revertJsonRecursive(
  value: unknown,
  entries: MappingSnapshotEntry[],
  options: RevertWithMappingOptions
): unknown {
  if (typeof value === 'string') {
    return revertWithMappingEntriesWithOptions(value, entries, options)
  }
  if (Array.isArray(value)) {
    return value.map((item) => revertJsonRecursive(item, entries, options))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const revertedKey = revertWithMappingEntriesWithOptions(key, entries, options)
      result[revertedKey] = revertJsonRecursive(child, entries, options)
    }
    return result
  }
  return value
}

export class PiiMapping {
  private originalToEntry = new Map<string, MappingEntry>()
  private markerPathToOriginal = new Map<string, string>()
  private fakeValueToOriginal = new Map<string, string>()
  private usedMarkerPaths = new Set<string>()
  private counters = new Map<string, number>()

  add(original: string, markerPath: string, fakeValue: string): MappingEntry | undefined {
    if (!original) return undefined
    const cleanedOriginal = normalizeWhitespace(original)
    const normalizedOriginal = normalizeMatchKey(cleanedOriginal)
    if (!normalizedOriginal || this.originalToEntry.has(normalizedOriginal)) {
      return this.originalToEntry.get(normalizedOriginal)
    }
    if (!markerPath) return undefined
    if (this.usedMarkerPaths.has(markerPath)) return undefined
    const fakeKey = normalizeMatchKey(fakeValue)
    if (fakeKey && this.isFakeValueBlocked(fakeValue, cleanedOriginal)) return undefined

    this.originalToEntry.set(normalizedOriginal, {
      markerPath,
      fakeValue,
      originalValue: cleanedOriginal
    })
    this.markerPathToOriginal.set(markerPath, cleanedOriginal)
    if (fakeKey) this.fakeValueToOriginal.set(fakeKey, cleanedOriginal)
    this.usedMarkerPaths.add(markerPath)
    return this.originalToEntry.get(normalizedOriginal)
  }

  isFakeUsedByOther(fake: string, ownOriginal: string): boolean {
    const existing = this.fakeValueToOriginal.get(normalizeMatchKey(fake))
    if (!existing) return false
    return normalizeMatchKey(existing) !== normalizeMatchKey(ownOriginal)
  }

  isFakeValueBlocked(fake: string, ownOriginal: string): boolean {
    const fakeKey = normalizeMatchKey(fake)
    if (!fakeKey) return false
    const ownKey = normalizeMatchKey(ownOriginal)
    if (fakeKey === ownKey) return true

    const existingFakeOwner = this.fakeValueToOriginal.get(fakeKey)
    if (existingFakeOwner && normalizeMatchKey(existingFakeOwner) !== ownKey) return true

    const existingOriginal = this.originalToEntry.get(fakeKey)
    if (existingOriginal && normalizeMatchKey(existingOriginal.originalValue) !== ownKey) {
      return true
    }

    return false
  }

  isMarkerPathUsed(path: string): boolean {
    return this.usedMarkerPaths.has(path)
  }

  getFake(original: string): MappingEntry | undefined {
    return this.originalToEntry.get(normalizeMatchKey(original))
  }

  getOriginalByMarker(markerPath: string): string | undefined {
    return this.markerPathToOriginal.get(markerPath)
  }

  getOriginalByFake(fakeValue: string): string | undefined {
    return this.fakeValueToOriginal.get(normalizeMatchKey(fakeValue))
  }

  hasOriginal(original: string): boolean {
    return this.originalToEntry.has(normalizeMatchKey(original))
  }

  bumpCounter(typeKey: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    const current = this.counters.get(typeKey) ?? 0
    if (value > current) this.counters.set(typeKey, value)
  }

  nextMarker(typeKey: string): string {
    const n = (this.counters.get(typeKey) ?? 0) + 1
    this.counters.set(typeKey, n)
    return `${typeKey}_${n}`
  }

  static format(_markerPath: string, fakeValue: string): string {
    return fakeValue
  }

  revert(text: string): string {
    return revertWithMappingEntriesWithOptions(text, this.toJSON())
  }

  entriesByLength(): Array<{ original: string; entry: MappingEntry }> {
    return Array.from(this.originalToEntry.values())
      .map((entry) => ({ original: entry.originalValue, entry }))
      .sort((a, b) => b.original.length - a.original.length)
  }

  toJSON(): MappingSnapshotEntry[] {
    return Array.from(this.originalToEntry.values())
      .map((entry) => ({
        original: entry.originalValue,
        markerPath: entry.markerPath,
        fakeValue: entry.fakeValue
      }))
      .sort((left, right) => left.markerPath.localeCompare(right.markerPath))
  }
}
