import { describe, expect, it } from 'vitest'

import { detectPii } from '../piiDetector'

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

  it('treats a French postal code + lowercase city as a postalLocation, not a phone', () => {
    const spans = detectPii('ajouter aux contacts jean-michel durand, 2 bd de Cimiez 06100 nice')

    const postal = spans.find((span) => span.type === 'postalLocation')
    expect(postal?.value).toBe('06100 nice')
    // Regression guard: the old PHONE_DE_RE was loose enough to swallow "06100"
    // as a 5-digit phone number, and the old POSTAL_LOCATION_RE required an
    // upper-case city initial so the postal branch never reached casual input.
    expect(spans.find((span) => span.type === 'phone')).toBeUndefined()
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

  it('detects English title-anchored names and excludes the titles themselves', () => {
    const spans = detectPii(
      'Mr. John Smith met Mrs Johnson and Professor Elizabeth Turner with Doctor Watson.'
    )

    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)
    expect(values).toEqual(
      expect.arrayContaining(['John', 'Smith', 'Johnson', 'Elizabeth', 'Turner', 'Watson'])
    )
    expect(values).not.toContain('Mr.')
    expect(values).not.toContain('Mrs')
    expect(values).not.toContain('Professor')
    expect(values).not.toContain('Doctor')
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

  it('detects an ALL-CAPS surname adjacent to a Title-Case first name (French legal style)', () => {
    const spans = detectPii('Contact : Corinne BLANCHET, avocate au barreau de Nice.')
    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(values).toContain('Corinne')
    expect(values).toContain('BLANCHET')
  })

  it('detects fully-uppercased name pairs where the first token is a known first name', () => {
    const spans = detectPii('Madame JULIETTE MOREAU, née le 12/07/1981, demandeuse.')
    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(values).toContain('JULIETTE')
    expect(values).toContain('MOREAU')
  })

  it('detects fully-uppercased identity names near birth-date context even without known first names', () => {
    const spans = detectPii(
      'votre nom, prénom et date de naissance : MONTALBAN RIVERA né(e) le 24/03/2004'
    )
    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(values).toContain('MONTALBAN')
    expect(values).toContain('RIVERA')
  })

  it('detects an ALL-CAPS surname following a known first name inside a longer prose sentence', () => {
    const spans = detectPii("L'avis est remis à Romain LAFONT, avocat au barreau.")
    const values = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(values).toContain('Romain')
    expect(values).toContain('LAFONT')
  })

  it('does not flag ALL-CAPS legal headings without a known first name', () => {
    const spans = detectPii('TRIBUNAL JUDICIAIRE de NICE — PROCÉDURE DE DROIT COMMUN')
    const nameValues = spans.filter((s) => s.type === 'name').map((s) => s.value)

    expect(nameValues).not.toContain('TRIBUNAL')
    expect(nameValues).not.toContain('JUDICIAIRE')
    expect(nameValues).not.toContain('NICE')
  })

  it('detects a date of birth introduced by "née le" / "born on" / "DOB"', () => {
    const spans1 = detectPii('Madame JULIETTE MOREAU, née le 12/07/1981, demandeuse.')
    const spans2 = detectPii('Patient born on 1979-03-04, hospitalised yesterday.')
    const spans3 = detectPii('DOB: 04.11.1965 — see annex.')

    expect(spans1).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'birthDate', value: '12/07/1981' })])
    )
    expect(spans2).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'birthDate', value: '1979-03-04' })])
    )
    expect(spans3).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'birthDate', value: '04.11.1965' })])
    )
  })

  it('detects birth dates regardless of separator and component ordering', () => {
    const cases: Array<[string, string]> = [
      // DD-first variants
      ['Né le 12/07/1981', '12/07/1981'],
      ['Né le 12-07-1981', '12-07-1981'],
      ['Né le 12.07.1981', '12.07.1981'],
      ['Né le 12 07 1981', '12 07 1981'],
      ['Né le 12/07/81', '12/07/81'],
      // YYYY-first variants
      ['Date de naissance : 1981-07-12', '1981-07-12'],
      ['Date de naissance : 1981/07/12', '1981/07/12'],
      ['Date de naissance : 1981.07.12', '1981.07.12'],
      ['Date de naissance : 1981 07 12', '1981 07 12'],
      // Textual month, both languages
      ['Née le 12 mars 1981', '12 mars 1981'],
      ['Born March 12, 1981', 'March 12, 1981'],
      ['Born on March 12 1981', 'March 12 1981']
    ]

    for (const [input, expected] of cases) {
      const spans = detectPii(input)
      expect(spans, `failed for "${input}"`).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'birthDate', value: expected })])
      )
    }
  })

  it('redacts arbitrary dates as a generic "date" marker (loose detection — better safe than leaking)', () => {
    const spans = detectPii("L'audience est fixée au 12/05/2026 à 14h00.")
    const types = spans.map((s) => s.type)

    // Birth-date specific marker must NOT be applied — no birth keyword present.
    expect(types).not.toContain('birthDate')
    // But a generic 'date' marker IS applied so the date does not leak in clear text.
    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'date', value: '12/05/2026' })])
    )
  })

  it('keeps the more specific "birthDate" marker when both birth-context and loose date detectors hit the same span', () => {
    const spans = detectPii('Madame JULIETTE MOREAU, née le 12/07/1981, demandeuse.')
    const dateSpans = spans.filter((s) => s.value === '12/07/1981')

    expect(dateSpans).toHaveLength(1)
    expect(dateSpans[0]!.type).toBe('birthDate')
  })

  it('redacts long bare numeric runs as a generic identifier (loose safety net)', () => {
    const spans = detectPii('Code interne 81237654 transmis par email.')

    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'identifier', value: '81237654' })])
    )
  })

  it('redacts unanchored alphanumeric reference codes as a generic identifier', () => {
    const spans = detectPii('Référence interne AB12-34CD à conserver.')

    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'identifier', value: 'AB12-34CD' })])
    )
  })

  it('detects French numéro fiscal (SPI) introduced by a tax keyword', () => {
    const spans1 = detectPii('Numéro fiscal de référence : 1234567890123')
    const spans2 = detectPii('SPI 12 34 567 890 123')
    const spans3 = detectPii('Tax ID: 9876543210987')

    expect(spans1).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'taxId', value: '1234567890123' })])
    )
    expect(spans2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'taxId', value: '12 34 567 890 123' })
      ])
    )
    expect(spans3).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'taxId', value: '9876543210987' })])
    )
  })

  it('detects French IBAN written with spaces every four characters', () => {
    const spans = detectPii('IBAN : FR76 1234 5678 9012 3456 7890 123')

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'IBAN', value: 'FR76 1234 5678 9012 3456 7890 123' })
      ])
    )
  })

  it('detects driver licence numbers behind a "permis" / "licence" keyword', () => {
    const spans1 = detectPii('Permis de conduire : 123456789012')
    const spans2 = detectPii("Driver's license number AB1234567")

    expect(spans1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'driverLicense', value: '123456789012' })
      ])
    )
    expect(spans2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'driverLicense', value: 'AB1234567' })
      ])
    )
  })

  it('detects BIC / SWIFT codes when explicitly labelled', () => {
    const spans = detectPii('BIC : BNPAFRPPXXX, IBAN à suivre.')

    expect(spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'BIC', value: 'BNPAFRPPXXX' })])
    )
  })

  it('detects IPv4 and MAC addresses', () => {
    const ipSpans = detectPii('Connexion depuis 192.168.42.17 à 18h32.')
    const macSpans = detectPii('Carte réseau : 3C:22:FB:90:AB:CD bridée.')

    expect(ipSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ipAddress', value: '192.168.42.17' })
      ])
    )
    expect(macSpans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'macAddress', value: '3C:22:FB:90:AB:CD' })
      ])
    )
  })

  it('detects generic identifiers behind labels like matricule / dossier n°', () => {
    const spans1 = detectPii('Matricule : 78A12345B')
    const spans2 = detectPii('Numéro allocataire 1234567')
    const spans3 = detectPii('Dossier n° 24/00876')

    expect(spans1).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'identifier', value: '78A12345B' })])
    )
    expect(spans2).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'identifier', value: '1234567' })])
    )
    expect(spans3).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'identifier', value: '24/00876' })])
    )
  })

  it('detects bare surnames anchored by legal role keywords (demandeur / défendeur / témoin…)', () => {
    const spans1 = detectPii('Le demandeur Lefebvre soutient que la créance est éteinte.')
    const spans2 = detectPii('Témoin entendu : Vasseur, employé du demandeur.')
    const spans3 = detectPii('La défenderesse DURAND a produit ses pièces.')

    expect(spans1.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Lefebvre')
    expect(spans2.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Vasseur')
    expect(spans3.filter((s) => s.type === 'name').map((s) => s.value)).toContain('DURAND')
  })

  it('detects bare surnames anchored by English legal role keywords', () => {
    const spans = detectPii('The plaintiff Lefebvre states that the defendant denies the claim.')

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Lefebvre')
  })

  it('detects bare surnames in the apposition form "{name}, {role}"', () => {
    const spans = detectPii('Bonnefoy, avocat au barreau, représente le requérant.')

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Bonnefoy')
  })

  it('detects bare surnames in the English apposition form "{name}, {role}"', () => {
    const spans = detectPii('Smith, attorney for the claimant, appeared at the hearing.')

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Smith')
  })

  it('detects bare surnames in adversarial constructions (contre / c/ / vs)', () => {
    const spans1 = detectPii('Affaire Lefebvre c/ Marchand, audience prochaine.')
    const spans2 = detectPii('Action engagée contre Boulanger.')

    const names1 = spans1.filter((s) => s.type === 'name').map((s) => s.value)
    expect(names1).toEqual(expect.arrayContaining(['Lefebvre', 'Marchand']))

    expect(spans2.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Boulanger')
  })

  it('detects bare surnames in English adversarial constructions', () => {
    const spans1 = detectPii('Brown v. Taylor is listed for hearing tomorrow.')
    const spans2 = detectPii('Action brought against Morgan remains pending.')
    const spans3 = detectPii('Jones versus Parker will be heard next week.')

    expect(spans1.filter((s) => s.type === 'name').map((s) => s.value)).toEqual(
      expect.arrayContaining(['Brown', 'Taylor'])
    )
    expect(spans2.filter((s) => s.type === 'name').map((s) => s.value)).toContain('Morgan')
    expect(spans3.filter((s) => s.type === 'name').map((s) => s.value)).toEqual(
      expect.arrayContaining(['Jones', 'Parker'])
    )
  })

  it('detects bare surnames preceding a verb of speech', () => {
    const spans = detectPii('Lefebvre déclare avoir signé en présence de Vasseur.')

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).toEqual(
      expect.arrayContaining(['Lefebvre'])
    )
  })

  it('detects bare surnames preceding English speech/action verbs', () => {
    const spans = detectPii(
      'Taylor states the facts, Morgan affirms the account, Johnson testifies.'
    )

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).toEqual(
      expect.arrayContaining(['Taylor', 'Morgan', 'Johnson'])
    )
  })

  it('does not promote legal document nouns or role titles to name spans even adjacent to a role keyword', () => {
    const spans = detectPii('Le demandeur Tribunal Judiciaire de Nice statue ce jour.')

    expect(spans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('Tribunal')
  })

  it('does not promote English legal/document nouns, role titles, or salutations to name spans', () => {
    const courtSpans = detectPii('The plaintiff Court Agreement appears in the header.')
    const roleSpans = detectPii('The defendant Judge Director signs the order.')
    const daySpans = detectPii('Monday states that January remains in the schedule.')
    const salutationSpans = detectPii('Hello states the obvious. Dear confirms receipt.')

    expect(courtSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('Court')
    expect(courtSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain(
      'Agreement'
    )
    expect(roleSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('Judge')
    expect(roleSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('Director')
    expect(daySpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('Monday')
    expect(daySpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain('January')
    expect(salutationSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain(
      'Hello'
    )
    expect(salutationSpans.filter((s) => s.type === 'name').map((s) => s.value)).not.toContain(
      'Dear'
    )
  })

  it('detects URLs', () => {
    const spans = detectPii('Voir https://example.com/dossier/12345?token=abc à venir.')

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'url',
          value: 'https://example.com/dossier/12345?token=abc'
        })
      ])
    )
  })

  it('detects obfuscated emails using [at] / (dot) wrappers', () => {
    const spans1 = detectPii('Contact: john.doe[at]example[dot]com pour suite.')
    const spans2 = detectPii('Écrire à marie (at) acme (dot) fr')

    expect(spans1.map((s) => s.type)).toContain('email')
    expect(spans2.map((s) => s.type)).toContain('email')
  })

  it('detects file paths that may leak the local username', () => {
    const spansUnix = detectPii('Fichier déposé dans /Users/jane.smith/Documents/contrat.pdf hier.')
    const spansWin = detectPii(
      'Sauvegarde sur C:\\Users\\janedoe\\AppData\\Local\\Ordicab\\backup.zip réussie.'
    )

    expect(spansUnix.map((s) => s.type)).toContain('filePath')
    expect(spansWin.map((s) => s.type)).toContain('filePath')
  })

  it('detects decimal GPS coordinates with sufficient precision', () => {
    const spans = detectPii("Le rendez-vous au point GPS 48.85661, 2.35222 à l'entrée nord.")

    expect(spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'gpsCoordinates', value: '48.85661, 2.35222' })
      ])
    )
  })

  it('does not flag low-precision decimal pairs as GPS coordinates', () => {
    const spans = detectPii('Note de frais 1.5, 2.5 EUR.')

    expect(spans.map((s) => s.type)).not.toContain('gpsCoordinates')
  })

  it('detects medical identifiers behind RPPS / ADELI / MRN keywords', () => {
    const spans1 = detectPii('Médecin RPPS : 10003456789 — service cardio.')
    const spans2 = detectPii('Patient MRN: A1234567 admis ce matin.')

    expect(spans1).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'medicalId', value: '10003456789' })])
    )
    expect(spans2).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'medicalId', value: 'A1234567' })])
    )
  })
})
