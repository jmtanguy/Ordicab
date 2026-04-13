/**
 * PiiMapping — bidirectional map between original values and their pseudonymized markers.
 *
 * Each entry links:
 *   original value  →  { markerPath, fakeValue }
 *   markerPath      →  original value   (for reversal via [[marker]])
 *   fakeValue       →  original value   (fallback reversal when marker is dropped)
 *
 * Markers use [[path]] `fakeValue` syntax:
 *   - path follows template macro conventions: contact.client.firstName, dossier.keyDate.audienceDate
 *   - fakeValue is a realistic replacement so the LLM reasons naturally about the content
 */

import { buildDiacriticInsensitivePattern, normalizeMatchKey } from './textMatching'

export interface MappingEntry {
  markerPath: string
  fakeValue: string
  /** Raw (un-normalized) original value — used for regex building and export */
  originalValue: string
}

export interface MappingSnapshotEntry {
  original: string
  markerPath: string
  fakeValue: string
}

export class PiiMapping {
  private originalToEntry = new Map<string, MappingEntry>()
  private markerPathToOriginal = new Map<string, string>()
  private fakeValueToOriginal = new Map<string, string>()
  private counters = new Map<string, number>()

  private ensureUniqueFakeValue(original: string, fakeValue: string): string {
    let candidate = fakeValue
    let suffix = 2

    while (true) {
      const existingOriginal = this.fakeValueToOriginal.get(normalizeMatchKey(candidate))
      if (!existingOriginal || existingOriginal === original) {
        return candidate
      }
      candidate = `${fakeValue} ${suffix}`
      suffix += 1
    }
  }

  add(original: string, markerPath: string, fakeValue: string): void {
    if (!original) return
    const normalizedOriginal = normalizeMatchKey(original)
    if (!normalizedOriginal || this.originalToEntry.has(normalizedOriginal)) return
    const uniqueFakeValue = this.ensureUniqueFakeValue(normalizedOriginal, fakeValue)
    this.originalToEntry.set(normalizedOriginal, {
      markerPath,
      fakeValue: uniqueFakeValue,
      originalValue: original
    })
    this.markerPathToOriginal.set(markerPath, original)
    this.fakeValueToOriginal.set(normalizeMatchKey(uniqueFakeValue), original)
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

  /** Allocate a counter-based unique marker path for types without a template path */
  nextMarker(typeKey: string): string {
    const n = (this.counters.get(typeKey) ?? 0) + 1
    this.counters.set(typeKey, n)
    return `${typeKey}_${n}`
  }

  /** Format the in-text representation: [[path]] `fakeValue` */
  static format(markerPath: string, fakeValue: string): string {
    return `[[${markerPath}]] \`${fakeValue}\``
  }

  /** Revert all [[marker]] occurrences in text back to original values.
   *
   * Two-pass strategy:
   *   Pass 1 — marker-based: scans for [[path]] patterns. The path is the
   *             canonical key; this handles all cases where the LLM preserved
   *             the marker (as instructed for tool call arguments).
   *   Pass 2 — fake-value fallback: scans remaining text for known fake values
   *             that appear without their [[marker]] wrapper. This covers prose
   *             responses where the LLM is permitted by rule 1 to write just
   *             the replacement value. Only applied to fake values ≥ 4 chars
   *             to reduce false positive risk on short common words.
   *             Longest fake value matched first to prevent partial matches.
   */
  revert(text: string): string {
    // Pass 1: marker-based (primary)
    // Resolved values are stored as null-byte sentinels (\x00N\x00) to protect them from
    // pass 2 substitution. This prevents collisions where an original value happens to match
    // another entry's fake value (e.g. real lastName "Martin" being replaced by country "France"
    // because "Martin" was used as a fake for "France").
    const sentinels: string[] = []
    let result = text.replace(MARKER_RE, (fullMatch, rawPath: string, fakeValue?: string) => {
      const path = rawPath.trim()
      const byMarker = this.markerPathToOriginal.get(path)
      if (byMarker !== undefined) {
        // When a fakeValue hint is present, verify it matches the stored original to handle
        // cases where multiple contacts share the same marker path (e.g. contacts with no role
        // all get prefix 'contact', causing contact.firstName etc. to collide).
        if (
          !fakeValue ||
          normalizeMatchKey(this.originalToEntry.get(byMarker)?.fakeValue ?? '') ===
            normalizeMatchKey(fakeValue)
        ) {
          const idx = sentinels.push(byMarker) - 1
          return `__ORDICAB_PII_SENTINEL_${idx}__`
        }
      }
      if (fakeValue) {
        const byFake = this.fakeValueToOriginal.get(normalizeMatchKey(fakeValue))
        const resolved = byFake ?? fakeValue
        const idx = sentinels.push(resolved) - 1
        return `__ORDICAB_PII_SENTINEL_${idx}__`
      }
      return fullMatch
    })

    // Pass 2: bare fake-value fallback (longest first, min length 4)
    // Sentinels shield pass-1 results so they are not re-processed here.
    const fakeEntries = Array.from(this.originalToEntry.values())
      .map((entry) => ({ original: entry.originalValue, fakeValue: entry.fakeValue }))
      .filter(({ fakeValue }) => fakeValue.length >= 4)
      .sort((a, b) => b.fakeValue.length - a.fakeValue.length)

    for (const { original, fakeValue } of fakeEntries) {
      const escaped = buildDiacriticInsensitivePattern(fakeValue)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      result = result.replace(re, original)
    }

    // Restore sentinels
    result = result.replace(
      /__ORDICAB_PII_SENTINEL_(\d+)__/g,
      (_match, i: string) => sentinels[Number(i)]
    )

    return result
  }

  /** All original→entry pairs sorted by original length descending (longest match first) */
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

/** Regex matching [[path]] optionally followed by `fakeValue`, 'fakeValue', or "fakeValue".
 *  - Path is trimmed of surrounding whitespace during processing.
 *  - Backtick is the canonical delimiter; single and double quotes are accepted for backwards compatibility.
 */
export const MARKER_RE = /\[\[\s*([^\]]+?)\s*\]\](?:\s+[`'"]([^`'"]*)[`'"])?/g
