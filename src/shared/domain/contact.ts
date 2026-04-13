import type { ContactManagedFieldValues } from '../managedFields'

/**
 * Canonical contact record returned by contactService.list() and contactService.get().
 * Used widely across the app (intentDispatcher, aiService, PII pseudonymizer, renderer).
 * TODO: rename `dossierId` → `dossierUuid` for consistency with dossier UUIDs.
 *       This is a breaking rename — update all call sites when doing so.
 */
export interface ContactRecord {
  uuid: string
  dossierId: string
  displayName?: string
  title?: string
  firstName?: string
  lastName?: string
  gender?: 'M' | 'F' | 'N'
  role?: string
  institution?: string
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
  phone?: string
  email?: string
  customFields?: ContactManagedFieldValues
  information?: string
}

/**
 * Input shape for contact create/update operations.
 * Differs from ContactRecord: `id` is optional (omit to create, provide to update),
 * and `displayName` is absent (it is computed server-side from firstName + lastName).
 */
export interface ContactUpsertInput {
  id?: string
  dossierId: string
  title?: string
  firstName?: string
  lastName?: string
  gender?: 'M' | 'F' | 'N'
  role?: string
  institution?: string
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  country?: string
  phone?: string
  email?: string
  customFields?: ContactManagedFieldValues
  information?: string
}

/**
 * Input for contact deletion.
 */
export interface ContactDeleteInput {
  dossierId: string
  contactUuid: string
}
