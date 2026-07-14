/**
 * Pure helpers for the document-generation panel.
 *
 * These functions compute display values, parse user-entered dates, and
 * build dropdown options for tag overrides. They have no React state and
 * no DOM dependency, so they can be unit-tested in isolation if needed.
 */
import { buildAddressFields } from '@shared/addressFormatting'
import { buildSalutationFields } from '@shared/contactSalutation'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import { normalizeTagPath } from '@shared/templateContent'
import { toFrenchTagPath } from '@shared/templateRoutines'
import {
  getContactManagedFieldTemplateValues,
  getContactManagedFieldValue,
  getContactManagedFieldValues,
  type ManagedFieldDefinition
} from '@shared/managedFields'
import type { ContactRecord } from '@shared/validation'

import type { ComboOption } from './ComboField'

export function getFilenameFromPath(path: string): string {
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] ?? path
}

/**
 * Parses a user-entered date string to ISO YYYY-MM-DD.
 * Accepts ISO format directly, or DD/MM/YYYY (and variants) for FR locale.
 * Returns null if the input cannot be reliably parsed as a date.
 */
export function parseLocalDateToIso(value: string, locale: string): string | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  if (locale.startsWith('fr')) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v)
    if (m) {
      const [, day, month, yearRaw] = m
      const year = yearRaw?.length === 2 ? `20${yearRaw}` : yearRaw
      const iso = `${year}-${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(new Date(`${iso}T12:00:00`).getTime()))
        return iso
    }
  }
  const d = new Date(v)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function formatIsoDateShort(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(
      new Date(`${iso}T12:00:00`)
    )
  } catch {
    return iso
  }
}

/**
 * Applies a keyDate base path override and auto-derives all formatted variants.
 * If the value is a parseable date (ISO or local format), the .formatted / .long / .short
 * sub-overrides are populated automatically. Otherwise they are cleared.
 */
export function applyKeyDateOverride(
  path: string,
  value: string,
  locale: string,
  current: Record<string, string>
): Record<string, string> {
  // Sibling variant keys are derived in the French form so they line up with
  // the state keys reported by the engine (date.<label>.formate / .texte / .court).
  const canonicalBase = normalizeTagPath(path)
  const variantKey = (variant: string): string => toFrenchTagPath(`${canonicalBase}.${variant}`)
  const updated: Record<string, string> = { ...current, [path]: value }
  const isoDate = parseLocalDateToIso(value, locale)
  if (isoDate) {
    const d = new Date(`${isoDate}T12:00:00`)
    updated[variantKey('formatted')] = d.toLocaleDateString(locale)
    updated[variantKey('long')] = d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
    updated[variantKey('short')] = d.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: '2-digit'
    })
  } else {
    delete updated[variantKey('formatted')]
    delete updated[variantKey('long')]
    delete updated[variantKey('short')]
  }
  return updated
}

export function buildKeyDateOptions(
  detail:
    | {
        keyDates: Array<{ label: string; date: string }>
      }
    | null
    | undefined,
  locale: string
): ComboOption[] {
  return (detail?.keyDates ?? [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((keyDate) => ({
      label: `${keyDate.label} (${formatIsoDateShort(keyDate.date, locale)})`,
      value: keyDate.date
    }))
}

/** Returns all contact field values for a given tag prefix (e.g. "contact" or "contact.client") */
export function contactFieldValues(
  contact: ContactRecord | undefined,
  prefix: string,
  managedFieldDefinitions: ManagedFieldDefinition[]
): Record<string, string> {
  if (!contact) return {}
  const displayName = computeContactDisplayName(contact)
  const firstNames = [
    contact.firstName,
    getContactManagedFieldValue(contact, 'additionalFirstNames')
  ]
    .map((v) => v?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  const fields: Record<string, string | undefined> = {
    displayName,
    title: contact.title,
    firstName: contact.firstName,
    additionalFirstNames: getContactManagedFieldValue(contact, 'additionalFirstNames'),
    firstNames: firstNames || undefined,
    lastName: contact.lastName,
    gender: contact.gender,
    role: contact.role,
    email: contact.email,
    phone: contact.phone,
    institution: contact.institution,
    addressLine: contact.addressLine,
    addressLine2: contact.addressLine2,
    zipCode: contact.zipCode,
    city: contact.city,
    country: contact.country,
    ...getContactManagedFieldValues(contact),
    ...getContactManagedFieldTemplateValues(contact, managedFieldDefinitions),
    ...buildAddressFields(contact),
    ...buildSalutationFields(contact.gender, contact.lastName, displayName)
  }
  const result: Record<string, string> = {}
  for (const [field, val] of Object.entries(fields)) {
    if (val) result[`${prefix}.${field}`] = String(val)
  }
  return result
}
