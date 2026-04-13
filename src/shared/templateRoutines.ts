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
    // Dynamic keyDate/keyRef tag: dossier.keyDate.<label> or dossier.keyRef.<label>
    const km = /^dossier\.(keyDate|keyRef)\.(.+)$/.exec(path)
    if (km) {
      const sub = km[1]!
      const label = km[2]!
      const frSub = sub === 'keyDate' ? 'date' : 'reference'
      return isFr ? `dossier.${frSub}.${label}` : `dossier.${sub}.${label}`
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
    return path
  }
}

export const templateRoutineCatalog: TemplateRoutineEntry[] = [
  {
    tag: '{{dossier.name}}',
    tagFr: '{{dossier.nom}}',
    group: 'dossier',
    description: 'Primary dossier title',
    descriptionFr: 'Titre principal du dossier',
    example: 'LASTNAME-A v. Insurance Co.'
  },
  {
    tag: '{{dossier.reference}}',
    group: 'dossier',
    description: 'Main dossier reference',
    descriptionFr: 'Référence principale du dossier',
    example: 'RG 26/001'
  },
  {
    tag: '{{dossier.status}}',
    tagFr: '{{dossier.statut}}',
    group: 'dossier',
    description: 'Current dossier status',
    descriptionFr: 'Statut actuel du dossier',
    example: 'Active'
  },
  {
    tag: '{{dossier.type}}',
    group: 'dossier',
    description: 'Configured dossier type label',
    descriptionFr: 'Libellé du type de dossier',
    example: 'Civil litigation'
  },
  {
    tag: '{{dossier.createdAt}}',
    tagFr: '{{dossier.dateCreation}}',
    group: 'dossier',
    description: 'Dossier registration date (ISO format)',
    descriptionFr: "Date d'enregistrement du dossier (format ISO)",
    example: '2026-03-15'
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
    example: '15 mars 2026'
  },
  {
    tag: '{{dossier.createdAtShort}}',
    tagFr: '{{dossier.dateCreationCourte}}',
    group: 'dossier',
    description: 'Dossier registration date (abbreviated text)',
    descriptionFr: "Date d'enregistrement du dossier (texte abrégé)",
    example: '15 mars 26'
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
    example: 'Person-G Person-F Person-H'
  },
  {
    tag: '{{contact.additionalFirstNames}}',
    tagFr: '{{contact.prenomsComplementaires}}',
    group: 'contact',
    description: 'Primary contact additional civil first names',
    descriptionFr: "Prénoms complémentaires de l'état civil du contact principal",
    subGroup: 'personalInfo',
    example: 'Person-F Person-H'
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
    group: 'contact',
    description: 'Primary contact role',
    descriptionFr: 'Rôle du contact principal',
    subGroup: 'identity',
    example: 'Client'
  },
  {
    tag: '{{contact.email}}',
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
    example: '12 rue des Fleurs'
  },
  {
    tag: '{{contact.addressLine2}}',
    tagFr: '{{contact.ligneAdresse2}}',
    group: 'contact',
    description: 'Primary contact second address line (complement)',
    descriptionFr: "Deuxième ligne d'adresse du contact principal (complément)",
    subGroup: 'address',
    example: 'Appt 3'
  },
  {
    tag: '{{contact.zipCode}}',
    tagFr: '{{contact.codePostal}}',
    group: 'contact',
    description: 'Primary contact postal code',
    descriptionFr: 'Code postal du contact principal',
    subGroup: 'address',
    example: '75008'
  },
  {
    tag: '{{contact.city}}',
    tagFr: '{{contact.ville}}',
    group: 'contact',
    description: 'Primary contact city',
    descriptionFr: 'Ville du contact principal',
    subGroup: 'address',
    example: 'Paris'
  },
  {
    tag: '{{contact.country}}',
    tagFr: '{{contact.pays}}',
    group: 'contact',
    description: 'Primary contact country',
    descriptionFr: 'Pays du contact principal',
    subGroup: 'address',
    example: 'France'
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
    example: '12 rue des Fleurs, 75008 Paris'
  },
  {
    tag: '{{contact.salutation}}',
    tagFr: '{{contact.civilite}}',
    group: 'contact',
    description: 'Salutation (Madame / Monsieur)',
    descriptionFr: 'Civilité (Madame / Monsieur)',
    subGroup: 'salutation',
    example: 'Madame'
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
  {
    tag: '{{entity.displayName}}',
    tagFr: '{{entity.nomAffiche}}',
    group: 'entity',
    description: 'Full entity contact name (title + first name + last name)',
    descriptionFr: 'Nom affiché du cabinet (titre + prénom + nom)',
    example: 'Me Person-C LASTNAME-E'
  },
  {
    tag: '{{entity.firmName}}',
    tagFr: '{{entity.nomCabinet}}',
    group: 'entity',
    description: 'Saved firm name',
    descriptionFr: 'Nom du cabinet enregistré',
    example: 'Cabinet LASTNAME-E'
  },
  {
    tag: '{{entity.title}}',
    tagFr: '{{entity.titre}}',
    group: 'entity',
    description: 'Firm contact title',
    descriptionFr: 'Titre du contact du cabinet',
    example: 'Me'
  },
  {
    tag: '{{entity.firstName}}',
    tagFr: '{{entity.prenom}}',
    group: 'entity',
    description: 'Firm contact first name',
    descriptionFr: 'Prénom du contact du cabinet',
    example: 'Person-C'
  },
  {
    tag: '{{entity.lastName}}',
    tagFr: '{{entity.nom}}',
    group: 'entity',
    description: 'Firm contact last name',
    descriptionFr: 'Nom de famille du contact du cabinet',
    example: 'LASTNAME-E'
  },
  {
    tag: '{{entity.address}}',
    tagFr: '{{entity.adresse}}',
    group: 'entity',
    description: 'Saved firm raw address (free-text)',
    descriptionFr: 'Adresse brute du cabinet (texte libre)',
    subGroup: 'address',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{entity.addressLine}}',
    tagFr: '{{entity.ligneAdresse}}',
    group: 'entity',
    description: 'Firm first address line (street)',
    descriptionFr: "Première ligne d'adresse du cabinet (rue)",
    subGroup: 'address',
    example: '12 rue des Fleurs'
  },
  {
    tag: '{{entity.addressLine2}}',
    tagFr: '{{entity.ligneAdresse2}}',
    group: 'entity',
    description: 'Firm second address line (complement)',
    descriptionFr: "Deuxième ligne d'adresse du cabinet (complément)",
    subGroup: 'address',
    example: 'Bâtiment B'
  },
  {
    tag: '{{entity.zipCode}}',
    tagFr: '{{entity.codePostal}}',
    group: 'entity',
    description: 'Firm postal code',
    descriptionFr: 'Code postal du cabinet',
    subGroup: 'address',
    example: '75008'
  },
  {
    tag: '{{entity.city}}',
    tagFr: '{{entity.ville}}',
    group: 'entity',
    description: 'Firm city',
    descriptionFr: 'Ville du cabinet',
    subGroup: 'address',
    example: 'Paris'
  },
  {
    tag: '{{entity.addressFormatted}}',
    tagFr: '{{entity.adresseFormatee}}',
    group: 'entity',
    description: 'Firm formatted address (multi-line: street then zip + city)',
    descriptionFr: 'Adresse formatée du cabinet (multi-ligne : rue puis code postal + ville)',
    subGroup: 'address',
    example: '12 rue des Fleurs\n75008 Paris'
  },
  {
    tag: '{{entity.addressInline}}',
    tagFr: '{{entity.adresseCompacte}}',
    group: 'entity',
    description: 'Firm address on one line (comma-separated)',
    descriptionFr: 'Adresse du cabinet sur une ligne (séparée par des virgules)',
    subGroup: 'address',
    example: '12 rue des Fleurs, 75008 Paris'
  },
  {
    tag: '{{entity.vatNumber}}',
    tagFr: '{{entity.tva}}',
    group: 'entity',
    description: 'Saved firm VAT number',
    descriptionFr: 'Numéro de TVA du cabinet',
    example: 'FR12345678901'
  },
  {
    tag: '{{entity.phone}}',
    tagFr: '{{entity.telephone}}',
    group: 'entity',
    description: 'Saved firm phone number',
    descriptionFr: 'Numéro de téléphone du cabinet',
    example: '+33 1 98 76 54 32'
  },
  {
    tag: '{{entity.email}}',
    group: 'entity',
    description: 'Saved firm email address',
    descriptionFr: 'Adresse e-mail du cabinet',
    example: 'contact@cabinet-LASTNAME-E.fr'
  },
  {
    tag: '{{dossier.keyDate.<label>}}',
    tagFr: '{{dossier.date.<label>}}',
    group: 'keyDates',
    description:
      'Dynamic key date (ISO) - replace <label> with the canonical key derived from the date label',
    descriptionFr: 'Date clé dynamique (ISO) — remplacez <label> par la clé dérivée du libellé',
    example: '{{dossier.keyDate.audienceDate}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.formatted}}',
    tagFr: '{{dossier.date.<label>.formate}}',
    group: 'keyDates',
    description: 'Dynamic key date (localized format)',
    descriptionFr: 'Date clé dynamique (format local JJ/MM/AAAA)',
    example: '{{dossier.keyDate.audienceDate.formatted}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.long}}',
    tagFr: '{{dossier.date.<label>.texte}}',
    group: 'keyDates',
    description: 'Dynamic key date (long text)',
    descriptionFr: 'Date clé dynamique (texte long)',
    example: '{{dossier.keyDate.audienceDate.long}}'
  },
  {
    tag: '{{dossier.keyDate.<label>.short}}',
    tagFr: '{{dossier.date.<label>.court}}',
    group: 'keyDates',
    description: 'Dynamic key date (abbreviated text)',
    descriptionFr: 'Date clé dynamique (texte abrégé)',
    example: '{{dossier.keyDate.audienceDate.short}}'
  },
  {
    tag: '{{dossier.keyRef.<label>}}',
    tagFr: '{{dossier.reference.<label>}}',
    group: 'keyRefs',
    description: 'Dynamic key reference',
    descriptionFr: 'Référence clé dynamique',
    example: '{{dossier.keyRef.caseNumber}}'
  },
  {
    tag: '{{app.content}}',
    group: 'system',
    description: 'App-managed companion text injected into a DOCX template placeholder',
    descriptionFr:
      "Texte compagnon géré dans l'application et injecté dans un emplacement du modèle DOCX",
    example: 'Additional notes written from Ordicab'
  },
  {
    tag: '{{createdAt}}',
    tagFr: '{{creeLe}}',
    group: 'system',
    description: 'Template generation timestamp (ISO)',
    descriptionFr: 'Horodatage de génération du document (ISO)',
    example: '2026-03-15T14:30:00.000Z'
  },
  {
    tag: '{{createdAt.formatted}}',
    tagFr: '{{creeLe.formate}}',
    group: 'system',
    description: 'Template generation date (localized format)',
    descriptionFr: 'Date de génération du document (format local JJ/MM/AAAA)',
    example: '15/03/2026'
  },
  {
    tag: '{{createdAt.long}}',
    tagFr: '{{creeLe.texte}}',
    group: 'system',
    description: 'Template generation date (long text)',
    descriptionFr: 'Date de génération du document (texte long)',
    example: '15 mars 2026'
  },
  {
    tag: '{{createdAt.short}}',
    tagFr: '{{creeLe.court}}',
    group: 'system',
    description: 'Template generation date (abbreviated text)',
    descriptionFr: 'Date de génération du document (texte abrégé)',
    example: '15 mars 26'
  },
  {
    tag: '{{today}}',
    tagFr: '{{aujourdhui}}',
    group: 'system',
    description: 'Current day at generation time (ISO format)',
    descriptionFr: 'Date du jour au moment de la génération (format ISO)',
    example: '2026-03-15'
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
    tag: '{{todo}}',
    tagFr: '{{aCompleter}}',
    group: 'system',
    description: 'Placeholder for content that must be completed manually or by AI',
    descriptionFr: 'Emplacement à compléter manuellement ou par IA',
    example: '[A completer]'
  }
]

/**
 * Resolves a human-readable description for each unresolved tag path, using the
 * catalog when available and falling back to a generated label for dynamic paths
 * (keyDate.<label>, keyRef.<label>, contact.<role>.<field>).
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

    // Dynamic keyDate: dossier.keyDate.<label> or dossier.keyDate.<label>.formatted|long|short
    const keyDateMatch = /^dossier\.keyDate\.([^.]+)(?:\.(formatted|long|short))?$/.exec(path)
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
              : ' (ISO)'
      result[path] = `Date clé « ${label} »${suffix}`
      continue
    }

    // Dynamic keyRef: dossier.keyRef.<label>
    const keyRefMatch = /^dossier\.keyRef\.([^.]+)$/.exec(path)
    if (keyRefMatch) {
      result[path] = `Référence clé « ${keyRefMatch[1]} »`
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
