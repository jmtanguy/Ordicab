/**
 * Unit tests for docxRevisions — OOXML builders for tracked changes.
 * Verifies:
 * - Valid XML structure for <w:ins> and <w:del>
 * - Proper escaping of special characters
 * - Unique w:id values
 */

import { describe, it, expect } from 'vitest'
import {
  buildInsertionXml,
  buildDeletionXml,
  buildInsertionParagraphXml,
  findMaxRevisionId,
  parseParagraphXml,
  replaceParagraphInXml
} from '../docxRevisions'

describe('docxRevisions', () => {
  const meta = {
    revId: 1,
    author: 'Test Author',
    dateIso: '2026-07-05T10:00:00Z'
  }

  describe('buildInsertionXml', () => {
    it('should create valid <w:ins> element', () => {
      const xml = buildInsertionXml('Test text', meta)
      expect(xml).toContain('<w:ins')
      expect(xml).toContain('w:id="1"')
      expect(xml).toContain('w:author="Test Author"')
      expect(xml).toContain('w:date="2026-07-05T10:00:00Z"')
      expect(xml).toContain('<w:t xml:space="preserve">Test text</w:t>')
    })

    it('should escape special characters', () => {
      const xml = buildInsertionXml('Test & <tag>', meta)
      expect(xml).toContain('Test &amp; &lt;tag&gt;')
      expect(xml).not.toContain('Test & <tag>')
    })

    it('should escape author name', () => {
      const metaWithSpecial = { ...meta, author: 'Author & Co.' }
      const xml = buildInsertionXml('text', metaWithSpecial)
      expect(xml).toContain('Author &amp; Co.')
    })
  })

  describe('buildDeletionXml', () => {
    it('should create valid <w:del> element with <w:delText>', () => {
      const xml = buildDeletionXml('Deleted text', meta)
      expect(xml).toContain('<w:del')
      expect(xml).toContain('w:id="1"')
      expect(xml).toContain('<w:delText xml:space="preserve">Deleted text</w:delText>')
    })

    it('should use <w:delText> not <w:t>', () => {
      const xml = buildDeletionXml('text', meta)
      expect(xml).toContain('<w:delText')
      expect(xml).not.toContain('<w:t')
    })
  })

  describe('buildInsertionParagraphXml', () => {
    it('should wrap insertion in a paragraph with style', () => {
      const pPrXml = '<w:spacing w:after="0"/>'
      const xml = buildInsertionParagraphXml('New para', pPrXml, meta)
      expect(xml).toMatch(/<w:p><w:pPr>.*<\/w:pPr><w:ins/)
      expect(xml).toContain('New para')
    })

    it('should handle empty pPrXml', () => {
      const xml = buildInsertionParagraphXml('text', '', meta)
      expect(xml).toContain('<w:p><w:pPr></w:pPr>')
    })
  })

  describe('findMaxRevisionId', () => {
    it('should find maximum w:id in document', () => {
      const docXml = `
        <w:ins w:id="5" />
        <w:del w:id="10" />
        <w:ins w:id="3" />
      `
      const max = findMaxRevisionId(docXml)
      expect(max).toBe(10)
    })

    it('should return 0 for document with no revisions', () => {
      const docXml = '<w:document><w:body></w:body></w:document>'
      const max = findMaxRevisionId(docXml)
      expect(max).toBe(0)
    })
  })

  describe('parseParagraphXml', () => {
    it('should extract pPr and runs from paragraph', () => {
      const pXml = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:t>text</w:t></w:r></w:p>`
      const result = parseParagraphXml(pXml)
      expect(result).not.toBeNull()
      expect(result!.pPrXml).toContain('<w:spacing')
      expect(result!.runsXml).toContain('<w:r>')
    })

    it('should handle paragraph without pPr', () => {
      const pXml = `<w:p><w:r><w:t>text</w:t></w:r></w:p>`
      const result = parseParagraphXml(pXml)
      expect(result).not.toBeNull()
      expect(result!.pPrXml).toBe('')
    })
  })

  describe('replaceParagraphInXml', () => {
    it('should replace paragraph in document', () => {
      const original = '<w:document><w:p>old</w:p><w:p>keep</w:p></w:document>'
      const oldP = '<w:p>old</w:p>'
      const newP = '<w:p>new</w:p>'
      const result = replaceParagraphInXml(original, oldP, newP)
      expect(result).toContain('<w:p>new</w:p>')
      expect(result).toContain('<w:p>keep</w:p>')
      expect(result).not.toContain('<w:p>old</w:p>')
    })

    it('should not replace if paragraph not found', () => {
      const original = '<w:document><w:p>text</w:p></w:document>'
      const result = replaceParagraphInXml(original, '<w:p>missing</w:p>', '<w:p>new</w:p>')
      expect(result).toBe(original)
    })
  })
})
