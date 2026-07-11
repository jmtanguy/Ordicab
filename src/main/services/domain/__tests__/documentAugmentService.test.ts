/**
 * Tests for documentAugmentService — the core augmentation engine.
 * Verifies:
 * - Byte-identity: untouched paragraphs remain exactly the same
 * - Revision validity: <w:ins>/<w:del> XML is well-formed
 * - Diff correctness: computeDiff matches the applied operations
 * - Second-round edits on an already-revised document (tracked runs present)
 * - Accept/reject decisions per revision id
 */

import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import {
  applyOperationsToContent,
  applyRevisionDecision,
  extractIndexedTextFromContent,
  extractTextFromTrackedXml,
  htmlToRunsXml,
  paragraphRunsToHtml,
  parseTopLevelParagraphs,
  readDocumentXml,
  rebuildDocxWithDocumentXml
} from '../documentAugmentService'
import {
  CONTENT_TYPES,
  RELS,
  assertWellFormedXml,
  buildDocxFromBodyXml,
  buildTestDocx,
  paragraphXml,
  plainParagraphXml
} from './docxFixture'

const META = { author: 'Test Author', dateIso: '2026-07-10T12:00:00Z' }

describe('extractIndexedTextFromContent', () => {
  it('extracts indexed paragraphs with their text', () => {
    const docx = buildTestDocx(['Premier paragraphe.', 'Deuxième paragraphe.', 'Troisième.'])
    const { paragraphs, previewText } = extractIndexedTextFromContent(docx)

    expect(paragraphs).toHaveLength(3)
    expect(paragraphs[0]!.index).toBe(0)
    expect(paragraphs[0]!.text).toBe('Premier paragraphe.')
    expect(paragraphs[2]!.text).toBe('Troisième.')
    expect(previewText).toContain('[0] Premier paragraphe.')
    expect(previewText).toContain('[2] Troisième.')
  })

  it('excludes paragraphs nested in tables', () => {
    const inTable =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cellule</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const zip = new PizZip()
    zip.file('[Content_Types].xml', CONTENT_TYPES)
    zip.file('_rels/.rels', RELS)
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="x"><w:body>${paragraphXml('Avant')}${inTable}${paragraphXml('Après')}</w:body></w:document>`
    )
    const docx = zip.generate({ type: 'nodebuffer' }) as Uint8Array

    const { paragraphs } = extractIndexedTextFromContent(docx)
    expect(paragraphs.map((p) => p.text)).toEqual(['Avant', 'Après'])
  })
})

describe('applyOperationsToContent', () => {
  it('preserves byte-identity of untouched paragraphs', () => {
    const docx = buildTestDocx(['Alpha.', 'Bravo.', 'Charlie.'])
    const before = parseTopLevelParagraphs(readDocumentXml(docx))

    const { trackedDocumentXml } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'replace', index: 1, text: 'Bravo révisé.' }],
      META
    )

    expect(trackedDocumentXml).toContain(before[0]!.rawXml)
    expect(trackedDocumentXml).toContain(before[2]!.rawXml)
    expect(trackedDocumentXml).not.toContain(before[1]!.rawXml)
  })

  it('creates well-formed <w:ins>/<w:del> revisions with unique seeded ids', () => {
    const docx = buildTestDocx(['Un.', 'Deux.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [
        { id: 'ins1', op: 'insert_after', anchorIndex: 0, text: 'Inséré.' },
        { id: 'del1', op: 'delete', index: 1 }
      ],
      META
    )

    expect(trackedDocumentXml).toMatch(
      /<w:ins w:id="\d+" w:author="Test Author" w:date="2026-07-10T12:00:00Z">/
    )
    expect(trackedDocumentXml).toMatch(/<w:del w:id="\d+"/)
    expect(trackedDocumentXml).toContain('<w:delText')

    const ids = [...opRevisionIds.values()].flat()
    expect(new Set(ids).size).toBe(ids.length)
    expect(opRevisionIds.get('ins1')).toHaveLength(1)
    expect(opRevisionIds.get('del1')).toHaveLength(1)
  })

  it('applies multiple operations against initial offsets (descending order)', () => {
    const docx = buildTestDocx(['P0.', 'P1.', 'P2.', 'P3.'])
    const { trackedDocumentXml } = applyOperationsToContent(
      docx,
      [
        { id: 'a', op: 'replace', index: 0, text: 'P0 bis.' },
        { id: 'b', op: 'insert_after', anchorIndex: 1, text: 'Entre P1 et P2.' },
        { id: 'c', op: 'delete', index: 3 }
      ],
      META
    )

    const text = extractTextFromTrackedXml(trackedDocumentXml)
    expect(text).toContain('P0 bis.')
    expect(text).toContain('Entre P1 et P2.')
    expect(text).not.toContain('P3.')
    // Reading order preserved
    expect(text.indexOf('P1.')).toBeLessThan(text.indexOf('Entre P1 et P2.'))
    expect(text.indexOf('Entre P1 et P2.')).toBeLessThan(text.indexOf('P2.'))
  })

  it('keeps the submitted reading order for several insertions on the same anchor', () => {
    const docx = buildTestDocx(['Base.'])
    const { trackedDocumentXml } = applyOperationsToContent(
      docx,
      [
        { id: 'l1', op: 'insert_after', anchorIndex: 0, text: 'Ligne 1.' },
        { id: 'l2', op: 'insert_after', anchorIndex: 0, text: 'Ligne 2.' },
        { id: 'l3', op: 'insert_after', anchorIndex: 0, text: 'Ligne 3.' }
      ],
      META
    )

    const text = extractTextFromTrackedXml(trackedDocumentXml)
    expect(text.indexOf('Base.')).toBeLessThan(text.indexOf('Ligne 1.'))
    expect(text.indexOf('Ligne 1.')).toBeLessThan(text.indexOf('Ligne 2.'))
    expect(text.indexOf('Ligne 2.')).toBeLessThan(text.indexOf('Ligne 3.'))
  })

  it('computes diff blocks reflecting the operations', () => {
    const docx = buildTestDocx(['Alpha.', 'Bravo.'])
    const { diffBlocks } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'insert_after', anchorIndex: 1, text: 'Nouveau paragraphe final.' }],
      META
    )

    const added = diffBlocks.filter((b) => b.type === 'added' || b.type === 'modified')
    expect(added.length).toBeGreaterThan(0)
    const addedText = diffBlocks
      .flatMap((b) => b.segments)
      .filter((s) => s.kind === 'added')
      .map((s) => s.text)
      .join(' ')
    expect(addedText).toContain('Nouveau paragraphe final.')
  })

  it('supports a second round on an already-revised document', () => {
    const docx = buildTestDocx(['Intro.', 'Corps.', 'Conclusion.'])

    // Round 1: replace paragraph 1 (creates <w:del> + <w:ins> inside it)
    const round1 = applyOperationsToContent(
      docx,
      [{ id: 'r1', op: 'replace', index: 1, text: 'Corps révisé.' }],
      META
    )
    const round1Ids = [...round1.opRevisionIds.values()].flat()

    // Round 2 works on the revised buffer: the revised paragraph is now a
    // tracked paragraph; insert after it and replace the conclusion.
    const round2 = applyOperationsToContent(
      round1.docxBuffer,
      [
        { id: 'r2a', op: 'insert_after', anchorIndex: 1, text: 'Ajout après le corps.' },
        { id: 'r2b', op: 'replace', index: 2, text: 'Conclusion révisée.' }
      ],
      { author: 'Second Author', dateIso: '2026-07-11T09:00:00Z' }
    )

    // New revision ids are seeded above round 1's
    const round2Ids = [...round2.opRevisionIds.values()].flat()
    expect(Math.min(...round2Ids)).toBeGreaterThan(Math.max(...round1Ids))

    const text = extractTextFromTrackedXml(round2.trackedDocumentXml)
    expect(text).toContain('Corps révisé.')
    expect(text).toContain('Ajout après le corps.')
    expect(text).toContain('Conclusion révisée.')
    expect(text).not.toContain('Conclusion.')

    // Round 1 revision markup is still present (not clobbered)
    expect(round2.trackedDocumentXml).toContain(`w:id="${round1Ids[0]}"`)
  })

  it('replacing an already-replaced paragraph keeps the original deletion intact', () => {
    const docx = buildTestDocx(['Seul paragraphe.'])
    const round1 = applyOperationsToContent(
      docx,
      [{ id: 'r1', op: 'replace', index: 0, text: 'Version 2.' }],
      META
    )
    const round2 = applyOperationsToContent(
      round1.docxBuffer,
      [{ id: 'r2', op: 'replace', index: 0, text: 'Version 3.' }],
      META
    )

    const text = extractTextFromTrackedXml(round2.trackedDocumentXml)
    expect(text).toContain('Version 3.')
    // Both deletions survive as tracked deletions
    expect(round2.trackedDocumentXml).toContain('Seul paragraphe.')
    expect(round2.trackedDocumentXml).toContain('Version 2.')
  })
})

describe('applyRevisionDecision', () => {
  it('accept flattens an insertion (content kept, markup removed)', () => {
    const docx = buildTestDocx(['Base.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Inséré.' }],
      META
    )

    const flattened = applyRevisionDecision(trackedDocumentXml, opRevisionIds.get('op1')!, 'accept')
    expect(flattened).toContain('Inséré.')
    const [revId] = opRevisionIds.get('op1')!
    expect(flattened).not.toContain(`<w:ins w:id="${revId}"`)
  })

  it('reject removes an insertion entirely', () => {
    const docx = buildTestDocx(['Base.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Inséré.' }],
      META
    )

    const rejected = applyRevisionDecision(trackedDocumentXml, opRevisionIds.get('op1')!, 'reject')
    expect(rejected).not.toContain('Inséré.')
    expect(rejected).toContain('Base.')
  })

  it('accept on a replace keeps the new text and drops the old', () => {
    const docx = buildTestDocx(['Ancien texte.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'replace', index: 0, text: 'Nouveau texte.' }],
      META
    )

    const flattened = applyRevisionDecision(trackedDocumentXml, opRevisionIds.get('op1')!, 'accept')
    expect(flattened).toContain('Nouveau texte.')
    expect(flattened).not.toContain('Ancien texte.')
    expect(flattened).not.toContain('<w:delText')
  })

  it('reject on a replace restores the original text', () => {
    const docx = buildTestDocx(['Ancien texte.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'replace', index: 0, text: 'Nouveau texte.' }],
      META
    )

    const rejected = applyRevisionDecision(trackedDocumentXml, opRevisionIds.get('op1')!, 'reject')
    expect(rejected).not.toContain('Nouveau texte.')
    expect(rejected).toContain('Ancien texte.')
    expect(rejected).not.toContain('<w:delText')
    expect(rejected).toContain('<w:t')
  })

  it('decisions are independent of other pending revisions', () => {
    const docx = buildTestDocx(['A.', 'B.'])
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      docx,
      [
        { id: 'op1', op: 'replace', index: 0, text: 'A2.' },
        { id: 'op2', op: 'replace', index: 1, text: 'B2.' }
      ],
      META
    )

    const partial = applyRevisionDecision(trackedDocumentXml, opRevisionIds.get('op1')!, 'accept')
    // op1 flattened
    expect(partial).toContain('A2.')
    expect(partial).not.toContain('A.</w:delText>')
    // op2 still tracked
    const [op2Id] = opRevisionIds.get('op2')!
    expect(partial).toContain(`w:id="${op2Id}"`)
    expect(partial).toContain('B2.')
  })
})

describe('rich manual edits (html operations)', () => {
  it('replace with html produces formatted runs and round-trips to html', () => {
    const docx = buildTestDocx(['Texte initial.'])
    const { trackedDocumentXml, docxBuffer } = applyOperationsToContent(
      docx,
      [
        {
          id: 'op1',
          op: 'replace',
          index: 0,
          text: 'Un passage important et souligné.',
          html: 'Un passage <strong>important</strong> et <em><u>souligné</u></em>.'
        }
      ],
      META
    )
    assertWellFormedXml(trackedDocumentXml)
    expect(trackedDocumentXml).toContain('<w:rPr><w:b/></w:rPr>')
    expect(trackedDocumentXml).toContain('<w:i/>')
    expect(trackedDocumentXml).toContain('<w:u w:val="single"/>')

    // The paragraph converts back to the same minimal HTML for the editor
    const paragraphs = parseTopLevelParagraphs(readDocumentXml(docxBuffer))
    expect(paragraphRunsToHtml(paragraphs[0]!.rawXml)).toBe(
      'Un passage <strong>important</strong> et <em><u>souligné</u></em>.'
    )
  })

  it('paragraphRunsToHtml skips deleted content and keeps pending insertions', () => {
    const docx = buildTestDocx(['Ancien texte.'])
    const round1 = applyOperationsToContent(
      docx,
      [{ id: 'r1', op: 'replace', index: 0, text: 'Nouveau texte.' }],
      META
    )
    const paragraphs = parseTopLevelParagraphs(readDocumentXml(round1.docxBuffer))
    expect(paragraphRunsToHtml(paragraphs[0]!.rawXml)).toBe('Nouveau texte.')
  })

  it('paragraph-level bold (pPr rPr or heading style) is shown in the editor html', () => {
    // Bold carried by the paragraph-mark run properties (common in real Word docs)
    const pPrBold =
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr/><w:t>Objet : renvoi</w:t></w:r></w:p>'
    expect(paragraphRunsToHtml(pPrBold)).toBe('<strong>Objet : renvoi</strong>')

    // Bold implied by a heading style, without any run-level <w:b/>
    const heading =
      '<w:p><w:pPr><w:pStyle w:val="Titre1"/></w:pPr><w:r><w:t>I. Discussion</w:t></w:r></w:p>'
    expect(paragraphRunsToHtml(heading)).toBe('<strong>I. Discussion</strong>')

    // Run-level explicit "not bold" wins over the paragraph default
    const overridden =
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>normal</w:t></w:r></w:p>'
    expect(paragraphRunsToHtml(overridden)).toBe('normal')
  })

  it('htmlToRunsXml preserves special characters and ignores unknown tags', () => {
    const runs = htmlToRunsXml('Voir <span data-x="1">l&apos;article &amp; annexe</span>')
    assertWellFormedXml(`<w:p>${runs}</w:p>`)
    expect(runs).toContain('l&apos;article &amp; annexe')
    expect(runs).not.toContain('<span')
  })

  it('preserves TipTap hard line breaks as Word breaks', () => {
    const runs = htmlToRunsXml('Première ligne<br>Deuxième ligne')
    assertWellFormedXml(`<w:p>${runs}</w:p>`)
    expect(runs).toContain('<w:br/>')
    expect(runs).toContain('Première ligne')
    expect(runs).toContain('Deuxième ligne')
  })
})

describe('XML entity decoding (apostrophes, ampersands…)', () => {
  it('round-trips inserted text containing apostrophes and special chars', () => {
    const docx = buildTestDocx(['Base.'])
    const inserted = "L'audience de M. Dupont & Fils : « délai < 15 jours »"
    const round1 = applyOperationsToContent(
      docx,
      [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: inserted }],
      META
    )

    // The XML stores escaped entities…
    expect(round1.trackedDocumentXml).toContain('&apos;')
    // …but every extracted text surface shows the decoded characters.
    const { paragraphs } = extractIndexedTextFromContent(round1.docxBuffer)
    expect(paragraphs.map((p) => p.text)).toContain(inserted)
    expect(extractTextFromTrackedXml(round1.trackedDocumentXml)).toContain(inserted)
    const addedText = round1.diffBlocks
      .flatMap((b) => b.segments)
      .filter((s) => s.kind === 'added')
      .map((s) => s.text)
      .join(' ')
    expect(addedText).toContain("L'audience")
    expect(addedText).not.toContain('&apos;')

    // Editing that paragraph again must not double-escape.
    const round2 = applyOperationsToContent(
      round1.docxBuffer,
      [{ id: 'op2', op: 'replace', index: 1, text: "L'audience est reportée." }],
      META
    )
    expect(round2.trackedDocumentXml).not.toContain('&amp;apos;')
    const texts = extractIndexedTextFromContent(round2.docxBuffer).paragraphs.map((p) => p.text)
    expect(texts).toContain("L'audience est reportée.")
  })
})

describe('XML well-formedness (Word-compatible output)', () => {
  // Real Word documents emit `<w:t>` without attributes: the delete/replace
  // conversion to <w:delText> must handle both forms or the saved file is
  // corrupted ("Opening and ending tag mismatch" on reopen).
  const plainDocx = (): Uint8Array =>
    buildDocxFromBodyXml(
      plainParagraphXml('Premier paragraphe.') +
        plainParagraphXml('Deuxième paragraphe.') +
        plainParagraphXml('Troisième paragraphe.')
    )

  it('delete of a paragraph with attribute-less <w:t> stays well-formed', () => {
    const { trackedDocumentXml } = applyOperationsToContent(
      plainDocx(),
      [{ id: 'op1', op: 'delete', index: 1 }],
      META
    )
    assertWellFormedXml(trackedDocumentXml)
    expect(trackedDocumentXml).toContain('<w:delText>Deuxième paragraphe.</w:delText>')
  })

  it('replace of a paragraph with attribute-less <w:t> stays well-formed', () => {
    const { trackedDocumentXml } = applyOperationsToContent(
      plainDocx(),
      [{ id: 'op1', op: 'replace', index: 0, text: 'Premier révisé.' }],
      META
    )
    assertWellFormedXml(trackedDocumentXml)
    expect(trackedDocumentXml).toContain('<w:delText>Premier paragraphe.</w:delText>')
  })

  it('second-round delete of an already-replaced paragraph does not nest <w:del>', () => {
    const round1 = applyOperationsToContent(
      plainDocx(),
      [{ id: 'r1', op: 'replace', index: 1, text: 'Deuxième révisé.' }],
      META
    )
    assertWellFormedXml(round1.trackedDocumentXml)

    const round2 = applyOperationsToContent(
      round1.docxBuffer,
      [{ id: 'r2', op: 'delete', index: 1 }],
      META
    )
    assertWellFormedXml(round2.trackedDocumentXml)
    expect(round2.trackedDocumentXml).not.toMatch(/<w:del\b[^>]*>(?:(?!<\/w:del>)[\s\S])*<w:del\b/)

    // Accepting then committing the second-round deletion must stay well-formed
    const accepted = applyRevisionDecision(
      round2.trackedDocumentXml,
      round2.opRevisionIds.get('r2')!,
      'accept'
    )
    assertWellFormedXml(accepted)
    const rejected = applyRevisionDecision(
      round2.trackedDocumentXml,
      round2.opRevisionIds.get('r2')!,
      'reject'
    )
    assertWellFormedXml(rejected)
  })

  it('full mixed scenario stays well-formed after decisions', () => {
    const { trackedDocumentXml, opRevisionIds } = applyOperationsToContent(
      plainDocx(),
      [
        { id: 'a', op: 'replace', index: 0, text: 'Nouvelle intro.' },
        { id: 'b', op: 'insert_after', anchorIndex: 1, text: 'Inséré.' },
        { id: 'c', op: 'delete', index: 2 }
      ],
      META
    )
    assertWellFormedXml(trackedDocumentXml)

    let xml = trackedDocumentXml
    xml = applyRevisionDecision(xml, opRevisionIds.get('a')!, 'accept')
    xml = applyRevisionDecision(xml, opRevisionIds.get('b')!, 'reject')
    assertWellFormedXml(xml)
  })
})

describe('rebuildDocxWithDocumentXml', () => {
  it('produces a readable zip with the updated document.xml', () => {
    const docx = buildTestDocx(['Contenu.'])
    const xml = readDocumentXml(docx).replace('Contenu.', 'Modifié.')
    const rebuilt = rebuildDocxWithDocumentXml(docx, xml)
    expect(readDocumentXml(rebuilt)).toContain('Modifié.')
  })
})
