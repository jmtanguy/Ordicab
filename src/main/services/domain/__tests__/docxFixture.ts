/**
 * Minimal in-memory .docx fixtures for augmentation/redaction tests.
 * Only word/document.xml matters to the code under test.
 */

import PizZip from 'pizzip'

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

export const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

export function paragraphXml(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '<w:pPr></w:pPr>'
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

/** Real Word documents commonly emit `<w:t>` WITHOUT attributes. */
export function plainParagraphXml(text: string): string {
  return `<w:p><w:pPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
}

/**
 * Minimal well-formedness check (tag-balance stack). Throws with the first
 * mismatch — the exact failure Word reports when opening a corrupted file
 * ("Opening and ending tag mismatch").
 */
export function assertWellFormedXml(xml: string): void {
  const tagPattern = /<(\/?)([A-Za-z0-9:._-]+)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g
  const stack: string[] = []
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(xml)) !== null) {
    const closing = match[1]
    const name = match[2] ?? ''
    const selfClosing = match[4]
    if (!name || name.startsWith('?') || name.startsWith('!')) continue
    if (selfClosing) continue
    if (closing) {
      const open = stack.pop()
      if (open !== name) {
        throw new Error(
          `Malformed XML: closing </${name}> at offset ${match.index} but expected </${open ?? 'nothing'}>`
        )
      }
    } else {
      stack.push(name)
    }
  }

  if (stack.length > 0) {
    throw new Error(`Malformed XML: unclosed tags ${stack.join(', ')}`)
  }
}

export function buildDocxFromBodyXml(bodyXml: string): Uint8Array {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyXml}</w:body></w:document>`

  const zip = new PizZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS)
  zip.file('word/document.xml', documentXml)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Uint8Array
}

export function buildTestDocx(
  paragraphs: Array<string | { text: string; style?: string }>
): Uint8Array {
  const body = paragraphs
    .map((p) => (typeof p === 'string' ? paragraphXml(p) : paragraphXml(p.text, p.style)))
    .join('')
  return buildDocxFromBodyXml(body)
}
