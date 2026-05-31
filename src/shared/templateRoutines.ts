export { CONTACT_ROLE_FIELD_ALIASES, TEMPLATE_ROUTINE_GROUPS } from './templateRoutines/types'
export type { TemplateRoutineEntry, TemplateRoutineGroup } from './templateRoutines/types'

import type { TemplateRoutineEntry } from './templateRoutines/types'
import { CONTACT_ROLE_FIELD_ALIASES } from './templateRoutines/types'

const EN_TO_FR_FIELD = new Map<string, string>(
  CONTACT_ROLE_FIELD_ALIASES.map(({ en, fr }) => [en, fr])
)
const FR_TO_EN_FIELD = new Map<string, string>(
  CONTACT_ROLE_FIELD_ALIASES.map(({ en, fr }) => [fr, en])
)

/**
 * Returns a function that translates any tag path to its localized display form.
 * Covers both static catalog entries and dynamic contact.<role>.<field> paths.
 * Used by SmartTagExtension to render tags in the current language.
 */
export function buildTagPathLocalizer(
  catalog: TemplateRoutineEntry[],
  locale: string
): (path: string) => string {
  const isFr = locale.startsWith('fr')
  const staticMap = new Map<string, string>()

  for (const entry of catalog) {
    const enPath = entry.tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
    const frPath = entry.tagFr?.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '') ?? null
    const displayPath = isFr && frPath ? frPath : enPath

    staticMap.set(enPath, displayPath)
    if (frPath) {
      staticMap.set(frPath, displayPath)
    }
  }

  return (path: string): string => {
    if (staticMap.has(path)) return staticMap.get(path)!
    // Dynamic chronology date tag: dossier.keyDate.<label>(.<variant>)?
    const km = /^dossier\.keyDate\.([^.]+)(?:\.(formatted|long|short|label))?$/.exec(path)
    if (km) {
      const label = km[1]!
      const variant = km[2]
      if (!isFr) return path
      const variantFr =
        variant === 'formatted'
          ? 'formate'
          : variant === 'long'
            ? 'texte'
            : variant === 'short'
              ? 'court'
              : variant === 'label'
                ? 'libelle'
                : undefined
      return variantFr ? `date.${label}.${variantFr}` : `date.${label}`
    }
    // Dynamic contact role tag: contact.<role>.<field>
    const m = /^(contact\.[^.]+)\.([^.]+)$/.exec(path)
    if (m) {
      const prefix = m[1]!
      const field = m[2]!
      const localized = isFr
        ? (EN_TO_FR_FIELD.get(field) ?? field)
        : (FR_TO_EN_FIELD.get(field) ?? field)
      return `${prefix}.${localized}`
    }
    // Dynamic date offset tag: date.today+N(.variant)? ↔ date.j+N(.variant)?
    const dm = /^date\.today\+(\d+)(?:\.(formatted|long|short))?$/.exec(path)
    if (dm) {
      if (!isFr) return path
      const days = dm[1]!
      const variant = dm[2]
      const variantFr =
        variant === 'formatted'
          ? 'formate'
          : variant === 'long'
            ? 'texte'
            : variant === 'short'
              ? 'court'
              : undefined
      return variantFr ? `date.j+${days}.${variantFr}` : `date.j+${days}`
    }
    return path
  }
}

const TEMPLATE_ROUTINE_CATALOG_ALL: TemplateRoutineEntry[] = [
  {
    tag: '{{dossier.name}}',
    tagFr: '{{dossier.nom}}',
    group: 'dossier',
    description: 'Primary dossier title',
    descriptionFr: 'Titre principal du dossier',
    example: 'LASTNAME-A v. Insurance Co.'
  },
  {
    tag: '{{dossier.createdAt}}',
    tagFr: '{{dossier.dateCreation}}',
    group: 'dossier',
    description: 'Dossier registration date (ISO format)',
    descriptionFr: "Date d'enregistrement du dossier (format ISO)",
    example: '2026-03-15',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.createdAtFormatted}}',
    tagFr: '{{dossier.dateCreationFormatee}}',
    group: 'dossier',
    description: 'Dossier registration date (localized format)',
    descriptionFr: "Date d'enregistrement du dossier (format local JJ/MM/AAAA)",
    example: '15/03/2026'
  },
  {
    tag: '{{dossier.createdAtLong}}',
    tagFr: '{{dossier.dateCreationTexte}}',
    group: 'dossier',
    description: 'Dossier registration date (long text)',
    descriptionFr: "Date d'enregistrement du dossier (texte long)",
    example: '15 mars 2026',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.createdAtShort}}',
    tagFr: '{{dossier.dateCreationCourte}}',
    group: 'dossier',
    description: 'Dossier registration date (abbreviated text)',
    descriptionFr: "Date d'enregistrement du dossier (texte abrégé)",
    example: '15 mars 26',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.juridiction}}',
    tagFr: '{{dossier.juridiction}}',
    group: 'dossier',
    description: 'Jurisdiction handling the dossier (court system)',
    descriptionFr: 'Juridiction saisie pour le dossier (ordre de juridiction)',
    example: 'Tribunal judiciaire'
  },
  {
    tag: '{{dossier.tribunal}}',
    tagFr: '{{dossier.tribunal}}',
    group: 'dossier',
    description: 'Specific court (tribunal) handling the dossier',
    descriptionFr: 'Tribunal précis saisi pour le dossier',
    example: 'Tribunal judiciaire de Paris'
  },
  {
    tag: '{{contact.displayName}}',
    tagFr: '{{contact.nomAffiche}}',
    group: 'contact',
    description: 'Primary contact display name (title + first name + last name)',
    descriptionFr: 'Nom affiché du contact principal (titre + prénom + nom)',
    subGroup: 'identity',
    example: 'Me Person-G LASTNAME-A'
  },
  {
    tag: '{{contact.title}}',
    tagFr: '{{contact.titre}}',
    group: 'contact',
    description: 'Primary contact title',
    descriptionFr: 'Titre du contact principal',
    subGroup: 'identity',
    example: 'Me'
  },
  {
    tag: '{{contact.firstName}}',
    tagFr: '{{contact.prenom}}',
    group: 'contact',
    description: 'Primary contact first name',
    descriptionFr: 'Prénom du contact principal',
    subGroup: 'identity',
    example: 'Person-G'
  },
  {
    tag: '{{contact.firstNames}}',
    tagFr: '{{contact.prenoms}}',
    group: 'contact',
    description: 'Primary contact first names (main first name + additional civil first names)',
    descriptionFr:
      "Prénoms du contact principal (prénom principal + prénoms complémentaires de l'état civil)",
    subGroup: 'identity',
    example: 'Person-G Person-F Person-H',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.additionalFirstNames}}',
    tagFr: '{{contact.prenomsComplementaires}}',
    group: 'contact',
    description: 'Primary contact additional civil first names',
    descriptionFr: 'Prénoms complémentaires du contact principal',
    subGroup: 'personalInfo',
    example: 'Person-F Person-H',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.lastName}}',
    tagFr: '{{contact.nom}}',
    group: 'contact',
    description: 'Primary contact last name',
    descriptionFr: 'Nom de famille du contact principal',
    subGroup: 'identity',
    example: 'LASTNAME-B'
  },
  {
    tag: '{{contact.role}}',
    tagFr: '{{contact.role}}',
    group: 'contact',
    description: 'Primary contact role',
    descriptionFr: 'Rôle du contact principal',
    subGroup: 'identity',
    example: 'Client'
  },
  {
    tag: '{{contact.email}}',
    tagFr: '{{contact.email}}',
    group: 'contact',
    description: 'Primary contact email address',
    descriptionFr: 'Adresse e-mail du contact principal',
    subGroup: 'identity',
    example: 'Person-G.LASTNAME-B@example.com'
  },
  {
    tag: '{{contact.phone}}',
    tagFr: '{{contact.telephone}}',
    group: 'contact',
    description: 'Primary contact phone number',
    descriptionFr: 'Numéro de téléphone du contact principal',
    subGroup: 'identity',
    example: '+33 1 23 45 67 89'
  },
  {
    tag: '{{contact.institution}}',
    tagFr: '{{contact.institution}}',
    group: 'contact',
    description: 'Primary contact institution',
    descriptionFr: 'Institution du contact principal',
    subGroup: 'identity',
    example: 'LASTNAME-A Conseil'
  },
  {
    tag: '{{contact.addressLine}}',
    tagFr: '{{contact.ligneAdresse}}',
    group: 'contact',
    description: 'Primary contact first address line (street)',
    descriptionFr: "Première ligne d'adresse du contact principal (rue)",
    subGroup: 'address',
    example: '12 rue des Fleurs',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.addressLine2}}',
    tagFr: '{{contact.ligneAdresse2}}',
    group: 'contact',
    description: 'Primary contact second address line (complement)',
    descriptionFr: "Deuxième ligne d'adresse du contact principal (complément)",
    subGroup: 'address',
    example: 'Appt 3',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.zipCode}}',
    tagFr: '{{contact.codePostal}}',
    group: 'contact',
    description: 'Primary contact postal code',
    descriptionFr: 'Code postal du contact principal',
    subGroup: 'address',
    example: '75008',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.city}}',
    tagFr: '{{contact.ville}}',
    group: 'contact',
    description: 'Primary contact city',
    descriptionFr: 'Ville du contact principal',
    subGroup: 'address',
    example: 'Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.country}}',
    tagFr: '{{contact.pays}}',
    group: 'contact',
    description: 'Primary contact country',
    descriptionFr: 'Pays du contact principal',
    subGroup: 'address',
    example: 'France',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.dateOfBirth}}',
    tagFr: '{{contact.dateNaissance}}',
    group: 'contact',
    description: 'Primary contact date of birth',
    descriptionFr: 'Date de naissance du contact principal',
    subGroup: 'personalInfo',
    example: '15/03/1980'
  },
  {
    tag: '{{contact.countryOfBirth}}',
    tagFr: '{{contact.paysNaissance}}',
    group: 'contact',
    description: 'Primary contact country of birth',
    descriptionFr: 'Pays de naissance du contact principal',
    subGroup: 'personalInfo',
    example: 'France'
  },
  {
    tag: '{{contact.nationality}}',
    tagFr: '{{contact.nationalite}}',
    group: 'contact',
    description: 'Primary contact nationality',
    descriptionFr: 'Nationalité du contact principal',
    subGroup: 'personalInfo',
    example: 'Française'
  },
  {
    tag: '{{contact.occupation}}',
    tagFr: '{{contact.profession}}',
    group: 'contact',
    description: 'Primary contact occupation',
    descriptionFr: 'Profession du contact principal',
    subGroup: 'personalInfo',
    example: 'Ingénieur'
  },
  {
    tag: '{{contact.socialSecurityNumber}}',
    tagFr: '{{contact.numeroSecu}}',
    group: 'contact',
    description: 'Primary contact social security number',
    descriptionFr: 'Numéro de sécurité sociale du contact principal',
    subGroup: 'personalInfo',
    example: '1 80 03 75 123 456 78'
  },
  {
    tag: '{{contact.maidenName}}',
    tagFr: '{{contact.nomJeuneFille}}',
    group: 'contact',
    description: 'Primary contact maiden name',
    descriptionFr: 'Nom de jeune fille du contact principal',
    subGroup: 'personalInfo',
    example: 'LASTNAME-A'
  },
  {
    tag: '{{contact.addressFormatted}}',
    tagFr: '{{contact.adresseFormatee}}',
    group: 'contact',
    description: 'Primary contact formatted address (multi-line: street then zip + city + country)',
    descriptionFr:
      'Adresse formatée du contact principal (multi-ligne : rue puis code postal + ville + pays)',
    subGroup: 'address',
    example: '12 rue des Fleurs\n75008 Paris\nFrance'
  },
  {
    tag: '{{contact.addressInline}}',
    tagFr: '{{contact.adresseCompacte}}',
    group: 'contact',
    description: 'Primary contact address on one line (comma-separated)',
    descriptionFr: 'Adresse du contact principal sur une ligne (séparée par des virgules)',
    subGroup: 'address',
    example: '12 rue des Fleurs, 75008 Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.salutation}}',
    tagFr: '{{contact.civilite}}',
    group: 'contact',
    description: 'Salutation (Madame / Monsieur)',
    descriptionFr: 'Civilité (Madame / Monsieur)',
    subGroup: 'salutation',
    example: 'Madame',
    visibility: 'hidden'
  },
  {
    tag: '{{contact.salutationFull}}',
    tagFr: '{{contact.civiliteNom}}',
    group: 'contact',
    description: 'Salutation with last name',
    descriptionFr: 'Civilité avec nom',
    subGroup: 'salutation',
    example: 'Madame LASTNAME-A'
  },
  {
    tag: '{{contact.dear}}',
    tagFr: '{{contact.formuleAppel}}',
    group: 'contact',
    description: 'Opening formula (Chère Madame, Cher Monsieur, ...)',
    descriptionFr: "Formule d'appel (Chère Madame, Cher Monsieur, ...)",
    subGroup: 'salutation',
    example: 'Chère Madame'
  },
  // Opposing-counsel stubs: resolution is dynamic via labelToKey (any contact carrying the
  // role "Conseil adverse" is automatically routed). These catalog entries exist purely so
  // the routines appear in the TagReferencePanel for discoverability.
  {
    tag: '{{contact.conseilAdverse.displayName}}',
    tagFr: '{{contact.conseilAdverse.nomAffiche}}',
    group: 'contact',
    description: 'Opposing counsel display name (requires a contact with role "Conseil adverse")',
    descriptionFr:
      'Nom affiché du conseil adverse (nécessite un contact avec le rôle « Conseil adverse »)',
    subGroup: 'identity',
    example: 'Me Person-Z LASTNAME-Y'
  },
  {
    tag: '{{contact.conseilAdverse.email}}',
    tagFr: '{{contact.conseilAdverse.email}}',
    group: 'contact',
    description: 'Opposing counsel email',
    descriptionFr: 'Email du conseil adverse',
    subGroup: 'identity',
    example: 'avocat@cabinet-adverse.fr'
  },
  {
    tag: '{{contact.conseilAdverse.phone}}',
    tagFr: '{{contact.conseilAdverse.telephone}}',
    group: 'contact',
    description: 'Opposing counsel phone',
    descriptionFr: 'Téléphone du conseil adverse',
    subGroup: 'identity',
    example: '+33 1 23 45 67 89'
  },
  {
    tag: '{{contact.conseilAdverse.institution}}',
    tagFr: '{{contact.conseilAdverse.institution}}',
    group: 'contact',
    description: 'Opposing counsel firm/institution',
    descriptionFr: 'Cabinet/institution du conseil adverse',
    subGroup: 'identity',
    example: 'Cabinet Adverse & Associés'
  },
  {
    tag: '{{contact.conseilAdverse.addressFormatted}}',
    tagFr: '{{contact.conseilAdverse.adresseFormatee}}',
    group: 'contact',
    description: 'Opposing counsel formatted address (multi-line)',
    descriptionFr: 'Adresse formatée du conseil adverse (multi-ligne)',
    subGroup: 'address',
    example: '12 rue de la Paix\n75002 Paris'
  },
  {
    tag: '{{entity.displayName}}',
    tagFr: '{{cabinet.nomAffiche}}',
    group: 'entity',
    description: 'Full entity contact name (title + first name + last name)',
    descriptionFr: 'Nom affiché du cabinet (titre + prénom + nom)',
    subGroup: 'identity',
    example: 'Me Person-C LASTNAME-E'
  },
  {
    tag: '{{entity.firmName}}',
    tagFr: '{{cabinet.nomCabinet}}',
    group: 'entity',
    description: 'Saved firm name',
    descriptionFr: 'Nom du cabinet enregistré',
    subGroup: 'identity',
    example: 'Cabinet LASTNAME-E'
  },
  {
    tag: '{{entity.title}}',
    tagFr: '{{cabinet.titre}}',
    group: 'entity',
    description: 'Lawyer short title (constant)',
    descriptionFr: "Titre court de l'avocat (constante)",
    subGroup: 'identity',
    example: 'Me',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.titleLong}}',
    tagFr: '{{cabinet.titreLong}}',
    group: 'entity',
    description: 'Lawyer full title (constant) — for formal contexts',
    descriptionFr: "Titre complet de l'avocat (constante) — pour contextes formels",
    subGroup: 'identity',
    example: 'Maître',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.firstName}}',
    tagFr: '{{cabinet.prenom}}',
    group: 'entity',
    description: 'Firm contact first name',
    descriptionFr: 'Prénom du contact du cabinet',
    subGroup: 'identity',
    example: 'Person-C',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.lastName}}',
    tagFr: '{{cabinet.nom}}',
    group: 'entity',
    description: 'Firm contact last name',
    descriptionFr: 'Nom de famille du contact du cabinet',
    subGroup: 'identity',
    example: 'LASTNAME-E',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.address}}',
    tagFr: '{{cabinet.adresse}}',
    group: 'entity',
    description: 'Saved firm raw address (free-text)',
    descriptionFr: 'Adresse brute du cabinet (texte libre)',
    subGroup: 'address',
    example: '12 rue des Fleurs\n75008 Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.addressLine}}',
    tagFr: '{{cabinet.ligneAdresse}}',
    group: 'entity',
    description: 'Firm first address line (street)',
    descriptionFr: "Première ligne d'adresse du cabinet (rue)",
    subGroup: 'address',
    example: '12 rue des Fleurs',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.addressLine2}}',
    tagFr: '{{cabinet.ligneAdresse2}}',
    group: 'entity',
    description: 'Firm second address line (complement)',
    descriptionFr: "Deuxième ligne d'adresse du cabinet (complément)",
    subGroup: 'address',
    example: 'Bâtiment B',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.zipCode}}',
    tagFr: '{{cabinet.codePostal}}',
    group: 'entity',
    description: 'Firm postal code',
    descriptionFr: 'Code postal du cabinet',
    subGroup: 'address',
    example: '75008',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.city}}',
    tagFr: '{{cabinet.ville}}',
    group: 'entity',
    description: 'Firm city',
    descriptionFr: 'Ville du cabinet',
    subGroup: 'address',
    example: 'Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.addressFormatted}}',
    tagFr: '{{cabinet.adresseFormatee}}',
    group: 'entity',
    description: 'Firm formatted address (multi-line: street then zip + city)',
    descriptionFr: 'Adresse formatée du cabinet (multi-ligne : rue puis code postal + ville)',
    subGroup: 'address',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{entity.addressInline}}',
    tagFr: '{{cabinet.adresseCompacte}}',
    group: 'entity',
    description: 'Firm address on one line (comma-separated)',
    descriptionFr: 'Adresse du cabinet sur une ligne (séparée par des virgules)',
    subGroup: 'address',
    example: '12 rue des Fleurs, 75008 Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.vatNumber}}',
    tagFr: '{{cabinet.tva}}',
    group: 'entity',
    description: 'Saved firm VAT number',
    descriptionFr: 'Numéro de TVA du cabinet',
    subGroup: 'legal',
    example: 'FR12345678901'
  },
  {
    tag: '{{entity.phone}}',
    tagFr: '{{cabinet.telephone}}',
    group: 'entity',
    description: 'Saved firm phone number',
    descriptionFr: 'Numéro de téléphone du cabinet',
    subGroup: 'identity',
    example: '+33 1 98 76 54 32'
  },
  {
    tag: '{{entity.email}}',
    tagFr: '{{cabinet.email}}',
    group: 'entity',
    description: 'Saved firm email address',
    descriptionFr: 'Adresse e-mail du cabinet',
    subGroup: 'identity',
    example: 'contact@cabinet-LASTNAME-E.fr'
  },
  {
    tag: '{{entity.siren}}',
    tagFr: '{{cabinet.siren}}',
    group: 'entity',
    description: 'Firm SIREN number (9 digits)',
    descriptionFr: 'Numéro SIREN du cabinet (9 chiffres)',
    subGroup: 'legal',
    example: '123 456 789'
  },
  {
    tag: '{{entity.legalForm}}',
    tagFr: '{{cabinet.formeJuridique}}',
    group: 'entity',
    description: 'Firm legal form (e.g. SELARL, EURL, SCP)',
    descriptionFr: 'Forme juridique du cabinet (ex. SELARL, EURL, SCP)',
    subGroup: 'legal',
    example: 'SELARL'
  },
  {
    tag: '{{entity.shareCapital}}',
    tagFr: '{{cabinet.capitalSocial}}',
    group: 'entity',
    description: 'Firm share capital',
    descriptionFr: 'Capital social du cabinet',
    subGroup: 'legal',
    example: '10 000 €'
  },
  {
    tag: '{{entity.rcsNumber}}',
    tagFr: '{{cabinet.numeroRcs}}',
    group: 'entity',
    description: 'Firm RCS registration number',
    descriptionFr: "Numéro d'immatriculation RCS du cabinet",
    subGroup: 'legal',
    example: 'Paris B 123 456 789'
  },
  {
    tag: '{{entity.rcsCity}}',
    tagFr: '{{cabinet.villeGreffe}}',
    group: 'entity',
    description: 'City of the RCS court (greffe)',
    descriptionFr: 'Ville du greffe du tribunal de commerce',
    subGroup: 'legal',
    example: 'Paris',
    visibility: 'hidden'
  },
  {
    tag: '{{entity.iban}}',
    tagFr: '{{cabinet.iban}}',
    group: 'entity',
    description: 'Firm bank account IBAN',
    descriptionFr: 'IBAN du compte bancaire du cabinet',
    subGroup: 'banking',
    example: 'FR76 1234 5678 9012 3456 7890 123'
  },
  {
    tag: '{{entity.bic}}',
    tagFr: '{{cabinet.bic}}',
    group: 'entity',
    description: 'Firm bank account BIC',
    descriptionFr: 'BIC du compte bancaire du cabinet',
    subGroup: 'banking',
    example: 'BNPAFRPP'
  },
  {
    tag: '{{entity.carpaIban}}',
    tagFr: '{{cabinet.ibanCarpa}}',
    group: 'entity',
    description: 'CARPA trust account IBAN (lawyers)',
    descriptionFr: 'IBAN du compte CARPA (avocats)',
    subGroup: 'banking',
    example: 'FR76 9876 5432 1098 7654 3210 987'
  },
  {
    tag: '{{entity.barreau}}',
    tagFr: '{{cabinet.barreau}}',
    group: 'entity',
    description: 'Bar (barreau) where the lawyer is registered',
    descriptionFr: "Barreau d'inscription de l'avocat",
    subGroup: 'bar',
    example: 'Paris'
  },
  {
    tag: '{{entity.toque}}',
    tagFr: '{{cabinet.toque}}',
    group: 'entity',
    description: 'Toque number (bar roll number)',
    descriptionFr: 'Numéro de toque (palais)',
    subGroup: 'bar',
    example: 'P0123'
  },
  {
    tag: '{{entity.avocat.titre}}',
    tagFr: '{{cabinet.avocat.titre}}',
    group: 'entity',
    description: 'Lawyer honorific (Me / Maître) for signature blocks',
    descriptionFr: "Titre de l'avocat (Me / Maître) pour bloc signature",
    subGroup: 'identity',
    example: 'Maître'
  },
  {
    tag: '{{dossier.keyDate.<label>}}',
    tagFr: '{{date.<label>}}',
    group: 'keyDates',
    description:
      'Dynamic key date (ISO) - replace <label> with the canonical key derived from the date label',
    descriptionFr: 'Date clé dynamique (ISO) — remplacez <label> par la clé dérivée du libellé',
    example: '{{dossier.keyDate.audienceDate}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.formatted}}',
    tagFr: '{{date.<label>.formate}}',
    group: 'keyDates',
    description: 'Dynamic key date (localized format)',
    descriptionFr: 'Date clé dynamique (format local JJ/MM/AAAA)',
    example: '{{dossier.keyDate.audienceDate.formatted}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.long}}',
    tagFr: '{{date.<label>.texte}}',
    group: 'keyDates',
    description: 'Dynamic key date (long text)',
    descriptionFr: 'Date clé dynamique (texte long)',
    example: '{{dossier.keyDate.audienceDate.long}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.short}}',
    tagFr: '{{date.<label>.court}}',
    group: 'keyDates',
    description: 'Dynamic key date (abbreviated text)',
    descriptionFr: 'Date clé dynamique (texte abrégé)',
    example: '{{dossier.keyDate.audienceDate.short}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.label}}',
    tagFr: '{{date.<label>.libelle}}',
    group: 'keyDates',
    description: 'Dynamic key date label',
    descriptionFr: "Libellé de l'événement de chronologie",
    example: '{{dossier.keyDate.audienceDate.label}}'
  },
  {
    tag: '{{dossier.feeAgreement.generatedDocumentFilename}}',
    tagFr: '{{convention.documentGenere}}',
    group: 'feeAgreement',
    description: 'Filename of the document generated from a template for this fee agreement',
    descriptionFr: 'Nom du document généré depuis un modèle pour cette convention',
    example: 'Convention v1 - LASTNAME-A.docx',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.signedDocumentFilename}}',
    tagFr: '{{convention.documentSigne}}',
    group: 'feeAgreement',
    description: 'Filename of the imported signed-scan document linked to this fee agreement',
    descriptionFr: 'Nom du scan signé importé et associé à cette convention',
    example: 'Convention signée - LASTNAME-A.pdf',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.status}}',
    tagFr: '{{convention.statut}}',
    group: 'feeAgreement',
    description: 'Fee agreement status (draft, sent, signed)',
    descriptionFr: 'Statut de la convention (brouillon, envoyée, signée)',
    example: 'signed',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.matterLabel}}',
    tagFr: '{{convention.objet}}',
    group: 'feeAgreement',
    description: 'Matter label',
    descriptionFr: 'Objet de la convention',
    example: 'Défense prud’homale'
  },
  {
    tag: '{{dossier.feeAgreement.scopeDescription}}',
    tagFr: '{{convention.mission}}',
    group: 'feeAgreement',
    description: 'Scope description (mission perimeter)',
    descriptionFr: 'Périmètre de la mission',
    example: 'Assistance et représentation'
  },
  {
    tag: '{{dossier.feeAgreement.billingType}}',
    tagFr: '{{convention.typeFacturation}}',
    group: 'feeAgreement',
    description: 'Billing type (flat, hourly, mixed)',
    descriptionFr: 'Type de facturation (forfait, horaire, mixte)',
    example: 'mixed',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.flatFeeHt}}',
    tagFr: '{{convention.forfait}}',
    group: 'feeAgreement',
    description: 'Flat fee before VAT (formatted EUR)',
    descriptionFr: 'Forfait HT (formaté en EUR)',
    example: '2 400,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.flatFeeTtc}}',
    tagFr: '{{convention.forfaitTtc}}',
    group: 'feeAgreement',
    description: 'Flat fee including VAT (formatted EUR)',
    descriptionFr: 'Forfait TTC (formaté en EUR)',
    example: '2 880,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.hourlyRateHt}}',
    tagFr: '{{convention.tauxHoraire}}',
    group: 'feeAgreement',
    description: 'Hourly rate before VAT (formatted EUR)',
    descriptionFr: 'Taux horaire HT (formaté en EUR)',
    example: '180,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.retainerHt}}',
    tagFr: '{{convention.provision}}',
    group: 'feeAgreement',
    description: 'Retainer before VAT (formatted EUR)',
    descriptionFr: 'Provision HT (formatée en EUR)',
    example: '1 000,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.retainerPaid}}',
    tagFr: '{{convention.provisionVersee}}',
    group: 'feeAgreement',
    description:
      'Retainer paid TTC — sum of TTC for billing items with status "billed" tagged as retainer for this fee agreement',
    descriptionFr:
      'Provision versée TTC — somme TTC des prestations facturées (statut « facturée ») marquées comme provision rattachées à cette convention',
    example: '1 200,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.balanceDue}}',
    tagFr: '{{convention.soldeDu}}',
    group: 'feeAgreement',
    description:
      'Balance due TTC — sum of TTC for draft (not yet billed) billing items attached to this fee agreement (or with no fee agreement link)',
    descriptionFr:
      'Solde dû TTC — somme TTC des prestations à facturer (statut « brouillon ») rattachées à la convention (ou non rattachées)',
    example: '800,00 €'
  },
  {
    tag: '{{dossier.feeAgreement.successFeePercent}}',
    tagFr: '{{convention.honoraireResultat}}',
    group: 'feeAgreement',
    description: 'Success fee percentage',
    descriptionFr: 'Pourcentage des honoraires de résultat',
    example: '10 %'
  },
  {
    tag: '{{dossier.feeAgreement.successFeeClause}}',
    tagFr: '{{convention.clauseResultat}}',
    group: 'feeAgreement',
    description: 'Success fee clause',
    descriptionFr: 'Clause d’honoraires de résultat',
    example: 'Sur les sommes encaissées'
  },
  {
    tag: '{{dossier.feeAgreement.vatRate}}',
    tagFr: '{{convention.tva}}',
    group: 'feeAgreement',
    description: 'VAT rate (formatted %)',
    descriptionFr: 'Taux de TVA (formaté en %)',
    example: '20 %'
  },
  {
    tag: '{{dossier.feeAgreement.paymentTerms}}',
    tagFr: '{{convention.paiement}}',
    group: 'feeAgreement',
    description: 'Payment terms',
    descriptionFr: 'Conditions de paiement',
    example: 'Provision à signature'
  },
  {
    tag: '{{dossier.feeAgreement.expenseTerms}}',
    tagFr: '{{convention.frais}}',
    group: 'feeAgreement',
    description: 'Expense terms',
    descriptionFr: 'Frais et débours',
    example: 'Frais refacturés au réel'
  },
  {
    tag: '{{dossier.feeAgreement.terminationTerms}}',
    tagFr: '{{convention.resiliation}}',
    group: 'feeAgreement',
    description: 'Termination terms',
    descriptionFr: 'Conditions de résiliation',
    example: 'Facturation prorata temporis'
  },
  {
    tag: '{{dossier.feeAgreement.sentAt}}',
    tagFr: '{{convention.dateEnvoi}}',
    group: 'feeAgreement',
    description: 'Sent date (ISO)',
    descriptionFr: 'Date d’envoi (ISO)',
    example: '2026-05-23',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.signedAt}}',
    tagFr: '{{convention.dateSignature}}',
    group: 'feeAgreement',
    description: 'Signed date (ISO)',
    descriptionFr: 'Date de signature (ISO)',
    example: '2026-05-25',
    visibility: 'hidden'
  },
  {
    tag: '{{dossier.feeAgreement.client.displayName}}',
    tagFr: '{{convention.client.nomAffiche}}',
    group: 'feeAgreement',
    description: 'Fee agreement client display name',
    descriptionFr: 'Nom affiché du client de la convention',
    example: 'Mme Person-G LASTNAME-A'
  },
  {
    tag: '{{dossier.feeAgreement.client.salutationFull}}',
    tagFr: '{{convention.client.civiliteNom}}',
    group: 'feeAgreement',
    description: 'Fee agreement client salutation with name',
    descriptionFr: 'Civilité avec nom du client de la convention',
    example: 'Madame LASTNAME-A'
  },
  {
    tag: '{{dossier.feeAgreement.client.dear}}',
    tagFr: '{{convention.client.formuleAppel}}',
    group: 'feeAgreement',
    description: 'Fee agreement client opening formula',
    descriptionFr: "Formule d'appel du client de la convention",
    example: 'Chère Madame'
  },
  {
    tag: '{{dossier.feeAgreement.client.addressFormatted}}',
    tagFr: '{{convention.client.adresseFormatee}}',
    group: 'feeAgreement',
    description: 'Fee agreement client formatted address',
    descriptionFr: 'Adresse formatée du client de la convention',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{dossier.feeAgreement.client.email}}',
    tagFr: '{{convention.client.email}}',
    group: 'feeAgreement',
    description: 'Fee agreement client email',
    descriptionFr: 'Email du client de la convention',
    example: 'client@example.com'
  },
  {
    tag: '{{dossier.feeAgreement.client.phone}}',
    tagFr: '{{convention.client.telephone}}',
    group: 'feeAgreement',
    description: 'Fee agreement client phone',
    descriptionFr: 'Téléphone du client de la convention',
    example: '+33 1 23 45 67 89'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.displayName}}',
    tagFr: '{{convention.signataire.nomAffiche}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory display name',
    descriptionFr: 'Nom affiché du signataire de la convention',
    example: 'Mme Person-G LASTNAME-A'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.salutationFull}}',
    tagFr: '{{convention.signataire.civiliteNom}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory salutation with name',
    descriptionFr: 'Civilité avec nom du signataire de la convention',
    example: 'Madame LASTNAME-A'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.dear}}',
    tagFr: '{{convention.signataire.formuleAppel}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory opening formula',
    descriptionFr: "Formule d'appel du signataire de la convention",
    example: 'Chère Madame'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.addressFormatted}}',
    tagFr: '{{convention.signataire.adresseFormatee}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory formatted address',
    descriptionFr: 'Adresse formatée du signataire de la convention',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.email}}',
    tagFr: '{{convention.signataire.email}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory email',
    descriptionFr: 'Email du signataire de la convention',
    example: 'signataire@example.com'
  },
  {
    tag: '{{dossier.feeAgreement.signatory.phone}}',
    tagFr: '{{convention.signataire.telephone}}',
    group: 'feeAgreement',
    description: 'Fee agreement signatory phone',
    descriptionFr: 'Téléphone du signataire de la convention',
    example: '+33 1 23 45 67 89'
  },
  {
    tag: '{{invoice.number}}',
    tagFr: '{{facture.numero}}',
    group: 'invoice',
    description: 'Invoice number',
    descriptionFr: 'Numéro de facture',
    example: 'F2026-001'
  },
  {
    tag: '{{invoice.issuedAt}}',
    tagFr: '{{facture.dateEmission}}',
    group: 'invoice',
    description: 'Invoice issue date',
    descriptionFr: "Date d'émission de la facture",
    example: '26/05/2026'
  },
  {
    tag: '{{invoice.dueAt}}',
    tagFr: '{{facture.dateEcheance}}',
    group: 'invoice',
    description: 'Invoice due date',
    descriptionFr: "Date d'échéance de la facture",
    example: '25/06/2026'
  },
  {
    tag: '{{invoice.client.displayName}}',
    tagFr: '{{facture.client.nomAffiche}}',
    group: 'invoice',
    description: 'Invoice client name',
    descriptionFr: 'Nom du client facturé',
    example: 'Mme Person-G LASTNAME-A'
  },
  {
    tag: '{{invoice.client.addressFormatted}}',
    tagFr: '{{facture.client.adresseFormatee}}',
    group: 'invoice',
    description: 'Invoice client formatted address',
    descriptionFr: 'Adresse formatée du client facturé',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{invoice.linesTable}}',
    tagFr: '{{facture.tableauPrestations}}',
    group: 'invoice',
    description: 'Complete invoice services table',
    descriptionFr: 'Tableau complet des prestations facturées',
    example: 'Tableau Date / Libellé / Quantité / Prix / Totaux'
  },
  {
    tag: '{{invoice.totalHt}}',
    tagFr: '{{facture.totalHt}}',
    group: 'invoice',
    description: 'Invoice total before VAT',
    descriptionFr: 'Total HT de la facture',
    example: '1 000,00 €'
  },
  {
    tag: '{{invoice.totalVat}}',
    tagFr: '{{facture.totalTva}}',
    group: 'invoice',
    description: 'Invoice VAT total',
    descriptionFr: 'Total TVA de la facture',
    example: '200,00 €'
  },
  {
    tag: '{{invoice.totalTtc}}',
    tagFr: '{{facture.totalTtc}}',
    group: 'invoice',
    description: 'Invoice total including VAT',
    descriptionFr: 'Total TTC de la facture',
    example: '1 200,00 €'
  },
  {
    tag: '{{invoice.paymentTerms}}',
    tagFr: '{{facture.conditionsPaiement}}',
    group: 'invoice',
    description: 'Invoice payment terms',
    descriptionFr: 'Conditions de paiement de la facture',
    example: 'Paiement à réception'
  },
  {
    tag: '{{invoice.issuer.name}}',
    tagFr: '{{facture.emetteur.nom}}',
    group: 'invoice',
    description: 'Invoice issuer name',
    descriptionFr: "Nom de l'émetteur de la facture",
    example: 'Cabinet LASTNAME-E'
  },
  {
    tag: '{{invoice.issuer.legalFooter}}',
    tagFr: '{{facture.emetteur.mentionsLegales}}',
    group: 'invoice',
    description: 'Invoice legal footer',
    descriptionFr: 'Mentions légales de facturation',
    example: 'TVA non applicable...'
  },
  {
    tag: '{{app.content}}',
    group: 'system',
    description: 'App-managed companion text injected into a DOCX template placeholder',
    descriptionFr:
      "Texte compagnon géré dans l'application et injecté dans un emplacement du modèle DOCX",
    example: 'Additional notes written from Ordicab',
    visibility: 'hidden'
  },
  {
    tag: '{{createdAt}}',
    tagFr: '{{creeLe}}',
    group: 'system',
    description: 'Template generation timestamp (ISO)',
    descriptionFr: 'Horodatage de génération du document (ISO)',
    example: '2026-03-15T14:30:00.000Z',
    visibility: 'hidden'
  },
  {
    tag: '{{createdAt.formatted}}',
    tagFr: '{{creeLe.formate}}',
    group: 'system',
    description: 'Template generation date (localized format)',
    descriptionFr: 'Date de génération du document (format local JJ/MM/AAAA)',
    example: '15/03/2026',
    visibility: 'hidden'
  },
  {
    tag: '{{createdAt.long}}',
    tagFr: '{{creeLe.texte}}',
    group: 'system',
    description: 'Template generation date (long text)',
    descriptionFr: 'Date de génération du document (texte long)',
    example: '15 mars 2026',
    visibility: 'hidden'
  },
  {
    tag: '{{createdAt.short}}',
    tagFr: '{{creeLe.court}}',
    group: 'system',
    description: 'Template generation date (abbreviated text)',
    descriptionFr: 'Date de génération du document (texte abrégé)',
    example: '15 mars 26',
    visibility: 'hidden'
  },
  {
    tag: '{{today}}',
    tagFr: '{{aujourdhui}}',
    group: 'system',
    description: 'Current day at generation time (ISO format)',
    descriptionFr: 'Date du jour au moment de la génération (format ISO)',
    example: '2026-03-15',
    visibility: 'hidden'
  },
  {
    tag: '{{todayFormatted}}',
    tagFr: '{{aujourdhuiFormate}}',
    group: 'system',
    description: 'Current day at generation time (localized format)',
    descriptionFr: 'Date du jour au moment de la génération (format local JJ/MM/AAAA)',
    example: '15/03/2026'
  },
  {
    tag: '{{todayLong}}',
    tagFr: '{{aujourdhuiTexte}}',
    group: 'system',
    description: 'Current day at generation time (long text)',
    descriptionFr: 'Date du jour au moment de la génération (texte long)',
    example: '15 mars 2026'
  },
  {
    tag: '{{todayShort}}',
    tagFr: '{{aujourdhuiCourt}}',
    group: 'system',
    description: 'Current day at generation time (abbreviated text)',
    descriptionFr: 'Date du jour au moment de la génération (texte abrégé)',
    example: '15 mars 26'
  },
  {
    tag: '{{date.today}}',
    tagFr: '{{date.today}}',
    group: 'system',
    description: 'Alias of {{today}} (current day, ISO format)',
    descriptionFr: 'Alias de {{aujourdhui}} (date du jour, format ISO)',
    example: '2026-03-15',
    visibility: 'hidden'
  },
  {
    tag: '{{date.todayFr}}',
    tagFr: '{{date.todayFr}}',
    group: 'system',
    description: 'Alias of {{todayFormatted}} (current day, FR format JJ/MM/AAAA)',
    descriptionFr: 'Alias de {{aujourdhuiFormate}} (date du jour, format JJ/MM/AAAA)',
    example: '15/03/2026',
    visibility: 'hidden'
  },
  {
    tag: '{{date.today+N}}',
    tagFr: '{{date.j+N}}',
    group: 'system',
    description:
      'Current day plus N days (computed). Replace N with the offset, e.g. {{date.today+8}} or {{date.today+15}}. Supports .formatted / .long / .short variants.',
    descriptionFr:
      'Jour + N (calculé, notation J+N). Remplacez N par le décalage, ex. {{date.j+8}} ou {{date.j+15}}. Supporte les variantes .formate / .texte / .court via le suffixe.',
    example: '{{date.j+15}} → 11/06/2026'
  },
  {
    tag: '{{todo}}',
    tagFr: '{{aCompleter}}',
    group: 'system',
    description: 'Placeholder for content that must be completed manually or by AI',
    descriptionFr: 'Emplacement à compléter manuellement ou par IA',
    example: '[A completer]'
  }
]

export const templateRoutineCatalog: TemplateRoutineEntry[] = TEMPLATE_ROUTINE_CATALOG_ALL.filter(
  (entry) => entry.visibility !== 'hidden'
)

/**
 * Resolves a human-readable description for each unresolved tag path, using the
 * catalog when available and falling back to a generated label for dynamic paths
 * (keyDate.<label>, contact.<role>.<field>).
 *
 * Always returns French descriptions since Ordicab targets French-speaking users.
 */
export function resolveTagDescriptions(paths: string[]): Record<string, string> {
  // Build a static map from normalized path → descriptionFr (or description)
  const staticMap = new Map<string, string>()
  for (const entry of templateRoutineCatalog) {
    const enPath = entry.tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
    const description = entry.descriptionFr ?? entry.description
    staticMap.set(enPath, description)
    if (entry.tagFr) {
      const frPath = entry.tagFr.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
      staticMap.set(frPath, description)
    }
  }

  const result: Record<string, string> = {}

  for (const path of paths) {
    if (staticMap.has(path)) {
      result[path] = staticMap.get(path)!
      continue
    }

    // Dynamic keyDate: dossier.keyDate.<label> or dossier.keyDate.<label>.formatted|long|short|label
    const keyDateMatch = /^dossier\.keyDate\.([^.]+)(?:\.(formatted|long|short|label))?$/.exec(path)
    if (keyDateMatch) {
      const label = keyDateMatch[1]!
      const variant = keyDateMatch[2]
      const suffix =
        variant === 'formatted'
          ? ' (format JJ/MM/AAAA)'
          : variant === 'long'
            ? ' (texte long)'
            : variant === 'short'
              ? ' (texte abrégé)'
              : variant === 'label'
                ? ' (libellé)'
                : ' (ISO)'
      result[path] = `Date clé « ${label} »${suffix}`
      continue
    }

    // Dynamic contact role: contact.<role>.<field>
    const contactRoleMatch = /^contact\.([^.]+)\.([^.]+)$/.exec(path)
    if (contactRoleMatch) {
      const role = contactRoleMatch[1]!
      const field = contactRoleMatch[2]!
      const fieldDescription = EN_TO_FR_FIELD.get(field) ?? field
      result[path] = `Contact (rôle : ${role}) — ${fieldDescription}`
      continue
    }

    result[path] = path
  }

  return result
}
