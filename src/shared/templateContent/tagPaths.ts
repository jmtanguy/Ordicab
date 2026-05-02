/**
 * Converts a human label to the camelCase key used in template tag paths.
 */
export function labelToKey(label: string): string {
  const ascii = label.normalize('NFD').replace(/\p{Mn}/gu, '')

  const words = ascii
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  if (words.length === 0) return 'value'

  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join('')
}

const SYSTEM_ALIASES: Record<string, string> = {
  aujourdhui: 'today',
  aujourdhuiFormate: 'todayFormatted',
  aujourdhuiTexte: 'todayLong',
  aujourdhuiCourt: 'todayShort',
  creeLe: 'createdAt',
  aCompleter: 'todo'
}

const ROOT_ALIASES: Record<string, string> = {
  entite: 'entity',
  creeLe: 'createdAt'
}

const FIELD_ALIASES: Record<string, Record<string, string>> = {
  dossier: {
    nom: 'name',
    statut: 'status',
    dateCreation: 'createdAt',
    dateCreationFormatee: 'createdAtFormatted',
    dateCreationTexte: 'createdAtLong',
    dateCreationCourte: 'createdAtShort',
    date: 'keyDate',
    dateCle: 'keyDate',
    datesCles: 'keyDate',
    reference: 'keyRef',
    refCle: 'keyRef',
    refsCles: 'keyRef'
  },
  contact: {
    nomAffiche: 'displayName',
    prenom: 'firstName',
    prenoms: 'firstNames',
    prenomsComplementaires: 'additionalFirstNames',
    nom: 'lastName',
    titre: 'title',
    telephone: 'phone',
    ligneAdresse: 'addressLine',
    ligneAdresse2: 'addressLine2',
    complementAdresse: 'addressLine2',
    adresseCompacte: 'addressInline',
    adresseInline: 'addressInline',
    codePostal: 'zipCode',
    ville: 'city',
    pays: 'country',
    dateNaissance: 'dateOfBirth',
    paysNaissance: 'countryOfBirth',
    nationalite: 'nationality',
    profession: 'occupation',
    numeroSecu: 'socialSecurityNumber',
    nomJeuneFille: 'maidenName',
    adresseFormatee: 'addressFormatted',
    civilite: 'salutation',
    civiliteNom: 'salutationFull',
    formuleAppel: 'dear',
    entreprise: 'institution',
    societe: 'institution'
  },
  createdAt: {
    formate: 'formatted',
    texte: 'long',
    court: 'short'
  },
  entity: {
    nomAffiche: 'displayName',
    nomCabinet: 'firmName',
    prenom: 'firstName',
    nom: 'lastName',
    titre: 'title',
    adresse: 'address',
    ligneAdresse: 'addressLine',
    ligneAdresse2: 'addressLine2',
    complementAdresse: 'addressLine2',
    adresseCompacte: 'addressInline',
    adresseInline: 'addressInline',
    codePostal: 'zipCode',
    ville: 'city',
    adresseFormatee: 'addressFormatted',
    telephone: 'phone',
    tva: 'vatNumber',
    numeroTva: 'vatNumber'
  }
}

export function normalizeTagPath(path: string): string {
  const raw = path.trim()
  const segments = raw.split('.')

  if (segments.length === 1) {
    const [seg] = segments as [string]
    return SYSTEM_ALIASES[seg] ?? seg
  }

  const [rootRaw, ...rest] = segments as [string, ...string[]]
  const root = ROOT_ALIASES[rootRaw] ?? rootRaw

  const rootAliases = FIELD_ALIASES[root] ?? {}

  if (rest.length === 1) {
    const [sub] = rest as [string]
    return `${root}.${rootAliases[sub] ?? sub}`
  }

  if (rest.length === 2) {
    const [sub, label] = rest as [string, string]
    const translatedSub = rootAliases[sub] ?? sub

    if (root === 'dossier' && (translatedSub === 'keyDate' || translatedSub === 'keyRef')) {
      return `${root}.${translatedSub}.${labelToKey(label)}`
    }

    if (root === 'contact') {
      const normalizedRole = labelToKey(sub)
      const translatedField = (FIELD_ALIASES.contact ?? {})[label] ?? label
      return `${root}.${normalizedRole}.${translatedField}`
    }

    return `${root}.${translatedSub}.${label}`
  }

  if (rest.length === 3) {
    const [sub, labelRaw, variantRaw] = rest as [string, string, string]
    const translatedSub = rootAliases[sub] ?? sub

    if (root === 'dossier' && (translatedSub === 'keyDate' || translatedSub === 'keyRef')) {
      const variantAliases: Record<string, string> = {
        formate: 'formatted',
        texte: 'long',
        court: 'short',
        abrege: 'short'
      }
      return `${root}.${translatedSub}.${labelToKey(labelRaw)}.${variantAliases[variantRaw] ?? variantRaw}`
    }
  }

  return raw
}

export function extractTagPath(token: string): string {
  return token
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim()
}

export function buildTagToken(path: string): string {
  return `{{${path}}}`
}
