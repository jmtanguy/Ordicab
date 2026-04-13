import { describe, expect, it } from 'vitest'

import { PiiPseudonymizer } from './piiPseudonymizer'

describe('PiiPseudonymizer', () => {
  it('pseudonymizes first name and last name separately instead of collapsing a full contact name into one marker', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-john-smith',
          role: 'huissier',
          firstName: 'Jean',
          lastName: 'Dupont',
          displayName: 'Jean Dupont',
          addressLine: '42 avenue de la Gare',
          zipCode: '75000',
          city: 'Paris'
        }
      ]
    })

    const text = 'Ajouter le contact Jean Dupont, huissier, 42 avenue de la Gare, 75000 Paris'
    const pseudonymized = pseudonymizer.pseudonymize(text)

    expect(pseudonymized).toContain('[[contact.huissier.firstName]]')
    expect(pseudonymized).toContain('[[contact.huissier.lastName]]')
    expect(pseudonymized).not.toContain('[[contact.huissier.displayName]]')
    expect(pseudonymized).toContain('[[contact.huissier.firstName]]')
    expect(pseudonymized).toContain('[[contact.huissier.lastName]]')
  })

  it('keeps allowlisted non-sensitive labels clear while pseudonymizing sensitive values', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      allowlist: ['Huissier', "Date d'audience", 'N° RG'],
      contacts: [
        {
          id: 'contact-john-smith',
          role: 'huissier',
          firstName: 'Jean',
          lastName: 'Dupont',
          addressLine: '42 avenue de la Gare',
          zipCode: '75000',
          city: 'Paris'
        }
      ],
      keyDates: [{ label: "Date d'audience", value: '2026-04-10' }],
      keyRefs: [{ label: 'N° RG', value: '24/01234' }]
    })

    const text =
      "Huissier : Jean Dupont. Date d'audience : 2026-04-10. N° RG : 24/01234. Adresse : 42 avenue de la Gare, 75000 Paris."
    const pseudonymized = pseudonymizer.pseudonymize(text)

    expect(pseudonymized).toContain('Huissier')
    expect(pseudonymized).toContain("Date d'audience")
    expect(pseudonymized).toContain('N° RG')
    expect(pseudonymized).toContain('[[contact.huissier.firstName]]')
    expect(pseudonymized).toContain('[[contact.huissier.lastName]]')
    expect(pseudonymized).toContain('[[dossier.keyDate.dateDAudience]]')
    expect(pseudonymized).toContain('[[dossier.keyRef.nRg]]')
  })

  it('matches seeded values even when the source text drops accents', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-marie',
          role: 'cliente',
          firstName: 'Marie',
          lastName: 'Dubois'
        }
      ],
      keyRefs: [{ label: 'Référence étude', value: 'Dossier été 2026' }]
    })

    const text = 'Merci de recontacter marie dubois au sujet du dossier ete 2026.'
    const pseudonymized = pseudonymizer.pseudonymize(text)

    expect(pseudonymized).toContain('[[contact.cliente.firstName]]')
    expect(pseudonymized).toContain('[[contact.cliente.lastName]]')
    expect(pseudonymized).toContain('[[dossier.keyRef.referenceEtude]]')
  })

  it('does not cascade to a second mapping when one fake first name matches another real first name', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-marie',
          role: 'cliente',
          firstName: 'Marie'
        },
        {
          id: 'contact-sophie',
          role: 'avocate',
          firstName: 'Sophie'
        }
      ]
    })

    const mapping = pseudonymizer.exportMapping()
    const marieEntry = mapping.find((entry) => entry.original === 'Marie')
    const sophieEntry = mapping.find((entry) => entry.original === 'Sophie')

    expect(marieEntry).toBeTruthy()
    expect(sophieEntry).toBeTruthy()

    const pseudonymized = pseudonymizer.pseudonymize('Marie')

    expect(pseudonymized).toContain(`[[${marieEntry!.markerPath}]]`)
    expect(pseudonymized).toContain(`\`${marieEntry!.fakeValue}\``)
    expect(pseudonymized).not.toContain(`[[${sophieEntry!.markerPath}]]`)
  })

  it('round-trips a realistic pseudonymized sentence back to the original values', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      allowlist: ['Huissier', "Date d'audience", 'N° RG'],
      contacts: [
        {
          id: 'contact-john-smith',
          role: 'huissier',
          firstName: 'Jean',
          lastName: 'Dupont',
          addressLine: '42 avenue de la Gare',
          zipCode: '75000',
          city: 'Paris'
        }
      ],
      keyDates: [{ label: "Date d'audience", value: '2026-04-10' }],
      keyRefs: [{ label: 'N° RG', value: '24/01234' }]
    })

    const original =
      "Huissier : Jean Dupont. Date d'audience : 2026-04-10. N° RG : 24/01234. Adresse : 42 avenue de la Gare, 75000 Paris."

    const pseudonymized = pseudonymizer.pseudonymize(original)
    const reverted = pseudonymizer.revert(pseudonymized)

    expect(reverted).toBe(original)
  })

  it('reverts accentless fake-value variants back to the original accented values', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-marie',
          firstName: 'Marie',
          lastName: 'Dubois'
        }
      ]
    })

    const pseudonymized = pseudonymizer.pseudonymize('Merci de contacter marie dubois.')
    const accentlessAssistantReply = pseudonymized.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    expect(pseudonymizer.revert(accentlessAssistantReply)).toBe(
      'Merci de contacter Marie Dubois.'
    )
  })

  it('keeps delete confirmation wording and binary answers clear while pseudonymizing only the contact identity', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-alex',
          firstName: 'Alex',
          lastName: 'Bernard'
        }
      ]
    })

    const question = 'Voulez-vous vraiment supprimer le contact Alex Bernard ?'
    const answer = 'Oui'

    const pseudonymizedQuestion = pseudonymizer.pseudonymize(question)
    const pseudonymizedAnswer = pseudonymizer.pseudonymize(answer)

    expect(pseudonymizedQuestion).toContain('Voulez-vous vraiment supprimer le contact')
    expect(pseudonymizedQuestion).toContain('[[contact_1.firstName]]')
    expect(pseudonymizedQuestion).toContain('[[contact_1.lastName]]')
    expect(pseudonymizedAnswer).toBe('Oui')
  })

  it('keeps compound male first names in the male fake-name pool', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-expert',
          role: 'expert en informatique',
          firstName: 'Jean-Michel'
        }
      ]
    })

    const mapping = pseudonymizer.exportMapping()
    const firstNameEntry = mapping.find(
      (entry) => entry.markerPath === 'contact.expertEnInformatique.firstName'
    )

    expect(firstNameEntry?.original).toBe('Jean-Michel')
    expect(firstNameEntry?.fakeValue).not.toBe('Véronique')
    expect([
      'Antoine',
      'Pierre',
      'Nicolas',
      'Julien',
      'Maxime',
      'Alexandre',
      'François',
      'Emmanuel',
      'Romain',
      'Christophe',
      'Philippe',
      'Stéphane',
      'Frédéric',
      'Sébastien',
      'Mathieu',
      'Benoît',
      'Olivier',
      'Thierry',
      'Cédric',
      'Guillaume'
    ]).toContain(firstNameEntry?.fakeValue)
  })
})
