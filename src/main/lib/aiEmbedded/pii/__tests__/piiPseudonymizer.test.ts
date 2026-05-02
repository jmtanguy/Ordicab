import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PiiPseudonymizer } from '../piiPseudonymizer'
import { __resetNerCacheForTests } from '../nerDetection'
import { fakeFirstName, fakeLastName, inferGender } from '../fakegen'

const { pipelineSpy, envRef } = vi.hoisted(() => {
  const env = { localModelPath: undefined as string | undefined, allowRemoteModels: true }
  return { pipelineSpy: vi.fn(), envRef: env }
})

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineSpy,
  env: envRef
}))

beforeEach(() => {
  __resetNerCacheForTests()
  pipelineSpy.mockReset()
  envRef.localModelPath = undefined
  envRef.allowRemoteModels = true
})

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

  it('replaces a structural email as a whole token even when its domain contains a known contact lastName', () => {
    // Reproduces an aiPage display bug: an email appearing in document text
    // (not registered as the contact's email) shared its domain part with a
    // seeded contact lastName ("Lefebvre"). The seeded-value pass replaced the
    // lastName INSIDE the email first, breaking the email regex so the email
    // detector no longer matched. Result: a half-pseudonymized
    // `karina@[[contact.X.lastName]] \`Aubert\`-avocat.com` leaked the local
    // part to the LLM and confused the revert pass downstream. The fix is to
    // pre-detect structural patterns (email/URL/phone/...) on the original
    // text and register them as entries before the seeded-value pass runs.
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-1',
          role: 'Avocat de la partie représentée',
          firstName: 'Karine',
          lastName: 'Lefebvre'
        }
      ]
    })

    const pseudonymized = pseudonymizer.pseudonymize('Email : karina@Lefebvre-avocat.com')
    expect(pseudonymized).not.toMatch(/karina@\[\[/)
    expect(pseudonymized).toMatch(/^Email : \[\[email_\d+\]\] `[^`]+`$/)
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

  it('reverts markers when the LLM moves a marker-bearing string into an object key slot', () => {
    // Reproduces the document_generate failure where the LLM copied the
    // pseudonymized template macro path (a value-position string from
    // template_list output) into the `tagOverrides` keys.
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      wordlist: ['dossier']
    })

    const macro = pseudonymizer.pseudonymize('dossier.keyDate.audience.long')
    expect(macro).not.toBe('dossier.keyDate.audience.long')

    const reverted = pseudonymizer.revertJson({
      tagOverrides: { [macro]: '21 avril 2026' }
    }) as { tagOverrides: Record<string, string> }

    expect(Object.keys(reverted.tagOverrides)).toEqual(['dossier.keyDate.audience.long'])
    expect(reverted.tagOverrides['dossier.keyDate.audience.long']).toBe('21 avril 2026')
  })

  it('reverts a city value even when the LLM extracts only the city part of a postalLocation', () => {
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })

    const pseudonymized = pseudonymizer.pseudonymize(
      'ajouter aux contacts Luc Merlin, 2 bd de Cimiez 06100 nice'
    )
    // Extract the fake city the pseudonymizer produced so the test is independent
    // of the specific fakeCity output.
    const postalMatch = /\[\[postalLocation_[^\]]+\]\]\s+`(\d{5})\s+([^`]+)`/.exec(pseudonymized)
    expect(postalMatch).not.toBeNull()
    const fakeCity = postalMatch![2]!

    // Simulate an LLM tool call that only kept the city portion, not the
    // aggregate marker — revert must still map it back to "nice".
    expect(pseudonymizer.revert(fakeCity)).toBe('nice')
    // And the zipcode portion must also be revertible on its own.
    expect(pseudonymizer.revert(postalMatch![1]!)).toBe('06100')
  })

  it('reuses the seeded city fake when the same city later appears inside a postalLocation aggregate', () => {
    // Regression: the contact city was seeded with one fake ("city_Nice" hash)
    // and a postalLocation in the document text containing the same city in a
    // different casing produced a *different* fake ("city_nice" hash) for the
    // same real value. The LLM then saw two replacements for the same city and
    // sometimes echoed the postalLocation's fake bare in tool args; revert had
    // no atomic mapping for that fake (only the aggregate "06xxx <fake>") so
    // it leaked through and the wrong city was upserted.
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-helene',
          role: 'Partie représentée',
          firstName: 'Hélène',
          lastName: 'Leclerc',
          city: 'Nice'
        }
      ]
    })

    // Capture the contact city fake the seeding pass produced.
    const contactSeed = pseudonymizer.pseudonymize('barreau de Nice')
    const contactCityFake = /\[\[contact\.partieRepresentee\.city\]\]\s+`([^`]+)`/.exec(
      contactSeed
    )?.[1]
    expect(contactCityFake).toBeTruthy()

    // Document text: lowercase "nice" inside a postalLocation. Without the fix
    // this branch calls fakeCity("nice", …) afresh — different hash than
    // fakeCity("Nice", …) — and would yield a different city fake.
    const pseudonymized = pseudonymizer.pseudonymize('cabinet à 25 avenue Victor Hugo, 06000 nice')
    const postalAggregate = /\[\[postalLocation_[^\]]+\]\]\s+`(\d{5})\s+([^`]+)`/.exec(
      pseudonymized
    )
    expect(postalAggregate).not.toBeNull()
    const postalCityFake = postalAggregate![2]!

    // The aggregate must carry the same city fake as the contact marker.
    expect(postalCityFake).toBe(contactCityFake)

    // And reverting the bare fake (as if the LLM extracted only the city into
    // a tool argument) maps back to the real "Nice".
    expect(pseudonymizer.revert(postalCityFake)).toBe('Nice')
  })

  it('keeps the city fake stable across several postalLocations sharing the same city but different zips', () => {
    // A city like Nice has multiple postal codes (06100, 06200, 06300). Each
    // zip is a distinct real value and rightly gets its own fake, but the
    // shared city must be encoded with one stable fake — otherwise the LLM
    // sees N replacements for "nice" and revert is ambiguous.
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })

    const pseudonymized = pseudonymizer.pseudonymize(
      'antenne 1 : 5 rue Foo, 06100 nice. antenne 2 : 8 rue Bar, 06200 nice. antenne 3 : 11 rue Baz, 06300 nice.'
    )

    const aggregateRe = /\[\[postalLocation_[^\]]+\]\]\s+`(\d{5})\s+([^`]+)`/g
    const aggregates = [...pseudonymized.matchAll(aggregateRe)]
    expect(aggregates).toHaveLength(3)

    const fakeZips = aggregates.map((m) => m[1]!)
    const fakeCities = aggregates.map((m) => m[2]!)

    // Distinct real zips → distinct fake zips, each independently revertible.
    expect(new Set(fakeZips).size).toBe(3)
    expect(pseudonymizer.revert(fakeZips[0]!)).toBe('06100')
    expect(pseudonymizer.revert(fakeZips[1]!)).toBe('06200')
    expect(pseudonymizer.revert(fakeZips[2]!)).toBe('06300')

    // Shared real city → single stable fake city across every aggregate, and
    // a bare extraction by the LLM still reverts back to "nice".
    expect(new Set(fakeCities).size).toBe(1)
    expect(pseudonymizer.revert(fakeCities[0]!)).toBe('nice')
  })

  it('reuses the prior turn fake for an already-known original (stable across turns)', () => {
    // Without priorEntries, a fresh pseudonymizer generates fakeLastName('Pillot')
    // afresh each turn. The result is deterministic on the input string, but
    // pickUniqueFake rotation can land on a different attempt depending on
    // which other originals happen to collide in this turn. The decode ledger
    // then accumulates two distinct fakes for the same real value, and a bare
    // fake echoed by the LLM cannot be pinned to a single original.
    //
    // Importing the prior entry pre-registers its (original, fake) pair so the
    // new turn observes mapping.hasOriginal(value)=true for that original and
    // skips re-allocating — the prior fake wins.
    const priorEntries = [
      // Synthetic fake unreachable from fakeLastName('Pillot'): if the new
      // turn ever shows this fake in its output, it can only come from import.
      { original: 'Pillot', markerPath: 'name_5', fakeValue: 'ZZQuintard' }
    ]

    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr', priorEntries })
    const out = pseudonymizer.pseudonymize('Maître Pillot représente la partie.')

    expect(out).toContain('`ZZQuintard`')
    expect(out).toContain('[[name_5]]')
    expect(pseudonymizer.revert(out)).toBe('Maître Pillot représente la partie.')
  })

  it('blocks a prior-turn fake from being reused for a new original (no cross-turn collision)', () => {
    // Pre-register a fake whose natural target in the new turn would have
    // been "Charpentier"'s fakeLastName output. With import + isFakeValueBlocked
    // the new turn must rotate to a different fake instead of reusing the one
    // already mapped to a different original.
    //
    // We don't predict the natural fake; we just register every short fake
    // string that fakeLastName could plausibly emit, owned by another original.
    // The new turn for "Pillot" must then pick something none of those mapped.
    const reservedFake = fakeLastName('Pillot', 'fr')
    const priorEntries = [
      { original: 'OtherSurname', markerPath: 'name_99', fakeValue: reservedFake }
    ]

    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr', priorEntries })
    const out = pseudonymizer.pseudonymize('Maître Pillot représente la partie.')

    // The Pillot marker in the new turn must NOT carry the reserved fake.
    const pillotMatch = [...out.matchAll(/\[\[(name_[^\]]+)\]\]\s+`([^`]+)`/g)].find(
      (m) => m[1] !== 'name_99'
    )
    expect(pillotMatch).toBeTruthy()
    expect(pillotMatch![2]).not.toBe(reservedFake)
    // Reverting still works: bare fake → "Pillot".
    expect(pseudonymizer.revert(pillotMatch![2]!)).toBe('Pillot')
  })

  it('NER capitalization hint routes a lowercase PER mention through the regex layer as per-token spans', async () => {
    // NER used to bundle "luc merlin" into a single PER span and the
    // pseudonymizer would emit one marker with a concatenated "FakeFirst
    // FakeLast" payload — the LLM then had to split that aggregate itself and
    // revert() couldn't remap the halves independently. The new approach uses
    // NER only as a position oracle: it capitalizes the region so that
    // detectCapitalized (which emits ONE span per name token) picks it up.
    const text = 'ajouter le contact luc merlin au dossier'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.99, index: 3, word: 'luc' },
      { entity: 'I-PER', score: 0.98, index: 4, word: 'merlin' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      ner: { enabled: true, minScore: 0.5 }
    })

    const pseudonymized = await pseudonymizer.pseudonymizeAsync(text)

    const markerMatches = [...pseudonymized.matchAll(/\[\[(name_[^\]]+)\]\]\s+`([^`]+)`/g)]
    expect(markerMatches).toHaveLength(2)
    // Each marker wraps a single-token fake value (no more bundled
    // "FakeFirst FakeLast" identity).
    for (const m of markerMatches) {
      expect(m[2]!.split(/\s+/).filter(Boolean)).toHaveLength(1)
    }

    const [first, second] = markerMatches
    expect(pseudonymizer.revert(first![2]!)).toBe('luc')
    expect(pseudonymizer.revert(second![2]!)).toBe('merlin')
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('falls back to per-token name spans when the regex layer misses a NER-only name', async () => {
    // "Skywalker" is not in KNOWN_FIRST_NAMES, so detectCapitalized's
    // known-first-name anchor fails even after capitalization. The NER
    // fallback splits the region into per-token name spans so each component
    // still gets its own marker (no bundled identity leaks through).
    const text = 'contact anakin skywalker'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.95, index: 2, word: 'anakin' },
      { entity: 'I-PER', score: 0.95, index: 3, word: 'skywalker' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      ner: { enabled: true, minScore: 0.5 }
    })

    const pseudonymized = await pseudonymizer.pseudonymizeAsync(text)

    const markerMatches = [...pseudonymized.matchAll(/\[\[(name_[^\]]+)\]\]\s+`([^`]+)`/g)]
    expect(markerMatches).toHaveLength(2)
    for (const m of markerMatches) {
      expect(m[2]!.split(/\s+/).filter(Boolean)).toHaveLength(1)
    }
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('keeps same-role contacts reversible even when the LLM drops markers and returns only fake values', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-client-1',
          role: 'client',
          firstName: 'Jean',
          lastName: 'Dupont'
        },
        {
          id: 'contact-client-2',
          role: 'client',
          firstName: 'Marie',
          lastName: 'Durand'
        }
      ]
    })

    const mapping = pseudonymizer.exportMapping()
    const firstNameEntries = mapping.filter((entry) => entry.markerPath.endsWith('.firstName'))
    expect(firstNameEntries).toHaveLength(2)
    // First contact wins the role-based prefix; the second collides and gets a
    // counter-based prefix without a content-derived seed.
    const paths = firstNameEntries.map((entry) => entry.markerPath).sort()
    expect(paths[0]).toBe('contact.client.firstName')
    expect(paths[1]).toBe('contact_1.firstName')

    for (const entry of mapping) {
      expect(pseudonymizer.revert(entry.fakeValue)).toBe(entry.original)
    }
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

    expect(pseudonymizer.revert(accentlessAssistantReply)).toBe('Merci de contacter Marie Dubois.')
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
    expect(pseudonymizedQuestion).toMatch(/\[\[contact_[a-z0-9]+\.firstName\]\]/)
    expect(pseudonymizedQuestion).toMatch(/\[\[contact_[a-z0-9]+\.lastName\]\]/)
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

  it('never uses the original name itself as the fake value', () => {
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-self-fake',
          firstName: 'Guillaume',
          lastName: 'Rousseau'
        }
      ]
    })

    const mapping = pseudonymizer.exportMapping()
    expect(mapping.find((entry) => entry.original === 'Guillaume')?.fakeValue).not.toBe('Guillaume')
    expect(mapping.find((entry) => entry.original === 'Rousseau')?.fakeValue).not.toBe('Rousseau')
  })

  it('never uses another known contact value as a fake value', () => {
    const primary = 'Marie'
    const unsafeFake = fakeFirstName(primary, 'fr', inferGender(primary), 0)

    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      contacts: [
        {
          id: 'contact-primary',
          firstName: primary
        },
        {
          id: 'contact-colliding-fake',
          firstName: unsafeFake
        }
      ]
    })

    const entry = pseudonymizer.exportMapping().find((item) => item.original === primary)

    expect(entry).toBeDefined()
    expect(entry?.fakeValue).not.toBe(unsafeFake)
    expect(pseudonymizer.pseudonymize(primary)).not.toContain(`\`${unsafeFake}\``)
  })

  it('never uses another PII span from the same input as a fake value', () => {
    const primary = 'Marie'
    const unsafeFake = fakeFirstName(primary, 'fr', inferGender(primary), 0)
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })

    const out = pseudonymizer.pseudonymize(`${unsafeFake} ${primary}`)
    const entry = pseudonymizer.exportMapping().find((item) => item.original === primary)

    expect(entry).toBeDefined()
    expect(entry?.fakeValue).not.toBe(unsafeFake)
    expect(out).not.toContain(`\`${unsafeFake}\``)
  })

  it('falls back to an opaque reversible marker instead of leaving PII in clear text', () => {
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })
    const mapping = pseudonymizer['mapping']
    const originalAdd = mapping.add.bind(mapping)
    const addSpy = vi.spyOn(mapping, 'add')
    addSpy.mockImplementation((original, markerPath, fakeValue) => {
      if (!markerPath.startsWith('fallback.')) return undefined
      return originalAdd(original, markerPath, fakeValue)
    })

    const out = pseudonymizer.pseudonymize('Contact: jean.dupont@example.com')

    expect(out).toContain('[[fallback.email_')
    expect(out).not.toContain('jean.dupont@example.com')
    expect(pseudonymizer.revert(out)).toBe('Contact: jean.dupont@example.com')
  })

  it('fully replaces IBAN and alphanumeric identifier content in fake values', () => {
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })

    pseudonymizer.pseudonymize('IBAN FR76 3000 6000 0112 3456 7890 189. Passeport DUPONT2024A.')
    const mapping = pseudonymizer.exportMapping()
    const ibanEntry = mapping.find((entry) => entry.original.startsWith('FR76'))
    const passportEntry = mapping.find((entry) => entry.original === 'DUPONT2024A')

    expect(ibanEntry?.fakeValue).toBeDefined()
    expect(ibanEntry?.fakeValue).not.toContain('3000')
    expect(ibanEntry?.fakeValue).not.toContain('7890')
    expect(passportEntry?.fakeValue).toBeDefined()
    expect(passportEntry?.fakeValue).not.toContain('DUPONT')
  })

  it('pseudonymizes all-caps identity names instead of leaking them to the LLM', () => {
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })
    const text = 'votre nom, prénom et date de naissance : MONTALBAN RIVERA né(e) le 24/03/2004'

    const out = pseudonymizer.pseudonymize(text)

    expect(out).toContain('[[name_')
    expect(out).not.toContain('MONTALBAN')
    expect(out).not.toContain('RIVERA')
  })

  it('pseudonymizeAsync falls back to regex-only when NER is disabled', async () => {
    const p = new PiiPseudonymizer({ locale: 'fr' })
    const text = 'Contact: jean.dupont@example.com'
    expect(await p.pseudonymizeAsync(text)).toBe(p.pseudonymize(text))
  })

  it('pseudonymizeAsync still redacts regex-detectable PII when NER model fails to load', async () => {
    __resetNerCacheForTests()
    const p = new PiiPseudonymizer({
      locale: 'fr',
      ner: { enabled: true, modelPath: '/nonexistent/path/forces/load/failure' }
    })
    const text = 'Email: jean.dupont@example.com, téléphone 06 12 34 56 78'
    const out = await p.pseudonymizeAsync(text)
    expect(out).toContain('[[email')
    expect(out).toContain('[[phone')
    expect(out).not.toContain('jean.dupont@example.com')
    expect(out).not.toContain('06 12 34 56 78')
  })
})
