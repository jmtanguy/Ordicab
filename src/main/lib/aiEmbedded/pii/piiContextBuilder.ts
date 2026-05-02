/**
 * piiContextBuilder — single source of truth for assembling PiiContext from
 * the dossier/contacts/entity/templates/dossiers data already loaded by the
 * caller, plus the AI settings (wordlist) and runtime config (NER model path).
 *
 * Used by:
 *   - aiService (embedded AI assistant pipeline)
 *   - dossierTransferService (AI export of a dossier)
 *
 * Keeping a single builder ensures the export's pseudonymizer has the same
 * allowlist (entity managed fields, template names, current date), wordlist
 * (custom user terms, dossier names, contact custom fields), locale, and NER
 * configuration as the live assistant. Without alignment the export would
 * over-pseudonymize tokens that the assistant treats as safe (and vice versa),
 * which breaks marker reversibility on round-trip.
 */

import type { ContactRecord, DossierDetail, DossierSummary, TemplateRecord } from '@shared/types'
import { getContactManagedFieldValue } from '@shared/managedFields'
import type { EntityProfile } from '@shared/validation/entity'

import { PiiPseudonymizer, type PiiContext } from './piiPseudonymizer'
import type { MappingSnapshotEntry } from './piiMapping'

export interface BuildPiiContextInput {
  contacts: ContactRecord[]
  dossierDetail: DossierDetail | null
  entityProfile: EntityProfile | null
  /** Other dossier names → wordlist (prevents collateral pseudonymization). */
  dossiers: Pick<DossierSummary, 'name'>[]
  /** Template names → allowlist (template labels are part of the document UX). */
  templates: Pick<TemplateRecord, 'name'>[]
  /** User-defined sensitive terms from AI Settings. */
  piiWordlist: string[]
  /** Today's localized date string → allowlist (visible in many prompts). */
  currentDate: string
  locale: 'fr' | 'en'
  /**
   * Absolute path to the bundled NER model directory. When null/undefined the
   * pseudonymizer falls back to regex-only detection.
   */
  nerModelPath: string | null | undefined
  /**
   * Mapping entries accumulated by previous turns of the same conversation.
   * Forwarded to PiiPseudonymizer so the new turn keeps stable fakes for
   * already-known originals and dodges fakes already taken by other originals.
   */
  priorEntries?: MappingSnapshotEntry[]
}

export function buildPiiContext(input: BuildPiiContextInput): PiiContext {
  return {
    // `customFields` is intentionally omitted from contacts: managed-field VALUES
    // can themselves contain PII (SSN, maiden name, occupation), but their LABELS
    // are part of the document structure and are added to the allowlist below.
    contacts: input.contacts.map((c) => ({
      id: c.uuid,
      role: c.role,
      gender: c.gender,
      firstName: c.firstName,
      lastName: c.lastName,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      addressLine: c.addressLine,
      addressLine2: c.addressLine2,
      zipCode: c.zipCode,
      city: c.city,
      institution: c.institution,
      socialSecurityNumber: getContactManagedFieldValue(c, 'socialSecurityNumber'),
      maidenName: getContactManagedFieldValue(c, 'maidenName'),
      occupation: getContactManagedFieldValue(c, 'occupation'),
      information: c.information
    })),
    keyDates:
      input.dossierDetail?.keyDates?.map((kd) => ({
        label: kd.label,
        value: kd.date,
        note: kd.note
      })) ?? [],
    keyRefs:
      input.dossierDetail?.keyReferences?.map((kr) => ({
        label: kr.label,
        value: kr.value,
        note: kr.note
      })) ?? [],
    allowlist: [
      // Structural template keywords. These are reserved words of the Ordicab
      // template macro language (e.g. `dossier.keyDate.audience.long`). If any
      // of them gets pseudonymized — which happens when a user adds "dossier"
      // to their PII wordlist or has a contact custom-field value equal to one
      // of these tokens — the clarification messages emitted by the runtime
      // turn into marker-laden paths the LLM then echoes back as broken
      // `tagOverrides` keys, and document generation fails silently.
      'dossier',
      'contact',
      'entity',
      'template',
      'keyDate',
      'keyRef',
      'today',
      'todayLong',
      'todayShort',
      'todayFormatted',
      'createdAt',
      ...(input.entityProfile?.managedFields?.contactRoles ?? []),
      ...(input.entityProfile?.managedFields?.contacts?.map((field) => field.label) ?? []),
      ...(input.entityProfile?.managedFields?.keyDates?.map((field) => field.label) ?? []),
      ...(input.entityProfile?.managedFields?.keyReferences?.map((field) => field.label) ?? []),
      ...input.templates.map((t) => t.name),
      input.currentDate
    ],
    wordlist: [
      ...input.piiWordlist,
      ...input.dossiers.map((dossier) => dossier.name).filter(Boolean),
      ...input.contacts.flatMap((contact) =>
        Object.values(contact.customFields ?? {}).filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      )
    ],
    locale: input.locale,
    ner: input.nerModelPath ? { enabled: true, modelPath: input.nerModelPath } : undefined,
    priorEntries: input.priorEntries
  }
}

export function buildPiiPseudonymizer(input: BuildPiiContextInput): PiiPseudonymizer {
  return new PiiPseudonymizer(buildPiiContext(input))
}
