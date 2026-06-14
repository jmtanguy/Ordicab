import { describe, expect, it } from 'vitest'

import { replaceHtmlTextWithTags } from '@shared/templateContent'

describe('replaceHtmlTextWithTags', () => {
  it('replaces a value inside one text node with a smart-tag span', () => {
    const result = replaceHtmlTextWithTags('<p>Cher Jean Dupont, bonjour</p>', [
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }
    ])
    expect(result.html).toBe(
      '<p>Cher <span data-template-tag-path="contact.client.displayName" contenteditable="false">{{contact.client.displayName}}</span>, bonjour</p>'
    )
    expect(result.applied[0]?.occurrences).toBe(1)
  })

  it('replaces a value spanning inline markup', () => {
    const result = replaceHtmlTextWithTags('<p>Cher Jean <strong>Dupont</strong>, bonjour</p>', [
      { originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }
    ])
    expect(result.html).toContain('data-template-tag-path="contact.client.displayName"')
    expect(result.html).not.toContain('Jean')
    expect(result.html).toContain('<strong></strong>')
  })

  it('does not match across block boundaries', () => {
    const result = replaceHtmlTextWithTags('<p>Jean</p><p>Dupont</p>', [
      { originalText: 'JeanDupont', tagPath: 'contact.client.displayName' }
    ])
    expect(result.failed).toEqual([{ originalText: 'JeanDupont', reason: 'not-found' }])
  })

  it('ignores text inside existing smart-tag spans', () => {
    const html =
      '<p><span data-template-tag-path="contact.displayName" contenteditable="false">{{contact.displayName}}</span> et displayName</p>'
    const result = replaceHtmlTextWithTags(html, [
      { originalText: 'displayName', tagPath: 'contact.lastName' }
    ])
    expect(result.applied[0]?.occurrences).toBe(1)
    // The original span is untouched
    expect(result.html).toContain('{{contact.displayName}}')
  })

  it('replaces every occurrence and reports the count', () => {
    const result = replaceHtmlTextWithTags('<p>Paris est belle. Paris la nuit.</p>', [
      { originalText: 'Paris', tagPath: 'entity.city' }
    ])
    expect(result.applied[0]?.occurrences).toBe(2)
    expect(result.html).not.toContain('Paris est')
  })

  it('matches text containing HTML entities', () => {
    const result = replaceHtmlTextWithTags('<p>Cabinet Durand &amp; Associés</p>', [
      { originalText: 'Durand & Associés', tagPath: 'entity.firmName' }
    ])
    expect(result.html).toContain('data-template-tag-path="entity.firmName"')
    expect(result.applied).toHaveLength(1)
  })
})
