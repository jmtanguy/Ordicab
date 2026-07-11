/**
 * aiToolDefinitions — SDK-native tool contract for aiSdkAgentRuntime.
 */

/**
 * Action tools that can be executed inline within the tool loop, allowing the
 * model to chain multiple calls in a single turn (e.g. add several contacts).
 * Non-batchable tools (text_generate, document_generate) require separate LLM
 * calls or complex orchestration and are not eligible for inline execution.
 */
export const BATCHABLE_ACTION_TOOL_NAMES = new Set([
  'contact_create',
  'contact_update',
  'contact_delete',
  'dossier_select',
  'template_select',
  'dossier_create_key_date',
  'dossier_update_key_date',
  'dossier_delete_key_date',
  'dossier_create_key_reference',
  'dossier_update_key_reference',
  'dossier_delete_key_reference',
  'dossier_create_billing_item',
  'dossier_update_billing_item',
  'dossier_delete_billing_item',
  'note_create',
  'note_update',
  'note_delete',
  'document_analyze',
  'document_metadata_save',
  'document_rename',
  'document_split',
  'document_move'
])

/**
 * Maps each mutating action tool to the data-tool names whose cached results
 * become stale after that action is dispatched.
 * Used by appendHistory() to evict obsolete tool messages from conversation history.
 */
export const STALE_TOOL_NAMES_AFTER_ACTION: Partial<Record<string, string[]>> = {
  contact_create: ['contact_lookup', 'contact_get', 'document_search', 'document_analyze'],
  contact_update: ['contact_lookup', 'contact_get', 'document_search', 'document_analyze'],
  contact_delete: ['contact_lookup', 'contact_get'],
  document_generate: ['document_list'],
  document_augment: ['document_list'],
  document_metadata_save: ['document_list', 'document_get'],
  document_metadata_batch: ['document_list', 'document_get'],
  document_summary_batch: ['document_list', 'document_get'],
  document_analyze: ['document_list', 'document_get'],
  document_relocate: ['document_list'],
  document_rename: ['document_list', 'document_get', 'document_search', 'document_analyze'],
  document_split: ['document_list', 'document_search', 'document_analyze'],
  document_move: ['document_list', 'document_get', 'document_search', 'document_analyze'],
  dossier_select: ['contact_lookup', 'contact_get', 'document_list'],
  dossier_create: ['dossier_get', 'dossier_list'],
  dossier_update: ['dossier_get', 'dossier_list'],
  dossier_create_key_date: ['dossier_get'],
  dossier_update_key_date: ['dossier_get'],
  dossier_delete_key_date: ['dossier_get'],
  dossier_create_key_reference: ['dossier_get'],
  dossier_update_key_reference: ['dossier_get'],
  dossier_delete_key_reference: ['dossier_get'],
  dossier_create_billing_item: ['dossier_get'],
  dossier_update_billing_item: ['dossier_get'],
  dossier_delete_billing_item: ['dossier_get'],
  note_create: ['note_search', 'note_get', 'dossier_get'],
  note_update: ['note_search', 'note_get', 'dossier_get'],
  note_delete: ['note_search', 'note_get', 'dossier_get'],
  template_select: ['template_list'],
  template_create: ['template_list'],
  template_update: ['template_list'],
  template_delete: ['template_list']
}

import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { KEY_DATE_TAG_VALUES } from '@shared/domain/dossier'
import { NOTE_KIND_VALUES, NOTE_STATUS_VALUES } from '@shared/domain/dossierNote'
import {
  BILLING_ITEM_DISCOUNT_KIND_VALUES,
  BILLING_ITEM_QUANTITY_UNIT_VALUES,
  BILLING_ITEM_STATUS_VALUES
} from '@shared/domain/billing'

type ToolMap = Record<string, Tool<Record<string, unknown>>>

const contactMutationFieldsSchema = {
  firstName: z.string().optional().describe('First name.'),
  lastName: z.string().optional().describe('Last name.'),
  role: z.string().optional().describe('Role in the dossier.'),
  email: z.string().optional().describe('Email address.'),
  phone: z.string().optional().describe('Phone number.'),
  title: z.string().optional().describe('Title or honorific.'),
  institution: z.string().optional().describe('Institution or organisation.'),
  addressLine: z
    .string()
    .optional()
    .describe(
      'Street address line 1 only (e.g. "6 place Wilson"). Do NOT include complements, building names, or postal codes here.'
    ),
  addressLine2: z
    .string()
    .optional()
    .describe(
      'Address complement / second line (e.g. building name, BP, "Bât. B"). Never duplicate content from addressLine.'
    ),
  city: z
    .string()
    .optional()
    .describe('City name only, without postal code (e.g. "Nice", not "06000 Nice").'),
  zipCode: z
    .string()
    .optional()
    .describe('Postal code only, without city name (e.g. "06000", not "06000 Nice").'),
  country: z.string().optional().describe('Country.'),
  information: z.string().optional().describe('Additional information.'),
  customFields: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Values for managed contact fields not covered by the standard parameters. Keys must be exact field labels from managed_fields_get.'
    )
} satisfies Record<string, z.ZodTypeAny>

const dossierKeyDateFieldsSchema = {
  dossierId: z.string().describe('Target dossier ID.'),
  label: z.string().describe('Label for the event (e.g. "Audience", "Expertise", "Rendez-vous").'),
  date: z.string().describe('Date in YYYY-MM-DD format.'),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('Optional time in HH:MM (24h) format.'),
  duration: z.number().int().min(1).optional().describe('Optional duration in minutes.'),
  tags: z
    .array(z.enum(KEY_DATE_TAG_VALUES))
    .optional()
    .describe(
      'Optional cumulative tags. Do NOT use for past/upcoming — auto-computed from the date.'
    ),
  isClosed: z
    .boolean()
    .optional()
    .describe('Mark the event as closed (handled). Defaults to false / open.'),
  note: z.string().optional().describe('Optional free-text information.')
} satisfies Record<string, z.ZodTypeAny>

const dossierKeyReferenceFieldsSchema = {
  dossierId: z.string().describe('Target dossier ID.'),
  label: z.string().describe('Label for the key reference.'),
  value: z.string().describe('Value of the key reference.'),
  note: z.string().optional().describe('Optional note.')
} satisfies Record<string, z.ZodTypeAny>

const dossierNoteFieldsSchema = {
  dossierId: z
    .string()
    .describe('Target dossier ID. Omit-not-allowed: pass the active dossier ID.'),
  title: z.string().describe('Short title summarising the note.'),
  content: z
    .string()
    .optional()
    .describe('Body of the note (plain text / light markdown). Optional but usually provided.'),
  kind: z
    .enum(NOTE_KIND_VALUES)
    .optional()
    .describe(
      'Note kind; "ai_log" when YOU are saving a research/reasoning trace for later recall. Defaults to "note".'
    ),
  status: z
    .enum(NOTE_STATUS_VALUES)
    .optional()
    .describe('Todo status: "open" or "done". Use mainly with kind "todo".'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Optional free-form tags (e.g. "prescription", "à rappeler client").'),
  pinned: z.boolean().optional().describe('Pin the note to the top of the list.')
} satisfies Record<string, z.ZodTypeAny>

const dossierBillingItemFieldsSchema = {
  dossierId: z.string().describe('Target dossier ID.'),
  date: z.string().describe('Date of the service in YYYY-MM-DD format.'),
  label: z
    .string()
    .describe('Short label for the service (e.g. "Consultation", "Rédaction acte").'),
  description: z.string().optional().describe('Optional longer description of the service.'),
  quantity: z
    .number()
    .positive()
    .describe(
      'Quantity billed: number of hours when quantityUnit is "hours", otherwise a unit count.'
    ),
  quantityUnit: z
    .enum(BILLING_ITEM_QUANTITY_UNIT_VALUES)
    .describe('Unit for the quantity: "hours" for time-based work, "units" for fixed-price items.'),
  unitPriceHtCents: z
    .number()
    .int()
    .min(0)
    .describe('Unit price excluding VAT, in cents (e.g. 15000 = 150,00 € HT per hour/unit).'),
  vatRateBasisPoints: z
    .number()
    .int()
    .min(0)
    .describe('VAT rate in basis points (e.g. 2000 = 20%). Use 0 for VAT-exempt items.'),
  status: z
    .enum(BILLING_ITEM_STATUS_VALUES)
    .describe(
      'Status: "draft" for a new editable item, "cancelled" to void. Never set "billed" — that is managed by invoicing.'
    ),
  discountKind: z
    .enum(BILLING_ITEM_DISCOUNT_KIND_VALUES)
    .optional()
    .describe('Optional discount type: "percent" or "amount". Omit when there is no discount.'),
  discountPercentBasisPoints: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Discount in basis points when discountKind is "percent" (e.g. 1000 = 10%).'),
  discountAmountHtCents: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Discount amount in cents (HT) when discountKind is "amount".'),
  sourceServicePresetUuid: z
    .string()
    .optional()
    .describe('Optional ID of a cabinet service preset this item is based on.'),
  sourceKeyDateUuid: z
    .string()
    .optional()
    .describe('Optional ID of the timeline event (key date) this service relates to.')
} satisfies Record<string, z.ZodTypeAny>

/**
 * Data tools: result fed back to the LLM, loop continues.
 *
 * Descriptions are intentionally terse: cross-tool rules (MUST-call-not-narrate,
 * optional dossierId = active dossier, exact-ID resolution, per-domain workflows)
 * live ONCE in aiSystemPrompt.ts — do not re-add them per tool, the whole
 * payload is re-sent on every step of the loop.
 */
export function buildDataTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
): ToolMap {
  return {
    entity_get: tool({
      description:
        "Get the professional entity profile from Settings (the user's own cabinet/firm: name, address, phone, email, VAT, other `entity.*` values used in templates). " +
        'Primary source of truth for cabinet info — do NOT use `contact_lookup`/`document_search` for it. If a field is missing here, say it is not configured in Settings.',
      inputSchema: z.object({}),
      execute: async (args) => execute('entity_get', args as Record<string, unknown>)
    }),
    managed_fields_get: tool({
      description:
        'Load the configured contact roles and managed field definitions, so you know which roles/fields exist and what to extract from the request or source. ' +
        "Do NOT use it for read-only contact questions (listing contacts, reading an existing contact's email/phone/address/role…).",
      inputSchema: z.object({}),
      execute: async (args) => execute('managed_fields_get', args as Record<string, unknown>)
    }),
    contact_lookup: tool({
      description:
        'List all contacts in a dossier with their UUIDs. ' +
        'Use it to list/search contacts, answer read-only contact questions, or resolve a UUID (`contactUuid`) before contact_get or a contact action. READ-ONLY.',
      inputSchema: z.object({
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('contact_lookup', args as Record<string, unknown>)
    }),
    contact_get: tool({
      description: 'Get full details of a contact by UUID (`contactUuid` from contact_lookup).',
      inputSchema: z.object({
        contactUuid: z.string().describe('Contact UUID from a contact_lookup result.'),
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('contact_get', args as Record<string, unknown>)
    }),
    template_list: tool({
      description:
        'List all available templates with their ID, name, and description. ' +
        'Use this tool to choose a template or answer questions about available templates.',
      inputSchema: z.object({}),
      execute: async (args) => execute('template_list', args as Record<string, unknown>)
    }),
    document_list: tool({
      description:
        'List documents in a dossier with their name, date, type, and whether they already have metadata (description/tags). ' +
        'Use this for all document queries: full list, latest document, filtering by extension, or finding documents without metadata.',
      inputSchema: z.object({
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('document_list', args as Record<string, unknown>)
    }),
    document_get: tool({
      description:
        'Get a document’s metadata: uuid, filename, description, tags, totalChars, totalLines. ' +
        'Does NOT return the text — use it to gauge size before reading with document_analyze (optionally charStart/charEnd for a range).',
      inputSchema: z.object({
        documentUuid: z.string().describe('UUID of the document from document_list.'),
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('document_get', args as Record<string, unknown>)
    }),
    document_load_paragraphs: tool({
      description:
        'Extract indexed paragraphs from an existing Word document for augmentation. Returns numbered paragraphs [0] text..., [1] text..., etc. ' +
        'Read this first to understand the document structure, then use document_augment to apply tracked changes.',
      inputSchema: z.object({
        documentUuid: z.string().describe('UUID of the Word document'),
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('document_load_paragraphs', args as Record<string, unknown>)
    }),
    redaction_document_read: tool({
      description:
        'Read the CURRENT state of the active drafting session document (rédaction assistée) as numbered paragraphs [0] text..., [1] text... ' +
        'MUST be called before every redaction_edit — earlier turns may have shifted the paragraph indices.',
      inputSchema: z.object({}),
      execute: async (args) => execute('redaction_document_read', args as Record<string, unknown>)
    }),
    dossier_get: tool({
      description:
        'Get full dossier details: key dates, key references, billing items (prestations), fee agreements, and issued invoices (factures). ' +
        'Use for dossier-level questions about prestations, amounts invoiced/paid/remaining, and fee agreements. ' +
        '`financialSummary` has precomputed HT/VAT/TTC/paid/remaining totals — prefer them over summing lines.',
      inputSchema: z.object({
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('dossier_get', args as Record<string, unknown>)
    }),
    dossier_list: tool({
      description:
        'List all registered dossiers in the domain with their id, name, status, and type. ' +
        'Use this to discover dossiers — for example to resolve a dossier the user named, or to work across more than one dossier in the same turn.',
      inputSchema: z.object({}),
      execute: async (args) => execute('dossier_list', args as Record<string, unknown>)
    }),
    document_search: tool({
      description:
        'Hybrid search (exact + semantic) over the extracted text of a dossier’s documents. Returns ranked excerpts with score and matchType ("exact" scores ≥ 1 and ranks above "semantic"); use both to judge trust. ' +
        'Use it whenever the user asks about dossier CONTENT (demands, claims, facts, amounts, dates, positions, history), and as the FALLBACK for contact details missing from contact_lookup. ' +
        'QUERY EXPANSION: call 2–4 times with DIFFERENT queries (legal concept, party name, synonyms, document type); never repeat a query. Aggregate all excerpts before answering. ' +
        'Each hit may carry a `page` (1-based source page) for PDF/OCR documents — useful to locate a passage or to drive a `document_split`. ' +
        'Only works on documents already indexed via the Documents tab. If nothing is returned, say so.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Natural language search query describing the information to find (e.g. "demandes de la partie adverse", "pension alimentaire", "dates d\'audience").'
          ),
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('document_search', args as Record<string, unknown>)
    }),
    note_search: tool({
      description:
        'Hybrid search (keyword + semantic) over the dossier NOTES — the lawyer’s pense-bête / TODO / reflection log, including your own saved traces (kind "ai_log"). SEPARATE from document_search: notes are short memos, not documents. ' +
        'Returns notes with noteUuid, title, kind, status, an excerpt, a `truncated` flag, and matchType. ' +
        'Omit `query` to list ALL notes (pinned first, then most recent); do NOT pass "*". Optionally filter by kind/status. READ-ONLY.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            'Natural language query describing the note(s) to find. Omit (or leave empty) to list ALL notes in the dossier.'
          ),
        dossierId: z.string().optional(),
        kind: z
          .enum(NOTE_KIND_VALUES)
          .optional()
          .describe('Restrict to one note kind: note, todo, idea, to_verify, ai_log.'),
        status: z
          .enum(NOTE_STATUS_VALUES)
          .optional()
          .describe('Restrict to a todo status: open or done.')
      }),
      execute: async (args) => execute('note_search', args as Record<string, unknown>)
    }),
    note_get: tool({
      description:
        'Read ONE dossier note in full by its `noteUuid` (from note_search): title, full content (untruncated), kind, status, tags, pinned, timestamps. ' +
        'Use this when a note_search excerpt is marked `truncated`. READ-ONLY.',
      inputSchema: z.object({
        noteUuid: z.string().describe('Existing note ID, e.g. from note_search.'),
        dossierId: z.string().optional()
      }),
      execute: async (args) => execute('note_get', args as Record<string, unknown>)
    }),
    invoice_list: tool({
      description:
        'List invoices (factures) issued by the cabinet: number, type, status, payment status, dossier, client, TTC totals, key dates. ' +
        'Use first when asked how much was invoiced, paid, or remains due for a dossier. READ-ONLY.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe('Optional dossier filter. Omit to list ALL invoices (not the active dossier).')
      }),
      execute: async (args) => execute('invoice_list', args as Record<string, unknown>)
    }),
    invoice_get: tool({
      description:
        'Get the full details of a single invoice (facture) by its ID (from invoice_list): line items, VAT breakdown, payments, status, and references. READ-ONLY.',
      inputSchema: z.object({
        invoiceUuid: z.string().describe('Invoice ID from invoice_list.')
      }),
      execute: async (args) => execute('invoice_get', args as Record<string, unknown>)
    }),
    legal_search_legifrance: tool({
      description:
        'Search official French legal texts (statutes, code articles, decrees, JORF) via Légifrance/PISTE, or check whether a cited article exists. READ-ONLY. ' +
        'Mandatory before answering legal-research questions about French statutes, articles, codes, decrees, or official texts. ' +
        'Pass the natural query in `recherche`; set the other fields only to override the auto-detection. ' +
        'Results include a public `url` when available; include that source link in the answer. Official site: https://www.legifrance.gouv.fr.',
      inputSchema: z.object({
        recherche: z
          .string()
          .describe(
            'Natural-language query or citation, e.g. "article 1240 du code civil" or "responsabilité du fait des choses". Pass it as the user phrased it — do not pre-split it into fields.'
          ),
        fond: z
          .enum(['ALL', 'CODE_ETAT', 'CODE_DATE', 'LODA_ETAT', 'LODA_DATE', 'JORF', 'JURI'])
          .optional()
          .describe(
            'Optional Légifrance collection. Leave unset by default (auto-detected); set only to force a specific collection, e.g. JURI for case law.'
          ),
        typeChamp: z
          .enum(['ALL', 'TITLE', 'NUM_ARTICLE', 'ARTICLE', 'TEXTE', 'NUM'])
          .optional()
          .describe(
            'Optional search field. Leave unset unless you must target one specific field.'
          ),
        typeRecherche: z
          .enum(['EXACTE', 'TOUS_LES_MOTS_DANS_UN_CHAMP', 'UN_DES_MOTS'])
          .optional()
          .describe(
            'Optional matching mode. Leave unset by default (the query is auto-detected: EXACTE for citations, UN_DES_MOTS for natural language).'
          ),
        code: z
          .string()
          .optional()
          .describe(
            'Optional code name, e.g. "Code civil". Usually unnecessary — auto-detected from the query when present.'
          ),
        dateDebut: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Optional start date (YYYY-MM-DD) to restrict by publication/signature date.'),
        dateFin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Optional end date (YYYY-MM-DD). Defaults to dateDebut when omitted.'),
        tri: z
          .enum(['PERTINENCE', 'DATE_PUBLI_DESC', 'DATE_PUBLI_ASC', 'SIGNATURE_DATE_DESC'])
          .optional()
          .describe(
            'Optional sort order. Default PERTINENCE; use DATE_PUBLI_DESC for most recent.'
          ),
        pageTaille: z.number().int().min(1).max(20).optional()
      }),
      execute: async (args) => execute('legal_search_legifrance', args as Record<string, unknown>)
    }),
    legal_consult_legifrance: tool({
      description:
        'Consult the full official Légifrance content for a result id returned by legal_search_legifrance. READ-ONLY. ' +
        'Use this before quoting or validating the content of an article. Include the returned `url` source link in the answer when present.',
      inputSchema: z.object({
        id: z.string().describe('Légifrance id, e.g. LEGIARTI... from search results.')
      }),
      execute: async (args) => execute('legal_consult_legifrance', args as Record<string, unknown>)
    }),
    legal_search_judilibre: tool({
      description:
        'Search French judicial decisions through Judilibre via PISTE: Cour de cassation / court decision research, pourvoi numbers, ECLI, legal concepts in case law. READ-ONLY. ' +
        'Mandatory before answering legal-research questions about French case law or judicial decisions. ' +
        'Results include a public `url` when available; include that source link in the answer. Official search page: https://www.courdecassation.fr/recherche-judilibre.',
      inputSchema: z.object({
        recherche: z.string().optional().describe('Plain text query or pourvoi number.'),
        juridiction: z
          .enum(['cc', 'ca', 'tj', 'tcom'])
          .optional()
          .describe('Jurisdiction: cc=Cour de cassation, ca=cour d’appel, tj/tcom=tribunaux.'),
        chambre: z
          .string()
          .optional()
          .describe(
            'Optional chamber code (e.g. "civ1", "comm", "soc", "cr"). Resolve via legal_taxonomy_judilibre (id=chamber) before use.'
          ),
        theme: z
          .string()
          .optional()
          .describe(
            'Optional legal theme/matière. Must match a value from legal_taxonomy_judilibre (id=theme).'
          ),
        dateDebut: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Optional decision date lower bound (YYYY-MM-DD).'),
        dateFin: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Optional decision date upper bound (YYYY-MM-DD).'),
        tri: z
          .enum(['scorepub', 'score', 'date'])
          .optional()
          .describe('Optional sort: scorepub (default relevance), score, or date (most recent).'),
        nombreResultats: z.number().int().min(1).max(20).optional()
      }),
      execute: async (args) => execute('legal_search_judilibre', args as Record<string, unknown>)
    }),
    legal_taxonomy_judilibre: tool({
      description:
        'Look up the valid Judilibre vocabulary (chambers, legal themes, jurisdictions, decision types, fields) and resolve human terms to the exact codes Judilibre expects (e.g. id="chamber", contextValue="cc" → "civ1"). READ-ONLY. ' +
        'Use the returned codes as the chambre/theme/juridiction arguments of legal_search_judilibre.',
      inputSchema: z.object({
        taxonomyId: z
          .enum(['chamber', 'theme', 'jurisdiction', 'type', 'solution', 'field', 'location'])
          .describe('Which taxonomy to list.'),
        contextValue: z
          .string()
          .optional()
          .describe('Optional context, typically a jurisdiction code such as "cc" for chambers.'),
        key: z.string().optional().describe('Optional key to resolve a single value.'),
        value: z.string().optional().describe('Optional value to reverse-resolve to its key.')
      }),
      execute: async (args) => execute('legal_taxonomy_judilibre', args as Record<string, unknown>)
    }),
    legal_consult_judilibre: tool({
      description:
        'Consult the full Judilibre decision for an id returned by legal_search_judilibre. READ-ONLY. Include the returned `url` source link in the answer when present.',
      inputSchema: z.object({
        decisionId: z.string().describe('Judilibre decision id.')
      }),
      execute: async (args) => execute('legal_consult_judilibre', args as Record<string, unknown>)
    }),
    legal_verify_references: tool({
      description:
        'Extract and verify French legal references from text using Légifrance and Judilibre. READ-ONLY. ' +
        'Use this when the user asks whether references from a client, opposing counsel, or a document are correct. ' +
        'Matches include public source links when available; include those links in the answer.',
      inputSchema: z.object({
        text: z.string().describe('Text containing legal references to verify.')
      }),
      execute: async (args) => execute('legal_verify_references', args as Record<string, unknown>)
    })
  } as ToolMap
}

/**
 * Batchable action tools: executed inline within the tool loop, result fed back to LLM.
 * Descriptions are intentionally terse — shared rules live in aiSystemPrompt.ts (see buildDataTools).
 */
export function buildBatchableActionTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
): ToolMap {
  return {
    contact_create: tool({
      description:
        'Create a NEW contact in the active dossier. For correcting or enriching an EXISTING contact, use `contact_lookup` then `contact_update` instead. Provide only fields known from the request or source documents.',
      inputSchema: z.object(contactMutationFieldsSchema),
      execute: async (args) => execute('contact_create', args as Record<string, unknown>)
    }),
    contact_update: tool({
      description:
        'Update an existing contact in the active dossier with the exact `contactUuid` (UUID from contact_lookup/contact_get) and only the fields to change.',
      inputSchema: z.object({
        contactUuid: z
          .string()
          .describe('Existing contact UUID from contact_lookup or contact_get.'),
        ...contactMutationFieldsSchema
      }),
      execute: async (args) => execute('contact_update', args as Record<string, unknown>)
    }),
    contact_delete: tool({
      description:
        'Delete a contact from the active dossier. A bare contact name is accepted as `contactUuid` fallback, but resolving the exact UUID via contact_lookup first is preferred.',
      inputSchema: z.object({
        contactUuid: z
          .string()
          .describe('ID of the contact to delete, or a bare contact name as fallback.')
      }),
      execute: async (args) => execute('contact_delete', args as Record<string, unknown>)
    }),
    dossier_select: tool({
      description: 'Set a dossier as the active context.',
      inputSchema: z.object({
        dossierId: z.string().describe('ID of the dossier to select.')
      }),
      execute: async (args) => execute('dossier_select', args as Record<string, unknown>)
    }),
    template_select: tool({
      description:
        'Select a template by name. The tool result includes a `templateUuid` field — use it as the `templateUuid` in the next `document_generate` call.',
      inputSchema: z.object({
        templateName: z.string().describe('Name of the template to select.')
      }),
      execute: async (args) => execute('template_select', args as Record<string, unknown>)
    }),
    dossier_create_key_date: tool({
      description:
        'Create a NEW timeline event (chronologie) on a dossier — hearings, appointments, expertises, deadlines, etc. ' +
        'To modify an existing event, use `dossier_update_key_date` instead.',
      inputSchema: z.object(dossierKeyDateFieldsSchema),
      execute: async (args) => execute('dossier_create_key_date', args as Record<string, unknown>)
    }),
    dossier_update_key_date: tool({
      description:
        'Update an existing timeline event (chronologie). `keyDateUuid` MUST be the exact existing ID from dossier_get — never omit it. ' +
        'Provide only the fields to change, while keeping `label` and `date` explicit in the call.',
      inputSchema: z.object({
        keyDateUuid: z.string().describe('Existing key date ID from dossier_get.'),
        ...dossierKeyDateFieldsSchema
      }),
      execute: async (args) => execute('dossier_update_key_date', args as Record<string, unknown>)
    }),
    dossier_delete_key_date: tool({
      description: 'Delete a key date from a dossier.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        keyDateUuid: z.string().describe('ID of the key date to delete.')
      }),
      execute: async (args) => execute('dossier_delete_key_date', args as Record<string, unknown>)
    }),
    dossier_create_key_reference: tool({
      description:
        'Create a NEW key reference on a dossier. To modify an existing key reference, use `dossier_update_key_reference` instead.',
      inputSchema: z.object(dossierKeyReferenceFieldsSchema),
      execute: async (args) =>
        execute('dossier_create_key_reference', args as Record<string, unknown>)
    }),
    dossier_update_key_reference: tool({
      description:
        'Update an existing key reference on a dossier. `keyReferenceUuid` MUST be the exact existing ID from dossier_get — never omit it.',
      inputSchema: z.object({
        keyReferenceUuid: z.string().describe('Existing key reference ID from dossier_get.'),
        ...dossierKeyReferenceFieldsSchema
      }),
      execute: async (args) =>
        execute('dossier_update_key_reference', args as Record<string, unknown>)
    }),
    dossier_delete_key_reference: tool({
      description: 'Delete a key reference from a dossier.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        keyReferenceUuid: z.string().describe('ID of the key reference to delete.')
      }),
      execute: async (args) =>
        execute('dossier_delete_key_reference', args as Record<string, unknown>)
    }),
    dossier_create_billing_item: tool({
      description:
        'Create a NEW billing item (prestation) on a dossier — a billable line of work such as a consultation, a drafted act, or a court appearance. ' +
        'To modify an existing one, use `dossier_update_billing_item` instead.',
      inputSchema: z.object(dossierBillingItemFieldsSchema),
      execute: async (args) =>
        execute('dossier_create_billing_item', args as Record<string, unknown>)
    }),
    dossier_update_billing_item: tool({
      description:
        'Update an existing billing item (prestation). `billingItemUuid` MUST be the exact existing ID from dossier_get — never omit it. ' +
        'Re-state quantity, quantityUnit, unitPriceHtCents, and vatRateBasisPoints.',
      inputSchema: z.object({
        billingItemUuid: z.string().describe('Existing billing item ID from dossier_get.'),
        ...dossierBillingItemFieldsSchema
      }),
      execute: async (args) =>
        execute('dossier_update_billing_item', args as Record<string, unknown>)
    }),
    dossier_delete_billing_item: tool({
      description: 'Delete a billing item (prestation) from a dossier.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        billingItemUuid: z.string().describe('ID of the billing item to delete.')
      }),
      execute: async (args) =>
        execute('dossier_delete_billing_item', args as Record<string, unknown>)
    }),
    note_create: tool({
      description:
        'Create a NEW note in the dossier — an UNDATED reminder, task ("todo"), idea, supposition to verify, or your own research/reasoning trace ("ai_log"). ' +
        'If the item carries a specific date (deadline, appointment, "rappelle-moi le…"), use dossier_create_key_date instead — dated reminders belong to the timeline, not to notes. ' +
        'To change an existing note, use note_update instead.',
      inputSchema: z.object(dossierNoteFieldsSchema),
      execute: async (args) => execute('note_create', args as Record<string, unknown>)
    }),
    note_update: tool({
      description:
        'Update an existing dossier note. `noteUuid` MUST be the exact existing ID from note_search — never omit it. ' +
        'Provide only the fields to change (e.g. set status "done" to complete a todo).',
      inputSchema: z.object({
        noteUuid: z.string().describe('Existing note ID from note_search.'),
        ...dossierNoteFieldsSchema
      }),
      execute: async (args) => execute('note_update', args as Record<string, unknown>)
    }),
    note_delete: tool({
      description: 'Delete a note from the dossier. Confirm with the user before deleting.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        noteUuid: z.string().describe('ID of the note to delete.')
      }),
      execute: async (args) => execute('note_delete', args as Record<string, unknown>)
    }),
    document_analyze: tool({
      description:
        "Read a single document's text as JSON { uuid, rawContent, totalChars, charsReturned, page?, pages? }. " +
        'Uses the extraction cache; on miss it runs DOCX/PDF/OCR extraction and persists it. A surfaced error means extraction failed (unsupported type, missing OCR, read error) — relay it. ' +
        'Use charStart/charEnd for a specific range (inclusive); omit both for the full document (capped at 12 000 chars). ' +
        '`pages` (when present) lists each source page as { page, charStart, charEnd } — use it to detect where distinct documents begin in a multi-document scan and to choose `document_split` ranges.',
      inputSchema: z.object({
        documentUuid: z.string().describe('UUID of the document to read.'),
        dossierId: z.string().optional(),
        charStart: z.number().optional().describe('First character offset to return (inclusive).'),
        charEnd: z.number().optional().describe('Last character offset to return (inclusive).')
      }),
      execute: async (args) => execute('document_analyze', args as Record<string, unknown>)
    }),
    document_metadata_save: tool({
      description:
        'Save a description and/or tags for ONE document. Generate a concise description (1-3 sentences) and ≤5 relevant tags from the content. ' +
        'For several documents, prefer the batch tools.',
      inputSchema: z.object({
        documentUuid: z.string().describe('Document ID to update.'),
        dossierId: z.string().optional(),
        description: z.string().optional().describe('Short description of the document.'),
        tags: z.array(z.string()).describe('List of tags for the document.')
      }),
      execute: async (args) => execute('document_metadata_save', args as Record<string, unknown>)
    }),
    document_rename: tool({
      description:
        'Rename a document file inside the active dossier. The folder is preserved; pass only the new basename. ' +
        'Choose a name that reflects the actual content (type + parties + date when known). ' +
        'Identify the file by `documentUuid` (from document_list/document_search), or by `documentPath` for a file you just created with `document_split`. ' +
        'If a single scanned PDF actually holds several distinct documents, prefer `document_split` first, then name each part. ' +
        'Never overwrites: if the chosen name is already taken, a " (2)" suffix is added automatically — the feedback reports the final name.',
      inputSchema: z.object({
        documentUuid: z.string().optional().describe('UUID of the document to rename.'),
        documentPath: z
          .string()
          .optional()
          .describe('Relative path of the document to rename (use for freshly split files).'),
        dossierId: z.string().optional(),
        newFilename: z
          .string()
          .describe(
            'New basename only — no folders. Keep the original extension (e.g. end with ".pdf"); if you omit it, the source extension is reused.'
          )
      }),
      execute: async (args) => execute('document_rename', args as Record<string, unknown>)
    }),
    document_split: tool({
      description:
        'Split a PDF into several files, e.g. when one scanned PDF bundles multiple distinct documents. ' +
        'First read the source with `document_analyze` — its `pages` array gives each page boundary, and `document_search` hits carry a `page` — then group consecutive pages per document. ' +
        'Page numbers are 1-based and inclusive. Name each range from the content of those pages so the output is self-describing; omit `filename` to auto-name. ' +
        "Use mode 'each-page' only to explode every page into its own file. The source file is left untouched; the tool returns the new file paths.",
      inputSchema: z.object({
        documentUuid: z.string().optional().describe('UUID of the source PDF to split.'),
        documentPath: z
          .string()
          .optional()
          .describe('Relative path of the source PDF (alternative to documentUuid).'),
        dossierId: z.string().optional(),
        mode: z
          .union([
            z.literal('each-page'),
            z.object({
              ranges: z
                .array(
                  z.object({
                    from: z.number().int().positive().describe('First page, 1-based inclusive.'),
                    to: z.number().int().positive().describe('Last page, 1-based inclusive.'),
                    filename: z
                      .string()
                      .optional()
                      .describe('Output basename for this segment, derived from its content.')
                  })
                )
                .min(1)
                .max(100)
            })
          ])
          .describe("'each-page' or a list of named page ranges.")
      }),
      execute: async (args) => execute('document_split', args as Record<string, unknown>)
    }),
    document_move: tool({
      description:
        'Move one or more documents into a subfolder of the active dossier — use it to group files by theme (e.g. all invoices under "Factures/2024"). ' +
        'The destination folder is created if it does not exist (nested paths allowed). ' +
        'Identify files by `documentUuids` (from document_list/document_search) and/or `documentPaths` (for files you just created with document_split). ' +
        'Moving preserves each file’s extracted text and metadata, and never overwrites a file already in the destination (a " (2)" suffix is added if needed). ' +
        'Pass an empty `targetFolderPath` to move files back to the dossier root.',
      inputSchema: z.object({
        documentUuids: z.array(z.string()).optional().describe('UUIDs of the documents to move.'),
        documentPaths: z
          .array(z.string())
          .optional()
          .describe('Relative paths of the documents to move (use for freshly split files).'),
        dossierId: z.string().optional(),
        targetFolderPath: z
          .string()
          .describe('Destination subfolder relative to the dossier root, e.g. "Factures/2024".')
      }),
      execute: async (args) => execute('document_move', args as Record<string, unknown>)
    })
  } as ToolMap
}

/**
 * Terminal action tools: no execute — the SDK stops the loop when called.
 * The runtime reads these from result.steps[*].toolCalls and dispatches them as intents.
 * Descriptions are intentionally terse — shared rules live in aiSystemPrompt.ts (see buildDataTools).
 */
export const terminalActionTools = {
  field_populate: tool({
    description:
      'Prepare template field filling for a contact. Call this when both contactUuid and templateUuid are known.',
    inputSchema: z.object({
      contactUuid: z.string().describe('Contact ID to use.'),
      templateUuid: z.string().describe('Template ID to use.')
    })
  }),
  document_generate: tool({
    description:
      'Generate a document from a template for a dossier. ' +
      'When the runtime returns a clarification listing missing fields with their template paths in backticks ' +
      '(e.g. "Date d\'audience (`dossier.keyDate.audience.long`)"), the next call MUST reuse those EXACT paths ' +
      'as `tagOverrides` keys.',
    inputSchema: z.object({
      dossierId: z.string().describe('Target dossier ID.'),
      templateUuid: z.string().describe('Template ID to use.'),
      contactUuid: z.string().optional().describe('Optional primary contact ID.'),
      tagOverrides: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Override values for unresolved template tags. Keys MUST be exact template macro paths from `template_list` (`macros`) ' +
            'or quoted in a prior clarification — e.g. `dossier.keyDate.audience.long`, `contact.juridiction.displayName`, `todayLong`. ' +
            'Do NOT invent short keys or marker names; any key not in `macros` is silently dropped.'
        )
    })
  }),
  document_augment: tool({
    description:
      'Open an existing Word document in the rédaction assistée workspace with edits marked as tracked changes (revisions). First call document_load_paragraphs to read structure. ' +
      'Then submit operations (insert_after, insert_before, replace, delete) keyed by paragraph index. ' +
      'AI NEVER touches content not explicitly targeted. Each operation generates a Word revision with unique ID for accept/reject.',
    inputSchema: z.object({
      documentUuid: z.string().describe('UUID of the Word document to augment'),
      dossierId: z.string().optional(),
      operations: z.array(
        z.object({
          op: z.enum(['insert_after', 'insert_before', 'replace', 'delete']),
          index: z.number().int().describe('Paragraph index'),
          text: z.string().optional().describe('Text to insert or replace'),
          rationale: z.string().optional().describe('Why this change was made'),
          legalRefs: z.array(z.string()).optional().describe('Legal citations')
        })
      )
    })
  }),
  redaction_edit: tool({
    description:
      'Apply edits to the document of the ACTIVE drafting session (rédaction assistée) as Word tracked changes. ' +
      'Call redaction_document_read FIRST on every turn — indices refer to the CURRENT document state, revisions included. ' +
      'Operations: insert_after/insert_before (anchorIndex + text), replace (index + text), delete (index). ' +
      'At most one replace/delete per paragraph per turn; keep batches small (≤5 operations) and iterate. ' +
      'rationale is REQUIRED on every operation (shown to the lawyer next to the revision).',
    inputSchema: z.object({
      operations: z
        .array(
          z.object({
            op: z.enum(['insert_after', 'insert_before', 'replace', 'delete']),
            anchorIndex: z
              .number()
              .int()
              .optional()
              .describe('Paragraph index anchor for insert_after/insert_before'),
            index: z.number().int().optional().describe('Paragraph index for replace/delete'),
            text: z.string().optional().describe('New text for insert/replace'),
            rationale: z.string().describe('Why this change was made (required)'),
            legalRefs: z
              .array(z.string())
              .optional()
              .describe('Verified legal citations supporting the change')
          })
        )
        .min(1),
      summary: z.string().optional().describe('One-sentence summary of the batch, shown in chat')
    })
  }),
  document_metadata_batch: tool({
    description:
      'Generate and persist metadata (description + tags) for many documents in one shot, each via an isolated sub-LLM call — without polluting the main context. ' +
      'Omit `documentUuids` to process every document without metadata.',
    inputSchema: z.object({
      dossierId: z.string().optional(),
      documentUuids: z
        .array(z.string())
        .optional()
        .describe(
          'Optional explicit list of document UUIDs. Omit to process every document without metadata in the dossier.'
        )
    })
  }),
  document_summary_batch: tool({
    description:
      "Produce a 2–4 paragraph summary for many documents in one shot, saved as each document's description (existing tags preserved), each via an isolated sub-LLM call. " +
      'Distinct from `document_metadata_batch` (short description + tags). Omit `documentUuids` to summarise every document.',
    inputSchema: z.object({
      dossierId: z.string().optional(),
      documentUuids: z
        .array(z.string())
        .optional()
        .describe('Optional explicit list of document UUIDs. Omit to summarise every document.')
    })
  }),
  dossier_create: tool({
    description: 'Create a new dossier.',
    inputSchema: z.object({
      id: z.string().describe('Name or ID for the new dossier.')
    })
  }),
  dossier_update: tool({
    description: 'Update metadata of an existing dossier.',
    inputSchema: z.object({
      id: z.string().describe('Dossier ID to update.'),
      status: z.string().optional().describe('New status.'),
      dossierType: z.string().optional().describe('New dossier type.'),
      information: z.string().optional().describe('Additional information.')
    })
  }),
  document_relocate: tool({
    description:
      'Update a document metadata binding after the file was moved or renamed anywhere inside the same dossier. ' +
      'Use this only when the physical file already exists at its new path.',
    inputSchema: z.object({
      documentUuid: z
        .string()
        .describe('Stable UUID of the document whose metadata must be rebound.'),
      dossierId: z.string().describe('Dossier ID containing both the old and new file path.'),
      fromDocumentPath: z
        .string()
        .optional()
        .describe('Previous relative document path. Optional safety check.'),
      toDocumentPath: z.string().describe('New relative document path inside the same dossier.')
    })
  }),
  template_create: tool({
    description: 'Create a new template.',
    inputSchema: z.object({
      name: z.string().describe('Template name.'),
      content: z.string().describe('Template content.'),
      description: z.string().optional().describe('Optional description.')
    })
  }),
  template_update: tool({
    description: 'Update an existing template (`uuid` from template_list).',
    inputSchema: z.object({
      uuid: z.string().describe('Template UUID to update.'),
      name: z.string().optional().describe('New name.'),
      content: z.string().optional().describe('New content.'),
      description: z.string().optional().describe('New description.')
    })
  }),
  template_delete: tool({
    description: 'Delete a template (`uuid` from template_list).',
    inputSchema: z.object({
      uuid: z.string().describe('Template UUID to delete.')
    })
  }),
  text_generate: tool({
    description:
      'Request free-text drafting related to the Ordicab context — never write the draft yourself.',
    inputSchema: z.object({
      textType: z
        .enum(['email', 'letter', 'analysis', 'summary', 'text'])
        .describe('Type of text to produce.'),
      contactUuid: z.string().optional().describe('Optional target contact ID.'),
      language: z.string().optional().describe('Output language, e.g. fr or en.'),
      instructions: z.string().describe('Drafting instructions.')
    })
  }),
  dossier_summarize: tool({
    description:
      'Produce an executive summary of an ENTIRE dossier: object/nature, parties, facts & ' +
      'context, timeline and upcoming deadlines, key references, and open points to handle — never write the summary yourself.',
    inputSchema: z.object({
      dossierId: z.string().optional(),
      language: z.string().optional().describe('Output language, e.g. fr or en.')
    })
  }),
  clarification_request: tool({
    description:
      'Ask a structured clarifying question when multiple valid options remain. Use this instead of a free-form question.',
    inputSchema: z.object({
      question: z.string().describe('Question to ask the user.'),
      options: z.array(z.string()).describe('Human-readable options presented to the user.'),
      optionIds: z
        .array(z.string())
        .optional()
        .describe('Internal IDs associated with the options.')
    })
  }),
  unknown: tool({
    description:
      'Signal that no clear Ordicab action could be inferred. Use only as a last resort, never to avoid calling an available tool.',
    inputSchema: z.object({
      message: z.string().describe('Brief, helpful explanation for the user.')
    })
  })
} as const

/** Names of terminal action tools (no execute — loop ends on call). */
export const TERMINAL_ACTION_TOOL_NAMES = new Set(Object.keys(terminalActionTools))
