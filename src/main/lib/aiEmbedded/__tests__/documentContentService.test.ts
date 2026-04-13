import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  extractDocumentText,
  extractOcrLexicalFeatures,
  extractStructuredOcrText,
  getDocumentContentCachePath,
  hasReadableOcrText,
  normalizeExtractedText,
  resolveAutoDetectedRotation,
  scoreOcrText,
  shouldAcceptOcrCandidateEarly,
  shouldLockOcrOrientation,
  shouldTrySidewaysRotations,
  updateCachedDocumentText
} from '../documentContentService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-document-content-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('documentContentService paragraph normalization', () => {
  it('joins paragraph blocks with <NL> while flattening line wraps inside a paragraph', () => {
    expect(
      normalizeExtractedText('First line\nwrapped\n\nSecond paragraph\r\n\r\nThird    paragraph')
    ).toBe('First line wrapped<NL>Second paragraph<NL>Third paragraph')
  })

  it('returns normalized text for plain text extraction', async () => {
    const root = await createTempDir()
    const filePath = join(root, 'note.txt')
    const cacheDir = join(root, 'cache')

    await writeFile(filePath, 'Alpha line 1\nAlpha line 2\n\nBeta paragraph', 'utf8')

    await expect(extractDocumentText(filePath, cacheDir)).resolves.toEqual({
      text: 'Alpha line 1 Alpha line 2<NL>Beta paragraph',
      method: 'direct'
    })
  })

  it('prefers structured OCR paragraphs over raw OCR text', () => {
    expect(
      extractStructuredOcrText({
        text: 'fallback raw text',
        blocks: [
          {
            text: 'ignored block text',
            paragraphs: [
              {
                text: 'First OCR paragraph'
              },
              {
                lines: [{ text: 'Second line 1' }, { text: 'Second line 2' }]
              }
            ]
          },
          {
            text: 'Third OCR paragraph',
            paragraphs: []
          }
        ]
      })
    ).toBe('First OCR paragraph<NL>Second line 1 Second line 2<NL>Third OCR paragraph')
  })

  it('splits OCR paragraphs when line geometry shows a clear vertical gap', () => {
    expect(
      extractStructuredOcrText({
        blocks: [
          {
            bbox: { x0: 0, y0: 0, x1: 100, y1: 100 },
            paragraphs: [
              {
                lines: [
                  {
                    text: 'Paragraph one line 1',
                    bbox: { x0: 0, y0: 0, x1: 100, y1: 10 },
                    rowAttributes: { rowHeight: 10 }
                  },
                  {
                    text: 'Paragraph one line 2',
                    bbox: { x0: 0, y0: 12, x1: 100, y1: 22 },
                    rowAttributes: { rowHeight: 10 }
                  },
                  {
                    text: 'Paragraph two line 1',
                    bbox: { x0: 0, y0: 40, x1: 100, y1: 50 },
                    rowAttributes: { rowHeight: 10 }
                  }
                ]
              }
            ]
          }
        ]
      })
    ).toBe('Paragraph one line 1 Paragraph one line 2<NL>Paragraph two line 1')
  })

  it('treats very short OCR output as unreadable', () => {
    expect(hasReadableOcrText('AB12')).toBe(false)
    expect(hasReadableOcrText('Premiere phrase lisible avec assez de contenu 2024')).toBe(true)
  })

  it('scores readable OCR text above gibberish', () => {
    expect(
      scoreOcrText('Ceci est une phrase lisible avec plusieurs mots utiles.', 60)
    ).toBeGreaterThan(scoreOcrText('xqz | ~~ // ##', 60))
  })

  it('detects common FR and EN words plus key legal terms', () => {
    const features = extractOcrLexicalFeatures(
      'Bonjour Madame, veuillez trouver le contrat et the court judgment attached.'
    )

    expect(features).toMatchObject({
      commonWordHits: expect.any(Number),
      keywordHits: expect.any(Number)
    })
    expect(features.commonWordHits).toBeGreaterThanOrEqual(4)
    expect(features.keywordHits).toBeGreaterThanOrEqual(1)
    expect(features.recognizedWordRatio).toBeGreaterThan(0.25)
  })

  it('accepts a strong OCR candidate early', () => {
    const strongText = 'Bonjour Madame, le dossier et le tribunal sont prêts pour la procédure.'
    expect(shouldAcceptOcrCandidateEarly(scoreOcrText(strongText, 70), strongText)).toBe(true)
    expect(shouldAcceptOcrCandidateEarly(scoreOcrText('xqz', 70), 'xqz')).toBe(false)
  })

  it('locks document orientation once a strong readable candidate is found', () => {
    const strongText = 'Texte OCR correct et stable pour verrouiller l orientation du document.'
    expect(shouldLockOcrOrientation(scoreOcrText(strongText, 55), strongText)).toBe(true)
    expect(shouldLockOcrOrientation(scoreOcrText('xqz', 55), 'xqz')).toBe(false)
  })

  it('keeps the rotation detected by auto-rotate', () => {
    expect(resolveAutoDetectedRotation(Math.PI)).toBe(180)
    expect(resolveAutoDetectedRotation(Math.PI / 2)).toBe(90)
    expect(resolveAutoDetectedRotation(0)).toBe(0)
    expect(resolveAutoDetectedRotation(undefined)).toBeNull()
  })

  it('avoids sideways retries when a readable candidate already exists', () => {
    expect(
      shouldTrySidewaysRotations(
        scoreOcrText('Texte OCR correct et déjà exploitable pour ce document.', 45),
        'Texte OCR correct et déjà exploitable pour ce document.'
      )
    ).toBe(false)
    expect(shouldTrySidewaysRotations(scoreOcrText('xqz', 10), 'xqz')).toBe(true)
  })

  it('rewrites cached extracted text using the same <NL>-separated paragraph format', async () => {
    const root = await createTempDir()
    const filePath = join(root, 'contract.docx')
    const cacheDir = join(root, 'cache')
    const cachePath = getDocumentContentCachePath(cacheDir, filePath)

    await mkdir(cacheDir, { recursive: true })
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          version: 2,
          method: 'docx',
          extractedAt: '2026-04-08T10:00:00.000Z',
          text: 'stale',
          isEmpty: false
        },
        null,
        2
      ),
      'utf8'
    )

    await updateCachedDocumentText(filePath, cacheDir, 'One\nwrapped\n\nTwo')

    const cached = await readFile(cachePath, 'utf8')
    expect(cached).toContain('"name": "contract.docx"')
    expect(cached).toContain('"text": "One wrapped<NL>Two"')
  })
})
