/**
 * citationStrip — strips [[marker]] `fakeValue` citation annotations from
 * tool call arguments emitted by some remote model variants.
 *
 * Used by:
 *   - ollamaSdkProvider.ts / openAiCompatibleSdkProvider.ts (SDK providers)
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Strips [[path]] `value` → value from a single string. */
export function stripCitationAnnotation(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const m = value.match(/^\[\[.*?\]\]\s*`([\s\S]*)`$/)
  return m ? m[1] : value
}

/** Recursively strips citation annotations from an object/array/string. */
export function deepStripCitationAnnotations(obj: unknown): unknown {
  if (typeof obj === 'string') return stripCitationAnnotation(obj)
  if (Array.isArray(obj)) return obj.map(deepStripCitationAnnotations)
  if (isRecord(obj)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = deepStripCitationAnnotations(v)
    return out
  }
  return obj
}
