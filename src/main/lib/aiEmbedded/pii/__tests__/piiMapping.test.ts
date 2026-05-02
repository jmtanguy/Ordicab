import { describe, expect, it } from 'vitest'

import {
  PiiMapping,
  revertJsonValueWithMappingEntries,
  revertWithMappingEntries,
  revertWithMappingEntriesWithOptions
} from '../piiMapping'

describe('PiiMapping', () => {
  it('exposes isFakeUsedByOther so callers can detect collisions before adding', () => {
    const mapping = new PiiMapping()
    mapping.add('Martin', 'contact.client.lastName', 'Lefebvre')

    expect(mapping.isFakeUsedByOther('Lefebvre', 'Martin')).toBe(false)
    expect(mapping.isFakeUsedByOther('Lefebvre', 'Durand')).toBe(true)
    expect(mapping.isFakeUsedByOther('Aubert', 'Durand')).toBe(false)
  })

  it('reverts a marker whose fakeValue was rewritten with a non-breaking hyphen', () => {
    const mapping = new PiiMapping()
    mapping.add('25 rue du Faubourg Saint-Antoine', 'address_1', '42 rue du Faubourg Saint-Antoine')

    // LLM returns the marker with a non-breaking hyphen (U+2011) in the fakeValue.
    const llmText = 'Adresse : [[address_1]] `42 rue du Faubourg Saint\u2011Antoine`.'

    expect(mapping.revert(llmText)).toBe('Adresse : 25 rue du Faubourg Saint-Antoine.')
  })

  it('falls back to the marker path when the fakeValue no longer resolves', () => {
    const mapping = new PiiMapping()
    mapping.add('25 rue du Faubourg Saint-Antoine', 'address_1', '42 rue de la République')

    // LLM drops the fakeValue entirely into unrecognizable text — the marker path
    // is still authoritative and must not leak the fake literal to the UI.
    const llmText = 'Adresse : [[address_1]] `une rue quelconque`.'

    expect(mapping.revert(llmText)).toBe('Adresse : 25 rue du Faubourg Saint-Antoine.')
  })

  it('exposes isMarkerPathUsed so callers can detect path collisions', () => {
    const mapping = new PiiMapping()
    mapping.add('Jean', 'contact.client.firstName', 'Antoine')

    expect(mapping.isMarkerPathUsed('contact.client.firstName')).toBe(true)
    expect(mapping.isMarkerPathUsed('contact.client.lastName')).toBe(false)
  })

  it('allocates counter-based marker paths without content-derived seeds', () => {
    const mapping = new PiiMapping()

    expect(mapping.nextMarker('company')).toBe('company_1')
    expect(mapping.nextMarker('company')).toBe('company_2')
    expect(mapping.nextMarker('email')).toBe('email_1')
  })

  it('rejects an add() that would overwrite an existing markerPath with a different original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Sophie')).toBeDefined()

    // A second contact with the same role would land on the same marker path —
    // silently overwriting markerPathToOriginal would break revert via the
    // byMarker fallback for the first claimant.
    const collidingEntry = mapping.add('Sophie', 'contact.client.firstName', 'Antoine')
    expect(collidingEntry).toBeUndefined()

    // First original is still resolvable via both byFake and byMarker.
    expect(mapping.revert('Sophie')).toBe('Marie')
    expect(mapping.revert('[[contact.client.firstName]]')).toBe('Marie')
    expect(mapping.getOriginalByMarker('contact.client.firstName')).toBe('Marie')
  })

  it('rejects an add() that would overwrite an existing fakeValue with a different original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Sophie')).toBeDefined()

    // Sophie is already taken as a fake; a second contact reusing it would
    // make byFake resolve "Sophie" to the wrong original.
    const collidingEntry = mapping.add('Léa', 'contact.witness.firstName', 'Sophie')
    expect(collidingEntry).toBeUndefined()
    expect(mapping.getOriginalByFake('Sophie')).toBe('Marie')
  })

  it('rejects fake values that are the original itself or another registered original', () => {
    const mapping = new PiiMapping()
    expect(mapping.add('Marie', 'contact.client.firstName', 'Marie')).toBeUndefined()

    expect(mapping.add('Sophie', 'contact.witness.firstName', 'Antoine')).toBeDefined()
    expect(mapping.add('Léa', 'contact.client_2.firstName', 'Sophie')).toBeUndefined()
  })

  it('returns the existing entry when the same original is added twice', () => {
    const mapping = new PiiMapping()
    const first = mapping.add('Marie', 'contact.client.firstName', 'Sophie')
    const second = mapping.add('Marie', 'contact.client.firstName', 'Sophie')
    expect(first).toBeDefined()
    expect(second).toBe(first)
  })

  it('collapses whitespace runs in the stored original (OCR / paste artifacts)', () => {
    const mapping = new PiiMapping()
    const wide = '15 RUE TONDUTI                      L ESCARENE'
    const entry = mapping.add(wide, 'address_1', '42 rue du Marché Villeneuve')

    expect(entry?.originalValue).toBe('15 RUE TONDUTI L ESCARENE')
    expect(mapping.toJSON()[0]?.original).toBe('15 RUE TONDUTI L ESCARENE')

    // The wide form is still resolvable — both via lookup and via revert from
    // a marker — because match keys and the seeded-value regex tolerate it.
    expect(mapping.getFake(wide)?.markerPath).toBe('address_1')
    expect(mapping.revert('Adresse : [[address_1]] `42 rue du Marché Villeneuve`.')).toBe(
      'Adresse : 15 RUE TONDUTI L ESCARENE.'
    )
  })

  it('decodes old and current markers by fake value without trusting ambiguous marker paths', () => {
    const entries = [
      { original: 'Bertrand', markerPath: 'name_1', fakeValue: 'Charpentier' },
      { original: 'Sandrine', markerPath: 'name_22', fakeValue: 'Sandrine' },
      { original: 'Autre prénom', markerPath: 'name_1', fakeValue: 'Sophie' }
    ]

    expect(
      revertWithMappingEntries(
        'La cliente de [[name_1]] `Charpentier` est [[name_22]] `Sandrine`.',
        entries
      )
    ).toBe('La cliente de Bertrand est Sandrine.')
    expect(revertWithMappingEntries('Marker ambigu [[name_1]].', entries)).toBe(
      'Marker ambigu [[name_1]].'
    )
  })

  it('does not decode an invented marker when its fake value does not match the mapping', () => {
    const entries = [{ original: 'Fournier', markerPath: 'name_12', fakeValue: 'Leroy' }]

    expect(revertWithMappingEntries('Enfant: [[name_12]] `Rivera`.', entries)).toBe(
      'Enfant: [[name_12]] `Rivera`.'
    )
  })

  it('falls back to byMarker for semantic dotted marker paths when the fake is ambiguous', () => {
    // Repro for an aiPage display bug: the LLM emits
    // `[[contact.avocatDeLaPartieRepresentee.lastName]] \`Lefebvre\`` where the
    // fake "Lefebvre" is ambiguous across the cross-turn ledger (also registered
    // as the fake of an unrelated `name_N` token). Without the semantic-path
    // fallback the marker stayed visible in the rendered chat bubble. Counter-
    // based markers (name_12 above) still stay strict because their ids get
    // reused across turns with different meanings.
    const entries = [
      {
        original: 'Loubet',
        markerPath: 'contact.avocatDeLaPartieRepresentee.lastName',
        fakeValue: 'Durand'
      },
      { original: 'Lefebvre', markerPath: 'name_14', fakeValue: 'Lefebvre' },
      { original: 'Mercier', markerPath: 'name_16', fakeValue: 'Lefebvre' }
    ]

    expect(
      revertWithMappingEntries(
        'Maître Karine [[contact.avocatDeLaPartieRepresentee.lastName]] `Lefebvre`.',
        entries
      )
    ).toBe('Maître Karine Loubet.')
  })

  it('reverts a contact_upsert args object where lastName is bare but email carries the marker', () => {
    // Reproduces the failing upsert: the LLM emits `lastName: "Charpentier"`
    // (bare fake) while the sibling `email` field has `[[contact_1.lastName]]
    // `Charpentier`...`. The merged ledger has a stale cross-turn entry that
    // also assigns "Charpentier" to a different original, making byFake on the
    // bare value globally ambiguous. The JSON helper pre-scans the args, finds
    // the marker pair in `email`, and uses it to disambiguate the bare fake in
    // `lastName` so the database receives the real surname instead of the fake.
    const entries = [
      { original: 'Fournier', markerPath: 'contact_1.lastName', fakeValue: 'Charpentier' },
      { original: 'StaleSurname', markerPath: 'contact_99.lastName', fakeValue: 'Charpentier' },
      { original: 'Marie', markerPath: 'contact_1.firstName', fakeValue: 'Sandrine' }
    ]

    const upsertArgs = {
      id: '6ea90333-0cb6-4f85-a322-77b2959ef7b8',
      firstName: 'Sandrine',
      lastName: 'Charpentier',
      role: 'Avocat de la partie adverse',
      email: 'karina@[[contact_1.lastName]] `Charpentier`-avocat.com',
      phone: '07 65 61 45 81'
    }

    const reverted = revertJsonValueWithMappingEntries(upsertArgs, entries) as Record<
      string,
      string
    >

    expect(reverted.lastName).toBe('Fournier')
    expect(reverted.firstName).toBe('Marie')
    expect(reverted.email).toBe('karina@Fournier-avocat.com')
    // Untouched fields stay verbatim.
    expect(reverted.id).toBe('6ea90333-0cb6-4f85-a322-77b2959ef7b8')
    expect(reverted.phone).toBe('07 65 61 45 81')
  })

  it('disambiguates a cross-turn-ambiguous bare fake using currentTurnEntries when the LLM emitted no marker form', () => {
    // Reproduces a real upsert flow: the LLM is shown turn N's pseudonymized
    // documents where the fake "Charpentier" maps to Pillot, but turn N-1's
    // ledger had assigned the same fake "Charpentier" to a different original
    // (e.g. someone else's surname mentioned in an older search result). The
    // merged ledger therefore has byFake("charpentier") marked ambiguous.
    //
    // The LLM then calls contact_upsert with ONLY bare values — no marker
    // form anywhere in the JSON, so contextEntries built from the JSON
    // pre-scan is empty. Without currentTurnEntries the bare "Charpentier"
    // would leak through unchanged and the database would store the fake.
    const ledger = [
      { original: 'Pillot', markerPath: 'name_7', fakeValue: 'Charpentier' },
      { original: 'StaleSurname', markerPath: 'name_11', fakeValue: 'Charpentier' }
    ]
    const currentTurnEntries = [
      { original: 'Pillot', markerPath: 'name_7', fakeValue: 'Charpentier' }
    ]

    const upsertArgs = {
      firstName: 'Sandrine',
      lastName: 'Charpentier',
      role: 'Avocat de la partie représentée',
      email: 'antoine.girard@test-inbox.net',
      city: 'Strasbourg'
    }

    // Without the override: bare "Charpentier" stays as-is because byFake is null.
    const without = revertJsonValueWithMappingEntries(upsertArgs, ledger) as Record<string, string>
    expect(without.lastName).toBe('Charpentier')

    // With the current-turn override: bare "Charpentier" resolves to "Pillot".
    const withOverride = revertJsonValueWithMappingEntries(upsertArgs, ledger, {
      currentTurnEntries
    }) as Record<string, string>
    expect(withOverride.lastName).toBe('Pillot')
  })

  it('disambiguates a globally-ambiguous bare fake using a contextEntries override', () => {
    // Two cross-turn entries collide on the same fake "Charpentier", making
    // the bare-fake pass refuse to substitute. The aiService caller scans the
    // surrounding JSON object, finds `[[contact_1.lastName]] `Charpentier``,
    // looks it up via byPair and passes the result as a context entry — the
    // bare "Charpentier" then resolves to the same original.
    const entries = [
      { original: 'Fournier', markerPath: 'contact_1.lastName', fakeValue: 'Charpentier' },
      { original: 'OldName', markerPath: 'contact_99.lastName', fakeValue: 'Charpentier' }
    ]
    const contextEntries = [
      { original: 'Fournier', markerPath: 'contact_1.lastName', fakeValue: 'Charpentier' }
    ]

    // Without context: bare "Charpentier" is ambiguous and stays as-is.
    expect(revertWithMappingEntries('Charpentier', entries)).toBe('Charpentier')

    // With context: bare "Charpentier" resolves to the contextually-pinned original.
    expect(revertWithMappingEntriesWithOptions('Charpentier', entries, { contextEntries })).toBe(
      'Fournier'
    )
  })

  it('drops the orphan marker when the LLM merged two adjacent fakes into one backtick span', () => {
    // The LLM received "[[name_3]] `Moreau` [[name_4]] `Bonnet`" and rendered
    // it as a single "[[name_3]] `Moreau Bonnet`" by collapsing the two markers.
    // Strict mode used to leave the marker visible while the bare-fake pass
    // stripped the fake out, leaving an orphan "[[name_3]] Luc" in user text.
    const entries = [
      { original: 'Luc', markerPath: 'name_3', fakeValue: 'Moreau' },
      { original: 'Bonnet', markerPath: 'name_4', fakeValue: 'Aubert' }
    ]

    expect(revertWithMappingEntries('Ses enfants : [[name_3]] `Moreau Bonnet`.', entries)).toBe(
      'Ses enfants : Luc Bonnet.'
    )
  })

  it('reverts a fake date the LLM reformatted to ISO into the original date in ISO', () => {
    // The LLM canonicalises fake "21 avril 2026" to "2026-04-21" for a tool
    // argument typed `date`. Without format-tolerant matching, the fake date
    // would leak straight to the backend — the regression we are guarding.
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' }]

    expect(
      revertWithMappingEntries('{"label":"Date d\'audience","date":"2026-04-21"}', entries)
    ).toBe('{"label":"Date d\'audience","date":"2026-03-15"}')
  })

  it('reverts a fake date the LLM kept in textual French while preserving casing', () => {
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '2026-04-21' }]

    // LLM emits the date in French prose using the same fake content.
    expect(revertWithMappingEntries('Audience tenue le 21 Avril 2026.', entries)).toBe(
      'Audience tenue le 15 Mars 2026.'
    )
  })

  it('preserves the LLM-emitted format when the original is in a different format', () => {
    const entries = [{ original: '2026-03-15', markerPath: 'date_1', fakeValue: '21/04/2026' }]

    // Fake is FR numeric DD/MM/YYYY; LLM converts to ISO; revert should
    // produce ISO of the original (which happens to already be ISO).
    expect(revertWithMappingEntries('Renvoi: 2026-04-21.', entries)).toBe('Renvoi: 2026-03-15.')
    // Fake is FR numeric; LLM keeps FR numeric; revert reformats original to FR numeric.
    expect(revertWithMappingEntries('Renvoi: 21/04/2026.', entries)).toBe('Renvoi: 15/03/2026.')
  })

  it('interprets two-digit years with a civil-status pivot during date revert', () => {
    const entries = [{ original: '12/07/81', markerPath: 'date_1', fakeValue: '21/08/81' }]

    expect(revertWithMappingEntries('Naissance: 1981-08-21.', entries)).toBe(
      'Naissance: 1981-07-12.'
    )
  })

  it('leaves unrelated date-shaped tokens untouched', () => {
    const entries = [{ original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' }]

    // 2026-12-31 has no canonical match in the lookup; must pass through.
    expect(revertWithMappingEntries('Échéance: 2026-12-31.', entries)).toBe('Échéance: 2026-12-31.')
  })

  it('bails on ambiguous canonical-fake collisions across two originals', () => {
    const entries = [
      { original: '15 mars 2026', markerPath: 'date_1', fakeValue: '21 avril 2026' },
      { original: '03 mai 2026', markerPath: 'date_2', fakeValue: '21/04/2026' }
    ]

    // Two distinct originals share canonical fake 2026-04-21 — revert must not
    // pick one arbitrarily. The text is left as-is so the caller can detect
    // and surface the ambiguity rather than silently leaking a wrong date.
    expect(revertWithMappingEntries('Date: 2026-04-21.', entries)).toBe('Date: 2026-04-21.')
  })
})
