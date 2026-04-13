import { getContactManagedFieldValue } from './managedFields'

type ContactWithNameFields = {
  title?: string
  firstName?: string
  lastName?: string
  institution?: string
  customFields?: Record<string, string>
}

/**
 * Compute display name for a contact from its stored fields.
 * This is a derived/computed field and should never be stored.
 */
export function computeContactDisplayName(contact: ContactWithNameFields): string {
  const parts: string[] = []

  if (contact.title) {
    parts.push(contact.title)
  }

  if (contact.firstName) {
    parts.push(contact.firstName)
  }

  const additionalFirstNames = getContactManagedFieldValue(contact, 'additionalFirstNames')
  if (additionalFirstNames) {
    parts.push(additionalFirstNames)
  }

  if (contact.lastName) {
    parts.push(contact.lastName)
  }

  if (contact.institution && parts.length === 0) {
    parts.push(contact.institution)
  }

  return parts.join(' ').trim()
}
