/**
 * Detects « pièce n°X » references in the added text of a comparison,
 * so newly cited exhibits surface immediately. Numbers follow the
 * adversary's own numbering — they are listed, never matched against
 * this dossier's bordereau.
 */
import type { DetectedPieceReference } from '@shared/domain/compare'

/**
 * Matches: « pièce n° 12 », « pièces nos 4 à 7 », « (pièce adverse n°3) »,
 * « pièces n°2 et 5 », and the bare « pièce 12 ». The optional marker
 * (n°/no/nos) must be followed by digits, so « pièce maîtresse » or
 * « pièces jointes » never match.
 */
const PIECE_REFERENCE_PATTERN =
  /\bpi[èe]ces?\s+(?:adverses?\s+)?(?:n\s*[°ºo]?s?\.?\s*)?(\d{1,3}(?:\s*(?:,|et|à|-|–)\s*\d{1,3})*)/gi

/** A range wider than this is kept as its two endpoints, not expanded. */
const RANGE_EXPANSION_CAP = 50

const EXCERPT_RADIUS = 80

function expandNumberList(captured: string): number[] {
  const numbers: number[] = []
  for (const token of captured.split(/\s*(?:,|et)\s*/i)) {
    const range = token.match(/^(\d{1,3})\s*(?:à|-|–)\s*(\d{1,3})$/i)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (end > start && end - start <= RANGE_EXPANSION_CAP) {
        for (let value = start; value <= end; value += 1) numbers.push(value)
      } else {
        numbers.push(start, end)
      }
      continue
    }
    const single = token.match(/^\d{1,3}$/)
    if (single) numbers.push(Number(single[0]))
  }
  return numbers
}

function buildExcerpt(text: string, matchStart: number, matchEnd: number): string {
  const start = Math.max(0, matchStart - EXCERPT_RADIUS)
  const end = Math.min(text.length, matchEnd + EXCERPT_RADIUS)
  let excerpt = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) excerpt = `… ${excerpt}`
  if (end < text.length) excerpt = `${excerpt} …`
  return excerpt
}

export function detectPieceReferences(
  added: Array<{ text: string; blockIndex: number }>
): DetectedPieceReference[] {
  const references: DetectedPieceReference[] = []
  const seen = new Set<string>()
  for (const entry of added) {
    for (const match of entry.text.matchAll(PIECE_REFERENCE_PATTERN)) {
      const numbers = expandNumberList(match[1]!)
      if (numbers.length === 0) continue
      const key = `${entry.blockIndex}:${numbers.join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      references.push({
        numbers,
        raw: match[0].trim(),
        excerpt: buildExcerpt(entry.text, match.index, match.index + match[0].length),
        blockIndex: entry.blockIndex
      })
    }
  }
  return references.sort((a, b) => a.blockIndex - b.blockIndex)
}
