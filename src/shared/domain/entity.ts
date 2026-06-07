import type { EntityManagedFieldsConfig } from '../managedFields'

import type { Gender } from './gender'

export interface EntityProfile {
  firmName: string
  gender?: Gender
  firstName?: string
  lastName?: string
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
  address?: string
  vatNumber?: string
  siren?: string
  siret?: string
  legalForm?: string
  shareCapital?: string
  rcsNumber?: string
  rcsCity?: string
  iban?: string
  bic?: string
  carpaIban?: string
  phone?: string
  email?: string
  barreau?: string
  toque?: string
  defaultTemplateFileName?: string
  defaultTemplateImportedAt?: string
  managedFields?: EntityManagedFieldsConfig
}

export interface EntityProfileDraft extends EntityProfile {}
