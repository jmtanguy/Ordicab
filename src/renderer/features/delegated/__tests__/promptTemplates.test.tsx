import { describe, expect, it } from 'vitest'

import { createRendererI18n } from '@renderer/i18n'

import { buildPrompt, DELEGATED_OPERATIONS } from '../promptTemplates'

describe('buildPrompt', () => {
  it('returns expected prompts for english and french locales', async () => {
    await createRendererI18n('en')

    expect(buildPrompt('contacts', { dossierName: 'Test Dossier' })).toBe(
      "In dossier 'Test Dossier', add the following contacts:\n[paste contact details here]"
    )
    expect(buildPrompt('keyDates', { dossierName: 'Test Dossier' })).toBe(
      "In dossier 'Test Dossier', extract and add the following key dates:\n[paste text with dates here]"
    )
    expect(buildPrompt('keyReferences', { dossierName: 'Test Dossier' })).toBe(
      "In dossier 'Test Dossier', add the following key references:\n[paste reference here]"
    )
    expect(buildPrompt('entity', {})).toBe(
      'Update the firm entity profile with:\n[paste entity details here]'
    )
    expect(buildPrompt('dossierSetup', { dossierName: 'Test Dossier' })).toBe(
      "Set up dossier 'Test Dossier' with: status '[status]', type '[type]'"
    )

    await createRendererI18n('fr')
    expect(buildPrompt('contacts', { dossierName: 'Dossier Test' })).toBe(
      "Dans le dossier 'Dossier Test', ajoutez les contacts suivants :\n[collez ici les coordonnées du contact]"
    )
    expect(buildPrompt('entity', {})).toBe(
      "Mettez à jour le profil de l'entité du cabinet avec :\n[collez ici les informations de l'entité]"
    )
  })

  it('defines delegated operations in FR56 order with contextual prompts and placeholder fallbacks', async () => {
    await createRendererI18n('en')

    expect(DELEGATED_OPERATIONS.map((op) => op.id)).toEqual([
      'dossierBulkSetup',
      'contactAddUpdate',
      'keyDateExtraction',
      'keyReferenceAdd',
      'entitySetup',
      'documentTagging',
      'documentAnnotation',
      'templateAddUpdate',
      'documentGenerate'
    ])

    expect(
      DELEGATED_OPERATIONS[0]?.buildPrompt({
        entityName: 'Test Entity',
        sampleDossierName: 'Test Dossier'
      })
    ).toContain("Set up dossier 'Test Dossier'")
    expect(
      DELEGATED_OPERATIONS[4]?.buildPrompt({
        entityName: 'Test Entity',
        sampleDossierName: 'Test Dossier'
      })
    ).toContain("entity profile for 'Test Entity'")

    // placeholders when no context
    expect(
      DELEGATED_OPERATIONS[0]?.buildPrompt({ entityName: null, sampleDossierName: null })
    ).toContain('[your dossier name]')
    expect(
      DELEGATED_OPERATIONS[4]?.buildPrompt({ entityName: null, sampleDossierName: null })
    ).toContain('[firm name]')
  })
})
