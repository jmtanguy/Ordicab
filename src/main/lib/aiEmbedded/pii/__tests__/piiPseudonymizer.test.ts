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
  it('pseudonymizes first name and last name separately instead of collapsing a full contact name', () => {
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
    const mapping = pseudonymizer.exportMapping()
    const firstName = mapping.find((entry) => entry.markerPath === 'contact.huissier.firstName')
    const lastName = mapping.find((entry) => entry.markerPath === 'contact.huissier.lastName')

    expect(firstName).toBeTruthy()
    expect(lastName).toBeTruthy()
    expect(pseudonymized).toContain(firstName!.fakeValue)
    expect(pseudonymized).toContain(lastName!.fakeValue)
    expect(pseudonymized).not.toContain('Jean')
    expect(pseudonymized).not.toContain('Dupont')
    expect(pseudonymized).not.toContain('[[')
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
    expect(pseudonymized).not.toContain('Jean')
    expect(pseudonymized).not.toContain('Dupont')
    expect(pseudonymized).not.toContain('2026-04-10')
    expect(pseudonymized).not.toContain('24/01234')
    expect(pseudonymized).not.toContain('[[')
  })

  it('replaces a structural email as a whole token even when its domain contains a known contact lastName', () => {
    // Reproduces an aiPage display bug: an email appearing in document text
    // (not registered as the contact's email) shared its domain part with a
    // seeded contact lastName ("Lefebvre"). The seeded-value pass replaced the
    // lastName INSIDE the email first, breaking the email regex so the email
    // detector no longer matched. Result: a half-pseudonymized value leaked
    // the local part to the LLM and confused the revert pass downstream. The fix is to
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
    expect(pseudonymized).not.toContain('karina@')
    expect(pseudonymized).not.toContain('Lefebvre')
    expect(pseudonymized).not.toContain('[[')
    expect(pseudonymizer.revert(pseudonymized)).toBe('Email : karina@Lefebvre-avocat.com')
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

    expect(pseudonymized).not.toContain('marie')
    expect(pseudonymized).not.toContain('dubois')
    expect(pseudonymized).not.toContain('dossier ete 2026')
    expect(pseudonymized).not.toContain('[[')
    expect(pseudonymizer.revert(pseudonymized)).toBe(
      'Merci de recontacter Marie Dubois au sujet du Dossier été 2026.'
    )
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

    expect(pseudonymized).toContain(marieEntry!.fakeValue)
    expect(pseudonymized).not.toContain(sophieEntry!.fakeValue)
    expect(pseudonymized).not.toContain('[[')
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

  it('reverts fake values when the LLM moves a pseudonymized string into an object key slot', () => {
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
    const mapping = pseudonymizer.exportMapping()
    const fakeCity = mapping.find((entry) => entry.original === 'nice')?.fakeValue
    const fakeZip = mapping.find((entry) => entry.original === '06100')?.fakeValue

    expect(fakeCity).toBeTruthy()
    expect(fakeZip).toBeTruthy()
    expect(pseudonymized).toContain(fakeCity!)

    // Simulate an LLM tool call that only kept the city portion, not the
    // aggregate value — revert must still map it back to "nice".
    expect(pseudonymizer.revert(fakeCity!)).toBe('nice')
    // And the zipcode portion must also be revertible on its own.
    expect(pseudonymizer.revert(fakeZip!)).toBe('06100')
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

    const contactSeed = pseudonymizer.pseudonymize('barreau de Nice')
    const contactCityFake = pseudonymizer
      .exportMapping()
      .find((entry) => entry.original === 'Nice')?.fakeValue
    expect(contactCityFake).toBeTruthy()
    expect(contactSeed).toContain(contactCityFake!)

    // Document text: lowercase "nice" inside a postalLocation. Without the fix
    // this branch calls fakeCity("nice", …) afresh — different hash than
    // fakeCity("Nice", …) — and would yield a different city fake.
    const pseudonymized = pseudonymizer.pseudonymize('cabinet à 25 avenue Victor Hugo, 06000 nice')
    const postalCityFake = pseudonymizer
      .exportMapping()
      .find((entry) => entry.original === '06000 nice')
      ?.fakeValue.split(/\s+/)
      .slice(1)
      .join(' ')

    // The aggregate must carry the same city fake as the seeded contact city.
    expect(postalCityFake).toBe(contactCityFake)
    expect(pseudonymized).toContain(contactCityFake!)

    // And reverting the bare fake (as if the LLM extracted only the city into
    // a tool argument) maps back to the real "Nice".
    expect(pseudonymizer.revert(postalCityFake!)).toBe('Nice')
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
    expect(pseudonymized).not.toContain('06100 nice')
    expect(pseudonymized).not.toContain('06200 nice')
    expect(pseudonymized).not.toContain('06300 nice')

    const aggregates = pseudonymizer
      .exportMapping()
      .filter((entry) => /^06[123]00 nice$/.test(entry.original))
    expect(aggregates).toHaveLength(3)

    const fakeZips = ['06100', '06200', '06300'].map(
      (zip) => pseudonymizer.exportMapping().find((entry) => entry.original === zip)!.fakeValue
    )
    const fakeCities = aggregates.map((entry) => entry.fakeValue.split(/\s+/).slice(1).join(' '))

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

    expect(out).toContain('ZZQuintard')
    expect(out).not.toContain('[[')
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

    const pillotEntry = pseudonymizer.exportMapping().find((entry) => entry.original === 'Pillot')
    expect(pillotEntry).toBeTruthy()
    expect(out).toContain(pillotEntry!.fakeValue)
    expect(pillotEntry!.fakeValue).not.toBe(reservedFake)
    // Reverting still works: bare fake → "Pillot".
    expect(pseudonymizer.revert(pillotEntry!.fakeValue)).toBe('Pillot')
  })

  it('NER capitalization hint routes a lowercase PER mention through the regex layer as per-token spans', async () => {
    // NER used to bundle "luc merlin" into a single PER span and the
    // pseudonymizer would emit a concatenated "FakeFirst
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

    const entries = pseudonymizer
      .exportMapping()
      .filter((entry) => entry.original === 'luc' || entry.original === 'merlin')
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.fakeValue.split(/\s+/).filter(Boolean)).toHaveLength(1)
      expect(pseudonymized).toContain(entry.fakeValue)
      expect(pseudonymizer.revert(entry.fakeValue)).toBe(entry.original)
    }
    expect(pseudonymized).not.toContain('[[')
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('falls back to per-token name spans when the regex layer misses a NER-only name', async () => {
    // "Skywalker" is not in KNOWN_FIRST_NAMES, so detectCapitalized's
    // known-first-name anchor fails even after capitalization. The NER
    // fallback splits the region into per-token name spans so each component
    // still gets its own fake value (no bundled identity leaks through).
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

    const entries = pseudonymizer
      .exportMapping()
      .filter((entry) => entry.original === 'anakin' || entry.original === 'skywalker')
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.fakeValue.split(/\s+/).filter(Boolean)).toHaveLength(1)
      expect(pseudonymized).toContain(entry.fakeValue)
    }
    expect(pseudonymized).not.toContain('[[')
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('never registers a function-word stopword as a name when NER over-tags a region', async () => {
    // Regression: the multilingual NER model routinely over-extends a PER
    // region across French function words. The fallback split then registered
    // "de" / "la" as `name_N` entries, and replaceSeededValues substituted
    // every later occurrence of those words — corrupting the whole conversation
    // and persisting across turns via the decode ledger.
    const text = 'avocat de la skywalker'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.95, index: 1, word: 'de' },
      { entity: 'I-PER', score: 0.95, index: 2, word: 'la' },
      { entity: 'I-PER', score: 0.95, index: 3, word: 'skywalker' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      ner: { enabled: true, minScore: 0.5 }
    })

    const pseudonymized = await pseudonymizer.pseudonymizeAsync(text)

    // The real surname is still pseudonymized…
    const skywalkerEntry = pseudonymizer
      .exportMapping()
      .find((entry) => entry.original === 'skywalker')
    expect(skywalkerEntry).toBeTruthy()
    expect(pseudonymized).toContain(skywalkerEntry!.fakeValue)
    expect(pseudonymizer.revert(skywalkerEntry!.fakeValue)).toBe('skywalker')
    // …but the function words are left untouched in clear text.
    expect(pseudonymized).toContain('avocat de la ')
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('still emits the uncovered name tokens of a NER region the regex layer only partially covered', async () => {
    // Old behaviour: if ANY regex span overlapped the NER region, the WHOLE
    // region was dropped — so an OCR-garbled surname next to a regex-caught
    // token leaked. The coverage check is now per-token.
    const text = 'le contact Charpentier Skywalker arrive'
    const fakePipe = vi.fn(async () => [
      { entity: 'B-PER', score: 0.95, index: 2, word: 'Charpentier' },
      { entity: 'I-PER', score: 0.95, index: 3, word: 'Skywalker' }
    ])
    pipelineSpy.mockResolvedValue(fakePipe)

    // The wordlist makes the regex layer claim "Charpentier" (as a `custom`
    // span), leaving "Skywalker" as the uncovered tail of the NER region.
    const pseudonymizer = new PiiPseudonymizer({
      locale: 'fr',
      wordlist: ['Charpentier'],
      ner: { enabled: true, minScore: 0.5 }
    })

    const pseudonymized = await pseudonymizer.pseudonymizeAsync(text)

    expect(pseudonymized).not.toContain('Charpentier')
    expect(pseudonymized).not.toContain('Skywalker')
    expect(pseudonymized).not.toContain('[[')
    expect(pseudonymizer.revert(pseudonymized)).toBe(text)
  })

  it('drops a toxic stopword prior entry on import but keeps legitimate ones', () => {
    // A `name_N` counter entry whose original is a function word can only come
    // from a past detection bug — importing it would re-arm replaceSeededValues
    // to substitute that word again. Semantic-path entries are always kept.
    const priorEntries = [
      { original: 'de', markerPath: 'name_2', fakeValue: 'Moreau' },
      { original: 'Pillot', markerPath: 'name_5', fakeValue: 'ZZQuintard' },
      { original: 'Paris', markerPath: 'contact.client.city', fakeValue: 'Lyon' }
    ]

    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr', priorEntries })
    const out = pseudonymizer.pseudonymize('Maître Pillot, de Paris, défend de la partie.')

    // Toxic "de" → "Moreau" entry was dropped: "de" stays in clear text.
    expect(out).not.toContain('Moreau')
    expect(out).toContain(' de la partie')
    // Legitimate prior entries survive.
    expect(out).toContain('ZZQuintard')
    expect(out).toContain('Lyon')
    expect(out).not.toContain('[[')
  })

  it('keeps same-role contacts reversible from fake values alone', () => {
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
    expect(pseudonymizedQuestion).not.toContain('Alex')
    expect(pseudonymizedQuestion).not.toContain('Bernard')
    expect(pseudonymizedQuestion).not.toContain('[[')
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
    expect(pseudonymizer.pseudonymize(primary)).not.toContain(unsafeFake)
  })

  it('never uses another PII span from the same input as a fake value', () => {
    const primary = 'Marie'
    const unsafeFake = fakeFirstName(primary, 'fr', inferGender(primary), 0)
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })

    const out = pseudonymizer.pseudonymize(`${unsafeFake} ${primary}`)
    const entry = pseudonymizer.exportMapping().find((item) => item.original === primary)

    expect(entry).toBeDefined()
    expect(entry?.fakeValue).not.toBe(unsafeFake)
    expect(out).not.toContain(unsafeFake)
  })

  it('falls back to an opaque reversible fake instead of leaving PII in clear text', () => {
    const pseudonymizer = new PiiPseudonymizer({ locale: 'fr' })
    const mapping = pseudonymizer['mapping']
    const originalAdd = mapping.add.bind(mapping)
    const addSpy = vi.spyOn(mapping, 'add')
    addSpy.mockImplementation((original, markerPath, fakeValue) => {
      if (!markerPath.startsWith('fallback.')) return undefined
      return originalAdd(original, markerPath, fakeValue)
    })

    const out = pseudonymizer.pseudonymize('Contact: jean.dupont@example.com')

    expect(out).toContain('PII_email_')
    expect(out).not.toContain('[[')
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

    expect(out).not.toContain('MONTALBAN')
    expect(out).not.toContain('RIVERA')
    expect(out).not.toContain('[[')
    expect(pseudonymizer.revert(out)).toBe(text)
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
    expect(out).not.toContain('jean.dupont@example.com')
    expect(out).not.toContain('06 12 34 56 78')
    expect(out).not.toContain('[[')
    expect(p.revert(out)).toBe(text)
  })

  // ── Structural PII round-trips ──────────────────────────────────────────────
  // Each case asserts the three properties that the marker-free pipeline relies
  // on: (1) the real value never reaches the model-facing text, (2) the fake
  // keeps the type's shape without echoing the original digits, and (3) the
  // pseudonymize → revert round-trip is exact (revert now works off the bare
  // fake value alone — there is no [[marker]] fallback anymore).
  describe('structural PII pseudonymization', () => {
    it('pseudonymizes a French phone number into another plausible mobile and round-trips', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Téléphone : 06 12 34 56 78'

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === '06 12 34 56 78')?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain('06 12 34 56 78')
      expect(out).toContain(fake!)
      // Still shaped like a French mobile: 0[67] then four space-separated pairs.
      expect(fake!).toMatch(/^0[67]( \d{2}){4}$/)
      expect(p.revert(out)).toBe(text)
    })

    it('preserves the separator style of a dotted phone number', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Tel 01.45.67.89.10'

      const out = p.pseudonymize(text)
      expect(out).not.toContain('01.45.67.89.10')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a French social-security number without leaking any original digit group', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const ssn = '1 85 12 75 116 001 42'
      const text = `Numéro de sécurité sociale : ${ssn}`

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === ssn)?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain(ssn)
      // Gender digit + same grouping pattern, but none of the real groups survive.
      expect(fake!).toMatch(/^[12]( \d{2}){2} \d{2} \d{3} \d{3} \d{2}$/)
      expect(fake!).not.toContain('85 12')
      expect(fake!).not.toContain('116 001')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a space-free NIR and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'NIR 185127511600142'

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === '185127511600142')?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain('185127511600142')
      expect(fake!).toMatch(/^[12]\d{14}$/)
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a seeded contact zip code into another zip in the same department', () => {
      const p = new PiiPseudonymizer({
        locale: 'fr',
        contacts: [{ id: 'c-1', role: 'client', zipCode: '75008' }]
      })

      const fake = p.exportMapping().find((e) => e.original === '75008')?.fakeValue
      expect(fake).toBeTruthy()
      // French zips keep their 2-digit department prefix, so the fake still reads
      // as a Paris (75) code while differing from the original.
      expect(fake!).toMatch(/^75\d{3}$/)
      expect(fake).not.toBe('75008')

      const out = p.pseudonymize('Le client habite dans le 75008.')
      expect(out).not.toContain('75008')
      expect(out).toContain(fake!)
      expect(p.revert(out)).toBe('Le client habite dans le 75008.')
    })

    it('keeps the zip department prefix when a zip+city appears as a postalLocation', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'cabinet à 25 avenue Victor Hugo, 06000 nice'

      const out = p.pseudonymize(text)
      const zipFake = p.exportMapping().find((e) => e.original === '06000')?.fakeValue
      const cityFake = p.exportMapping().find((e) => e.original === 'nice')?.fakeValue

      expect(zipFake).toBeTruthy()
      expect(cityFake).toBeTruthy()
      expect(zipFake!).toMatch(/^06\d{3}$/)
      expect(out).not.toContain('06000 nice')
      // City fake is a real French city name (≥4 chars so the bare-fake revert
      // pass can still resolve it) and is not the original.
      expect(cityFake!.length).toBeGreaterThanOrEqual(4)
      expect(cityFake!.toLowerCase()).not.toBe('nice')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a known contact city in prose and round-trips it', () => {
      const p = new PiiPseudonymizer({
        locale: 'fr',
        contacts: [{ id: 'c-1', role: 'client', city: 'Marseille' }]
      })

      const fake = p.exportMapping().find((e) => e.original === 'Marseille')?.fakeValue
      expect(fake).toBeTruthy()
      expect(fake).not.toBe('Marseille')

      const out = p.pseudonymize('Audience au tribunal de Marseille.')
      expect(out).not.toContain('Marseille')
      expect(out).toContain(fake!)
      expect(p.revert(out)).toBe('Audience au tribunal de Marseille.')
    })

    it('pseudonymizes a labelled IBAN and strips every original account group', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const iban = 'FR76 3000 6000 0112 3456 7890 189'
      const text = `IBAN : ${iban}`

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === iban)?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain(iban)
      // Country code preserved, grouping preserved, but no original group remains.
      expect(fake!.startsWith('FR')).toBe(true)
      expect(fake!).not.toContain('3000')
      expect(fake!).not.toContain('3456')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a labelled BIC into a valid-shaped BIC and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'BIC : BNPAFRPPXXX'

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === 'BNPAFRPPXXX')?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain('BNPAFRPPXXX')
      // 11-char BIC: 6 letters + 2 alphanumerics + 3 alphanumerics.
      expect(fake!).toMatch(/^[A-Z]{6}[A-Z0-9]{2}[A-Z0-9]{3}$/)
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a labelled tax id and a driver licence and round-trips both', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Numéro fiscal : 12 34 567 890 123. Permis n° 123456789012.'

      const out = p.pseudonymize(text)
      expect(out).not.toContain('12 34 567 890 123')
      expect(out).not.toContain('123456789012')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a French vehicle registration plate and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Immatriculation : AB-123-CD'

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === 'AB-123-CD')?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain('AB-123-CD')
      // Same SIV plate shape (LL-DDD-LL), separators preserved.
      expect(fake!).toMatch(/^[A-Z]{2}-\d{3}-[A-Z]{2}$/)
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a credit-card number without echoing any original digit run', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const card = '4970 1012 3456 7890'
      const text = `Carte bancaire ${card}`

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === card)?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain(card)
      expect(fake!).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/)
      expect(fake!).not.toContain('4970')
      expect(fake!).not.toContain('7890')
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes IP and MAC addresses into reserved ranges and round-trips them', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Connexion depuis 192.168.1.55 via la carte 01:23:45:67:89:AB.'

      const out = p.pseudonymize(text)
      const ipFake = p.exportMapping().find((e) => e.original === '192.168.1.55')?.fakeValue
      const macFake = p.exportMapping().find((e) => e.original === '01:23:45:67:89:AB')?.fakeValue

      expect(ipFake).toBeTruthy()
      expect(macFake).toBeTruthy()
      expect(out).not.toContain('192.168.1.55')
      expect(out).not.toContain('01:23:45:67:89:AB')
      // IP stays in the private 192.168/16 range; MAC stays in the IANA doc prefix.
      expect(ipFake!).toMatch(/^192\.168\.\d{1,3}\.\d{1,3}$/)
      expect(macFake!.startsWith('00:00:5E:')).toBe(true)
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a URL into a synthetic URL and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const url = 'https://cabinet-dupont.example.fr/dossier/42'
      const text = `Voir ${url}`

      const out = p.pseudonymize(text)
      expect(out).not.toContain('cabinet-dupont')
      expect(out).toMatch(/https?:\/\//)
      expect(p.revert(out)).toBe(text)
    })

    it('pseudonymizes a labelled medical identifier and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'Médecin RPPS : 10003456789'

      const out = p.pseudonymize(text)
      expect(out).not.toContain('10003456789')
      expect(p.revert(out)).toBe(text)
    })

    it('shifts a birth date to another date while keeping the format and round-trips it', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = 'née le 24/03/1990'

      const out = p.pseudonymize(text)
      const fake = p.exportMapping().find((e) => e.original === '24/03/1990')?.fakeValue

      expect(fake).toBeTruthy()
      expect(out).not.toContain('24/03/1990')
      // Same DD/MM/YYYY shape, different day.
      expect(fake!).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
      expect(fake).not.toBe('24/03/1990')
      expect(p.revert(out)).toBe(text)
    })

    it('round-trips a dense multi-type identity block exactly', () => {
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text = [
        'Téléphone 06 12 34 56 78,',
        'IBAN FR76 3000 6000 0112 3456 7890 189,',
        'née le 24/03/1990,',
        'IP 192.168.1.55,',
        'plaque AB-123-CD.'
      ].join(' ')

      const out = p.pseudonymize(text)

      for (const real of [
        '06 12 34 56 78',
        'FR76 3000 6000 0112 3456 7890 189',
        '24/03/1990',
        '192.168.1.55',
        'AB-123-CD'
      ]) {
        expect(out).not.toContain(real)
      }
      expect(out).not.toContain('[[')
      expect(p.revert(out)).toBe(text)
    })

    it('redacts every PII type in a realistic free-text sentence mixing names with structural data', () => {
      // The hardest case for the marker-free pipeline: identity (name) + address
      // + several structural types woven into one natural French sentence, with
      // no field labels to anchor on. Everything must be redacted and the whole
      // sentence must round-trip from the bare fakes alone.
      const p = new PiiPseudonymizer({ locale: 'fr' })
      const text =
        'Monsieur Jean Dupont, né le 24/03/1990, demeurant 12 rue des Lilas 75008 Paris, ' +
        'joignable au 06 12 34 56 78 ou à jean.dupont@example.com, a réglé par carte 4970 1012 3456 7890.'

      const out = p.pseudonymize(text)

      for (const real of [
        'Jean',
        'Dupont',
        '24/03/1990',
        '12 rue des Lilas',
        '75008',
        'Paris',
        '06 12 34 56 78',
        'jean.dupont@example.com',
        '4970 1012 3456 7890'
      ]) {
        expect(out).not.toContain(real)
      }
      expect(out).not.toContain('[[')
      // "Monsieur" is an honorific, not PII — it must stay readable for the model.
      expect(out).toContain('Monsieur')
      expect(p.revert(out)).toBe(text)
    })

    it('round-trips a mixed-PII sentence using the seeded contact context', () => {
      // Same data also lives in the contact context (as it would in production):
      // the seeded values and the inline detection must agree so the round-trip
      // is exact even though the same identity appears twice.
      const p = new PiiPseudonymizer({
        locale: 'fr',
        contacts: [
          {
            id: 'c-1',
            role: 'client',
            firstName: 'Jean',
            lastName: 'Dupont',
            email: 'jean.dupont@example.com',
            phone: '06 12 34 56 78',
            addressLine: '12 rue des Lilas',
            zipCode: '75008',
            city: 'Paris'
          }
        ]
      })

      const text =
        'Merci de rappeler Jean Dupont au 06 12 34 56 78 ; il habite 12 rue des Lilas, 75008 Paris ' +
        '(courriel jean.dupont@example.com).'

      const out = p.pseudonymize(text)

      for (const real of [
        'Jean',
        'Dupont',
        '06 12 34 56 78',
        '12 rue des Lilas',
        '75008',
        'Paris',
        'jean.dupont@example.com'
      ]) {
        expect(out).not.toContain(real)
      }
      expect(out).not.toContain('[[')
      expect(p.revert(out)).toBe(text)
    })
  })
})
