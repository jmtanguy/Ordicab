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
import { PiiMapping, MARKER_RE, type MappingEntry, type MappingSnapshotEntry } from './piiMapping'
import { detectPii, detectStructuralPii, mergeSpans, type DetectedSpan } from './piiDetector'
import { applyNerHints, type NerConfig } from './nerDetection'
import * as fake from './fakegen'
import type { Locale, Gender } from './fakegen'
import { buildDiacriticInsensitivePattern, normalizeMatchKey } from './textMatching'

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
  ner?: NerConfig
  /**
   * Mapping entries from earlier turns of the same conversation. When supplied,
   * the pseudonymizer pre-registers them so a real value that already had a
   * fake assigned in a prior turn keeps the same fake (stable across turns)
   * and `pickUniqueFake` rotates around already-taken fakes (no two distinct
   * originals share a fake across the whole session). This eliminates the
   * decode ambiguity that arises when the merged cross-turn ledger has
   * collisions on the same fake value.
   */
  priorEntries?: MappingSnapshotEntry[]
}

type ContactFieldDef = {
  field: keyof PiiContact
  markerSuffix: string
  generate: (value: string, contact: PiiContact, locale: Locale, attempt: number) => string
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
    generate: (v, c, l, attempt) =>
      fake.fakeFirstName(v, l, genderForFake(c.gender) ?? fake.inferGender(v), attempt)
  },
  {
    field: 'lastName',
    markerSuffix: 'lastName',
    generate: (v, _, l, attempt) => fake.fakeLastName(v, l, attempt)
  },
  {
    field: 'maidenName',
    markerSuffix: 'maidenName',
    generate: (v, _, l, attempt) => fake.fakeLastName(v, l, attempt)
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

/**
 * Emit spans for NER regions that the regex layer didn't cover. For name
 * regions we split on whitespace so each token becomes its own `name` span —
 * the LLM then sees distinct firstName / lastName markers instead of one
 * bundled identity. For address / company regions we emit a single span
 * covering the whole region (splitting a street line into its components is
 * the regex's job; we only fill the gap when the regex saw nothing at all).
 */
function buildNerFallbackSpans(
  text: string,
  nerRegions: DetectedSpan[],
  regexSpans: DetectedSpan[]
): DetectedSpan[] {
  if (nerRegions.length === 0) return []

  const fallback: DetectedSpan[] = []
  for (const region of nerRegions) {
    const covered = regexSpans.some((span) => span.start < region.end && region.start < span.end)
    if (covered) continue

    if (region.type !== 'name') {
      fallback.push({
        type: region.type,
        value: text.slice(region.start, region.end),
        start: region.start,
        end: region.end
      })
      continue
    }

    // Name region with no regex coverage (e.g. foreign surname with no known
    // first name anchor). Split into per-token spans so each name component
    // still gets its own marker.
    const wordRe = /[^\s]+/gu
    const regionText = text.slice(region.start, region.end)
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(regionText)) !== null) {
      const token = m[0]
      if (token.length < 2) continue
      fallback.push({
        type: 'name',
        value: token,
        start: region.start + m.index,
        end: region.start + m.index + token.length
      })
    }
  }
  return fallback
}

function collectReservedOriginalKeys(context: PiiContext): Set<string> {
  const keys = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return
    const key = normalizeMatchKey(value)
    if (key) keys.add(key)
  }

  for (const contact of context.contacts ?? []) {
    add(contact.firstName)
    add(contact.lastName)
    add(contact.displayName)
    add(contact.email)
    add(contact.phone)
    add(contact.addressLine)
    add(contact.addressLine2)
    add(contact.zipCode)
    add(contact.city)
    add(contact.institution)
    add(contact.socialSecurityNumber)
    add(contact.maidenName)
    add(contact.occupation)
  }
  for (const keyDate of context.keyDates ?? []) add(keyDate.value)
  for (const keyRef of context.keyRefs ?? []) add(keyRef.value)
  for (const word of context.wordlist ?? []) add(word)

  return keys
}

export class PiiPseudonymizer {
  private mapping: PiiMapping
  private wordlist: string[]
  private allowlist: string[]
  private locale: Locale
  private nerConfig: NerConfig | null
  private reservedOriginalKeys: Set<string>
  private opaqueFakeCounter = 0

  constructor(context: PiiContext = {}) {
    this.mapping = new PiiMapping()
    this.wordlist = context.wordlist ?? []
    this.allowlist = [
      ...new Set((context.allowlist ?? []).map((value) => value.trim()).filter(Boolean))
    ]
    this.locale = context.locale ?? 'fr'
    this.nerConfig = context.ner ?? null
    this.reservedOriginalKeys = collectReservedOriginalKeys(context)
    // Import prior-turn entries BEFORE seeding from context so contact-derived
    // values that already have a fake from a previous turn keep that fake
    // (subsequent contact seeding sees mapping.hasOriginal(value) and skips).
    // Cross-turn fake collisions are also prevented at the source: pickUniqueFake
    // sees already-taken fakes via isFakeValueBlocked and rotates past them.
    this.importPriorEntries(context.priorEntries ?? [])
    this.seedFromContext(context)
  }

  /**
   * Pre-register entries from earlier turns. Goals:
   *   • Same real value keeps its prior fake (stable across turns).
   *   • Cross-turn fake collisions blocked at the source — `pickUniqueFake`
   *     and `isFakeValueBlocked` see prior fakes as taken.
   *
   * Uses `mapping.add()` directly (not `addEntry`) so the original→fake pair
   * is preserved verbatim from the prior turn even when the prior fake would
   * fail the current turn's safety checks (e.g. it equals a freshly-detected
   * span on this turn). Prior decoding correctness wins over local heuristics.
   */
  private importPriorEntries(entries: MappingSnapshotEntry[]): void {
    for (const entry of entries) {
      if (!entry.original || !entry.markerPath || !entry.fakeValue) continue
      if (this.mapping.hasOriginal(entry.original)) continue
      const added = this.mapping.add(entry.original, entry.markerPath, entry.fakeValue)
      if (!added) continue
      // Counter-shaped paths (`name_5`, `phone_3`, …) must bump the relevant
      // counter so a later `nextMarker(typeKey)` skips already-allocated ids
      // instead of falling back to ugly suffixed paths like `name_1_2`.
      const counterMatch = /^([a-zA-Z]+)_(\d+)$/.exec(entry.markerPath)
      if (counterMatch) {
        const typeKey = counterMatch[1]!
        const n = Number.parseInt(counterMatch[2]!, 10)
        if (Number.isFinite(n)) this.mapping.bumpCounter(typeKey, n)
      }
    }
  }

  private seedFromContext(context: PiiContext): void {
    const loc = this.locale
    const seenPrefixes = new Set<string>()

    for (const contact of context.contacts ?? []) {
      const roleKey = contact.role ? labelToKey(contact.role) : null
      const candidatePrefix = roleKey ? `contact.${roleKey}` : null
      const prefix =
        candidatePrefix && !seenPrefixes.has(candidatePrefix)
          ? candidatePrefix
          : this.mapping.nextMarker('contact')
      seenPrefixes.add(prefix)

      for (const { field, markerSuffix, generate } of CONTACT_PII_FIELDS) {
        const value = contact[field] as string | undefined
        if (!value || this.mapping.hasOriginal(value)) continue
        const fakeValue = this.pickUniqueFake(value, (attempt) =>
          generate(value, contact, loc, attempt)
        )
        this.addEntry(value, `${prefix}.${markerSuffix}`, fakeValue, markerSuffix)
      }

      // Free-text information field: run heuristic pass inline when seeding
      if (contact.information) {
        this.pseudonymize(contact.information)
      }
    }

    for (const kd of context.keyDates ?? []) {
      if (!kd.value || this.mapping.hasOriginal(kd.value)) continue
      this.addEntry(
        kd.value,
        `dossier.keyDate.${labelToKey(kd.label)}`,
        fake.fakeDate(kd.value),
        'date'
      )
    }

    for (const kr of context.keyRefs ?? []) {
      if (!kr.value || this.mapping.hasOriginal(kr.value)) continue
      this.addEntry(
        kr.value,
        `dossier.keyRef.${labelToKey(kr.label)}`,
        fake.fakeAlphanumericReference(kr.value),
        'keyRef'
      )
    }
  }

  /** Pseudonymize a plain text string */
  pseudonymize(text: string): string {
    if (!text) return text

    // Step 0: pre-register structural patterns (email, URL, phone, address, …)
    // before the seeded-value pass. Without this, a known contact lastName
    // appearing inside an email's domain would be substituted first, leaving
    // a partial marker like `karina@[[contact.X.lastName]] \`Aubert\`-avocat.com`
    // because the email regex no longer matches the broken pattern.
    // Pre-registering lets entriesByLength() see the email as a longer entry
    // and replace the whole token via the cascade-prevention sentinels.
    this.preRegisterStructuralEntries(text)

    // Step 1: replace seeded known values (longest first)
    let result = this.replaceSeededValues(text)

    // Step 2: mask existing [[markers]] and explicit allowlisted non-sensitive terms
    // before running heuristic detection. This prevents managed field labels,
    // configured roles, and already-replaced marker payloads from being re-detected.
    const masked = this.maskProtectedSegments(result)

    // Step 3: detect remaining PII in masked text (same positions as result)
    const spans = detectPii(masked, this.wordlist)
    this.reserveSpanOriginals(result, spans)

    // Step 4: apply in reverse order (preserves indices). Skip spans whose
    // entry could not be allocated — addEntry has already logged the reason and
    // leaving the original in clear text is preferable to crashing the flow.
    const sortedSpans = [...spans].sort((a, b) => b.start - a.start)
    for (const span of sortedSpans) {
      const entry = this.mapping.getFake(span.value) ?? this.generateEntry(span.type, span.value)
      const marker = PiiMapping.format(entry.markerPath, entry.fakeValue)
      result = result.slice(0, span.start) + marker + result.slice(span.end)
    }

    return result
  }

  /**
   * Detect structural PII patterns on the original text (after masking
   * already-protected segments) and register each as a mapping entry. Does
   * not modify the text — the actual substitution happens later via
   * `replaceSeededValues`, which iterates `entriesByLength()` so the now-
   * registered structural patterns (typically longer than their internal
   * sub-tokens) are substituted before any sub-token can claim them.
   */
  private preRegisterStructuralEntries(text: string): void {
    const masked = this.maskProtectedSegments(text)
    for (const span of detectStructuralPii(masked)) {
      const value = text.slice(span.start, span.end)
      if (!value || this.mapping.hasOriginal(value)) continue
      this.generateEntry(span.type, value)
    }
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
      (_match, i: string) => sentinels[Number(i)] ?? ''
    )
    return result
  }

  /**
   * Rotate through deterministic generator picks until we find a fake value
   * that is not already mapped to a different original. Used because suffix-
   * based disambiguation (" 2", "_2") cannot survive LLM prose: the model
   * routinely strips trailing digits, breaking revert. Pool rotation produces
   * a fully distinct word instead, so the fallback fake-value pass in revert
   * can still resolve it back to the right original.
   */
  private pickUniqueFake(
    original: string,
    generate: (attempt: number) => string,
    maxAttempts = 64
  ): string {
    // Reject self-mapping as well as cross-entry fake collisions: sending the
    // real value back to the model behind a marker is still a privacy leak.
    const isSafeCandidate = (candidate: string): boolean =>
      this.isFakeCandidateSafe(candidate, original)

    let candidate = generate(0)
    if (isSafeCandidate(candidate)) return candidate
    for (let attempt = 1; attempt < maxAttempts; attempt++) {
      const next = generate(attempt)
      if (isSafeCandidate(next)) return next
      candidate = next
    }
    // Pool exhausted — return the last candidate. addEntry() will reject unsafe
    // candidates and fall back to an opaque reversible fake rather than leaking.
    return candidate
  }

  private reserveSpanOriginals(text: string, spans: DetectedSpan[]): void {
    for (const span of spans) {
      const key = normalizeMatchKey(text.slice(span.start, span.end))
      if (key) this.reservedOriginalKeys.add(key)
    }
  }

  private isFakeCandidateSafe(candidate: string, original: string): boolean {
    const candidateKey = normalizeMatchKey(candidate)
    if (!candidateKey) return false
    const originalKey = normalizeMatchKey(original)
    if (candidateKey === originalKey) return false
    if (this.mapping.isFakeValueBlocked(candidate, original)) return false
    return !this.reservedOriginalKeys.has(candidateKey)
  }

  private makeOpaqueFake(type: string): string {
    this.opaqueFakeCounter += 1
    return `PII_${labelToKey(type) || 'value'}_${this.opaqueFakeCounter}`
  }

  /**
   * Add `value` to the mapping with the requested base markerPath, retrying
   * with a `_2`, `_3`, … suffix on the markerPath when `add()` rejects a
   * collision. Salting the markerPath is safe (the marker is an internal
   * token the LLM doesn't paraphrase). Fake-value collisions cannot be
   * salt-fixed here without breaking revert, so the caller is responsible
   * for handing in a fakeValue that's already disambiguated (see
   * `pickUniqueFake` for name pools).
   */
  private addWithUniqueMarker(
    value: string,
    basePath: string,
    fakeValue: string,
    maxAttempts = 16
  ): MappingEntry | null {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const path = attempt === 0 ? basePath : `${basePath}_${attempt + 1}`
      if (this.mapping.isMarkerPathUsed(path)) continue
      const entry = this.mapping.add(value, path, fakeValue)
      if (entry) return entry
      // add() returned undefined for a non-marker reason (fakeValue collision
      // with a different original). Salting the marker won't help; bail out.
      return null
    }
    return null
  }

  private addEntry(
    value: string,
    markerPath: string,
    fakeValue: string,
    type: string
  ): MappingEntry {
    const preferredFake = this.isFakeCandidateSafe(fakeValue, value)
      ? fakeValue
      : this.makeOpaqueFake(type)

    const preferredEntry = this.addWithUniqueMarker(value, markerPath, preferredFake)
    if (preferredEntry) return preferredEntry

    for (let attempt = 0; attempt < 64; attempt++) {
      const fallbackFake = this.makeOpaqueFake(type)
      if (!this.isFakeCandidateSafe(fallbackFake, value)) continue
      const fallbackEntry = this.addWithUniqueMarker(value, markerPath, fallbackFake)
      if (fallbackEntry) return fallbackEntry
    }

    // Last-resort non-failing path.
    //
    // This branch is expected to be extremely rare: the normal path already
    // retries marker suffixes and fake-value rotation. Still, it matters because
    // this code runs on the user-facing AI action path. A collision here must
    // not make the action fail, and it must not leave the original PII in clear
    // text just to keep going.
    //
    // So we switch to a completely synthetic marker namespace
    // (`fallback.<type>_*`) plus an opaque fake (`PII_*`). That preserves the
    // mapping needed by revert()/revertJson(), gives the LLM no real personal
    // data, and avoids exhausting role/template-derived marker paths. In
    // practice this loop should exit on the first iteration; the cap only
    // prevents an accidental infinite loop if PiiMapping invariants regress.
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const fallbackFake = this.makeOpaqueFake(type)
      const fallbackMarker = this.mapping.nextMarker(`fallback.${type}`)
      const entry = this.mapping.add(value, fallbackMarker, fallbackFake)
      if (entry) return entry
    }

    // Truly unreachable unless PiiMapping.add stops accepting fresh marker/fake
    // pairs. At that point aborting is still safer than sending raw PII remote:
    // action failure is preferable to privacy leakage.
    throw new Error(`Unable to allocate fallback PII marker for ${type}`)
  }

  private generateEntry(type: string, value: string): MappingEntry {
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
        fakeValue = fake.fakeIban(value)
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
          const [, zip = '', city = ''] = match
          // Reuse pre-existing fakes when the city/zip are already mapped
          // (typically by the contact seeding pass via pickUniqueFake collision
          // rotation). Without this, the aggregate would compute a fresh
          // attempt=0 fake here that disagrees with the bare-city marker —
          // e.g. contact city "Nice" → "Strasbourg" but postalLocation "Nice"
          // → "Lyon". The LLM would then echo "Lyon" alone in tool args, and
          // revert() can't map a substring of a multi-word fakeValue.
          const fakeZip = this.mapping.getFake(zip)?.fakeValue ?? fake.fakeZipCode(zip)
          const fakeCity = this.mapping.getFake(city)?.fakeValue ?? fake.fakeCity(city, loc)
          fakeValue = `${fakeZip} ${fakeCity}`
          // The LLM often splits a postalLocation back into separate tool-call
          // fields ({ city, postalCode }). Without per-component entries, only
          // the aggregate fakeValue is registered and revert() cannot map a
          // bare "Villeneuve" back to "nice". Register zip and city as their
          // own reversible entries so each fragment has a mapping — the
          // aggregate still wins during pseudonymization (longer match first).
          if (!this.mapping.hasOriginal(zip)) {
            this.addEntry(zip, this.mapping.nextMarker('postalCode'), fakeZip, 'postalCode')
          }
          if (!this.mapping.hasOriginal(city)) {
            this.addEntry(city, this.mapping.nextMarker('city'), fakeCity, 'city')
          }
        } else {
          fakeValue = fake.fakeAddress(value, loc)
        }
        break
      }
      case 'companyId':
        markerPath = this.mapping.nextMarker('companyId')
        // Preserve structure (spaces, dashes) while replacing letters and digits.
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'birthDate':
        markerPath = this.mapping.nextMarker('birthDate')
        fakeValue = fake.fakeDate(value)
        break
      case 'date':
        markerPath = this.mapping.nextMarker('date')
        fakeValue = fake.fakeDate(value)
        break
      case 'taxId':
        markerPath = this.mapping.nextMarker('taxId')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'driverLicense':
        markerPath = this.mapping.nextMarker('driverLicense')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'passport':
        markerPath = this.mapping.nextMarker('passport')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'vehicleRegistration':
        markerPath = this.mapping.nextMarker('vehicleRegistration')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'creditCard':
        markerPath = this.mapping.nextMarker('creditCard')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'BIC':
        markerPath = this.mapping.nextMarker('BIC')
        fakeValue = fake.fakeBic(value)
        break
      case 'ipAddress':
        markerPath = this.mapping.nextMarker('ipAddress')
        fakeValue = fake.fakeIp(value)
        break
      case 'macAddress':
        markerPath = this.mapping.nextMarker('macAddress')
        fakeValue = fake.fakeMac(value)
        break
      case 'identifier':
        markerPath = this.mapping.nextMarker('identifier')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'medicalId':
        markerPath = this.mapping.nextMarker('medicalId')
        fakeValue = fake.fakeAlphanumericReference(value)
        break
      case 'url':
        markerPath = this.mapping.nextMarker('url')
        fakeValue = fake.fakeUrl(value)
        break
      case 'filePath':
        markerPath = this.mapping.nextMarker('filePath')
        fakeValue = fake.fakeFilePath(value)
        break
      case 'gpsCoordinates':
        markerPath = this.mapping.nextMarker('gpsCoordinates')
        fakeValue = fake.fakeGps(value)
        break
      case 'custom':
        markerPath = this.mapping.nextMarker(`custom.${labelToKey(value)}`)
        fakeValue = fake.fakeCompany(value, loc)
        break
      default: {
        // name — every name producer (detectCapitalized, salutation/title-anchored,
        // legal-role, NER fallback) emits one span per token, so `value` is a
        // single token here. Pick firstName vs lastName based on inferred gender.
        markerPath = this.mapping.nextMarker('name')
        const inferredGender = fake.inferGender(value)
        fakeValue = this.pickUniqueFake(value, (attempt) =>
          inferredGender !== null
            ? fake.fakeFirstName(value, loc, inferredGender, attempt)
            : fake.fakeLastName(value, loc, attempt)
        )
        break
      }
    }

    return this.addEntry(value, markerPath, fakeValue, type)
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

  /**
   * Same contract as pseudonymize() but uses the NER model as a position
   * oracle when the constructor received a ner config with `enabled: true`.
   * NER capitalizes PER / LOC / ORG regions in the masked text so the regex
   * layer (detectCapitalized, ADDRESS_FR_RE, …) can pick them up on its own
   * terms — the regex splits multi-word names into one span per token, which
   * lets the LLM route firstName / lastName into separate tool-call fields.
   *
   * For NER-flagged regions that the regex still misses (foreign surnames not
   * in the known-first-name list, addresses without a leading house number),
   * a fallback emits per-token name spans / single address-or-company spans so
   * the region is still redacted. Falls back to the sync path when NER is
   * disabled or not configured.
   */
  async pseudonymizeAsync(text: string): Promise<string> {
    if (!text) return text
    if (!this.nerConfig?.enabled) return this.pseudonymize(text)

    // Same pre-registration step as `pseudonymize` — see the comment there for
    // why this must run before `replaceSeededValues`.
    this.preRegisterStructuralEntries(text)

    let result = this.replaceSeededValues(text)
    const masked = this.maskProtectedSegments(result)

    const { hintedText, nerRegions } = await applyNerHints(masked, this.nerConfig)
    const regexSpans = detectPii(hintedText, this.wordlist)
    const fallbackSpans = buildNerFallbackSpans(result, nerRegions, regexSpans)

    // Regex spans win on identical ranges via mergeSpans' stable sort; the
    // fallback only fills regions with no regex coverage.
    const spans: DetectedSpan[] = mergeSpans([...regexSpans, ...fallbackSpans])
    this.reserveSpanOriginals(result, spans)

    const sortedSpans = [...spans].sort((a, b) => b.start - a.start)
    for (const span of sortedSpans) {
      // Always use the original (un-hinted) substring as the mapping key so
      // revert() round-trips to the exact source casing / diacritics.
      const originalValue = result.slice(span.start, span.end)
      const entry =
        this.mapping.getFake(originalValue) ?? this.generateEntry(span.type, originalValue)
      const marker = PiiMapping.format(entry.markerPath, entry.fakeValue)
      result = result.slice(0, span.start) + marker + result.slice(span.end)
    }

    return result
  }

  /** Async counterpart of pseudonymizeAuto — routes JSON string values through the NER-aware path. */
  async pseudonymizeAutoAsync(text: string): Promise<string> {
    if (!text) return text
    if (!this.nerConfig?.enabled) return this.pseudonymizeAuto(text)
    try {
      const parsed = JSON.parse(text) as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(await this.pseudonymizeJsonAsync(parsed))
      }
    } catch {
      // not JSON
    }
    return this.pseudonymizeAsync(text)
  }

  /** Recursive async variant of pseudonymizeJson. */
  async pseudonymizeJsonAsync(obj: unknown): Promise<unknown> {
    if (typeof obj === 'string') return this.pseudonymizeAsync(obj)
    if (Array.isArray(obj)) {
      const out: unknown[] = []
      for (const item of obj) out.push(await this.pseudonymizeJsonAsync(item))
      return out
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = await this.pseudonymizeJsonAsync(value)
      }
      return result
    }
    return obj
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

  /** Recursively revert JSON object string values AND keys. Keys can carry
   * markers because the LLM routinely repositions marker-bearing strings
   * (e.g. template paths from a previous tool result) into key slots. */
  revertJson(obj: unknown): unknown {
    if (typeof obj === 'string') return this.revert(obj)
    if (Array.isArray(obj)) return obj.map((item) => this.revertJson(item))
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[this.revert(key)] = this.revertJson(value)
      }
      return result
    }
    return obj
  }

  exportMapping(): ReturnType<PiiMapping['toJSON']> {
    return this.mapping.toJSON()
  }
}
