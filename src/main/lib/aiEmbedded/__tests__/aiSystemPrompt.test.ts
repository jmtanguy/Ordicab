import { describe, expect, it } from 'vitest'

import { buildSystemPrompt, buildToolSystemPrompt } from '../aiSystemPrompt'

describe('buildSystemPrompt', () => {
  it('contains the JSON intent schema and output rule', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).toContain('## Action Schemas')
    expect(prompt).toContain('contact_lookup')
    expect(prompt).toContain('managed_fields_get')
    expect(prompt).toContain('clarification_request')
    expect(prompt).toContain('unknown')
    expect(prompt).toContain('IMPORTANT: Respond ONLY with valid JSON.')
  })

  it('includes live examples when context data is provided', () => {
    const prompt = buildSystemPrompt({
      dossierId: 'dos-1',
      dossiers: [{ id: 'dos-1', name: 'Dossier Exemple', status: 'active' }],
      contacts: [{ uuid: 'c-1', name: 'Contact Exemple' }],
      templates: [{ id: 'tpl-1', name: 'Modele Exemple' }]
    })
    expect(prompt).toContain('Dossier Exemple')
    expect(prompt).toContain('Contact Exemple')
    expect(prompt).toContain('Modele Exemple')
    expect(prompt).toContain('dos-1')
  })
})

describe('buildToolSystemPrompt', () => {
  it('keeps only active context and contract-oriented guidance', () => {
    const prompt = buildToolSystemPrompt({
      dossierId: 'dos-1',
      dossiers: [{ id: 'dos-1', uuid: 'd-uuid-1', name: 'Dossier Exemple', status: 'active' }],
      contacts: [{ uuid: 'c-1', name: 'Contact Exemple' }],
      templates: [{ id: 'tpl-1', name: 'Modele Exemple' }]
    })

    expect(prompt).toContain('## Active context')
    expect(prompt).toContain('- id: "d-uuid-1"')
    expect(prompt).toContain('## Runtime contract')
    expect(prompt).not.toContain('Contact Exemple')
    expect(prompt).not.toContain('Modele Exemple')
    expect(prompt).not.toContain('## Available Contacts')
  })

  it('keeps destructive safety and grounding requirements', () => {
    const prompt = buildToolSystemPrompt({})
    expect(prompt).toContain('For destructive actions (`contact_delete`, `template_delete`')
    expect(prompt).toContain('`clarification_request` with exactly two options: `Oui` and `Non`')
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
