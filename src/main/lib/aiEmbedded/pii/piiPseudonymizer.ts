/**
 * piiPseudonymizer — orchestrates PII detection and replacement.
 *
 * Usage:
 *   const p = new PiiPseudonymizer(context)   // pre-seeds from known contacts/dates/refs
 *   const safe = p.pseudonymize(userText)      // → text with realistic fake values
 *   const original = p.revert(llmResponse)     // → restored text
 *
 * JSON-aware: pseudonymizeAuto() parses JSON and only touches string values, not keys.
 *
 * The model-facing text contains fake values only. Internal mapping entries
 * keep the original ↔ fake relationship for reversal.
 */

import { labelToKey } from '@shared/templateContent/tagPaths'
import { PiiMapping, type MappingEntry, type MappingSnapshotEntry } from './piiMapping'
import {
  detectPii,
  detectStructuralPii,
  isStopwordToken,
  mergeSpans,
  type DetectedSpan,
  type EntityType
} from './piiDetector'
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

// Entity types that map 1:1 to a fake generator and use their own name as the
// marker base. Types needing extra logic (postalLocation, custom, name) are
// handled explicitly in generateEntry instead.
type DirectEntryFactory = (value: string, locale: Locale) => string

const fakeReference: DirectEntryFactory = (value) => fake.fakeAlphanumericReference(value)

const DIRECT_ENTRY_FACTORIES: Partial<Record<EntityType, DirectEntryFactory>> = {
  email: (value, locale) => fake.fakeEmail(value, locale),
  phone: (value) => fake.fakePhone(value),
  SSN: (value) => fake.fakeSSN(value),
  IBAN: (value) => fake.fakeIban(value),
  password: (value) => fake.fakePassword(value),
  company: (value, locale) => fake.fakeCompany(value, locale),
  address: (value, locale) => fake.fakeAddress(value, locale),
  birthDate: (value) => fake.fakeDate(value),
  date: (value) => fake.fakeDate(value),
  BIC: (value) => fake.fakeBic(value),
  ipAddress: (value) => fake.fakeIp(value),
  macAddress: (value) => fake.fakeMac(value),
  url: (value) => fake.fakeUrl(value),
  filePath: (value) => fake.fakeFilePath(value),
  gpsCoordinates: (value) => fake.fakeGps(value),
  companyId: fakeReference,
  taxId: fakeReference,
  driverLicense: fakeReference,
  passport: fakeReference,
  vehicleRegistration: fakeReference,
  creditCard: fakeReference,
  identifier: fakeReference,
  medicalId: fakeReference
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
 * Emit spans for NER regions that the regex layer didn't cover.
 *
 * Name regions are split on whitespace so each token becomes its own `name`
 * span — the LLM then sees distinct firstName / lastName fake values instead
 * of one bundled identity. The coverage check is done PER TOKEN, not per region: a
 * region the regex layer touched only partially (e.g. it caught an honorific
 * but missed the OCR-garbled surname next to it) still contributes its
 * uncovered name tokens instead of being dropped wholesale. Tokens that are
 * common function words / structural stopwords ("de", "la", "vu", a month
 * name…) are skipped — a stopword registered as a `name` poisons the whole
 * conversation, since `replaceSeededValues` then substitutes every later
 * occurrence and the toxic entry rides the decode ledger into the next turn.
 *
 * For address / company regions we still emit a single span covering the whole
 * region, and only when the regex saw nothing in it at all (splitting a street
 * line into its components is the regex's job).
 */
function buildNerFallbackSpans(
  text: string,
  nerRegions: DetectedSpan[],
  regexSpans: DetectedSpan[]
): DetectedSpan[] {
  if (nerRegions.length === 0) return []

  const overlapsRegex = (start: number, end: number): boolean =>
    regexSpans.some((span) => span.start < end && start < span.end)

  const fallback: DetectedSpan[] = []
  for (const region of nerRegions) {
    if (region.type !== 'name') {
      // Address / company region: fill only a total gap — see jsdoc above.
      if (overlapsRegex(region.start, region.end)) continue
      fallback.push({
        type: region.type,
        value: text.slice(region.start, region.end),
        start: region.start,
        end: region.end
      })
      continue
    }

    // Name region: emit one span per uncovered, non-stopword token.
    const wordRe = /[^\s]+/gu
    const regionText = text.slice(region.start, region.end)
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(regionText)) !== null) {
      const token = m[0]
      if (token.length < 2) continue
      if (isStopwordToken(token)) continue
      const start = region.start + m.index
      const end = start + token.length
      if (overlapsRegex(start, end)) continue
      fallback.push({ type: 'name', value: token, start, end })
    }
  }
  return fallback
}

/**
 * A function-word stopword tagged as a `name` or `company` span is never PII.
 * Registering it as a mapping entry would poison `replaceSeededValues` (every
 * later occurrence of the word gets substituted) and ride the decode ledger
 * into the next turn. Used as a final guard before a span becomes an entry.
 */
function isNamingSpanStopword(span: DetectedSpan): boolean {
  return (span.type === 'name' || span.type === 'company') && isStopwordToken(span.value)
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
      // Self-heal ledgers poisoned by a past detection bug: a function-word
      // stopword ("de", "la", …) registered as a counter-based `name_N` /
      // `company_N` entry. Re-importing it would re-arm `replaceSeededValues`
      // to substitute every occurrence of that word for the rest of the
      // conversation. Semantic-path entries (e.g. `contact.X.city` = "Paris")
      // are legitimate and kept — they get re-seeded from context regardless.
      if (isStopwordToken(entry.original) && /^[a-z]+_\d+$/i.test(entry.markerPath)) continue
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

    this.seedLabeledValues(
      context.keyDates,
      'dossier.keyDate',
      (value) => fake.fakeDate(value),
      'date'
    )
    this.seedDirectDossierReferences(context.keyRefs)
  }

  // `type` is a free-form label namespace for the opaque-fake fallback, not an
  // EntityType — these seeded values use semantic marker paths, not type counters.
  private seedLabeledValues(
    items: Array<{ label: string; value: string }> | undefined,
    markerPrefix: string,
    generate: (value: string) => string,
    type: string
  ): void {
    for (const item of items ?? []) {
      if (!item.value || this.mapping.hasOriginal(item.value)) continue
      this.addEntry(
        item.value,
        `${markerPrefix}.${labelToKey(item.label)}`,
        generate(item.value),
        type
      )
    }
  }

  private seedDirectDossierReferences(
    items: Array<{ label: string; value: string }> | undefined
  ): void {
    for (const item of items ?? []) {
      if (!item.value || this.mapping.hasOriginal(item.value)) continue
      this.addEntry(
        item.value,
        `dossier.${labelToKey(item.label)}`,
        fake.fakeAlphanumericReference(item.value),
        'reference'
      )
    }
  }

  /** Pseudonymize a plain text string */
  pseudonymize(text: string): string {
    if (!text) return text

    const { result, masked } = this.prepareTextForDetection(text)
    return this.applyDetectedSpans(result, detectPii(masked, this.wordlist))
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

  private prepareTextForDetection(text: string): { result: string; masked: string } {
    // Pre-register structural patterns (email, URL, phone, address, …)
    // before the seeded-value pass. Without this, a known contact lastName
    // appearing inside an email's domain would be substituted first, leaving
    // a partial fake because the email regex no longer matches the broken
    // pattern. Pre-registering lets entriesByLength() replace the whole token.
    this.preRegisterStructuralEntries(text)

    const { result, protectedValues } = this.replaceSeededValues(text)
    return { result, masked: this.maskProtectedSegments(result, protectedValues) }
  }

  private maskProtectedSegments(text: string, protectedValues: string[] = []): string {
    let masked = text

    for (const value of this.allowlist) {
      const escaped = buildDiacriticInsensitivePattern(value)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      masked = masked.replace(re, (match) => ' '.repeat(match.length))
    }

    for (const value of protectedValues) {
      if (!value) continue
      const escaped = buildDiacriticInsensitivePattern(value)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      masked = masked.replace(re, (match) => ' '.repeat(match.length))
    }

    return masked
  }

  private replaceSeededValues(text: string): { result: string; protectedValues: string[] } {
    // Use sentinels to protect already-replaced segments from being
    // re-processed by subsequent iterations. Without this, a fake value that happens
    // to match another entry's original (e.g. MARTIN→Bonnet, Bonnet→Aubert)
    // would cascade: the "Bonnet" inside the first fake gets replaced by the second.
    const sentinels: string[] = []
    const protectedValues: string[] = []
    let result = text
    for (const { original, entry } of this.mapping.entriesByLength()) {
      if (original.length < 2) continue
      const escaped = buildDiacriticInsensitivePattern(original)
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu')
      const marker = PiiMapping.format(entry.markerPath, entry.fakeValue)
      result = result.replace(re, () => {
        const idx = sentinels.push(marker) - 1
        protectedValues.push(marker)
        return `__ORDICAB_PII_SENTINEL_${idx}__`
      })
    }
    // Restore sentinels
    result = result.replace(
      /__ORDICAB_PII_SENTINEL_(\d+)__/g,
      (_match, i: string) => sentinels[Number(i)] ?? ''
    )
    return { result, protectedValues }
  }

  private applyDetectedSpans(text: string, spans: DetectedSpan[]): string {
    this.reserveSpanOriginals(text, spans)

    let result = text
    const sortedSpans = [...spans].sort((a, b) => b.start - a.start)
    for (const span of sortedSpans) {
      // Key the mapping on the original (un-hinted) substring at the span's
      // position, not span.value — the NER path hints the detection text, and
      // this keeps revert() round-tripping to the exact source casing/diacritics.
      const originalValue = result.slice(span.start, span.end)
      // Final safety net: a function-word stopword tagged as name/company is
      // never PII — registering it would poison replaceSeededValues. The NER
      // fallback already filters these; this guards the regex layer too.
      if (isNamingSpanStopword({ ...span, value: originalValue })) continue
      const entry =
        this.mapping.getFake(originalValue) ?? this.generateEntry(span.type, originalValue)
      const marker = PiiMapping.format(entry.markerPath, entry.fakeValue)
      result = result.slice(0, span.start) + marker + result.slice(span.end)
    }

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
    // real value back to the model as its own fake is still a privacy leak.
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
   * collision. Salting the markerPath is safe (the path is an internal
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
      // add() returned undefined for a non-path reason (fakeValue collision
      // with a different original). Salting the path won't help; bail out.
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
    // So we switch to a completely synthetic internal path namespace
    // (`fallback.<type>_*`) plus an opaque fake (`PII_*`). That preserves the
    // mapping needed by revert()/revertJson(), gives the LLM no real personal
    // data, and avoids exhausting role/template-derived paths. In
    // practice this loop should exit on the first iteration; the cap only
    // prevents an accidental infinite loop if PiiMapping invariants regress.
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const fallbackFake = this.makeOpaqueFake(type)
      const fallbackMarker = this.mapping.nextMarker(`fallback.${type}`)
      const entry = this.mapping.add(value, fallbackMarker, fallbackFake)
      if (entry) return entry
    }

    // Truly unreachable unless PiiMapping.add stops accepting fresh internal
    // path / fake pairs. At that point aborting is still safer than sending raw PII remote:
    // action failure is preferable to privacy leakage.
    throw new Error(`Unable to allocate fallback PII mapping for ${type}`)
  }

  private createDirectEntry(type: EntityType, value: string): MappingEntry | null {
    const generate = DIRECT_ENTRY_FACTORIES[type]
    if (!generate) return null
    return this.addEntry(value, this.mapping.nextMarker(type), generate(value, this.locale), type)
  }

  private generatePostalLocationEntry(value: string): MappingEntry {
    const markerPath = this.mapping.nextMarker('postalLocation')
    const match = /^(\d{5})\s+(.+)$/.exec(value.trim())
    if (!match) {
      return this.addEntry(
        value,
        markerPath,
        fake.fakeAddress(value, this.locale),
        'postalLocation'
      )
    }

    const [, zip = '', city = ''] = match
    // Reuse pre-existing fakes when the city/zip are already mapped
    // (typically by the contact seeding pass via pickUniqueFake collision
    // rotation). Without this, the aggregate would compute a fresh attempt=0
    // fake here that disagrees with the bare-city value.
    const fakeZip = this.mapping.getFake(zip)?.fakeValue ?? fake.fakeZipCode(zip)
    const fakeCity = this.mapping.getFake(city)?.fakeValue ?? fake.fakeCity(city, this.locale)

    // The LLM often splits a postalLocation back into separate tool-call
    // fields ({ city, postalCode }). Without per-component entries, only the
    // aggregate fakeValue is registered and revert() cannot map a bare city or
    // postcode back to the original.
    if (!this.mapping.hasOriginal(zip)) {
      this.addEntry(zip, this.mapping.nextMarker('postalCode'), fakeZip, 'postalCode')
    }
    if (!this.mapping.hasOriginal(city)) {
      this.addEntry(city, this.mapping.nextMarker('city'), fakeCity, 'city')
    }

    return this.addEntry(value, markerPath, `${fakeZip} ${fakeCity}`, 'postalLocation')
  }

  private generateNameEntry(value: string): MappingEntry {
    // Every name producer emits one span per token, so `value` is a single
    // token here. Pick firstName vs lastName based on inferred gender.
    const inferredGender = fake.inferGender(value)
    const fakeValue = this.pickUniqueFake(value, (attempt) =>
      inferredGender !== null
        ? fake.fakeFirstName(value, this.locale, inferredGender, attempt)
        : fake.fakeLastName(value, this.locale, attempt)
    )
    return this.addEntry(value, this.mapping.nextMarker('name'), fakeValue, 'name')
  }

  private generateCustomEntry(value: string): MappingEntry {
    return this.addEntry(
      value,
      this.mapping.nextMarker(`custom.${labelToKey(value)}`),
      fake.fakeCompany(value, this.locale),
      'custom'
    )
  }

  private generateEntry(type: EntityType, value: string): MappingEntry {
    if (type === 'postalLocation') return this.generatePostalLocationEntry(value)
    if (type === 'custom') return this.generateCustomEntry(value)
    if (type === 'name') return this.generateNameEntry(value)
    // Every remaining entity type maps 1:1 to a fake generator. The `?? name`
    // guard is defensive: a future EntityType missing from DIRECT_ENTRY_FACTORIES
    // is still redacted (as a name) rather than slipping through in clear text.
    return this.createDirectEntry(type, value) ?? this.generateNameEntry(value)
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

    const { result, masked } = this.prepareTextForDetection(text)
    const { hintedText, nerRegions } = await applyNerHints(masked, this.nerConfig)
    const regexSpans = detectPii(hintedText, this.wordlist)
    const fallbackSpans = buildNerFallbackSpans(result, nerRegions, regexSpans)

    // Regex spans win on identical ranges via mergeSpans' stable sort; the
    // fallback only fills regions with no regex coverage.
    return this.applyDetectedSpans(result, mergeSpans([...regexSpans, ...fallbackSpans]))
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
    return this.mapJsonAsync(obj, (value) => this.pseudonymizeAsync(value))
  }

  /** Recursively pseudonymize JSON string values, leaving keys untouched */
  pseudonymizeJson(obj: unknown): unknown {
    return this.mapJson(obj, (value) => this.pseudonymize(value))
  }

  /** Revert fake values back to original values */
  revert(text: string): string {
    return this.mapping.revert(text)
  }

  /** Recursively revert JSON object string values AND keys. Keys can carry
   * fake values because the LLM can reposition value strings into key slots
   * (e.g. template paths from a previous tool result). */
  revertJson(obj: unknown): unknown {
    return this.mapJson(
      obj,
      (value) => this.revert(value),
      (key) => this.revert(key)
    )
  }

  exportMapping(): ReturnType<PiiMapping['toJSON']> {
    return this.mapping.toJSON()
  }

  private mapJson(
    obj: unknown,
    mapString: (value: string) => string,
    mapKey: (key: string) => string = (key) => key
  ): unknown {
    if (typeof obj === 'string') return mapString(obj)
    if (Array.isArray(obj)) return obj.map((item) => this.mapJson(item, mapString, mapKey))
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[mapKey(key)] = this.mapJson(value, mapString, mapKey)
      }
      return result
    }
    return obj
  }

  // Async counterpart of mapJson. No mapKey parameter: the only async caller
  // (pseudonymizeJsonAsync) leaves keys untouched, like sync pseudonymizeJson.
  // Traversal is sequential — never Promise.all — because mapString mutates the
  // shared PiiMapping (counter-based paths, fake-collision rotation), so
  // parallel traversal would make path allocation non-deterministic.
  private async mapJsonAsync(
    obj: unknown,
    mapString: (value: string) => Promise<string>
  ): Promise<unknown> {
    if (typeof obj === 'string') return mapString(obj)
    if (Array.isArray(obj)) {
      const result: unknown[] = []
      for (const item of obj) result.push(await this.mapJsonAsync(item, mapString))
      return result
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = await this.mapJsonAsync(value, mapString)
      }
      return result
    }
    return obj
  }
}
