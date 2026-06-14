import type { StoredDocumentMetadata } from './document'
import type { DossierBillingItem, DossierFeeAgreement } from './billing'
import type { DossierNote } from './dossierNote'
import type { PieceRecord } from './piece'

type DossierStatusTuple = ['active', 'pending', 'completed', 'archived']

export type DossierStatus = DossierStatusTuple[number]

/** Statut de l'aide juridictionnelle (AJ) sur le dossier. */
export const LEGAL_AID_STATUS_VALUES = ['none', 'requested', 'granted', 'rejected'] as const
export type LegalAidStatus = (typeof LEGAL_AID_STATUS_VALUES)[number]

/** Type d'AJ une fois accordée : totale (prise en charge intégrale par l'État) ou partielle. */
export const LEGAL_AID_TYPE_VALUES = ['total', 'partial'] as const
export type LegalAidType = (typeof LEGAL_AID_TYPE_VALUES)[number]

/**
 * Métadonnées d'aide juridictionnelle attachées à un dossier.
 *
 * Saisie 100 % libre par l'avocat : il renseigne lui-même le statut, le type,
 * le taux (AJ partielle), les références BAJ et les montants (rétribution État
 * et complément). Aucun barème ni auto-calcul.
 */
export interface DossierLegalAid {
  status: LegalAidStatus
  /** Requis lorsque `status === 'granted'`. */
  type?: LegalAidType
  /** Taux d'AJ partielle en points de base (ex. 5500 = 55 %). Requis lorsque `type === 'partial'`. */
  shareBasisPoints?: number
  /** Numéro de la décision du BAJ (bureau d'aide juridictionnelle). */
  bajDecisionNumber?: string
  /** Date de la décision du BAJ (ISO YYYY-MM-DD). */
  bajDecisionDate?: string
  /** BAJ / juridiction de rattachement. */
  bajOffice?: string
  /** Numéro d'AJ / référence CARPA. */
  aidNumber?: string
  /** Rétribution versée par l'État, saisie par l'avocat, en centimes HT. */
  stateRetributionHtCents?: number
  /** Complément d'honoraires (AJ partielle), saisi par l'avocat, en centimes HT. */
  complementHtCents?: number
  /** Garde-fou : passe à true une fois l'orchestration automatique exécutée pour éviter les doublons. */
  autoSetupDone?: boolean
  notes?: string
}

export const KEY_DATE_TAG_VALUES = [
  'cancelled',
  'postponed',
  'urgent',
  'imperative',
  'important',
  'to_confirm',
  'confidential',
  'to_do'
] as const
export type KeyDateTag = (typeof KEY_DATE_TAG_VALUES)[number]

export interface KeyDate {
  uuid: string
  dossierId: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface DossierKeyDateUpsertInput {
  uuid?: string
  dossierId: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface DossierKeyDateDeleteInput {
  dossierId: string
  keyDateUuid: string
}

/**
 * Déplace un événement d'un rattachement à un autre. `null` = « hors dossier »
 * (événement général). Porte aussi les champs édités : un déplacement peut
 * accompagner une modification du libellé, de la date, etc. L'`uuid` est
 * conservé de bout en bout.
 */
export interface KeyDateMoveInput {
  keyDateUuid: string
  fromDossierId: string | null
  toDossierId: string | null
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

/** Événement « hors dossier » : même forme qu'un {@link KeyDate} sans rattachement à un dossier. */
export interface GeneralKeyDate {
  uuid: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface GeneralKeyDateUpsertInput {
  uuid?: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface GeneralKeyDateDeleteInput {
  keyDateUuid: string
}

export interface KeyReference {
  uuid: string
  dossierId: string
  label: string
  value: string
  note?: string
}

/**
 * Reserved label for the auto-injected key reference that holds the dossier name.
 * Editing this entry via the references UI updates `metadata.name`.
 */
export const DOSSIER_NAME_REFERENCE_LABEL = 'Nom du dossier'
export const DOSSIER_STATUS_REFERENCE_LABEL = 'Statut'
export const DOSSIER_TYPE_REFERENCE_LABEL = 'Type'
export const DOSSIER_JURIDICTION_REFERENCE_LABEL = 'Juridiction'
export const DOSSIER_TRIBUNAL_REFERENCE_LABEL = 'Tribunal'
export const DOSSIER_INFORMATION_REFERENCE_LABEL = 'Informations'

export const DOSSIER_REQUIRED_REFERENCE_LABELS = [
  DOSSIER_NAME_REFERENCE_LABEL,
  DOSSIER_STATUS_REFERENCE_LABEL,
  DOSSIER_TYPE_REFERENCE_LABEL,
  DOSSIER_JURIDICTION_REFERENCE_LABEL,
  DOSSIER_TRIBUNAL_REFERENCE_LABEL,
  DOSSIER_INFORMATION_REFERENCE_LABEL
] as const

/**
 * Case-insensitive match used by services and UI to detect the reserved name entry.
 */
export function isDossierNameReferenceLabel(label: string): boolean {
  return (
    label.trim().toLocaleLowerCase('fr-FR') ===
    DOSSIER_NAME_REFERENCE_LABEL.toLocaleLowerCase('fr-FR')
  )
}

export function isDossierRequiredReferenceLabel(label: string): boolean {
  const normalized = label.trim().toLocaleLowerCase('fr-FR')
  return DOSSIER_REQUIRED_REFERENCE_LABELS.some(
    (entry) => entry.toLocaleLowerCase('fr-FR') === normalized
  )
}

export interface DossierKeyReferenceUpsertInput {
  uuid?: string
  dossierId: string
  label: string
  value: string
  note?: string
}

export interface DossierKeyReferenceDeleteInput {
  dossierId: string
  keyReferenceUuid: string
}

export interface DossierRegistrationInput {
  slug: string
}

export interface DossierCreateInput {
  name: string
}

export interface DossierUnregisterInput {
  slug: string
}

export interface DossierEligibleFolder {
  slug: string
  name: string
  path: string
}

export interface DossierScopedQuery {
  dossierId: string
}

export interface DossierUpdateInput {
  slug: string
  status: DossierStatus
  type: string
  information?: string
  juridiction?: string
  tribunal?: string
  legalAid?: DossierLegalAid
}

export interface DossierUpdateLegalAidInput {
  dossierId: string
  legalAid: DossierLegalAid
}

export interface DossierSetupLegalAidInput {
  dossierId: string
  /** Force la régénération même si l'AJ a déjà été configurée. */
  force?: boolean
}

export interface DossierSetupLegalAidResult {
  feeAgreementUuid: string
  billingItemUuids: string[]
  invoiceUuids: string[]
  invoiceNumbers: string[]
  documentUuids: string[]
  keyDateUuids: string[]
  warnings: string[]
}

export interface DossierSummary {
  slug: string
  uuid: string
  name: string
  type: string
  status: DossierStatus
  updatedAt: string
  lastOpenedAt: string | null
  nextUpcomingKeyDate: string | null
  nextUpcomingKeyDateLabel: string | null
}

export interface DossierDetail extends DossierSummary {
  registeredAt: string
  createdAt?: string
  description?: string
  information?: string
  juridiction?: string
  tribunal?: string
  legalAid?: DossierLegalAid
  feeAgreements: DossierFeeAgreement[]
  billingItems: DossierBillingItem[]
  keyDates: KeyDate[]
  keyReferences: KeyReference[]
  notes: DossierNote[]
}

export interface DossierMetadataFile extends DossierDetail {
  documents: StoredDocumentMetadata[]
  pieces: PieceRecord[]
}
