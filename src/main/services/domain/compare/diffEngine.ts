/**
 * Pure diff engine for the « Comparaison de conclusions » feature.
 *
 * Pipeline: normalize extracted text into noise-free paragraphs →
 * paragraph-level alignment on normalized keys (diffArrays) → pair
 * removed/added paragraphs by word-set similarity into 'modified'
 * blocks refined word-by-word (diffWords) → collapse long unchanged
 * runs so the IPC payload and the DOM stay bounded.
 *
 * Both inputs come from extractDocumentText, whose contract is
 * \n\n-separated paragraphs — but PDF extraction still leaks page
 * numbers, running headers, in-paragraph line wraps and hyphenation,
 * which the normalization pass scrubs before any comparison.
 */
import { diffArrays, diffWords } from 'diff'

import type { ComparisonStats, DiffBlock, DiffSegment } from '@shared/domain/compare'

/** Paragraphs shorter than this are candidate running headers/footers. */
const REPEATED_HEADER_MAX_LENGTH = 80
/** Exact repetitions of a short paragraph before it is dropped as noise. */
const REPEATED_HEADER_MIN_COUNT = 3
/** Dice similarity above which a removed/added paragraph pair is 'modified'. */
const PAIR_SIMILARITY_THRESHOLD = 0.4
/** Unchanged runs strictly longer than this are collapsed (1 context paragraph kept per side). */
const COLLAPSE_THRESHOLD = 3

/** Standalone page markers: "3", "Page 3", "3/25", "3 sur 25". */
const PAGE_MARKER_PATTERN = /^(?:page\s*)?\d{1,4}(?:\s*(?:\/|sur)\s*\d{1,4})?$/i

/**
 * Splits extracted text into comparison-ready paragraphs: NFC, soft
 * hyphens removed, non-breaking spaces unified, curly apostrophes
 * straightened, PDF end-of-line hyphenation repaired, in-paragraph
 * whitespace collapsed, page markers and repeated short headers dropped.
 */
export function normalizeForComparison(text: string): string[] {
  const cleaned = text
    .normalize('NFC')
    .replace(/\u00AD/g, '')
    .replace(/[\u00A0\u202F\u2007]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0 && !PAGE_MARKER_PATTERN.test(paragraph))

  const shortOccurrences = new Map<string, number>()
  for (const paragraph of paragraphs) {
    if (paragraph.length < REPEATED_HEADER_MAX_LENGTH) {
      shortOccurrences.set(paragraph, (shortOccurrences.get(paragraph) ?? 0) + 1)
    }
  }

  return paragraphs.filter(
    (paragraph) => (shortOccurrences.get(paragraph) ?? 0) < REPEATED_HEADER_MIN_COUNT
  )
}

/**
 * Equality key used for paragraph alignment only — display always keeps
 * the normalized paragraph text. Case and punctuation differences never
 * misalign paragraphs; they surface as word-level edits instead.
 */
export function paragraphKey(paragraph: string): string {
  return paragraph
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function wordSet(paragraph: string): Set<string> {
  return new Set(paragraphKey(paragraph).split(' ').filter(Boolean))
}

/** Dice coefficient on word sets: 2·|A∩B| / (|A|+|B|). */
function diceSimilarity(a: string, b: string): number {
  const wordsA = wordSet(a)
  const wordsB = wordSet(b)
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let common = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) common += 1
  }
  return (2 * common) / (wordsA.size + wordsB.size)
}

function singleSegmentBlock(type: 'unchanged' | 'added' | 'removed', text: string): DiffBlock {
  const kind: DiffSegment['kind'] =
    type === 'added' ? 'added' : type === 'removed' ? 'removed' : 'same'
  return { type, segments: [{ kind, text }] }
}

function modifiedBlock(oldParagraph: string, newParagraph: string): DiffBlock {
  const segments: DiffSegment[] = diffWords(oldParagraph, newParagraph).map((part) => ({
    kind: part.added ? 'added' : part.removed ? 'removed' : 'same',
    text: part.value
  }))
  return { type: 'modified', segments }
}

/**
 * Pairs the paragraphs of a remove+add hunk in order. Adjacent
 * paragraphs above the similarity threshold become one 'modified'
 * block; otherwise the lookahead similarity decides which side to
 * flush as a pure removal/addition, so a single inserted paragraph
 * does not desynchronize the remaining pairs.
 */
function refineReplaceHunk(removed: string[], added: string[]): DiffBlock[] {
  const blocks: DiffBlock[] = []
  let removedIndex = 0
  let addedIndex = 0
  while (removedIndex < removed.length && addedIndex < added.length) {
    const removedParagraph = removed[removedIndex]!
    const addedParagraph = added[addedIndex]!
    if (diceSimilarity(removedParagraph, addedParagraph) >= PAIR_SIMILARITY_THRESHOLD) {
      blocks.push(modifiedBlock(removedParagraph, addedParagraph))
      removedIndex += 1
      addedIndex += 1
      continue
    }
    const similarityIfSkippingRemoved =
      removedIndex + 1 < removed.length
        ? diceSimilarity(removed[removedIndex + 1]!, addedParagraph)
        : -1
    const similarityIfSkippingAdded =
      addedIndex + 1 < added.length ? diceSimilarity(removedParagraph, added[addedIndex + 1]!) : -1
    if (similarityIfSkippingAdded > similarityIfSkippingRemoved) {
      blocks.push(singleSegmentBlock('added', addedParagraph))
      addedIndex += 1
    } else {
      blocks.push(singleSegmentBlock('removed', removedParagraph))
      removedIndex += 1
    }
  }
  while (removedIndex < removed.length) {
    blocks.push(singleSegmentBlock('removed', removed[removedIndex]!))
    removedIndex += 1
  }
  while (addedIndex < added.length) {
    blocks.push(singleSegmentBlock('added', added[addedIndex]!))
    addedIndex += 1
  }
  return blocks
}

function pushUnchangedRun(blocks: DiffBlock[], paragraphs: string[]): void {
  if (paragraphs.length <= COLLAPSE_THRESHOLD) {
    for (const paragraph of paragraphs) {
      blocks.push(singleSegmentBlock('unchanged', paragraph))
    }
    return
  }
  blocks.push(singleSegmentBlock('unchanged', paragraphs[0]!))
  blocks.push({ type: 'unchanged', segments: [], collapsedCount: paragraphs.length - 2 })
  blocks.push(singleSegmentBlock('unchanged', paragraphs[paragraphs.length - 1]!))
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function computeStats(blocks: DiffBlock[]): ComparisonStats {
  const stats: ComparisonStats = {
    addedWords: 0,
    removedWords: 0,
    addedBlocks: 0,
    removedBlocks: 0,
    modifiedBlocks: 0
  }
  for (const block of blocks) {
    if (block.type === 'added') stats.addedBlocks += 1
    if (block.type === 'removed') stats.removedBlocks += 1
    if (block.type === 'modified') stats.modifiedBlocks += 1
    for (const segment of block.segments) {
      if (segment.kind === 'added') stats.addedWords += countWords(segment.text)
      if (segment.kind === 'removed') stats.removedWords += countWords(segment.text)
    }
  }
  return stats
}

export function computeDiff(
  oldText: string,
  newText: string
): { blocks: DiffBlock[]; stats: ComparisonStats } {
  const oldParagraphs = normalizeForComparison(oldText)
  const newParagraphs = normalizeForComparison(newText)
  const parts = diffArrays(oldParagraphs.map(paragraphKey), newParagraphs.map(paragraphKey))

  const blocks: DiffBlock[] = []
  let oldIndex = 0
  let newIndex = 0
  let pendingRemoved: string[] | null = null

  const flushPendingRemoved = (): void => {
    if (!pendingRemoved) return
    for (const paragraph of pendingRemoved) {
      blocks.push(singleSegmentBlock('removed', paragraph))
    }
    pendingRemoved = null
  }

  for (const part of parts) {
    const length = part.value.length
    if (part.removed) {
      flushPendingRemoved()
      pendingRemoved = oldParagraphs.slice(oldIndex, oldIndex + length)
      oldIndex += length
    } else if (part.added) {
      const addedParagraphs = newParagraphs.slice(newIndex, newIndex + length)
      newIndex += length
      if (pendingRemoved) {
        blocks.push(...refineReplaceHunk(pendingRemoved, addedParagraphs))
        pendingRemoved = null
      } else {
        for (const paragraph of addedParagraphs) {
          blocks.push(singleSegmentBlock('added', paragraph))
        }
      }
    } else {
      flushPendingRemoved()
      pushUnchangedRun(blocks, newParagraphs.slice(newIndex, newIndex + length))
      oldIndex += length
      newIndex += length
    }
  }
  flushPendingRemoved()

  return { blocks, stats: computeStats(blocks) }
}

/**
 * Added-text corpus for citation verification and pièce detection:
 * one entry per 'added' block and per 'modified' block (its added
 * segments joined), each tagged with its block index for scroll-to.
 */
export function collectAddedText(blocks: DiffBlock[]): Array<{ text: string; blockIndex: number }> {
  const entries: Array<{ text: string; blockIndex: number }> = []
  blocks.forEach((block, blockIndex) => {
    if (block.type !== 'added' && block.type !== 'modified') return
    const text = block.segments
      .filter((segment) => segment.kind === 'added')
      .map((segment) => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) entries.push({ text, blockIndex })
  })
  return entries
}
