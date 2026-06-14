import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'

import { replaceTextWithTags } from '../docxTextReplace'

const DOCX_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
const DOCX_FOOTER = `</w:body></w:document>`

function buildDocx(bodyXml: string): Buffer {
  const zip = new PizZip()
  zip.file('word/document.xml', `${DOCX_HEADER}${bodyXml}${DOCX_FOOTER}`)
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
  )
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}

function readDocumentXml(buffer: Buffer): string {
  return new PizZip(buffer).file('word/document.xml')!.asText()
}

describe('replaceTextWithTags', () => {
  it('replaces a value contained in a single run', () => {
    const buffer = buildDocx('<w:p><w:r><w:t>Cher Jean Dupont, bonjour</w:t></w:r></w:p>')
    const result = replaceTextWithTags(buffer, [
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }
    ])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('Cher {{contact.client.displayName}}, bonjour')
    expect(result.applied).toEqual([
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName', occurrences: 1 }
    ])
    expect(result.failed).toHaveLength(0)
  })

  it('replaces a value split across runs, writing the tag into the first run', () => {
    const buffer = buildDocx(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Cher Jean Du</w:t></w:r><w:r><w:t>pont, bonjour</w:t></w:r></w:p>'
    )
    const result = replaceTextWithTags(buffer, [
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }
    ])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('<w:t>Cher {{contact.client.displayName}}</w:t>')
    expect(xml).toContain('<w:t>, bonjour</w:t>')
    // The first run's formatting is preserved
    expect(xml).toContain('<w:b/>')
    expect(result.applied[0]?.occurrences).toBe(1)
  })

  it('replaces every occurrence across paragraphs', () => {
    const buffer = buildDocx(
      '<w:p><w:r><w:t>Paris, le 12 juin</w:t></w:r></w:p><w:p><w:r><w:t>Fait à Paris</w:t></w:r></w:p>'
    )
    const result = replaceTextWithTags(buffer, [{ originalText: 'Paris', tagPath: 'entity.city' }])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('{{entity.city}}, le 12 juin')
    expect(xml).toContain('Fait à {{entity.city}}')
    expect(result.applied[0]?.occurrences).toBe(2)
  })

  it('keeps XML entities intact around the replacement', () => {
    const buffer = buildDocx('<w:p><w:r><w:t>Dupont &amp; Fils — Jean Dupont</w:t></w:r></w:p>')
    const result = replaceTextWithTags(buffer, [
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }
    ])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('Dupont &amp; Fils — {{contact.client.displayName}}')
  })

  it('matches text containing entities (decoded form)', () => {
    const buffer = buildDocx('<w:p><w:r><w:t>Cabinet Durand &amp; Associés</w:t></w:r></w:p>')
    const result = replaceTextWithTags(buffer, [
      { originalText: 'Durand & Associés', tagPath: 'entity.firmName' }
    ])
    expect(readDocumentXml(result.buffer)).toContain('Cabinet {{entity.firmName}}')
  })

  it('reports not-found for text spanning a paragraph boundary', () => {
    const buffer = buildDocx(
      '<w:p><w:r><w:t>Jean</w:t></w:r></w:p><w:p><w:r><w:t>Dupont</w:t></w:r></w:p>'
    )
    const result = replaceTextWithTags(buffer, [
      { originalText: 'JeanDupont', tagPath: 'contact.client.displayName' }
    ])
    expect(result.applied).toHaveLength(0)
    expect(result.failed).toEqual([{ originalText: 'JeanDupont', reason: 'not-found' }])
  })

  it('does not loop when the original text is a substring of the tag token', () => {
    const buffer = buildDocx('<w:p><w:r><w:t>rendez-vous client demain</w:t></w:r></w:p>')
    const result = replaceTextWithTags(buffer, [
      { originalText: 'client', tagPath: 'contact.client.displayName' }
    ])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('rendez-vous {{contact.client.displayName}} demain')
    expect(result.applied[0]?.occurrences).toBe(1)
  })

  it('preserves leading/trailing whitespace via xml:space', () => {
    const buffer = buildDocx(
      '<w:p><w:r><w:t xml:space="preserve">Maître </w:t></w:r><w:r><w:t>Martin est présent</w:t></w:r></w:p>'
    )
    const result = replaceTextWithTags(buffer, [
      { originalText: 'Martin', tagPath: 'entity.lastName' }
    ])
    const xml = readDocumentXml(result.buffer)
    expect(xml).toContain('<w:t xml:space="preserve">Maître </w:t>')
    expect(xml).toContain('{{entity.lastName}} est présent')
  })
})
