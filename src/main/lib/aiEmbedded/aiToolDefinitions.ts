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
  'document_analyze',
  'document_metadata_save'
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
  document_metadata_save: ['document_list', 'document_get'],
  document_metadata_batch: ['document_list', 'document_get'],
  document_summary_batch: ['document_list', 'document_get'],
  document_analyze: ['document_list', 'document_get'],
  document_relocate: ['document_list'],
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
  template_select: ['template_list'],
  template_create: ['template_list'],
  template_update: ['template_list'],
  template_delete: ['template_list']
}

import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { KEY_DATE_TAG_VALUES } from '@shared/domain/dossier'
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
      'Optional values for managed contact fields not covered by the standard parameters. Omit this field entirely when no managed field value is explicitly known. Keys must be exact field labels from managed_fields_get.'
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
      'Optional explicit tags (cumulative). Allowed values: cancelled, postponed, urgent, imperative, important, to_confirm, confidential, to_do. ' +
        'Do NOT use this for past/upcoming — that is auto-computed from the date.'
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
  sourceServicePresetId: z
    .string()
    .optional()
    .describe('Optional ID of a cabinet service preset this item is based on.'),
  sourceKeyDateId: z
    .string()
    .optional()
    .describe('Optional ID of the timeline event (key date) this service relates to.')
} satisfies Record<string, z.ZodTypeAny>

/**
 * Data tools: result fed back to the LLM, loop continues.
 * All descriptions are verbatim from the original createActionTool() calls.
 */
export function buildDataTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
): ToolMap {
  return {
    entity_get: tool({
      description:
        "Get the current professional entity profile configured in Settings (the user's own cabinet / office / firm). " +
        'Use this when the user asks for their own cabinet information, such as firm name, professional identity, address, phone, email, VAT number, or other `entity.*` details used in document templates. ' +
        "This is the primary source of truth for the user's own cabinet information. Do NOT start with `contact_lookup` or `document_search` for those questions. " +
        'If a requested field is missing here, say that it is not configured in Settings.',
      inputSchema: z.object({}),
      execute: async (args) => execute('entity_get', args as Record<string, unknown>)
    }),
    managed_fields_get: tool({
      description:
        'Load the configured contact roles and managed field definitions for the current entity profile. ' +
        'Use this before creating or updating contacts, key dates, or key references. ' +
        'In particular, call it before adding a contact, before adding a key date, and before adding a key reference, so you know which roles and managed fields exist and which details to extract from the user request or source text. ' +
        "Do NOT use this tool for read-only contact questions such as listing contacts or retrieving an existing contact's email, phone, address, role, or other current values.",
      inputSchema: z.object({}),
      execute: async (args) => execute('managed_fields_get', args as Record<string, unknown>)
    }),
    contact_lookup: tool({
      description:
        'List all contacts in a dossier, including their UUIDs. ' +
        'Use this tool to list contacts, search by name, answer read-only questions about an existing contact, or resolve a UUID before an action or contact_get. ' +
        'Each contact in the result has an `id` field which is a UUID — always use this UUID as the contactId in subsequent calls. ' +
        'This tool only retrieves data — after getting the result, you MUST call the appropriate action tool (e.g. contact_delete, contact_update, contact_create) to perform any mutation. ' +
        'CONTACT RECORDS FIRST: this is the primary source of truth for contacts. If a contact the user named is not in the result, do NOT stop there — fall back to `document_search` to look for it in the dossier documents before telling the user it cannot be found.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('contact_lookup', args as Record<string, unknown>)
    }),
    contact_get: tool({
      description:
        'Get full details of a contact by UUID. ' +
        'If you do not have the UUID yet, call contact_lookup first to resolve it. ' +
        'contactId MUST be the exact UUID from a contact_lookup result — never a name, placeholder, or comment. ' +
        'If a field the user asked about (phone, email, address…) is empty or missing on the returned contact, fall back to `document_search` to look for that detail in the dossier documents before answering that it is unavailable.',
      inputSchema: z.object({
        contactId: z
          .string()
          .describe(
            'UUID of the contact from a contact_lookup result. Must be an exact UUID — never a name or placeholder.'
          ),
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
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
        'Use this for all document queries: full list, latest document, filtering by extension, or finding documents without metadata. ' +
        'Also use this to resolve a `@<filename>` mention from the user to its UUID before any document_get / document_analyze call.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('document_list', args as Record<string, unknown>)
    }),
    document_get: tool({
      description:
        'Get the metadata of a document: its UUID, filename, description, tags, and size statistics. ' +
        'Returns a structured JSON with fields: uuid, filename, description, tags, totalChars, totalLines. ' +
        'This tool does NOT return the document text — use it to retrieve metadata and gauge the document size (totalChars / totalLines) before reading it. ' +
        'To read the actual text content, call document_analyze (optionally with charStart / charEnd to read a specific character range of large documents). ' +
        'If the user referenced the document via a `@<filename>` mention in the chat, resolve the UUID with document_list first (match on `filename`) and then call this tool. ' +
        'If you do not have the documentId, call document_list first. ' +
        'documentId must be the UUID of the document.',
      inputSchema: z.object({
        documentId: z.string().describe('UUID of the document from document_list.'),
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('document_get', args as Record<string, unknown>)
    }),
    dossier_get: tool({
      description:
        'Get the full details of a dossier including its key dates, key references, billing items (prestations), and fee agreements. ' +
        'Use this before updating or deleting key dates, key references, or billing items to read the existing IDs. ' +
        'If you do not have the dossierId, call dossier_list first.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('dossier_get', args as Record<string, unknown>)
    }),
    dossier_list: tool({
      description:
        'List all registered dossiers in the domain with their id, name, status, and type. ' +
        'Use this to discover dossiers — for example to resolve a dossier the user named, or to work across more than one dossier in the same turn. ' +
        'This tool only retrieves data; the loop continues after the result.',
      inputSchema: z.object({}),
      execute: async (args) => execute('dossier_list', args as Record<string, unknown>)
    }),
    document_search: tool({
      description:
        'Hybrid search over the pre-extracted text of all documents in a dossier: combines exact substring matches with semantic (embedding) similarity, then returns the best-matching excerpts ranked by confidence. ' +
        'Each match includes: excerpt, score (higher is better), matchType ("exact" for literal string hits, "semantic" for vector similarity), and document info. ' +
        'Exact matches score ≥ 1 and always rank above semantic matches. Use matchType + score to judge how trustworthy a hit is. ' +
        'Use this tool whenever the user asks about dossier CONTENT: demands, claims, facts, amounts, dates, positions, history, or any specific information. ' +
        'Also use it as the FALLBACK for contact questions: when a contact has no record via contact_lookup, or a requested contact detail (phone, email, address…) is not filled in on the record, search the documents here before telling the user the information is unavailable. ' +
        'You MUST call this tool (or document_analyze for a single document) before answering content questions — never answer from memory. ' +
        'QUERY EXPANSION REQUIRED: for any content question, call this tool 2–4 times with DIFFERENT query strings — ' +
        'one per semantic angle (legal concept, party name, synonyms, document type). ' +
        'Because semantic search handles paraphrase well, vary wording across calls (e.g., "pension alimentaire" vs "contribution à l\'entretien") to catch both verbatim and reformulated passages. ' +
        'NEVER repeat the same query string across calls — it returns the same results and wastes a turn. ' +
        'Use known contact names and roles from the active context to craft targeted queries. ' +
        'Aggregate all returned excerpts before answering. ' +
        'Only works for documents whose text has already been extracted and indexed via the Documents tab. ' +
        'If no excerpts are returned after all queries, say so — do NOT invent content.',
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Natural language search query describing the information to find (e.g. "demandes de la partie adverse", "pension alimentaire", "dates d\'audience").'
          ),
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('document_search', args as Record<string, unknown>)
    }),
    invoice_list: tool({
      description:
        'List the invoices (factures) issued by the cabinet, with their number, document type, status, payment status, dossier, client, total amounts (TTC), and key dates. ' +
        'Optionally filter by dossierId to list only invoices of one dossier. ' +
        'This tool is READ-ONLY: it retrieves data and the loop continues. ' +
        'The assistant cannot create, cancel, or record payments on invoices — those actions are done by the user in the Invoices tab.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe(
            'Optional dossier ID to list only that dossier’s invoices. Omit to list all invoices.'
          )
      }),
      execute: async (args) => execute('invoice_list', args as Record<string, unknown>)
    }),
    invoice_get: tool({
      description:
        'Get the full details of a single invoice (facture) by its ID: line items, VAT breakdown, payments, status, and references. ' +
        'Call invoice_list first to discover invoice IDs. ' +
        'This tool is READ-ONLY.',
      inputSchema: z.object({
        invoiceId: z.string().describe('Invoice ID from invoice_list.')
      }),
      execute: async (args) => execute('invoice_get', args as Record<string, unknown>)
    }),
    legal_search_legifrance: tool({
      description:
        'Search official French legal texts through Légifrance via PISTE. READ-ONLY. ' +
        'Use this for statutes, code articles, decrees, JORF, administrative/judicial legal databases, or when checking whether a cited article exists. ' +
        'PREFER passing the natural query in `recherche` and leaving the other fields unset: the search auto-detects article citations like "article 1240 du code civil" (it then targets the exact article in the right code) and otherwise ranks results by relevance. ' +
        'Only set fond/typeChamp/typeRecherche/code to deliberately override that behaviour. ' +
        'After finding a likely result, call legal_consult_legifrance with the exact id before giving a legal-content answer.',
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
        'Use this before quoting or validating the content of an article.',
      inputSchema: z.object({
        id: z.string().describe('Légifrance id, e.g. LEGIARTI... from search results.')
      }),
      execute: async (args) => execute('legal_consult_legifrance', args as Record<string, unknown>)
    }),
    legal_search_judilibre: tool({
      description:
        'Search French judicial decisions through Judilibre via PISTE. READ-ONLY. ' +
        'Use this for Cour de cassation / court decision research, pourvoi numbers, ECLI, legal concepts in case law. ' +
        'To filter by chamber (e.g. "civ1") or legal theme, first call legal_taxonomy_judilibre to get the exact valid codes — do NOT guess them. ' +
        'After finding a likely decision, call legal_consult_judilibre before summarising the holding.',
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
        'Look up the valid Judilibre vocabulary (chambers, legal themes, jurisdictions, decision types, fields) before filtering a case-law search. READ-ONLY. ' +
        'Call this to resolve human terms to the exact codes Judilibre expects — e.g. id="chamber" with contextValue="cc" lists the Cour de cassation chambers ("civ1" → "Première chambre civile"), id="theme" lists matières, id="jurisdiction" lists courts. ' +
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
        'Consult the full Judilibre decision for an id returned by legal_search_judilibre. READ-ONLY.',
      inputSchema: z.object({
        decisionId: z.string().describe('Judilibre decision id.')
      }),
      execute: async (args) => execute('legal_consult_judilibre', args as Record<string, unknown>)
    }),
    legal_verify_references: tool({
      description:
        'Extract and verify French legal references from text using Légifrance and Judilibre. READ-ONLY. ' +
        'Use this when the user asks whether references from a client, opposing counsel, or a document are correct.',
      inputSchema: z.object({
        text: z.string().describe('Text containing legal references to verify.')
      }),
      execute: async (args) => execute('legal_verify_references', args as Record<string, unknown>)
    })
  } as ToolMap
}

/**
 * Batchable action tools: executed inline within the tool loop, result fed back to LLM.
 * All descriptions are verbatim from the original createActionTool() calls.
 */
export function buildBatchableActionTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
): ToolMap {
  return {
    contact_create: tool({
      description:
        'Create a new contact in the active dossier. ' +
        'You MUST call this tool to save the new contact — do NOT describe the creation in text, do NOT say "done" or "created" without calling this tool first. ' +
        'Before creating a contact, call managed_fields_get so you know the configured contact roles and managed contact fields to populate or look for. ' +
        'Use this tool only for NEW contacts. If the user is correcting or enriching an existing contact, use `contact_lookup` then `contact_update` instead. ' +
        'Provide only the fields explicitly known from the user request or the source documents. ' +
        'Always capitalise proper names: first letter uppercase, rest lowercase (e.g. "dupont" → "Dupont", "MARIE" → "Marie"). ' +
        'ROLE RULE: only set `role` to a value from the managed_fields_get result, and only if the user explicitly stated it or it is unambiguously evident from context. ' +
        'If the role is not specified or unclear, omit the `role` field entirely — NEVER guess or invent a role. ' +
        'CUSTOM FIELDS RULE: managed contact fields are optional, never mandatory. Use `customFields` only for managed fields that both (a) actually exist in the managed_fields_get result and (b) are explicitly present and certain in the user request or source text. ' +
        'If no managed field value is clearly present, omit `customFields` entirely. NEVER invent, infer, auto-complete, or mirror standard fields into managed fields. ' +
        'Keys in `customFields` must match the field labels exactly as returned by managed_fields_get (e.g. { "Numéro de dossier": "2024-001" }).',
      inputSchema: z.object(contactMutationFieldsSchema),
      execute: async (args) => execute('contact_create', args as Record<string, unknown>)
    }),
    contact_update: tool({
      description:
        'Update an existing contact in the active dossier. ' +
        'You MUST call this tool to save the contact changes — do NOT describe the update in text, do NOT say "done" or "corrected" without calling this tool first. ' +
        'Before updating, call managed_fields_get so you know the configured contact roles and managed contact fields to populate or look for. ' +
        'Update workflow: (1) call contact_lookup to list contacts, (2) call contact_get to read current field values when needed, (3) call contact_update with the exact contactId and only the fields to change. ' +
        '`contactId` MUST be the exact UUID from contact_lookup or contact_get. Never omit it, never use a name in its place. ' +
        'Always capitalise proper names: first letter uppercase, rest lowercase (e.g. "dupont" → "Dupont", "MARIE" → "Marie"). ' +
        'ROLE RULE: only set `role` to a value from the managed_fields_get result, and only if the user explicitly stated it or it is unambiguously evident from context. ' +
        'If the role is not specified or unclear, omit the `role` field entirely — NEVER guess or invent a role. ' +
        'CUSTOM FIELDS RULE: managed contact fields are optional, never mandatory. Use `customFields` only for managed fields that both (a) actually exist in the managed_fields_get result and (b) are explicitly present and certain in the user request or source text. ' +
        'If no managed field value is clearly present, omit `customFields` entirely. NEVER invent, infer, auto-complete, or mirror standard fields into managed fields. ' +
        'Keys in `customFields` must match the field labels exactly as returned by managed_fields_get (e.g. { "Numéro de dossier": "2024-001" }).',
      inputSchema: z.object({
        contactId: z.string().describe('Existing contact UUID from contact_lookup or contact_get.'),
        ...contactMutationFieldsSchema
      }),
      execute: async (args) => execute('contact_update', args as Record<string, unknown>)
    }),
    contact_delete: tool({
      description:
        'Delete a contact from the active dossier. ' +
        'You MUST call this tool to perform the deletion — do NOT describe the deletion in text. ' +
        'If you do not have the contactId yet, call contact_lookup first to resolve it. ' +
        'A bare contact name can be accepted as fallback, but resolving to the exact existing contact first is preferred.',
      inputSchema: z.object({
        contactId: z
          .string()
          .describe('ID of the contact to delete, or a bare contact name as fallback.')
      }),
      execute: async (args) => execute('contact_delete', args as Record<string, unknown>)
    }),
    dossier_select: tool({
      description:
        'Set a dossier as the active context. You MUST call this tool to activate it — do NOT say "I selected the dossier" in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('ID of the dossier to select.')
      }),
      execute: async (args) => execute('dossier_select', args as Record<string, unknown>)
    }),
    template_select: tool({
      description:
        'Select a template by name. You MUST call this tool to select it — do NOT say "I selected the template" in text. ' +
        'The tool result includes a `templateId` field — use it as the `templateId` in the next `document_generate` call.',
      inputSchema: z.object({
        templateName: z.string().describe('Name of the template to select.')
      }),
      execute: async (args) => execute('template_select', args as Record<string, unknown>)
    }),
    dossier_create_key_date: tool({
      description:
        'Create a new timeline event (chronologie) on a dossier — hearings, appointments, expertises, deadlines, etc. ' +
        'Before creating, call managed_fields_get so you know the configured event labels to target. ' +
        'Use this tool only for NEW events. To modify an existing event, call dossier_get first and then use `dossier_update_key_date` with the exact `keyDateId`. ' +
        'You MUST call this tool to persist the event — do NOT describe the action in text.',
      inputSchema: z.object(dossierKeyDateFieldsSchema),
      execute: async (args) => execute('dossier_create_key_date', args as Record<string, unknown>)
    }),
    dossier_update_key_date: tool({
      description:
        'Update an existing timeline event (chronologie) on a dossier. ' +
        'Before updating, call managed_fields_get so you know the configured event labels to target, then call dossier_get to read the exact `keyDateId`. ' +
        '`keyDateId` MUST be the exact existing ID from dossier_get. Never omit it. ' +
        'Provide only the fields to change, while keeping `label` and `date` explicit in the call. ' +
        'You MUST call this tool to persist the event update — do NOT describe the action in text.',
      inputSchema: z.object({
        keyDateId: z.string().describe('Existing key date ID from dossier_get.'),
        ...dossierKeyDateFieldsSchema
      }),
      execute: async (args) => execute('dossier_update_key_date', args as Record<string, unknown>)
    }),
    dossier_delete_key_date: tool({
      description:
        'Delete a key date from a dossier. ' +
        'Call dossier_get first to resolve the keyDateId. ' +
        'You MUST call this tool to perform the deletion — do NOT describe the deletion in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        keyDateId: z.string().describe('ID of the key date to delete.')
      }),
      execute: async (args) => execute('dossier_delete_key_date', args as Record<string, unknown>)
    }),
    dossier_create_key_reference: tool({
      description:
        'Create a new key reference on a dossier. ' +
        'Before creating a key reference, call managed_fields_get so you know the configured key reference labels and field types to target. ' +
        'Use this tool only for NEW references. To modify an existing key reference, call dossier_get first and then use `dossier_update_key_reference` with the exact `keyReferenceId`. ' +
        'You MUST call this tool to persist the reference — do NOT describe the action in text.',
      inputSchema: z.object(dossierKeyReferenceFieldsSchema),
      execute: async (args) =>
        execute('dossier_create_key_reference', args as Record<string, unknown>)
    }),
    dossier_update_key_reference: tool({
      description:
        'Update an existing key reference on a dossier. ' +
        'Before updating a key reference, call managed_fields_get, then call dossier_get to read the exact `keyReferenceId`. ' +
        '`keyReferenceId` MUST be the exact existing ID from dossier_get. Never omit it. ' +
        'You MUST call this tool to persist the reference update — do NOT describe the action in text.',
      inputSchema: z.object({
        keyReferenceId: z.string().describe('Existing key reference ID from dossier_get.'),
        ...dossierKeyReferenceFieldsSchema
      }),
      execute: async (args) =>
        execute('dossier_update_key_reference', args as Record<string, unknown>)
    }),
    dossier_delete_key_reference: tool({
      description:
        'Delete a key reference from a dossier. ' +
        'Call dossier_get first to resolve the keyReferenceId. ' +
        'You MUST call this tool to perform the deletion — do NOT describe the deletion in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        keyReferenceId: z.string().describe('ID of the key reference to delete.')
      }),
      execute: async (args) =>
        execute('dossier_delete_key_reference', args as Record<string, unknown>)
    }),
    dossier_create_billing_item: tool({
      description:
        'Create a new billing item (prestation) on a dossier — a billable line of work such as a consultation, a drafted act, or a court appearance. ' +
        'Provide quantity + quantityUnit, unitPriceHtCents, and vatRateBasisPoints; the HT/VAT/TTC totals are computed automatically — do NOT compute or pass them. ' +
        'Use status "draft" for a new editable item. ' +
        'Use this tool only for NEW prestations. To modify an existing one, call dossier_get first and use `dossier_update_billing_item` with the exact `billingItemId`. ' +
        'You MUST call this tool to persist the prestation — do NOT describe the action in text.',
      inputSchema: z.object(dossierBillingItemFieldsSchema),
      execute: async (args) =>
        execute('dossier_create_billing_item', args as Record<string, unknown>)
    }),
    dossier_update_billing_item: tool({
      description:
        'Update an existing billing item (prestation) on a dossier. ' +
        'Call dossier_get first to read the exact `billingItemId`. `billingItemId` MUST be the exact existing ID — never omit it. ' +
        'Re-state quantity, quantityUnit, unitPriceHtCents, and vatRateBasisPoints; totals are recomputed automatically. ' +
        'A prestation that has already been invoiced (status "billed") cannot be edited — the tool will report this; do not retry. ' +
        'You MUST call this tool to persist the update — do NOT describe the action in text.',
      inputSchema: z.object({
        billingItemId: z.string().describe('Existing billing item ID from dossier_get.'),
        ...dossierBillingItemFieldsSchema
      }),
      execute: async (args) =>
        execute('dossier_update_billing_item', args as Record<string, unknown>)
    }),
    dossier_delete_billing_item: tool({
      description:
        'Delete a billing item (prestation) from a dossier. ' +
        'Call dossier_get first to resolve the billingItemId. ' +
        'A prestation that has already been invoiced (status "billed") cannot be deleted — the tool will report this; do not retry. ' +
        'You MUST call this tool to perform the deletion — do NOT describe the deletion in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        billingItemId: z.string().describe('ID of the billing item to delete.')
      }),
      execute: async (args) =>
        execute('dossier_delete_billing_item', args as Record<string, unknown>)
    }),
    document_analyze: tool({
      description:
        'Read the text of a single document and return it as structured JSON. ' +
        'Returns: { uuid, rawContent, totalChars, charsReturned }. ' +
        'Uses the pre-extracted cache when available; on cache miss it runs DOCX / PDF text / OCR extraction in-process and persists the result. ' +
        'A surfaced error means extraction itself failed (unsupported type, missing OCR data, or read error) — relay it to the user. ' +
        'Use charStart and charEnd to read a specific character range (both inclusive). ' +
        'Omit both to read the full document (capped at 12 000 chars). ' +
        'documentId must be the UUID of the document. If you do not have the UUID, call document_list first (also use this path to resolve a user `@<filename>` mention).',
      inputSchema: z.object({
        documentId: z.string().describe('UUID of the document to read.'),
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.'),
        charStart: z.number().optional().describe('First character offset to return (inclusive).'),
        charEnd: z.number().optional().describe('Last character offset to return (inclusive).')
      }),
      execute: async (args) => execute('document_analyze', args as Record<string, unknown>)
    }),
    document_metadata_save: tool({
      description:
        'Save a description and/or tags for a document. ' +
        'You MUST call this tool to persist metadata — do NOT describe the save in text. ' +
        'If you do not have the documentId, call document_list first. ' +
        'Generate a concise description (1-3 sentences) and at most 5 relevant tags from the document content. ' +
        'When indexing multiple documents in a single turn, call this tool once per document and continue with the next one without waiting for confirmation.',
      inputSchema: z.object({
        documentId: z.string().describe('Document ID to update.'),
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.'),
        description: z.string().optional().describe('Short description of the document.'),
        tags: z.array(z.string()).describe('List of tags for the document.')
      }),
      execute: async (args) => execute('document_metadata_save', args as Record<string, unknown>)
    })
  } as ToolMap
}

/**
 * Terminal action tools: no execute — the SDK stops the loop when called.
 * The runtime reads these from result.steps[*].toolCalls and dispatches them as intents.
 * All descriptions are verbatim from the original createActionTool() calls.
 */
export const terminalActionTools = {
  field_populate: tool({
    description:
      'Prepare template field filling for a contact. Call this when both contactId and templateId are known.',
    inputSchema: z.object({
      contactId: z.string().describe('Contact ID to use.'),
      templateId: z.string().describe('Template ID to use.')
    })
  }),
  document_generate: tool({
    description:
      'Generate a document from a template for a dossier. ' +
      'You MUST call this tool to trigger generation — do NOT describe the document as generated in text. ' +
      'When the runtime returns a clarification listing missing fields with their template paths in backticks ' +
      '(e.g. "Date d\'audience (`dossier.keyDate.audience.long`)"), the next call MUST reuse those EXACT paths ' +
      'as `tagOverrides` keys.',
    inputSchema: z.object({
      dossierId: z.string().describe('Target dossier ID.'),
      templateId: z.string().describe('Template ID to use.'),
      contactId: z.string().optional().describe('Optional primary contact ID.'),
      tagOverrides: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Override values for unresolved template tags. ' +
            'Keys MUST be the exact template macro paths as returned by `template_list` (the `macros` array) ' +
            'or as quoted in a previous clarification message — for example ' +
            '`dossier.keyDate.audience.long`, `contact.juridiction.displayName`, `todayLong`. ' +
            'Do NOT invent short keys (e.g. `dateDAudience`, `audience`) or use marker names ' +
            '(e.g. `custom.dossier_1`); the runtime will silently drop any key that is not in the macros list.'
        )
    })
  }),
  document_metadata_batch: tool({
    description:
      'Process multiple documents in one shot to generate and persist their metadata (description + tags) without polluting the main conversation context. ' +
      'Each document is handled by an isolated sub-LLM call with only that document text. ' +
      'Use this whenever the user wants to "index", "organise", "generate metadata", or "tag all documents" of a dossier — even when no explicit list is provided. ' +
      'When `documentIds` is omitted, ALL documents without metadata in the dossier are processed automatically. ' +
      'Prefer this over emitting many `document_metadata_save` calls in a loop.',
    inputSchema: z.object({
      dossierId: z
        .string()
        .optional()
        .describe('Target dossier ID. Omit to use the active dossier.'),
      documentIds: z
        .array(z.string())
        .optional()
        .describe(
          'Optional explicit list of document UUIDs. Omit to process every document without metadata in the dossier.'
        )
    })
  }),
  document_summary_batch: tool({
    description:
      'Produce a longer narrative summary (2–4 paragraphs) for multiple documents in one shot, persisted as the document description. Existing tags are preserved. ' +
      'Each document is handled by an isolated sub-LLM call. ' +
      'Use this when the user wants a "summary of each document" or "summarise all documents" — distinct from `document_metadata_batch` which produces short descriptions plus tags. ' +
      'When `documentIds` is omitted, EVERY document in the dossier is summarised.',
    inputSchema: z.object({
      dossierId: z
        .string()
        .optional()
        .describe('Target dossier ID. Omit to use the active dossier.'),
      documentIds: z
        .array(z.string())
        .optional()
        .describe('Optional explicit list of document UUIDs. Omit to summarise every document.')
    })
  }),
  dossier_create: tool({
    description:
      'Create a new dossier. ' +
      'You MUST call this tool to create the dossier — do NOT describe the creation in text.',
    inputSchema: z.object({
      id: z.string().describe('Name or ID for the new dossier.')
    })
  }),
  dossier_update: tool({
    description:
      'Update metadata of an existing dossier. ' +
      'You MUST call this tool to persist changes — do NOT describe the update in text.',
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
      'Use this only when the physical file already exists at its new path. ' +
      'You MUST call this tool to persist the new location — do NOT describe the move in text.',
    inputSchema: z.object({
      documentUuid: z
        .string()
        .describe('Stable UUID of the document whose metadata must be rebound.'),
      dossierId: z.string().describe('Dossier ID containing both the old and new file path.'),
      fromDocumentId: z
        .string()
        .optional()
        .describe('Previous relative document path. Optional safety check.'),
      toDocumentId: z.string().describe('New relative document path inside the same dossier.')
    })
  }),
  template_create: tool({
    description:
      'Create a new template. ' +
      'You MUST call this tool to create the template — do NOT describe the creation in text.',
    inputSchema: z.object({
      name: z.string().describe('Template name.'),
      content: z.string().describe('Template content.'),
      description: z.string().optional().describe('Optional description.')
    })
  }),
  template_update: tool({
    description:
      'Update an existing template. ' +
      'You MUST call this tool to persist changes — do NOT describe the update in text. ' +
      'Call template_list first if you do not have the template ID.',
    inputSchema: z.object({
      id: z.string().describe('Template ID to update.'),
      name: z.string().optional().describe('New name.'),
      content: z.string().optional().describe('New content.'),
      description: z.string().optional().describe('New description.')
    })
  }),
  template_delete: tool({
    description:
      'Delete a template. ' +
      'You MUST call this tool to perform the deletion — do NOT describe the deletion in text. ' +
      'Call template_list first if you do not have the template ID.',
    inputSchema: z.object({
      id: z.string().describe('Template ID to delete.')
    })
  }),
  text_generate: tool({
    description:
      'Request free-text drafting related to the Ordicab context. ' +
      'You MUST call this tool to trigger drafting — do NOT write the text yourself.',
    inputSchema: z.object({
      textType: z
        .enum(['email', 'letter', 'analysis', 'summary', 'text'])
        .describe('Type of text to produce.'),
      contactId: z.string().optional().describe('Optional target contact ID.'),
      language: z.string().optional().describe('Output language, e.g. fr or en.'),
      instructions: z.string().describe('Drafting instructions.')
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
