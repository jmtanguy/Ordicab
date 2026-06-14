import { describe, expect, it } from 'vitest'

import {
  buildKnownTagIndex,
  isValidTagPath,
  lintTemplateHtml,
  replaceTagPathInHtml,
  suggestTagPaths
} from '@shared/templateContent'
import { templateRoutineCatalog } from '@shared/templateRoutines'

const index = buildKnownTagIndex(templateRoutineCatalog)

describe('isValidTagPath', () => {
  it('accepts catalog paths in EN and FR alias form', () => {
    expect(isValidTagPath('dossier.name', index)).toBe(true)
    expect(isValidTagPath('dossier.nom', index)).toBe(true)
    expect(isValidTagPath('contact.prenom', index)).toBe(true)
    expect(isValidTagPath('entity.siret', index)).toBe(true)
  })

  it('accepts dynamic contact role paths with known fields only', () => {
    expect(isValidTagPath('contact.client.lastName', index)).toBe(true)
    expect(isValidTagPath('contact.conseilAdverse.email', index)).toBe(true)
    expect(isValidTagPath('contact.client.nom', index)).toBe(true)
    expect(isValidTagPath('contact.client.notAField', index)).toBe(false)
  })

  it('accepts free-form key date labels and their variants', () => {
    expect(isValidTagPath('dossier.keyDate.audience', index)).toBe(true)
    expect(isValidTagPath('dossier.keyDate.audience.long', index)).toBe(true)
    expect(isValidTagPath('date.monAudience.formate', index)).toBe(true)
    expect(isValidTagPath('dossier.keyDate.audience.unknown', index)).toBe(false)
  })

  it('accepts date offsets in EN and FR shorthand', () => {
    expect(isValidTagPath('date.today+7', index)).toBe(true)
    expect(isValidTagPath('date.j+7.formate', index)).toBe(true)
    expect(isValidTagPath('date.today+7.banana', index)).toBe(false)
  })

  it('never flags single-segment dossier references (per-dossier data)', () => {
    expect(isValidTagPath('dossier.numeroRg', index)).toBe(true)
  })

  it('rejects unknown roots and misspelled known paths', () => {
    expect(isValidTagPath('dosier.name', index)).toBe(false)
    expect(isValidTagPath('contact.emial', index)).toBe(false)
    expect(isValidTagPath('entity.siiret', index)).toBe(false)
  })
})

describe('suggestTagPaths', () => {
  it('suggests the close catalog path for a typo on the last segment', () => {
    expect(suggestTagPaths('contact.emial', index)).toContain('contact.email')
    expect(suggestTagPaths('entity.siiret', index)).toContain('entity.siret')
  })

  it('suggests via FR alias tokens', () => {
    expect(suggestTagPaths('contact.telephoneFixe', index)).toContain('contact.phone')
  })
})

describe('lintTemplateHtml', () => {
  it('reports unknown tags from smart spans and raw tokens, deduplicated', () => {
    const html = [
      '<p><span data-template-tag-path="contact.emial">{{contact.emial}}</span></p>',
      '<p>{{contact.emial}}</p>',
      '<p>{{dossier.name}}</p>',
      '<p>{{contact.client.nom}}</p>'
    ].join('')
    const issues = lintTemplateHtml(html, index)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.normalizedPath).toBe('contact.emial')
    expect(issues[0]?.suggestions).toContain('contact.email')
  })

  it('ignores system/loop tags excluded from the picker', () => {
    const html = '<p>{{app.content}}</p><p>{{#dossier.billingItems}}</p>'
    expect(lintTemplateHtml(html, index)).toHaveLength(0)
  })

  it('returns nothing for a fully valid template', () => {
    const html =
      '<p><span data-template-tag-path="dossier.name">{{dossier.name}}</span> {{date.j+7}}</p>'
    expect(lintTemplateHtml(html, index)).toHaveLength(0)
  })
})

describe('replaceTagPathInHtml', () => {
  it('replaces smart spans whose path normalizes to the target', () => {
    const html = '<p><span data-template-tag-path="contact.emial">{{contact.emial}}</span></p>'
    const fixed = replaceTagPathInHtml(html, 'contact.emial', 'contact.email')
    expect(fixed).toContain('data-template-tag-path="contact.email"')
    expect(fixed).not.toContain('contact.emial')
  })

  it('replaces raw tokens', () => {
    const html = '<p>Bonjour {{contact.emial}}</p>'
    const fixed = replaceTagPathInHtml(html, 'contact.emial', 'contact.email')
    expect(fixed).toContain('data-template-tag-path="contact.email"')
    expect(fixed).not.toContain('contact.emial')
  })
})
