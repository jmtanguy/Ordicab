export const LEGIFRANCE_FOND_VALUES = [
  'ALL',
  'JORF',
  'CNIL',
  'CETAT',
  'JURI',
  'JUFI',
  'CONSTIT',
  'KALI',
  'CODE_DATE',
  'CODE_ETAT',
  'LODA_DATE',
  'LODA_ETAT',
  'CIRC',
  'ACCO'
] as const

export type LegifranceFond = (typeof LEGIFRANCE_FOND_VALUES)[number]

export const LEGIFRANCE_FIELD_VALUES = [
  'ALL',
  'TITLE',
  'TABLE',
  'NOR',
  'NUM',
  'ADVANCED_TEXTE_ID',
  'NUM_DELIB',
  'NUM_DEC',
  'NUM_ARTICLE',
  'ARTICLE',
  'MINISTERE',
  'VISA',
  'NOTICE',
  'VISA_NOTICE',
  'TRAVAUX_PREP',
  'SIGNATURE',
  'NOTA',
  'NUM_AFFAIRE',
  'ABSTRATS',
  'RESUMES',
  'TEXTE',
  'ECLI',
  'NUM_LOI_DEF',
  'TYPE_DECISION',
  'NUMERO_INTERNE',
  'REF_PUBLI',
  'RESUME_CIRC',
  'TEXTE_REF',
  'TITRE_LOI_DEF',
  'RAISON_SOCIALE',
  'MOTS_CLES',
  'IDCC'
] as const

export type LegifranceField = (typeof LEGIFRANCE_FIELD_VALUES)[number]

export const LEGIFRANCE_SEARCH_TYPE_VALUES = [
  'UN_DES_MOTS',
  'EXACTE',
  'TOUS_LES_MOTS_DANS_UN_CHAMP',
  'AUCUN_DES_MOTS',
  'AUCUNE_CORRESPONDANCE_A_CETTE_EXPRESSION'
] as const

export type LegifranceSearchType = (typeof LEGIFRANCE_SEARCH_TYPE_VALUES)[number]

export const LEGIFRANCE_SORT_VALUES = [
  'PERTINENCE',
  'SIGNATURE_DATE_DESC',
  'SIGNATURE_DATE_ASC',
  'DATE_PUBLI_DESC',
  'DATE_PUBLI_ASC',
  'ID_DESC',
  'ID_ASC'
] as const

export type LegifranceSort = (typeof LEGIFRANCE_SORT_VALUES)[number]

export interface LegalSettingsResponse {
  credentials: LegalCredentialStatus
}

export interface LegalCredentialStatus {
  hasClientId: boolean
  clientIdSuffix?: string
  hasClientSecret: boolean
  clientSecretSuffix?: string
}

export interface LegalSettingsSaveInput {
  clientId?: string
  clientSecret?: string
}

export interface LegalConnectionStatusInput {
  clientId?: string
  clientSecret?: string
}

export interface LegalConnectionStatus {
  reachable: boolean
  tokenObtained: boolean
  legifranceReachable?: boolean
  judilibreReachable?: boolean
  error?: string
}

export interface LegifranceSearchInput {
  recherche: string
  fond?: LegifranceFond
  typeChamp?: LegifranceField
  typeRecherche?: LegifranceSearchType
  code?: string
  dateDebut?: string
  dateFin?: string
  page?: number
  pageTaille?: number
  tri?: LegifranceSort
  operateur?: 'ET' | 'OU'
}

export interface LegifranceConsultInput {
  id: string
}

export interface LegalSearchResultItem {
  source: 'legifrance' | 'judilibre'
  id: string
  title: string
  summary?: string
  date?: string
  nature?: string
  jurisdiction?: string
  url?: string
  /** Relevance score returned by the source (Judilibre only; Légifrance does not expose a per-item score). */
  score?: number
  raw?: unknown
}

export interface LegalSearchResponse {
  source: 'legifrance' | 'judilibre'
  total?: number
  page: number
  pageSize: number
  results: LegalSearchResultItem[]
  raw?: unknown
}

export interface LegalConsultResponse {
  source: 'legifrance' | 'judilibre'
  id: string
  title?: string
  text?: string
  date?: string
  url?: string
  raw: unknown
}

export const JUDILIBRE_JURISDICTION_VALUES = ['cc', 'ca', 'tj', 'tcom'] as const
export type JudilibreJurisdiction = (typeof JUDILIBRE_JURISDICTION_VALUES)[number]

export const JUDILIBRE_SORT_VALUES = ['scorepub', 'score', 'date'] as const
export type JudilibreSort = (typeof JUDILIBRE_SORT_VALUES)[number]

export interface JudilibreSearchInput {
  recherche?: string
  juridiction?: JudilibreJurisdiction
  localisation?: string
  chambre?: string
  typeDecision?: string
  theme?: string
  solution?: string
  dateDebut?: string
  dateFin?: string
  tri?: JudilibreSort
  ordre?: 'asc' | 'desc'
  nombreResultats?: number
  page?: number
}

export interface JudilibreConsultInput {
  decisionId: string
}

export interface JudilibreTaxonomyInput {
  taxonomyId?: string
  key?: string
  value?: string
  contextValue?: string
}

export interface LegalReferenceCheckInput {
  text: string
}

export interface LegalReferenceCheckResult {
  references: LegalReferenceCheckItem[]
}

export interface LegalReferenceCheckItem {
  reference: string
  normalizedReference?: string
  status: 'found' | 'ambiguous' | 'not_found' | 'api_error'
  confidence: 'high' | 'medium' | 'low'
  source: 'legifrance' | 'judilibre'
  matches: LegalSearchResultItem[]
  error?: string
}
