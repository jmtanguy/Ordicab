/**
 * Pure helpers for the tag-filling step shared between GenerateDocumentPanel
 * and InvoiceCreationDialog.
 */
import { templateRoutineCatalog } from '@shared/templateRoutines'
import type { EntityManagedFieldsConfig } from '@shared/managedFields'
import type { ContactRecord } from '@shared/validation'

import { contactFieldValues } from './tagValueHelpers'

export type TagProvenance =
  | 'contact'
  | 'dossier'
  | 'entity'
  | 'invoice'
  | 'system'
  | 'memorized'
  | 'empty'

/**
 * Determines where each pre-filled value comes from, for the provenance badges
 * of the tag-filling step. Priority: context-resolved > contact hydration >
 * memorized manual value > empty.
 */
export function computeTagProvenance(
  tagPaths: string[],
  resolvedTags: Record<string, string>,
  hydratedValues: Record<string, string>,
  memorizedOverrides: Record<string, string> | undefined
): Record<string, TagProvenance> {
  const provenance: Record<string, TagProvenance> = {}
  for (const path of tagPaths) {
    const root = path.split('.')[0]
    if ((resolvedTags[path] ?? '').trim() !== '') {
      provenance[path] =
        root === 'contact' || root === 'dossier' || root === 'entity' || root === 'invoice'
          ? root
          : 'system'
    } else if ((hydratedValues[path] ?? '').trim() !== '') {
      provenance[path] = 'contact'
    } else if ((memorizedOverrides?.[path] ?? '').trim() !== '') {
      provenance[path] = 'memorized'
    } else {
      provenance[path] = 'empty'
    }
  }
  return provenance
}

/** Fills still-empty fields with memorized manual values — live data always wins. */
export function mergeMemorizedOverrides(
  values: Record<string, string>,
  memorizedOverrides: Record<string, string> | undefined
): Record<string, string> {
  if (!memorizedOverrides) return values
  const next = { ...values }
  for (const [path, value] of Object.entries(memorizedOverrides)) {
    if (path in next && (next[path] ?? '').trim() === '' && value) {
      next[path] = value
    }
  }
  return next
}

export interface CategorizedTagPaths {
  primaryTagPaths: string[]
  roleTagGroups: Record<string, string[]>
  keyDatePaths: string[]
  invoicePaths: string[]
  otherNonAddressPaths: string[]
  otherAddressPaths: string[]
}

export function categorizeTagPaths(tagPaths: string[]): CategorizedTagPaths {
  const primaryTagPaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return s[0] === 'contact' && s.length === 2
  })

  const roleTagGroups: Record<string, string[]> = {}
  for (const p of tagPaths) {
    const s = p.split('.')
    if (s[0] === 'contact' && s.length === 3) {
      const roleKey = s[1] as string
      ;(roleTagGroups[roleKey] ??= []).push(p)
    }
  }

  const keyDateBasePaths = tagPaths.filter((p) => {
    const s = p.split('.')
    return s[0] === 'dossier' && s[1] === 'keyDate' && s.length === 3
  })
  const variantOnlyBasePaths = tagPaths
    .filter((p) => {
      const s = p.split('.')
      return s[0] === 'dossier' && s[1] === 'keyDate' && s.length === 4
    })
    .map((p) => p.split('.').slice(0, 3).join('.'))
    .filter((bp) => !keyDateBasePaths.includes(bp))
  const keyDatePaths = [...new Set([...keyDateBasePaths, ...variantOnlyBasePaths])]

  const invoicePaths = tagPaths.filter((p) => p.split('.')[0] === 'invoice')

  const otherTagPaths = tagPaths.filter((p) => {
    const s = p.split('.')
    if (s[0] === 'contact') return false
    if (s[0] === 'dossier' && s[1] === 'keyDate') return false
    if (s[0] === 'invoice') return false
    return true
  })

  const otherAddressPaths = otherTagPaths.filter((p) => {
    const entry = templateRoutineCatalog.find(
      (e) =>
        e.tag.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '') === p ||
        e.tagFr?.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '') === p
    )
    return entry?.subGroup === 'address'
  })
  const otherNonAddressPaths = otherTagPaths.filter((p) => !otherAddressPaths.includes(p))

  return {
    primaryTagPaths,
    roleTagGroups,
    keyDatePaths,
    invoicePaths,
    otherNonAddressPaths,
    otherAddressPaths
  }
}

export function applyPrimaryContact(
  contactUuid: string,
  currentTagValues: Record<string, string>,
  contacts: ContactRecord[],
  managedFieldsConfig: EntityManagedFieldsConfig
): Record<string, string> {
  const contact = contacts.find((c) => c.uuid === contactUuid)
  const fields = contactFieldValues(contact, 'contact', managedFieldsConfig.contacts)
  const next = { ...currentTagValues }
  for (const path of Object.keys(next)) {
    const parts = path.split('.')
    if (parts[0] === 'contact' && parts.length === 2) {
      next[path] = fields[path] ?? ''
    }
  }
  return next
}

export function applyRoleContact(
  roleKey: string,
  contactUuid: string,
  currentTagValues: Record<string, string>,
  contacts: ContactRecord[],
  managedFieldsConfig: EntityManagedFieldsConfig
): Record<string, string> {
  const contact = contacts.find((c) => c.uuid === contactUuid)
  const fields = contactFieldValues(contact, `contact.${roleKey}`, managedFieldsConfig.contacts)
  const next = { ...currentTagValues }
  for (const path of Object.keys(next)) {
    const parts = path.split('.')
    if (parts[0] === 'contact' && parts[1] === roleKey && parts.length === 3) {
      next[path] = fields[path] ?? ''
    }
  }
  return next
}

export function hydrateAutoSelectedContactTags(
  initialTagValues: Record<string, string>,
  initialPrimaryContactId: string,
  initialRoleContactIds: Record<string, string>,
  contacts: ContactRecord[],
  managedFieldsConfig: EntityManagedFieldsConfig
): Record<string, string> {
  let next = { ...initialTagValues }
  if (initialPrimaryContactId) {
    next = applyPrimaryContact(initialPrimaryContactId, next, contacts, managedFieldsConfig)
  }
  for (const [roleKey, contactUuid] of Object.entries(initialRoleContactIds)) {
    if (contactUuid) {
      next = applyRoleContact(roleKey, contactUuid, next, contacts, managedFieldsConfig)
    }
  }
  return next
}
