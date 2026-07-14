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
  cabinet: 'entity',
  creeLe: 'createdAt',
  facture: 'invoice'
}

const FIELD_ALIASES: Record<string, Record<string, string>> = {
  dossier: {
    nom: 'name',
    convention: 'feeAgreement',
    dateCreation: 'createdAt',
    dateCreationFormatee: 'createdAtFormatted',
    dateCreationTexte: 'createdAtLong',
    dateCreationCourte: 'createdAtShort',
    libelle: 'label'
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
  feeAgreement: {
    statut: 'status',
    objet: 'matterLabel',
    matiere: 'matterLabel',
    mission: 'scopeDescription',
    perimetre: 'scopeDescription',
    typeFacturation: 'billingType',
    sourcePrestation: 'sourceServicePresetUuid',
    forfait: 'flatFeeHt',
    forfaitTtc: 'flatFeeTtc',
    tauxHoraire: 'hourlyRateHt',
    tauxHoraireTtc: 'hourlyRateTtc',
    heuresEstimees: 'estimatedHours',
    provision: 'retainerHt',
    provisionTtc: 'retainerTtc',
    honoraireResultat: 'successFeePercent',
    clauseResultat: 'successFeeClause',
    tva: 'vatRate',
    paiement: 'paymentTerms',
    frais: 'expenseTerms',
    resiliation: 'terminationTerms',
    dateEnvoi: 'sentAt',
    dateSignature: 'signedAt',
    note: 'notes',
    client: 'client',
    signataire: 'signatory',
    documentGenere: 'generatedDocumentFilename',
    documentSigne: 'signedDocumentFilename'
  },
  invoice: {
    typeDocument: 'documentTypeLabel',
    typeDocumentCode: 'documentType',
    numero: 'number',
    dateEmission: 'issuedAt',
    dateEcheance: 'dueAt',
    conditionsPaiement: 'paymentTerms',
    motifCorrection: 'correctionReason',
    facturesOrigine: 'originalInvoiceNumbers',
    notes: 'notes',
    totalHt: 'totalHt',
    totalTva: 'totalVat',
    totalTtc: 'totalTtc',
    lignes: 'lines',
    tableauPrestations: 'linesTable',
    client: 'client',
    emetteur: 'issuer'
  },
  invoiceClient: {
    nomAffiche: 'displayName',
    adresse: 'address'
  },
  invoiceIssuer: {
    nom: 'name',
    adresse: 'address',
    siret: 'siret',
    tva: 'vatNumber',
    numeroTva: 'vatNumber',
    iban: 'iban',
    mentionsLegales: 'legalFooter'
  },
  invoiceLine: {
    libelle: 'label',
    quantite: 'quantity',
    unite: 'quantityUnit',
    prixUnitaireHt: 'unitPriceHt',
    sousTotalHt: 'subtotalHt',
    remiseHt: 'discountHt',
    tva: 'vatRate'
  },
  entity: {
    nomAffiche: 'displayName',
    nomCabinet: 'firmName',
    prenom: 'firstName',
    nom: 'lastName',
    titre: 'title',
    titreLong: 'titleLong',
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
    numeroTva: 'vatNumber',
    siren: 'siren',
    siret: 'siret',
    formeJuridique: 'legalForm',
    capitalSocial: 'shareCapital',
    numeroRcs: 'rcsNumber',
    rcs: 'rcsNumber',
    villeGreffe: 'rcsCity',
    greffe: 'rcsCity',
    iban: 'iban',
    bic: 'bic',
    ibanCarpa: 'carpaIban',
    carpa: 'carpaIban'
  }
}

const DATE_OFFSET_FR_VARIANT_ALIASES: Record<string, string> = {
  formate: 'formatted',
  texte: 'long',
  court: 'short',
  abrege: 'short'
}

const KEY_DATE_FR_VARIANT_ALIASES: Record<string, string> = {
  formate: 'formatted',
  texte: 'long',
  court: 'short',
  abrege: 'short',
  libelle: 'label'
}

// System-reserved sub-keys under `date.*` that must not be treated as chronology
// labels (they point to live values in the template context, or are placeholder
// variants displayed by the template authoring wizard before a label is chosen).
const SYSTEM_DATE_KEYS = new Set([
  'today',
  'todayFr',
  'todayLong',
  'todayShort',
  // Placeholder variants surfaced as default buttons in TagReferencePanel; they
  // mean "any chronology date, <variant>" and are expected to be augmented with
  // a label segment (`date.<label>.<variant>`) by the template author.
  'formate',
  'texte',
  'court',
  'libelle',
  'abrege'
])
const DATE_OFFSET_SUB_PATTERN = /^(?:today|j)\+\d+$/

// Translate the French alias for {{date.today+N}} ("J+N" shorthand) into its
// canonical English form so downstream resolvers (DATE_OFFSET_PATTERN in
// generateService) keep a single source of truth.
function preNormalizeDateOffset(path: string): string {
  const match = /^date\.j\+(\d+)(?:\.([a-z]+))?$/.exec(path)
  if (!match) return path
  const days = match[1]!
  const variant = match[2]
  if (!variant) return `date.today+${days}`
  const englishVariant = DATE_OFFSET_FR_VARIANT_ALIASES[variant] ?? variant
  return `date.today+${days}.${englishVariant}`
}

// Chronology FR alias: `date.<label>(.<variant>)?` → `dossier.keyDate.<labelKey>(.<englishVariant>)?`
// Also accepts the hand-authored hybrid `dossier.date.<label>…` (FR alias with
// the canonical `dossier.` prefix), a frequent mistake in Word templates.
// Skips reserved system date keys (today, todayFr…) and the offset patterns,
// which keep their literal form so they resolve through the context (or the
// regex in resolvePath for today+N).
function preNormalizeChronologyDate(path: string): string {
  const match = /^(?:dossier\.)?date\.([^.]+)(?:\.([a-z]+))?$/.exec(path)
  if (!match) return path
  const sub = match[1]!
  if (SYSTEM_DATE_KEYS.has(sub) || DATE_OFFSET_SUB_PATTERN.test(sub)) return path
  const variant = match[2]
  const labelKey = labelToKey(sub)
  if (!variant) return `dossier.keyDate.${labelKey}`
  const englishVariant = KEY_DATE_FR_VARIANT_ALIASES[variant] ?? variant
  return `dossier.keyDate.${labelKey}.${englishVariant}`
}

export function normalizeTagPath(path: string): string {
  const raw = preNormalizeChronologyDate(preNormalizeDateOffset(path.trim()))
  const segments = raw.split('.')

  if (segments.length === 1) {
    const [seg] = segments as [string]
    return SYSTEM_ALIASES[seg] ?? seg
  }

  const [rootRaw, ...rest] = segments as [string, ...string[]]

  if (rootRaw === 'feeAgreement' || rootRaw === 'convention') {
    return normalizeTagPath(`dossier.${raw}`)
  }

  const root = ROOT_ALIASES[rootRaw] ?? rootRaw

  const rootAliases = FIELD_ALIASES[root] ?? {}

  if (rest.length === 1) {
    const [sub] = rest as [string]
    return `${root}.${rootAliases[sub] ?? sub}`
  }

  if (rest.length === 2) {
    const [sub, label] = rest as [string, string]
    const translatedSub = rootAliases[sub] ?? sub

    if (root === 'dossier' && translatedSub === 'keyDate') {
      return `${root}.${translatedSub}.${labelToKey(label)}`
    }

    if (root === 'dossier' && translatedSub === 'feeAgreement') {
      const feeAgreementAliases = FIELD_ALIASES.feeAgreement ?? {}
      return `${root}.${translatedSub}.${feeAgreementAliases[label] ?? label}`
    }

    if (root === 'contact') {
      const normalizedRole = labelToKey(sub)
      const translatedField = (FIELD_ALIASES.contact ?? {})[label] ?? label
      return `${root}.${normalizedRole}.${translatedField}`
    }

    if (root === 'invoice') {
      if (translatedSub === 'client' || translatedSub === 'issuer') {
        const partyAliases =
          (translatedSub === 'client'
            ? FIELD_ALIASES.invoiceClient
            : FIELD_ALIASES.invoiceIssuer) ?? {}
        return `${root}.${translatedSub}.${partyAliases[label] ?? label}`
      }

      if (translatedSub === 'issuedAt') {
        const variantAliases: Record<string, string> = {
          formate: 'formatted',
          texte: 'long',
          court: 'short',
          abrege: 'short'
        }
        return `${root}.${translatedSub}.${variantAliases[label] ?? label}`
      }
    }

    return `${root}.${translatedSub}.${label}`
  }

  if (rest.length === 3) {
    const [sub, labelRaw, variantRaw] = rest as [string, string, string]
    const translatedSub = rootAliases[sub] ?? sub

    if (root === 'dossier' && translatedSub === 'keyDate') {
      const variantAliases: Record<string, string> = {
        formate: 'formatted',
        texte: 'long',
        court: 'short',
        abrege: 'short',
        libelle: 'label'
      }
      return `${root}.${translatedSub}.${labelToKey(labelRaw)}.${variantAliases[variantRaw] ?? variantRaw}`
    }

    if (root === 'dossier' && translatedSub === 'feeAgreement') {
      const feeAgreementAliases = FIELD_ALIASES.feeAgreement ?? {}
      const translatedLabel = feeAgreementAliases[labelRaw] ?? labelRaw
      const contactFieldAliases = FIELD_ALIASES.contact ?? {}
      const variantAliases: Record<string, string> = {
        formate: 'formatted',
        texte: 'long',
        court: 'short',
        abrege: 'short'
      }

      if (translatedLabel === 'client' || translatedLabel === 'signatory') {
        return `${root}.${translatedSub}.${translatedLabel}.${contactFieldAliases[variantRaw] ?? variantRaw}`
      }

      if (translatedLabel === 'sentAt' || translatedLabel === 'signedAt') {
        return `${root}.${translatedSub}.${translatedLabel}.${variantAliases[variantRaw] ?? variantRaw}`
      }
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

export function shouldExposeTemplateTagPath(path: string): boolean {
  const trimmed = extractTagPath(path).trim()
  if (!trimmed) return false
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('app.')
  ) {
    return false
  }

  const normalized = normalizeTagPath(trimmed)
  return !(
    normalized.startsWith('dossier.reference.') ||
    normalized.startsWith('dossier.keyRef.') ||
    normalized.startsWith('dossier.prestation.') ||
    normalized.startsWith('dossier.billingItem.') ||
    normalized === 'dossier.billingItems' ||
    normalized.startsWith('dossier.billingItems.') ||
    normalized === 'dossier.billingTotals' ||
    normalized.startsWith('dossier.billingTotals.')
  )
}

export function buildTagToken(path: string): string {
  return `{{${path}}}`
}
