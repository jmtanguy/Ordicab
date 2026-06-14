/**
 * internalAICommandDispatcher — executes a structured InternalAiCommand against the service layer.
 *
 * Receives the resolved AI action object (`InternalAiCommand`) produced by aiSdkAgentRuntime
 * and routes it to the correct internal service call. All calls go directly to
 * the service layer — never
 * via IPC — to avoid a round-trip back through the preload bridge.
 *
 * Intent routing:
 *   dossier_list       → dossierService.listRegisteredDossiers()
 *   dossier_select     → dossierService.listRegisteredDossiers() — resolves uuid/id, returns contextUpdate
 *   document_list      → documentService.listDocuments()
 *   contact_lookup     → contactService.list()  (active dossier by default, explicit dossier override)
 *   contact_get        → contactService.list()  (find by id, return full detail)
 *   contact_create     → contactService.upsert()
 *   contact_update     → contactService.list() + contactService.upsert()
 *   contact_delete     → contactService.delete()
 *   dossier_create_key_date → dossierService.upsertKeyDate()
 *   dossier_update_key_date → dossierService.getDossier() + dossierService.upsertKeyDate()
 *   dossier_delete_key_date → dossierService.deleteKeyDate()
 *   dossier_create_key_reference → dossierService.upsertKeyReference()
 *   dossier_update_key_reference → dossierService.getDossier() + dossierService.upsertKeyReference()
 *   dossier_delete_key_reference → dossierService.deleteKeyReference()
 *   template_list      → templateService.list()
 *   template_select    → templateService.list() + fuzzy match
 *   field_populate     → contactService.list()  (resolve name for feedback)
 *   document_generate  → generateService.generateDocument()
 *   text_generate      → handled upstream in aiService (second LLM call)
 *   direct_response    → plain assistant answer passed through as feedback
 *   clarification_request → returned as-is; AiPage renders the options inline
 *   unknown            → message passed through as feedback
 *
 * Template matching (template_select) uses a two-pass strategy:
 *   1. Exact case-insensitive match or substring match (findClosestTemplate).
 *   2. Word-level partial match → returns a clarification_request with suggestion.
 *   3. No match at all → returns unknown intent.
 *
 * Called by: aiService.executeCommand()
 * Calls:     contactService | templateService | generateService | dossierService | documentService
 */
import type {
  AiCommandContext,
  AiCommandResult,
  AppLocale,
  ClarificationRequestIntent,
  ContactRecord,
  ContactUpsertInput,
  DocumentRecord,
  DossierDetail,
  DossierSummary,
  GenerateDocumentInput,
  GeneratedDocumentResult,
  InternalAiCommand,
  InvoiceRecord,
  TemplateRecord
} from '@shared/types'
import type { SemanticSearchResult } from '@shared/contracts/documents'
import { getContactManagedFieldValue, getManagedFieldKey } from '@shared/managedFields'
import { GenerateServiceError } from '../../services/domain/generateService'
import { migrateDanglingOverrideKeys, resolveDossierTags } from './dossierTagResolver'

export interface ContactServiceLike {
  list(dossierId: string): Promise<ContactRecord[]>
  upsert(input: ContactUpsertInput): Promise<ContactRecord>
  delete(dossierId: string, contactUuid: string): Promise<void>
}

export interface TemplateServiceLike {
  list(): Promise<TemplateRecord[]>
  getContent(templateUuid: string): Promise<string>
  create(input: { name: string; content: string; description?: string }): Promise<TemplateRecord>
  update(input: {
    uuid: string
    name?: string
    content?: string
    description?: string
  }): Promise<TemplateRecord>
  delete(input: { uuid: string }): Promise<void>
}

export interface GenerateServiceLike {
  generateDocument(input: GenerateDocumentInput): Promise<GeneratedDocumentResult>
}

export interface DossierServiceLike {
  listRegisteredDossiers(): Promise<DossierSummary[]>
  getDossier(input: { dossierId: string }): Promise<DossierDetail>
  registerDossier(input: { slug: string }): Promise<DossierSummary>
  updateDossier(input: {
    slug: string
    status?: string
    type?: string
    information?: string
  }): Promise<DossierDetail>
  upsertKeyDate(input: {
    dossierId: string
    uuid?: string
    label: string
    date: string
    time?: string
    duration?: number
    tags?: string[]
    isClosed?: boolean
    note?: string
  }): Promise<DossierDetail>
  deleteKeyDate(input: { dossierId: string; keyDateUuid: string }): Promise<DossierDetail>
  upsertKeyReference(input: {
    dossierId: string
    uuid?: string
    label: string
    value: string
    note?: string
  }): Promise<DossierDetail>
  deleteKeyReference(input: { dossierId: string; keyReferenceUuid: string }): Promise<DossierDetail>
  upsertBillingItem(input: {
    dossierId: string
    uuid?: string
    date: string
    label: string
    description?: string
    sourceServicePresetUuid?: string
    quantity: number
    quantityUnit: 'hours' | 'units'
    unitPriceHtCents: number
    discountKind?: 'percent' | 'amount'
    discountPercentBasisPoints?: number
    discountAmountHtCents?: number
    vatRateBasisPoints: number
    status: 'draft' | 'billed' | 'cancelled'
    sourceKeyDateUuid?: string
  }): Promise<DossierDetail>
  deleteBillingItem(input: { dossierId: string; billingItemUuid: string }): Promise<DossierDetail>
  upsertNote(input: {
    dossierId: string
    uuid?: string
    title: string
    content?: string
    kind?: 'note' | 'todo' | 'idea' | 'to_verify' | 'ai_log'
    status?: 'open' | 'done'
    tags?: string[]
    pinned?: boolean
    source?: 'user' | 'ai'
  }): Promise<DossierDetail>
  deleteNote(input: { dossierId: string; noteUuid: string }): Promise<DossierDetail>
  searchNotes(input: {
    dossierId: string
    query: string
    kind?: 'note' | 'todo' | 'idea' | 'to_verify' | 'ai_log'
    status?: 'open' | 'done'
    topK?: number
  }): Promise<
    Array<{
      noteUuid: string
      title: string
      snippet: string
      score: number
      matchKind: string
      kind?: 'note' | 'todo' | 'idea' | 'to_verify' | 'ai_log'
      status?: 'open' | 'done'
      truncated?: boolean
    }>
  >
}

export interface InvoiceServiceLike {
  list(): Promise<InvoiceRecord[]>
  get(invoiceUuid: string): Promise<InvoiceRecord>
}

export interface DocumentServiceLike {
  listDocuments(input: { dossierId: string }): Promise<DocumentRecord[]>
  saveMetadata(input: {
    dossierId: string
    documentPath: string
    description?: string
    tags: string[]
  }): Promise<DocumentRecord>
  relocateMetadata(input: {
    documentUuid: string
    dossierId: string
    fromDocumentPath?: string
    toDocumentPath: string
  }): Promise<unknown>
  resolveRegisteredDossierRoot(input: { dossierId: string }): Promise<string>
  semanticSearch(input: {
    dossierId: string
    query: string
    topK?: number
  }): Promise<SemanticSearchResult>
  /**
   * Same surface as `DocumentService.extractContent`: reads cache when
   * available, otherwise runs DOCX/PDF/OCR extraction in-process and persists
   * the result. Optional on this interface so older test doubles can omit it.
   */
  extractContent?(input: {
    dossierId: string
    documentPath: string
  }): Promise<{ text: string; filename: string }>
}

export interface InternalAICommandDispatcherOptions {
  contactService: ContactServiceLike
  templateService: TemplateServiceLike
  generateService: GenerateServiceLike
  dossierService: DossierServiceLike
  documentService: DocumentServiceLike
  /**
   * Resolves the current UI locale at dispatch time. Optional so existing
   * callers (e.g. tests) can omit it; falls back to French to match the
   * historical hardcoded behavior.
   */
  getLocale?: () => AppLocale
}

export interface InternalAICommandDispatcher {
  dispatch(intent: InternalAiCommand, context: AiCommandContext): Promise<AiCommandResult>
}

function normalizeSearchText(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function splitSearchTokens(value: string | undefined): string[] {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean)
}

function buildContactSearchHaystacks(contact: ContactRecord): string[] {
  const fullName = [
    contact.title,
    contact.firstName,
    getContactManagedFieldValue(contact, 'additionalFirstNames'),
    contact.lastName
  ]
    .filter(Boolean)
    .join(' ')

  return [
    contact.uuid,
    contact.displayName,
    fullName,
    `${contact.firstName ?? ''} ${contact.lastName ?? ''}`,
    getContactManagedFieldValue(contact, 'additionalFirstNames'),
    getContactManagedFieldValue(contact, 'maidenName'),
    contact.role,
    contact.institution,
    contact.email,
    contact.phone,
    contact.information
  ]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
}

function resolveContactRecord(
  contacts: ContactRecord[],
  rawIdentifier: string | undefined
): ContactRecord | undefined {
  const raw = rawIdentifier?.trim() ?? ''
  if (!raw) return undefined

  const normalized = normalizeSearchText(raw)
  const tokens = splitSearchTokens(raw)

  return (
    contacts.find((contact) => contact.uuid === raw) ??
    contacts.find((contact) => normalizeSearchText(contact.uuid) === normalized) ??
    contacts.find((contact) => normalizeSearchText(contact.uuid).includes(normalized)) ??
    contacts.find((contact) =>
      buildContactSearchHaystacks(contact).some(
        (haystack) => haystack === normalized || haystack.includes(normalized)
      )
    ) ??
    contacts.find((contact) =>
      buildContactSearchHaystacks(contact).some(
        (haystack) => tokens.length > 0 && tokens.every((token) => haystack.includes(token))
      )
    )
  )
}

function resolveContactCandidates(
  contacts: ContactRecord[],
  rawIdentifier: string | undefined
): ContactRecord[] {
  const raw = rawIdentifier?.trim() ?? ''
  if (!raw) return []

  const normalized = normalizeSearchText(raw)
  const tokens = splitSearchTokens(raw)
  const unique = (items: ContactRecord[]): ContactRecord[] => {
    const seen = new Set<string>()
    return items.filter((contact) => {
      if (seen.has(contact.uuid)) return false
      seen.add(contact.uuid)
      return true
    })
  }

  const exactId = contacts.filter((contact) => contact.uuid === raw)
  if (exactId.length > 0) return unique(exactId)

  const normalizedId = contacts.filter(
    (contact) => normalizeSearchText(contact.uuid) === normalized
  )
  if (normalizedId.length > 0) return unique(normalizedId)

  const partialId = contacts.filter((contact) =>
    normalizeSearchText(contact.uuid).includes(normalized)
  )
  if (partialId.length > 0) return unique(partialId)

  const haystackMatches = contacts.filter((contact) =>
    buildContactSearchHaystacks(contact).some(
      (haystack) => haystack === normalized || haystack.includes(normalized)
    )
  )
  if (haystackMatches.length > 0) return unique(haystackMatches)

  return unique(
    contacts.filter((contact) =>
      buildContactSearchHaystacks(contact).some(
        (haystack) => tokens.length > 0 && tokens.every((token) => haystack.includes(token))
      )
    )
  )
}

function formatContactOption(contact: ContactRecord): string {
  const name = [
    contact.title,
    contact.firstName,
    getContactManagedFieldValue(contact, 'additionalFirstNames'),
    contact.lastName
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const details = [contact.role, contact.institution, contact.email, contact.phone]
    .filter(Boolean)
    .slice(0, 2)
    .join(' — ')

  return details ? `${name} — ${details}` : name || contact.uuid
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

type ContactMutationIntent = Extract<
  InternalAiCommand,
  { type: 'contact_create' | 'contact_update' }
>

function hasContactIdentityFields(intent: ContactMutationIntent): boolean {
  return (
    isNonEmptyString(intent.firstName) ||
    isNonEmptyString(intent.lastName) ||
    isNonEmptyString(intent.institution)
  )
}

function hasContactMutationChanges(intent: ContactMutationIntent): boolean {
  return (
    [
      intent.firstName,
      intent.lastName,
      intent.role,
      intent.email,
      intent.phone,
      intent.title,
      intent.institution,
      intent.addressLine,
      intent.addressLine2,
      intent.city,
      intent.zipCode,
      intent.country,
      intent.information
    ].some(isNonEmptyString) || Object.keys(intent.customFields ?? {}).length > 0
  )
}

function hasDossierUpdateChanges(
  intent: Extract<InternalAiCommand, { type: 'dossier_update' }>
): boolean {
  return (
    isNonEmptyString(intent.status) ||
    isNonEmptyString(intent.dossierType) ||
    isNonEmptyString(intent.information)
  )
}

function hasKeyDateOptionalChanges(
  intent: Extract<InternalAiCommand, { type: 'dossier_update_key_date' }>
): boolean {
  return (
    isNonEmptyString(intent.time) ||
    typeof intent.duration === 'number' ||
    Array.isArray(intent.tags) ||
    typeof intent.isClosed === 'boolean' ||
    isNonEmptyString(intent.note)
  )
}

function hasKeyReferenceOptionalChanges(
  intent: Extract<InternalAiCommand, { type: 'dossier_update_key_reference' }>
): boolean {
  return isNonEmptyString(intent.note)
}

function hasTemplateUpdateChanges(
  intent: Extract<InternalAiCommand, { type: 'template_update' }>
): boolean {
  return (
    isNonEmptyString(intent.name) ||
    isNonEmptyString(intent.content) ||
    isNonEmptyString(intent.description)
  )
}

function hasDocumentMetadataChanges(
  intent: Extract<InternalAiCommand, { type: 'document_metadata_save' }>
): boolean {
  return isNonEmptyString(intent.description) || intent.tags.length > 0
}

function resolveContactUpdateTarget(
  contacts: ContactRecord[],
  intent: ContactMutationIntent,
  context: AiCommandContext
): { contact?: ContactRecord; ambiguousCandidates?: ContactRecord[] } {
  if (intent.type === 'contact_update' && isNonEmptyString(intent.contactUuid)) {
    return { contact: contacts.find((contact) => contact.uuid === intent.contactUuid) }
  }

  if (isNonEmptyString(context.contactUuid)) {
    const fromContext = resolveContactRecord(contacts, context.contactUuid)
    if (fromContext) return { contact: fromContext }
  }

  const identifiers = [
    [intent.title, intent.firstName, intent.lastName].filter(isNonEmptyString).join(' ').trim(),
    intent.institution,
    intent.email,
    intent.phone
  ].filter(isNonEmptyString)

  for (const identifier of identifiers) {
    const candidates = resolveContactCandidates(contacts, identifier)
    if (candidates.length === 1) return { contact: candidates[0] }
    if (candidates.length > 1) return { ambiguousCandidates: candidates }
  }

  return {}
}

// ── Tag path → human-readable label ──────────────────────────────────────

/**
 * Converts an internal template tag path to a user-friendly label.
 *
 * Examples:
 *   "dossier.keyDate.audience.long"  → "Date d'audience"
 *   "dossier.keyDate.renvoi"         → "Date de renvoi"
 *   "dossier.nRg"                    → "Référence nRg"
 *   "contact.avocatAdverse.email"    → "Email (avocatAdverse)"
 */
function tagPathToLabel(path: string): string {
  const segments = path.split('.')

  // dossier.keyDate.<name>[.<variant>]
  if (segments[0] === 'dossier' && segments[1] === 'keyDate' && segments[2]) {
    const key = segments[2]
    const vowels = /^[aeiouàâäéèêëîïôùûü]/i
    const prep = vowels.test(key) ? "d'" : 'de '
    return `Date ${prep}${key}`
  }

  // direct dossier reference, e.g. dossier.nRg
  if (segments[0] === 'dossier' && segments.length === 2) {
    return `Référence ${segments[1]}`
  }

  // contact.<role>.<field>
  if (segments[0] === 'contact' && segments.length >= 3) {
    return `${segments[2]} (${segments[1]})`
  }

  // fallback: join with spaces
  return segments.slice(1).join(' › ')
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function askForDossier(
  dossierService: DossierServiceLike,
  intent: InternalAiCommand
): Promise<AiCommandResult> {
  const dossiers = await dossierService.listRegisteredDossiers()
  if (dossiers.length === 0) {
    return { intent, feedback: 'Aucun dossier enregistré.' }
  }
  const clarification: ClarificationRequestIntent = {
    type: 'clarification_request',
    question: 'Pour quel dossier ?',
    options: dossiers.map((d) => d.name),
    optionIds: dossiers.map((d) => d.slug)
  }
  return { intent: clarification, feedback: clarification.question }
}

/**
 * Resolves a dossier reference (uuid or id) to the actual dossier id.
 * Returns null if no matching dossier is found.
 */
async function resolveDossierRef(
  ref: string,
  dossierService: DossierServiceLike
): Promise<string | null> {
  const all = await dossierService.listRegisteredDossiers()
  const lower = ref.toLowerCase()
  const found =
    all.find((d) => d.uuid === ref || d.slug === ref) ??
    all.find((d) => d.name.toLowerCase() === lower) ??
    all.find((d) => d.name.toLowerCase().includes(lower) || lower.includes(d.name.toLowerCase()))
  return found?.slug ?? null
}

// ── Fuzzy template matching ────────────────────────────────────────────────

function findClosestTemplate(name: string, templates: TemplateRecord[]): TemplateRecord | null {
  const lower = name.toLowerCase()
  const exact = templates.find((t) => t.name.toLowerCase() === lower)
  if (exact) return exact
  const partial = templates.find(
    (t) => t.name.toLowerCase().includes(lower) || lower.includes(t.name.toLowerCase())
  )
  return partial ?? null
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => typeof entryValue !== 'undefined'
    )
  ) as Partial<T>
}

// ── Dispatcher implementation ─────────────────────────────────────────────

export function createInternalAICommandDispatcher(
  options: InternalAICommandDispatcherOptions
): InternalAICommandDispatcher {
  const {
    contactService,
    templateService,
    generateService,
    dossierService,
    documentService,
    getLocale
  } = options
  const resolveLocale = (): AppLocale => getLocale?.() ?? 'fr'

  return {
    async dispatch(intent: InternalAiCommand, context: AiCommandContext): Promise<AiCommandResult> {
      switch (intent.type) {
        case 'dossier_list': {
          const dossiers = await dossierService.listRegisteredDossiers()
          if (dossiers.length === 0) {
            return { intent, feedback: 'Aucun dossier enregistré.' }
          }
          const lines = dossiers.map((d) => `• ${d.name} (${d.status})`).join('\n')
          return { intent, feedback: `${dossiers.length} dossier(s):\n${lines}` }
        }

        case 'dossier_select': {
          const all = await dossierService.listRegisteredDossiers()
          const dossier = all.find(
            (d) => d.uuid === intent.dossierId || d.slug === intent.dossierId
          )
          if (!dossier) {
            const names = all.map((d) => d.name).join(', ')
            return {
              intent: { type: 'unknown', message: `Dossier introuvable. Disponibles: ${names}` },
              feedback: `Dossier introuvable. Disponibles: ${names}`
            }
          }
          return {
            intent,
            feedback: `Dossier "${dossier.name}" sélectionné.`,
            contextUpdate: { dossierId: dossier.slug }
          }
        }

        case 'document_list': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          if (!rawRef) return askForDossier(dossierService, intent)
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          const docs = await documentService.listDocuments({ dossierId })
          if (docs.length === 0) {
            return { intent, feedback: 'Aucun document dans ce dossier.' }
          }
          const lines = docs
            .map((d) => {
              const meta = d.description || d.tags.length > 0 ? ' ✓' : ''
              return `• ${d.filename}${meta}`
            })
            .join('\n')
          return {
            intent,
            feedback: `${docs.length} document(s) (✓ = métadonnées présentes):\n${lines}`
          }
        }

        case 'document_get': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          if (!rawRef) return askForDossier(dossierService, intent)
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          const docs = await documentService.listDocuments({ dossierId })
          const doc = docs.find((d) => d.path === intent.documentUuid)
          if (!doc) {
            return { intent, feedback: `Document introuvable: ${intent.documentUuid}` }
          }
          const descLine = doc.description
            ? `Description: ${doc.description}`
            : 'Aucune description.'
          const tagsLine = doc.tags.length > 0 ? `Tags: ${doc.tags.join(', ')}` : 'Aucun tag.'
          return { intent, feedback: `${doc.filename}\n${descLine}\n${tagsLine}` }
        }

        case 'document_metadata_save': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          if (!rawRef) return askForDossier(dossierService, intent)
          if (!hasDocumentMetadataChanges(intent)) {
            return { intent, feedback: 'Aucune métadonnée à enregistrer.' }
          }
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          const docs = await documentService.listDocuments({ dossierId })
          const doc = docs.find(
            (d) => d.path === intent.documentUuid || d.uuid === intent.documentUuid
          )
          if (!doc) {
            return { intent, feedback: `Document introuvable: ${intent.documentUuid}` }
          }
          const updated = await documentService.saveMetadata({
            dossierId,
            documentPath: doc.path,
            description: intent.description,
            tags: intent.tags
          })
          const descLine = updated.description ? `Description: ${updated.description}` : ''
          const tagsLine = updated.tags.length > 0 ? `Tags: ${updated.tags.join(', ')}` : ''
          const details = [descLine, tagsLine].filter(Boolean).join(' — ')
          return {
            intent,
            feedback: `Métadonnées enregistrées pour "${updated.filename}". ${details}`
          }
        }

        case 'contact_lookup': {
          const explicitDossierId = intent.dossierId
          // intent.dossierId takes priority — the LLM can resolve it from conversation history
          const rawRef = explicitDossierId ?? context.dossierId ?? ''
          if (!rawRef) return askForDossier(dossierService, intent)
          const dossierId = explicitDossierId
            ? ((await resolveDossierRef(explicitDossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          const contacts = await contactService.list(dossierId)
          const count = contacts.length
          if (count === 0) {
            const hint = !dossierId ? ' (aucun dossier actif)' : ''
            return { intent, feedback: `Aucun contact dans ce dossier${hint}.` }
          }

          const lines = contacts
            .map((c) => {
              const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim()
              const role = c.role ? ` — ${c.role}` : ''
              const email = c.email ? ` <${c.email}>` : ''
              return `• ${name}${role}${email}`
            })
            .join('\n')

          const feedback = `${count} contact(s):\n${lines}`
          // Always persist the resolved dossierId so subsequent document_list / document_generate
          // commands know which dossier is active — even if it matches the current context.
          const contextUpdate = dossierId ? { dossierId } : undefined
          return { intent, feedback, contextUpdate }
        }

        case 'contact_get': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          if (!rawRef) return askForDossier(dossierService, intent)
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          const contacts = await contactService.list(dossierId)
          const contact = resolveContactRecord(contacts, intent.contactUuid)
          if (!contact) {
            return { intent, feedback: `Contact introuvable (id: ${intent.contactUuid}).` }
          }
          const name = [
            contact.title,
            contact.firstName,
            getContactManagedFieldValue(contact, 'additionalFirstNames'),
            contact.lastName
          ]
            .filter(Boolean)
            .join(' ')
          const lines: string[] = [`Nom: ${name || contact.uuid}`]
          if (contact.role) lines.push(`Rôle: ${contact.role}`)
          if (contact.institution) lines.push(`Institution: ${contact.institution}`)
          if (contact.email) lines.push(`Email: ${contact.email}`)
          if (contact.phone) lines.push(`Téléphone: ${contact.phone}`)
          if (contact.addressLine) lines.push(`Adresse: ${contact.addressLine}`)
          if (contact.addressLine2) lines.push(`         ${contact.addressLine2}`)
          if (contact.zipCode || contact.city)
            lines.push(`         ${[contact.zipCode, contact.city].filter(Boolean).join(' ')}`)
          if (contact.country) lines.push(`Pays: ${contact.country}`)
          const dateOfBirth = getContactManagedFieldValue(contact, 'dateOfBirth')
          const nationality = getContactManagedFieldValue(contact, 'nationality')
          const occupation = getContactManagedFieldValue(contact, 'occupation')
          if (dateOfBirth) lines.push(`Date de naissance: ${dateOfBirth}`)
          if (nationality) lines.push(`Nationalité: ${nationality}`)
          if (occupation) lines.push(`Profession: ${occupation}`)
          if (contact.information) lines.push(`Informations: ${contact.information}`)
          return { intent, feedback: lines.join('\n') }
        }

        case 'contact_create':
        case 'contact_update': {
          const dossierId = context.dossierId ?? ''
          if (!dossierId) return askForDossier(dossierService, intent)
          const contacts =
            intent.type === 'contact_update' ? await contactService.list(dossierId) : []
          const upsertTarget =
            intent.type === 'contact_update'
              ? resolveContactUpdateTarget(contacts, intent, context)
              : { contact: undefined, ambiguousCandidates: undefined }
          const existingContact = upsertTarget.contact

          if (intent.type === 'contact_update' && intent.contactUuid && !existingContact) {
            return {
              intent,
              feedback: 'Contact introuvable.'
            }
          }

          if (!existingContact && upsertTarget.ambiguousCandidates?.length) {
            const clarification: ClarificationRequestIntent = {
              type: 'clarification_request',
              question: 'Plusieurs contacts correspondent. Lequel mettre à jour ?',
              options: upsertTarget.ambiguousCandidates.map(formatContactOption),
              optionIds: upsertTarget.ambiguousCandidates.map((contact) => contact.uuid)
            }
            return { intent: clarification, feedback: clarification.question }
          }

          const isPatchWithoutTarget =
            intent.type === 'contact_update' &&
            !existingContact &&
            !hasContactIdentityFields(intent) &&
            hasContactMutationChanges(intent)

          if (isPatchWithoutTarget) {
            if (contacts.length === 0) {
              return {
                intent,
                feedback: 'Aucun contact existant à mettre à jour dans ce dossier.'
              }
            }

            const clarification: ClarificationRequestIntent = {
              type: 'clarification_request',
              question: 'Quel contact faut-il mettre à jour ?',
              options: contacts.map(formatContactOption),
              optionIds: contacts.map((contact) => contact.uuid)
            }
            return { intent: clarification, feedback: clarification.question }
          }

          if (intent.type === 'contact_create' && !hasContactIdentityFields(intent)) {
            return {
              intent,
              feedback: "Impossible de créer un contact sans élément d'identité explicite."
            }
          }

          // Merge intent.customFields (keyed by label) into the existing customFields,
          // normalising each label to its canonical key via getManagedFieldKey.
          const mergedCustomFields =
            intent.customFields && typeof intent.customFields === 'object'
              ? Object.fromEntries(
                  Object.entries(intent.customFields as Record<string, string>).map(
                    ([label, value]) => [getManagedFieldKey(label), value]
                  )
                )
              : undefined

          const input = {
            dossierId,
            ...(existingContact ?? {}),
            ...pickDefined({
              uuid: existingContact?.uuid,
              firstName: intent.firstName,
              lastName: intent.lastName,
              role: intent.role,
              email: intent.email,
              phone: intent.phone,
              title: intent.title,
              institution: intent.institution,
              addressLine: intent.addressLine,
              addressLine2: intent.addressLine2,
              city: intent.city,
              zipCode: intent.zipCode,
              country: intent.country,
              information: intent.information
            }),
            ...(mergedCustomFields
              ? {
                  customFields: { ...(existingContact?.customFields ?? {}), ...mergedCustomFields }
                }
              : {})
          } satisfies ContactUpsertInput
          const saved = (await contactService.upsert(input)) as ContactRecord
          const name = `${saved.firstName ?? ''} ${saved.lastName ?? ''}`.trim()
          const action = existingContact ? 'mis à jour' : 'ajouté'
          return {
            intent,
            feedback: `Contact "${name}" ${action}.`,
            contextUpdate: { contactUuid: saved.uuid },
            entity: {
              id: saved.uuid,
              firstName: saved.firstName,
              lastName: saved.lastName,
              role: saved.role,
              email: saved.email,
              phone: saved.phone,
              title: saved.title,
              institution: saved.institution,
              addressLine: saved.addressLine,
              city: saved.city,
              zipCode: saved.zipCode,
              country: saved.country,
              information: saved.information
            }
          }
        }

        case 'contact_delete': {
          const dossierId = context.dossierId ?? ''
          if (!dossierId) return askForDossier(dossierService, intent)
          const contacts = await contactService.list(dossierId)
          const candidates = resolveContactCandidates(contacts, intent.contactUuid)
          if (candidates.length > 1) {
            const clarification: ClarificationRequestIntent = {
              type: 'clarification_request',
              question: 'Plusieurs contacts correspondent. Lequel supprimer ?',
              options: candidates.map(formatContactOption),
              optionIds: candidates.map((contact) => contact.uuid)
            }
            return { intent: clarification, feedback: clarification.question }
          }
          const contact = candidates[0] ?? resolveContactRecord(contacts, intent.contactUuid)
          if (!contact) {
            return {
              intent,
              feedback: 'Contact introuvable.'
            }
          }
          await contactService.delete(dossierId, contact.uuid)
          return { intent, feedback: 'Contact supprimé.' }
        }

        case 'template_list': {
          const templates = await templateService.list()
          if (templates.length === 0) {
            return { intent, feedback: 'Aucun modèle disponible.' }
          }
          const lines = templates
            .map((t) => `• ${t.name}${t.description ? ` — ${t.description}` : ''}`)
            .join('\n')
          return { intent, feedback: `${templates.length} modèle(s):\n${lines}` }
        }

        case 'template_select': {
          const templates = await templateService.list()
          const match = findClosestTemplate(intent.templateName, templates)

          if (match) {
            return {
              intent: { type: 'template_select', templateName: match.name },
              feedback: `Modèle "${match.name}" sélectionné.`,
              contextUpdate: { templateUuid: match.uuid }
            }
          }

          const closeMatch = templates.find((t) =>
            t.name
              .toLowerCase()
              .split(' ')
              .some((word) => intent.templateName.toLowerCase().includes(word))
          )

          if (closeMatch) {
            const clarification: ClarificationRequestIntent = {
              type: 'clarification_request',
              question: `Modèle "${intent.templateName}" introuvable. Voulez-vous dire "${closeMatch.name}" ?`,
              options: [closeMatch.name, 'Annuler'],
              optionIds: [closeMatch.uuid, '']
            }
            return { intent: clarification, feedback: clarification.question }
          }

          const available = templates.map((t) => t.name).join(', ')
          const unknownIntent = {
            type: 'unknown' as const,
            message: `Modèle "${intent.templateName}" introuvable. Disponibles: ${available || 'aucun'}.`
          }
          return { intent: unknownIntent, feedback: unknownIntent.message }
        }

        case 'field_populate': {
          const dossierId = context.dossierId ?? ''
          const contacts = dossierId ? await contactService.list(dossierId) : []
          const contact = contacts.find((c) => c.uuid === intent.contactUuid)
          const contactName = contact
            ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()
            : intent.contactUuid
          return { intent, feedback: `Champs renseignés depuis les données de ${contactName}.` }
        }

        case 'document_generate': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ??
              context.dossierId ??
              rawRef)
            : rawRef
          let templateUuid = intent.templateUuid ?? context.templateUuid ?? ''
          const missing: string[] = []
          if (!dossierId) missing.push('dossier')
          if (!templateUuid) missing.push('modèle')
          if (missing.length > 0) {
            const clarification: ClarificationRequestIntent = {
              type: 'clarification_request',
              question: `Pour générer le document, précisez: ${missing.join(' et ')}.`,
              options: ['Annuler'],
              optionIds: ['']
            }
            return { intent: clarification, feedback: clarification.question }
          }
          // Validate that templateUuid exists — the LLM sometimes puts a name instead of an ID.
          // If the ID is unknown, attempt fuzzy match by name/description as fallback.
          let templateMacros: string[] = []
          {
            const allTemplates = await templateService.list()
            const known = allTemplates.find((t) => t.uuid === templateUuid)
            if (known) {
              templateMacros = known.macros ?? []
            } else {
              // Try to fuzzy-match the value the LLM provided as if it were a name
              const fuzzy = findClosestTemplate(templateUuid, allTemplates)
              if (fuzzy) {
                templateUuid = fuzzy.uuid
                templateMacros = fuzzy.macros ?? []
              } else {
                const available = allTemplates.map((t) => t.name).join(', ')
                return {
                  intent,
                  feedback: `Modèle introuvable. Disponibles: ${available || 'aucun'}.`
                }
              }
            }
          }
          // The LLM sometimes emits short keys (`dateDAudience`, `dossier_1`)
          // instead of the full template path (`dossier.keyDate.audience.long`).
          // generateService silently ignores unknown keys — the generation
          // would then ask for the same field again, hiding the cause. Migrate
          // unique token matches onto their target macro path; drop the rest
          // and log so the failure mode is no longer silent.
          const rawOverrides: Record<string, string> = { ...(intent.tagOverrides ?? {}) }
          const {
            migrated: baseOverrides,
            migrations: overrideMigrations,
            dropped: droppedOverrideKeys
          } = migrateDanglingOverrideKeys(rawOverrides, templateMacros)
          if (overrideMigrations.length > 0) {
            console.log(
              `[document_generate] migrated ${overrideMigrations.length} override key(s) onto template macros:`,
              overrideMigrations
            )
          }
          if (droppedOverrideKeys.length > 0) {
            console.warn(
              `[document_generate] dropping ${droppedOverrideKeys.length} override key(s) with no matching template macro:`,
              { dropped: droppedOverrideKeys, templateMacros }
            )
          }
          console.log(
            `[document_generate] start dossierId=${dossierId} templateUuid=${templateUuid} overrideKeys=${JSON.stringify(Object.keys(baseOverrides))}`
          )

          const buildInput = (overrides: Record<string, string>): GenerateDocumentInput =>
            ({
              dossierId,
              templateUuid,
              primaryContactUuid: intent.contactUuid,
              tagOverrides: Object.keys(overrides).length > 0 ? overrides : undefined
            }) satisfies GenerateDocumentInput

          let mergedOverrides = baseOverrides
          let hasRetried = false

          const generateOnce = async (): Promise<AiCommandResult> => {
            try {
              const result = (await generateService.generateDocument(
                buildInput(mergedOverrides)
              )) as GeneratedDocumentResult
              const filename = result.outputPath.split('/').pop() ?? result.outputPath
              console.log(
                `[document_generate] success file=${filename} retried=${hasRetried} mergedKeys=${JSON.stringify(Object.keys(mergedOverrides))}`
              )
              const locale = resolveLocale()
              const successFeedback =
                locale === 'en'
                  ? `Document generated: ${filename}.`
                  : `Document généré: ${filename}.`
              return {
                intent,
                feedback: successFeedback,
                generatedFilePath: result.outputPath,
                contextUpdate: { pendingTagPaths: undefined }
              }
            } catch (err) {
              if (
                !(err instanceof GenerateServiceError) ||
                !err.unresolvedTags ||
                err.unresolvedTags.length === 0
              ) {
                console.error(
                  `[document_generate] failed without unresolvedTags err=${err instanceof Error ? err.message : String(err)}`
                )
                throw err
              }

              console.warn(
                `[document_generate] generateService reported unresolvedTags=${JSON.stringify(err.unresolvedTags)} retried=${hasRetried}`
              )

              // First pass through the catch: try auto-resolving chronology dates and
              // direct dossier references from the live dossier before bothering the user.
              if (!hasRetried) {
                hasRetried = true
                let dossierDetail: DossierDetail | undefined
                try {
                  dossierDetail = await dossierService.getDossier({ dossierId })
                } catch (loadErr) {
                  console.warn(
                    `[document_generate] could not load dossier for auto-resolve: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`
                  )
                }
                if (dossierDetail) {
                  const auto = resolveDossierTags({
                    unresolvedTags: err.unresolvedTags,
                    keyDates: dossierDetail.keyDates,
                    keyReferences: dossierDetail.keyReferences
                  })
                  console.log(
                    `[document_generate] auto-resolve resolved=${JSON.stringify(Object.keys(auto.resolvedOverrides))} stillUnresolved=${JSON.stringify(auto.stillUnresolved)} ambiguous=${JSON.stringify(auto.ambiguous)}`
                  )
                  if (Object.keys(auto.resolvedOverrides).length > 0) {
                    mergedOverrides = { ...mergedOverrides, ...auto.resolvedOverrides }
                    return generateOnce()
                  }
                }
              }

              // Still unresolved after the auto-pass — emit a clarification, enriched with
              // the dossier's known key dates / references so the user (and the LLM) can pick.
              let dossierDetail: DossierDetail | undefined
              try {
                dossierDetail = await dossierService.getDossier({ dossierId })
              } catch {
                // best-effort enrichment
              }
              const fieldLines = err.unresolvedTags
                .map((p) => `• ${tagPathToLabel(p)} (\`${p}\`)`)
                .join('\n')
              const knownLines: string[] = []
              if (dossierDetail) {
                for (const kd of dossierDetail.keyDates) {
                  knownLines.push(`• ${kd.label}: ${kd.date}`)
                }
                for (const kr of dossierDetail.keyReferences) {
                  knownLines.push(`• ${kr.label}: ${kr.value}`)
                }
              }
              const locale = resolveLocale()
              const knownHeading =
                locale === 'en'
                  ? 'Known dates and references on this dossier:'
                  : 'Dates et références connues sur le dossier:'
              const knownBlock = knownLines.length
                ? `\n${knownHeading}\n${knownLines.join('\n')}`
                : ''
              const sampleTag = err.unresolvedTags[0] ?? 'dossier.keyDate.X.long'
              const question =
                locale === 'en'
                  ? `Some template fields need values:\n${fieldLines}${knownBlock}\nEnter the value (e.g. "April 5, 2026", "District Court of Nice"). It will be inserted as-is into the document.\n\n[For the LLM: on the next \`document_generate\` retry, \`tagOverrides\` keys must be EXACTLY the paths listed above between backticks, e.g. \`${sampleTag}\`.]`
                  : `Certains champs du modèle doivent être renseignés:\n${fieldLines}${knownBlock}\nSaisissez la valeur (ex: "5 avril 2026", "Tribunal de Nice"). Elle sera insérée telle quelle dans le document.\n\n[Pour le LLM: lors de la prochaine relance de \`document_generate\`, les clés de \`tagOverrides\` doivent être EXACTEMENT les chemins listés ci-dessus entre backticks, par ex. \`${sampleTag}\`.]`
              const cancelLabel = locale === 'en' ? 'Cancel' : 'Annuler'
              const clarification: ClarificationRequestIntent = {
                type: 'clarification_request',
                question,
                options: [cancelLabel],
                optionIds: ['']
              }
              console.warn(
                `[document_generate] emitting clarification for ${err.unresolvedTags.length} unresolved tag(s): ${JSON.stringify(err.unresolvedTags)}`
              )
              return {
                intent: clarification,
                feedback: clarification.question,
                // Persist dossierId + templateUuid so the next turn can retry without re-resolving them
                contextUpdate: { dossierId, templateUuid, pendingTagPaths: err.unresolvedTags }
              }
            }
          }

          return generateOnce()
        }

        case 'dossier_create': {
          await dossierService.registerDossier({ slug: intent.id })
          return { intent, feedback: `Dossier "${intent.id}" créé.` }
        }

        case 'dossier_update': {
          if (!hasDossierUpdateChanges(intent)) {
            return { intent, feedback: 'Aucune modification de dossier fournie.' }
          }
          const dossierId = (await resolveDossierRef(intent.id, dossierService)) ?? intent.id
          await dossierService.updateDossier({
            slug: dossierId,
            status: intent.status,
            type: intent.dossierType,
            information: intent.information
          })
          return { intent, feedback: `Dossier "${dossierId}" mis à jour.` }
        }

        case 'dossier_create_key_date':
        case 'dossier_update_key_date': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          if (intent.type === 'dossier_update_key_date' && !hasKeyDateOptionalChanges(intent)) {
            return { intent, feedback: "Aucune modification d'événement fournie." }
          }
          const updatedDossier = await dossierService.upsertKeyDate({
            dossierId,
            uuid: intent.type === 'dossier_update_key_date' ? intent.keyDateUuid : undefined,
            label: intent.label,
            date: intent.date,
            time: intent.time,
            duration: intent.duration,
            tags: intent.tags,
            isClosed: intent.isClosed,
            note: intent.note
          })
          const savedKeyDate = updatedDossier.keyDates.find((kd) =>
            intent.type === 'dossier_update_key_date'
              ? kd.uuid === intent.keyDateUuid
              : kd.label === intent.label.trim() && kd.date === intent.date
          )
          const action = intent.type === 'dossier_update_key_date' ? 'mis à jour' : 'ajouté'
          return {
            intent,
            feedback: `Événement "${intent.label}" ${action}.`,
            entity: savedKeyDate
              ? {
                  id: savedKeyDate.uuid,
                  label: savedKeyDate.label,
                  date: savedKeyDate.date,
                  time: savedKeyDate.time,
                  duration: savedKeyDate.duration,
                  tags: savedKeyDate.tags,
                  isClosed: savedKeyDate.isClosed,
                  note: savedKeyDate.note
                }
              : undefined
          }
        }

        case 'dossier_delete_key_date': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          await dossierService.deleteKeyDate({ dossierId, keyDateUuid: intent.keyDateUuid })
          return { intent, feedback: 'Événement supprimé.' }
        }

        case 'dossier_create_key_reference':
        case 'dossier_update_key_reference': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          if (
            intent.type === 'dossier_update_key_reference' &&
            !hasKeyReferenceOptionalChanges(intent)
          ) {
            return { intent, feedback: 'Aucune modification de référence clé fournie.' }
          }
          const updatedDossier = await dossierService.upsertKeyReference({
            dossierId,
            uuid:
              intent.type === 'dossier_update_key_reference' ? intent.keyReferenceUuid : undefined,
            label: intent.label,
            value: intent.value,
            note: intent.note
          })
          const savedKeyRef = updatedDossier.keyReferences.find((kr) =>
            intent.type === 'dossier_update_key_reference'
              ? kr.uuid === intent.keyReferenceUuid
              : kr.label === intent.label.trim() && kr.value === intent.value.trim()
          )
          const action = intent.type === 'dossier_update_key_reference' ? 'mise à jour' : 'ajoutée'
          return {
            intent,
            feedback: `Référence clé "${intent.label}" ${action}.`,
            entity: savedKeyRef
              ? {
                  id: savedKeyRef.uuid,
                  label: savedKeyRef.label,
                  value: savedKeyRef.value,
                  note: savedKeyRef.note
                }
              : undefined
          }
        }

        case 'dossier_delete_key_reference': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          await dossierService.deleteKeyReference({
            dossierId,
            keyReferenceUuid: intent.keyReferenceUuid
          })
          return { intent, feedback: 'Référence clé supprimée.' }
        }

        case 'dossier_create_billing_item':
        case 'dossier_update_billing_item': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          try {
            const updatedDossier = await dossierService.upsertBillingItem({
              dossierId,
              uuid:
                intent.type === 'dossier_update_billing_item' ? intent.billingItemUuid : undefined,
              date: intent.date,
              label: intent.label,
              description: intent.description,
              sourceServicePresetUuid: intent.sourceServicePresetUuid,
              quantity: intent.quantity,
              quantityUnit: intent.quantityUnit,
              unitPriceHtCents: intent.unitPriceHtCents,
              discountKind: intent.discountKind,
              discountPercentBasisPoints: intent.discountPercentBasisPoints,
              discountAmountHtCents: intent.discountAmountHtCents,
              vatRateBasisPoints: intent.vatRateBasisPoints,
              status: intent.status,
              sourceKeyDateUuid: intent.sourceKeyDateUuid
            })
            const savedItem = updatedDossier.billingItems.find((bi) =>
              intent.type === 'dossier_update_billing_item'
                ? bi.uuid === intent.billingItemUuid
                : bi.label === intent.label.trim() && bi.date === intent.date
            )
            const action = intent.type === 'dossier_update_billing_item' ? 'mise à jour' : 'ajoutée'
            return {
              intent,
              feedback: `Prestation "${intent.label}" ${action}.`,
              entity: savedItem
                ? {
                    id: savedItem.uuid,
                    label: savedItem.label,
                    date: savedItem.date,
                    quantity: savedItem.quantity,
                    quantityUnit: savedItem.quantityUnit,
                    unitPriceHtCents: savedItem.unitPriceHtCents,
                    totalHtCents: savedItem.totalHtCents,
                    totalTtcCents: savedItem.totalTtcCents,
                    status: savedItem.status
                  }
                : undefined
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue.'
            return { intent: { type: 'unknown', message }, feedback: message }
          }
        }

        case 'dossier_delete_billing_item': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          try {
            await dossierService.deleteBillingItem({
              dossierId,
              billingItemUuid: intent.billingItemUuid
            })
            return { intent, feedback: 'Prestation supprimée.' }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue.'
            return { intent: { type: 'unknown', message }, feedback: message }
          }
        }

        case 'note_create':
        case 'note_update': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          try {
            const updatedDossier = await dossierService.upsertNote({
              dossierId,
              uuid: intent.type === 'note_update' ? intent.noteUuid : undefined,
              title: intent.title,
              content: intent.content,
              kind: intent.kind,
              status: intent.status,
              tags: intent.tags,
              pinned: intent.pinned,
              // Notes authored through the AI loop are tagged as AI-sourced.
              source: 'ai'
            })
            const savedNote = updatedDossier.notes.find((note) =>
              intent.type === 'note_update'
                ? note.uuid === intent.noteUuid
                : note.title === intent.title.trim()
            )
            const action = intent.type === 'note_update' ? 'mise à jour' : 'ajoutée'
            return {
              intent,
              feedback: `Note "${intent.title}" ${action}.`,
              entity: savedNote
                ? {
                    id: savedNote.uuid,
                    label: savedNote.title,
                    note: savedNote.content
                  }
                : undefined
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue.'
            return { intent: { type: 'unknown', message }, feedback: message }
          }
        }

        case 'note_delete': {
          const rawRef = intent.dossierId ?? context.dossierId ?? ''
          const dossierId = rawRef
            ? ((await resolveDossierRef(rawRef, dossierService)) ?? rawRef)
            : rawRef
          if (!dossierId) return askForDossier(dossierService, intent)
          try {
            await dossierService.deleteNote({ dossierId, noteUuid: intent.noteUuid })
            return { intent, feedback: 'Note supprimée.' }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue.'
            return { intent: { type: 'unknown', message }, feedback: message }
          }
        }

        case 'template_create': {
          const created = await templateService.create({
            name: intent.name,
            content: intent.content,
            description: intent.description
          })
          return { intent, feedback: `Modèle "${created.name}" créé.` }
        }

        case 'template_update': {
          if (!hasTemplateUpdateChanges(intent)) {
            return { intent, feedback: 'Aucune modification de modèle fournie.' }
          }
          const updated = await templateService.update({
            uuid: intent.uuid,
            name: intent.name,
            content: intent.content,
            description: intent.description
          })
          return { intent, feedback: `Modèle "${updated.name}" mis à jour.` }
        }

        case 'template_delete': {
          await templateService.delete({ uuid: intent.uuid })
          return { intent, feedback: 'Modèle supprimé.' }
        }

        case 'document_relocate': {
          const dossierId = intent.dossierId
            ? ((await resolveDossierRef(intent.dossierId, dossierService)) ?? intent.dossierId)
            : (context.dossierId ?? '')
          if (!dossierId) return askForDossier(dossierService, intent)
          if (intent.fromDocumentPath && intent.fromDocumentPath === intent.toDocumentPath) {
            return {
              intent,
              feedback: 'La nouvelle localisation du document est identique a l ancienne.'
            }
          }
          await documentService.relocateMetadata({
            documentUuid: intent.documentUuid,
            dossierId,
            fromDocumentPath: intent.fromDocumentPath,
            toDocumentPath: intent.toDocumentPath
          })
          return { intent, feedback: `Document déplacé vers "${intent.toDocumentPath}".` }
        }

        case 'document_analyze': {
          return {
            intent,
            feedback: 'Analyse de document non disponible dans ce dispatcher.'
          }
        }

        case 'text_generate': {
          // Should be handled upstream in aiService before dispatch.
          // Fallback if it reaches here.
          return {
            intent,
            feedback: 'Génération de texte non disponible dans ce mode.'
          }
        }

        case 'dossier_summarize': {
          // Should be handled upstream in aiService where the runtime + PII context live.
          // Fallback if it reaches here.
          return {
            intent,
            feedback: 'Synthèse de dossier non disponible dans ce mode.'
          }
        }

        case 'document_metadata_batch':
        case 'document_summary_batch': {
          // Should be handled upstream in aiService where the runtime + PII context live.
          // Fallback if it reaches here.
          return {
            intent,
            feedback: 'Traitement par lot non disponible dans ce mode.'
          }
        }

        case 'direct_response': {
          return { intent, feedback: intent.message }
        }

        case 'clarification_request': {
          return { intent, feedback: intent.question }
        }

        case 'unknown': {
          return { intent, feedback: intent.message }
        }

        default: {
          const exhaustiveCheck: never = intent
          const msg = `Type d'intention non reconnu: ${(exhaustiveCheck as InternalAiCommand).type}`
          return {
            intent: { type: 'unknown', message: msg },
            feedback: msg
          }
        }
      }
    }
  }
}
