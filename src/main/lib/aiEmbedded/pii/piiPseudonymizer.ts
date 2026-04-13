/**
 * piiPseudonymizer — orchestrates PII detection and replacement.
 *
 * Usage:
 *   const p = new PiiPseudonymizer(context)   // pre-seeds from known contacts/dates/refs
 *   const safe = p.pseudonymize(userText)      // → text with [[markers]]
 *   const original = p.revert(llmResponse)     // → restored text
 *
 * JSON-aware: pseudonymizeAuto() parses JSON and only touches string values, not keys.
 *
 * Marker format: [[contact.client.firstName]] `Antoine`
 *   - [[...]] path follows template macro conventions
 *   - `fakeValue` lets the LLM use a realistic value in prose while the marker ensures reversal
 */

import { labelToKey } from '@shared/templateContent/tagPaths'
import { PiiMapping, MARKER_RE, type MappingSnapshotEntry } from './piiMapping'
import { detectPii } from './piiDetector'
import * as fake from './fakegen'
import type { Locale, Gender } from './fakegen'
import { buildDiacriticInsensitivePattern } from './textMatching'

export interface PiiContact {
  id: string
  role?: string
  gender?: 'M' | 'F' | 'N'
  firstName?: string
  lastName?: string
  displayName?: string
  email?: string
  phone?: string
  addressLine?: string
  addressLine2?: string
  zipCode?: string
  city?: string
  institution?: string
  socialSecurityNumber?: string
  maidenName?: string
  occupation?: string
  information?: string
}

export interface PiiContext {
  contacts?: PiiContact[]
  keyDates?: Array<{ label: string; value: string; note?: string }>
  keyRefs?: Array<{ label: string; value: string; note?: string }>
  wordlist?: string[]
  allowlist?: string[]
  locale?: Locale
}

type ContactFieldDef = {
  field: keyof PiiContact
  markerSuffix: string
  generate: (value: string, contact: PiiContact, locale: Locale) => string
}

function genderForFake(g?: 'M' | 'F' | 'N'): Gender {
  if (g === 'M') return 'M'
  if (g === 'F') return 'F'
  return null
}

const CONTACT_PII_FIELDS: ContactFieldDef[] = [
  {
    field: 'firstName',
    markerSuffix: 'firstName',
    generate: (v, c, l) => fake.fakeFirstName(v, l, genderForFake(c.gender) ?? fake.inferGender(v))
  },
  { field: 'lastName', markerSuffix: 'lastName', generate: (v, _, l) => fake.fakeLastName(v, l) },
  {
    field: 'maidenName',
    markerSuffix: 'maidenName',
    generate: (v, _, l) => fake.fakeLastName(v, l)
  },
  { field: 'email', markerSuffix: 'email', generate: (v, _, l) => fake.fakeEmail(v, l) },
  { field: 'phone', markerSuffix: 'phone', generate: (v) => fake.fakePhone(v) },
  {
    field: 'addressLine',
    markerSuffix: 'addressLine',
    generate: (v, _, l) => fake.fakeAddress(v, l)
  },
  {
    field: 'addressLine2',
    markerSuffix: 'addressLine2',
    generate: (v, _, l) => fake.fakeAddress(v + '2', l)
  },
  { field: 'city', markerSuffix: 'city', generate: (v, _, l) => fake.fakeCity(v, l) },
  { field: 'zipCode', markerSuffix: 'zipCode', generate: (v) => fake.fakeZipCode(v) },
  {
    field: 'institution',
    markerSuffix: 'institution',
    generate: (v, _, l) => fake.fakeCompany(v, l)
  },
  {
    field: 'socialSecurityNumber',
    markerSuffix: 'socialSecurityNumber',
    generate: (v) => fake.fakeSSN(v)
  },
  {
    field: 'occupation',
    markerSuffix: 'occupation',
    generate: (v, _, l) => fake.fakeOccupation(v, l)
  }
]

export class PiiPseudonymizer {
  private mapping: PiiMapping
  private wordlist: string[]
  private allowlist: string[]
  private locale: Locale

  constructor(context: PiiContext = {}) {
    this.mapping = new PiiMapping()
    this.wordlist = context.wordlist ?? []
    this.allowlist = [
      ...new Set((context.allowlist ?? []).map((value) => value.trim()).filter(Boolean))
    ]
    this.locale = context.locale ?? 'fr'
    this.seedFromContext(context)
  }

  private seedFromContext(context: PiiContext): void {
    const loc = this.locale

    for (const contact of context.contacts ?? []) {
      const roleKey = contact.role ? labelToKey(contact.role) : null
      const prefix = roleKey ? `contact.${roleKey}` : this.mapping.nextMarker('contact')

      for (const { field, markerSuffix, generate } of CONTACT_PII_FIELDS) {
        const value = contact[field] as string | undefined
        if (!value || this.mapping.hasOriginal(value)) continue
        this.mapping.add(value, `${prefix}.${markerSuffix}`, generate(value, contact, loc))
      }

      // Free-text information field: run heuristic pass inline when seeding
      if (contact.information) {
        this.pseudonymize(contact.information)
      }
    }

    for (const kd of context.keyDates ?? []) {
      if (!kd.value || this.mapping.hasOriginal(kd.value)) continue
      this.mapping.add(kd.value, `dossier.keyDate.${labelToKey(kd.label)}`, fake.fakeDate(kd.value))
    }

    for (const kr of context.keyRefs ?? []) {
      if (!kr.value || this.mapping.hasOriginal(kr.value)) continue
      this.mapping.add(
        kr.value,
        `dossier.keyRef.${labelToKey(kr.label)}`,
        fake.fakeKeyReference(kr.value)
      )
    }
  }

  /** Pseudonymize a plain text string */
  pseudonymize(text: string): string {
    if (!text) return text

    // Step 1: replace seeded known values (longest first)
    let result = this.replaceSeededValues(text)

    // Step 2: mask existing [[markers]] and explicit allowlisted non-sensitive terms
    // before running heuristic detection. This prevents managed field labels,
    // configured roles, and already-replaced marker payloads from being re-detected.
    const masked = this.maskProtectedSegments(result)

    // Step 3: detect remaining PII in masked text (same positions as result)
    const spans = detectPii(masked, this.wordlist)

    // Step 4: apply in reverse order (preserves indices)
    const sortedSpans = [...spans].sort((a, b) => b.start - a.start)
    for (const span of sortedSpans) {
      const existing = this.mapping.getFake(span.value)
      const markerPath =
        existing?.markerPath ?? this.generateEntry(span.type, span.value).markerPath
      const fakeValue = existing?.fakeValue ?? this.mapping.getFake(span.value)!.fakeValue
      const marker = PiiMapping.format(markerPath, fakeValue)
      result = result.slice(0, span.start) + marker + result.slice(span.end)
    }

    return result
  }

  private maskProtectedSegments(text: string): string {
    let masked = text.replace(new RegExp(MARKER_RE.source, 'g'), (m) => ' '.repeat(m.length))

    for (const value of this.allowlist) {
      const escaped = buildDiacriticInsensitivePattern(value)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      masked = masked.replace(re, (match) => ' '.repeat(match.length))
    }

    return masked
  }

  private replaceSeededValues(text: string): string {
    // Use sentinels to protect already-replaced segments from being
    // re-processed by subsequent iterations. Without this, a fake value that happens
    // to match another entry's original (e.g. MARTIN→Bonnet, Bonnet→Aubert)
    // would cascade: the "Bonnet" inside the first marker gets replaced by the second.
    const sentinels: string[] = []
    let result = text
    for (const { original, entry } of this.mapping.entriesByLength()) {
      if (original.length < 2) continue
      const escaped = buildDiacriticInsensitivePattern(original)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      const marker = PiiMapping.format(entry.markerPath, entry.fakeValue)
      result = result.replace(re, () => {
        const idx = sentinels.push(marker) - 1
        return `__ORDICAB_PII_SENTINEL_${idx}__`
      })
    }
    // Restore sentinels
    result = result.replace(
      /__ORDICAB_PII_SENTINEL_(\d+)__/g,
      (_match, i: string) => sentinels[Number(i)]
    )
    return result
  }

  private generateEntry(type: string, value: string): { markerPath: string; fakeValue: string } {
    const loc = this.locale
    let markerPath: string
    let fakeValue: string

    switch (type) {
      case 'email':
        markerPath = this.mapping.nextMarker('email')
        fakeValue = fake.fakeEmail(value, loc)
        break
      case 'phone':
        markerPath = this.mapping.nextMarker('phone')
        fakeValue = fake.fakePhone(value)
        break
      case 'SSN':
        markerPath = this.mapping.nextMarker('SSN')
        fakeValue = fake.fakeSSN(value)
        break
      case 'IBAN':
        markerPath = this.mapping.nextMarker('IBAN')
        fakeValue = value.slice(0, 4) + 'XXXX' + value.slice(8)
        break
      case 'password':
        markerPath = this.mapping.nextMarker('password')
        fakeValue = fake.fakePassword(value)
        break
      case 'company':
        markerPath = this.mapping.nextMarker('company')
        fakeValue = fake.fakeCompany(value, loc)
        break
      case 'address':
        markerPath = this.mapping.nextMarker('address')
        fakeValue = fake.fakeAddress(value, loc)
        break
      case 'postalLocation': {
        markerPath = this.mapping.nextMarker('postalLocation')
        const match = /^(\d{5})\s+(.+)$/.exec(value.trim())
        if (match) {
          fakeValue = `${fake.fakeZipCode(match[1])} ${fake.fakeCity(match[2], loc)}`
        } else {
          fakeValue = fake.fakeAddress(value, loc)
        }
        break
      }
      case 'companyId':
        markerPath = this.mapping.nextMarker('companyId')
        // Preserve structure (spaces, dashes) while randomizing digits
        fakeValue = fake.fakeKeyReference(value)
        break
      case 'custom':
        markerPath = this.mapping.nextMarker(`custom.${labelToKey(value)}`)
        fakeValue = fake.fakeCompany(value, loc)
        break
      default: {
        // name
        markerPath = this.mapping.nextMarker('name')
        const inferredGender = fake.inferGender(value)
        fakeValue =
          inferredGender !== null
            ? fake.fakeFirstName(value, loc, inferredGender)
            : fake.fakeLastName(value, loc)
        break
      }
    }

    this.mapping.add(value, markerPath, fakeValue)
    return { markerPath, fakeValue }
  }

  /** Pseudonymize a value that may be a JSON string or plain text */
  pseudonymizeAuto(text: string): string {
    if (!text) return text
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(this.pseudonymizeJson(parsed))
      }
    } catch {
      // not JSON
    }
    return this.pseudonymize(text)
  }

  /** Recursively pseudonymize JSON string values, leaving keys untouched */
  pseudonymizeJson(obj: unknown): unknown {
    if (typeof obj === 'string') return this.pseudonymize(obj)
    if (Array.isArray(obj)) return obj.map((item) => this.pseudonymizeJson(item))
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.pseudonymizeJson(value)
      }
      return result
    }
    return obj
  }

  /** Revert [[marker]] patterns back to original values */
  revert(text: string): string {
    return this.mapping.revert(text)
  }

  /** Recursively revert JSON object string values */
  revertJson(obj: unknown): unknown {
    if (typeof obj === 'string') return this.revert(obj)
    if (Array.isArray(obj)) return obj.map((item) => this.revertJson(item))
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = this.revertJson(value)
      }
      return result
    }
    return obj
  }

  exportMapping(): MappingSnapshotEntry[] {
    return this.mapping.toJSON()
  }
}
