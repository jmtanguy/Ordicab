import { describe, expect, it } from 'vitest'

import { buildToolSystemPrompt } from '../aiSystemPrompt'

describe('buildToolSystemPrompt', () => {
  it('keeps only active context and contract-oriented guidance', () => {
    const prompt = buildToolSystemPrompt({
      dossierId: 'dos-1',
      dossiers: [{ id: 'dos-1', uuid: 'd-uuid-1' }]
    })

    expect(prompt).toContain('## Active context')
    expect(prompt).toContain('- id: "d-uuid-1"')
    expect(prompt).toContain('## Runtime contract')
    expect(prompt).not.toContain('## Available Contacts')
  })

  it('instructs the assistant to reply in the requested locale', () => {
    const fr = buildToolSystemPrompt({ locale: 'fr' })
    expect(fr).toContain(
      'write your replies, questions, and clarification options to the user in French'
    )
    expect(fr).toContain('`Oui` and `Non`')

    const en = buildToolSystemPrompt({ locale: 'en' })
    expect(en).toContain(
      'write your replies, questions, and clarification options to the user in English'
    )
    expect(en).toContain('`Yes` and `No`')

    // Defaults to French when no locale is provided.
    expect(buildToolSystemPrompt({})).toContain('to the user in French')
  })

  it('keeps destructive safety and grounding requirements', () => {
    const prompt = buildToolSystemPrompt({})
    expect(prompt).toContain('For destructive actions (`contact_delete`, `template_delete`')
    expect(prompt).toContain('`clarification_request` with exactly two options: `Oui` and `Non`')
    expect(prompt).toContain('## Professional entity / Cabinet')
    expect(prompt).toContain('call `entity_get` first')
    expect(prompt).toContain('## Grounding')
    expect(prompt).toContain('answer only from tool results')
  })

  it('keeps template-first generation workflow', () => {
    const prompt = buildToolSystemPrompt({})
    expect(prompt).toContain('## Document and text generation workflow')
    expect(prompt).toContain('prefer template-based generation')
    expect(prompt).toContain('Use `text_generate` only when no suitable template exists')
  })
})
