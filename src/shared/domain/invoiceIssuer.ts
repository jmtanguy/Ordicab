import { buildAddressFields } from '../addressFormatting'

import type { EntityProfile } from './entity'
import type { InvoicePartySnapshot, InvoiceSettings } from './invoice'

function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Resolves the invoice "issuer" identity from the Cabinet entity profile — the single
 * source of truth for the firm's name, registration numbers, IBAN and address.
 *
 * Invoice-specific fields that have no entity equivalent (the legal footer) keep coming
 * from {@link InvoiceSettings}.
 */
export function entityToInvoiceIssuer(
  profile: EntityProfile | null | undefined,
  settings: Pick<InvoiceSettings, 'legalFooter'>
): InvoicePartySnapshot {
  const fullName = profile
    ? trimToUndefined([profile.firstName, profile.lastName].filter(Boolean).join(' '))
    : undefined
  const name = trimToUndefined(profile?.firmName) ?? fullName

  const structuredAddress = profile
    ? trimToUndefined(buildAddressFields(profile).addressFormatted)
    : undefined
  const address = structuredAddress ?? trimToUndefined(profile?.address)

  return {
    name,
    address,
    siret: trimToUndefined(profile?.siret),
    vatNumber: trimToUndefined(profile?.vatNumber),
    iban: trimToUndefined(profile?.iban),
    legalFooter: trimToUndefined(settings.legalFooter)
  }
}
