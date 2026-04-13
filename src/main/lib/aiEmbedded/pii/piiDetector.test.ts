import { describe, expect, it } from 'vitest'

import { detectPii } from './piiDetector'

describe('detectPii', () => {
  it('does not treat common imperative verbs at sentence start as names and splits person names into separate spans', () => {
    const spans = detectPii(
      'Ajouter le contact Rémy Martin, huissier, 10 rue Lamartine, 83000 Toulon'
    )

    expect(spans.map((span) => span.value)).not.toContain('Ajouter')
    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'name', value: 'Rémy' }),
        expect.objectContaining({ type: 'name', value: 'Martin' }),
        expect.objectContaining({ type: 'address', value: '10 rue Lamartine' }),
        expect.objectContaining({ type: 'postalLocation', value: '83000 Toulon' })
      ])
    )
  })

  it('detects company-like capitalized entities as a single company span', () => {
    const spans = detectPii('Envoyer le dossier au Cabinet Horizon demain')

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'company', value: 'Cabinet Horizon' })
      ])
    )
  })

  it('does not treat confirmation vocabulary as names', () => {
    const confirmationSpans = detectPii('Oui')
    const questionSpans = detectPii('Voulez-vous vraiment supprimer le contact Merlin ?')

    expect(confirmationSpans).toEqual([])
    expect(questionSpans.map((span) => span.value)).not.toContain('Voulez-vous')
  })

  it('does not treat a lone first word at sentence start as PII just because it is capitalized', () => {
    const spans = detectPii('Demain nous envoyons le courrier au client.')

    expect(spans.map((span) => span.value)).not.toContain('Demain')
  })

  it('detects names anchored by honorific titles (M., Mme., Maître, Dr.)', () => {
    const spans1 = detectPii('Le dossier concerne M. Dupont et Mme Martin.')
    const spans2 = detectPii('Maître Lefebvre représente le client.')
    const spans3 = detectPii('Dr. Smith a signé le rapport.')

    expect(spans1.map((s) => s.value)).toEqual(expect.arrayContaining(['Dupont', 'Martin']))
    expect(spans2.map((s) => s.value)).toEqual(expect.arrayContaining(['Lefebvre']))
    expect(spans3.map((s) => s.value)).toEqual(expect.arrayContaining(['Smith']))
  })

  it('does not tag honorific titles (Monsieur, Madame) as names', () => {
    const spans = detectPii('pour Monsieur Dupont et Madame Martin')

    const values = spans.map((s) => s.value)
    expect(values).not.toContain('Monsieur')
    expect(values).not.toContain('Madame')
    expect(values).toEqual(expect.arrayContaining(['Dupont', 'Martin']))
  })

  it('detects SIRET as companyId', () => {
    const spans = detectPii('Société immatriculée sous le numéro 123 456 789 01234')

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'companyId', value: '123 456 789 01234' })
      ])
    )
  })

  it('detects SIREN with registry keyword as companyId', () => {
    const spans = detectPii('RCS Paris 123 456 789')

    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'companyId', value: '123 456 789' })])
    )
  })

  it('detects company entities with new legal forms (SASU, SNC, LLC, Ltd)', () => {
    // "SASU" alone is recognised as a company keyword and groups with adjacent words
    const spans1 = detectPii('Le contrat avec Cabinet Sasu Horizon est signé.')
    // ALL-CAPS acronym + company suffix → company span
    const spans2 = detectPii('Acme Corp a transmis le dossier.')

    expect(spans1.map((s) => s.value)).toContain('Cabinet Sasu Horizon')
    expect(spans2.map((s) => s.value)).toContain('Acme Corp')
  })

  it('detects French VAT number as companyId', () => {
    const spans = detectPii('TVA intracommunautaire : FR12 123 456 789')

    expect(spans).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'companyId' })]))
  })

  it('hyphenated compound names are one token, space-separated names are split', () => {
    const spans1 = detectPii('Mme Marie-Claire Fontaine est présente.')
    const spans2 = detectPii('Contact: Rémy Martin, architecte.')

    // Hyphen = union → single span
    expect(spans1.map((s) => s.value)).toContain('Marie-Claire')
    expect(spans1.map((s) => s.value)).not.toContain('Marie')
    expect(spans1.map((s) => s.value)).not.toContain('Claire')
    // Abbreviation "Mme" is a title, not a name
    expect(spans1.map((s) => s.value)).not.toContain('Mme')

    // Space = separation → each word is its own span
    expect(spans2.map((s) => s.value)).toContain('Rémy')
    expect(spans2.map((s) => s.value)).toContain('Martin')
  })

  it('captures up to 4 name tokens after a title (first + additional + last)', () => {
    const spans = detectPii('M. Jean Pierre Paul Dupont est le demandeur.')
    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(values).toEqual(expect.arrayContaining(['Jean', 'Pierre', 'Paul', 'Dupont']))
  })

  it('detects English street addresses', () => {
    const spans = detectPii('The client lives at 42 Oak Street in London.')

    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'address', value: '42 Oak Street' })])
    )
  })
})
