import type { EntityManagedFieldsConfig } from '../managedFields'

export interface EntityProfile {
  firmName: string
  profession?: 'lawyer' | 'architect' | 'real_estate' | 'building_trades' | 'consulting_services'
  title?: string
  gender?: 'M' | 'F' | 'N'
  firstName?: string
  lastName?: string
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
  address?: string
  vatNumber?: string
  phone?: string
  email?: string
  managedFields?: EntityManagedFieldsConfig
}

export interface EntityProfileDraft extends EntityProfile {}
