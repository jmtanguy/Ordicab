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
  'contact_upsert',
  'contact_delete',
  'dossier_select',
  'template_select',
  'dossier_upsert_key_date',
  'dossier_delete_key_date',
  'dossier_upsert_key_reference',
  'dossier_delete_key_reference',
  'document_analyze'
])

/**
 * Maps each mutating action tool to the data-tool names whose cached results
 * become stale after that action is dispatched.
 * Used by appendHistory() to evict obsolete tool messages from conversation history.
 */
export const STALE_TOOL_NAMES_AFTER_ACTION: Partial<Record<string, string[]>> = {
  contact_upsert: ['contact_lookup', 'contact_get', 'document_search', 'document_analyze'],
  contact_delete: ['contact_lookup', 'contact_get'],
  document_generate: ['document_list'],
  document_metadata_save: ['document_list', 'document_get'],
  document_analyze: ['document_list', 'document_get'],
  document_relocate: ['document_list'],
  dossier_select: ['contact_lookup', 'contact_get', 'document_list'],
  dossier_create: ['dossier_get'],
  dossier_update: ['dossier_get'],
  dossier_upsert_key_date: ['dossier_get'],
  dossier_delete_key_date: ['dossier_get'],
  dossier_upsert_key_reference: ['dossier_get'],
  dossier_delete_key_reference: ['dossier_get'],
  template_select: ['template_list'],
  template_create: ['template_list'],
  template_update: ['template_list'],
  template_delete: ['template_list']
}

import { tool, type Tool } from 'ai'
import { z } from 'zod'

type ToolMap = Record<string, Tool<Record<string, unknown>>>

/**
 * Data tools: result fed back to the LLM, loop continues.
 * All descriptions are verbatim from the original createActionTool() calls.
 */
export function buildDataTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>
): ToolMap {
  return {
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
        'This tool only retrieves data — after getting the result, you MUST call the appropriate action tool (e.g. contact_delete, contact_upsert) to perform any mutation.',
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
        'contactId MUST be the exact UUID from a contact_lookup result — never a name, placeholder, or comment.',
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
        'Use this for all document queries: full list, latest document, filtering by extension, or finding documents without metadata.',
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
        'Get the full details of a document including its UUID, description, tags, raw extracted content, and size statistics (totalChars, totalLines). ' +
        'Returns a structured JSON with fields: uuid, filename, description, tags, rawContent, totalChars, totalLines. ' +
        'Use this as a FIRST STEP to retrieve document metadata and understand the total document size. ' +
        'To read a specific portion of large documents, use document_analyze with lineStart and lineEnd parameters for chunked reading. ' +
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
        'Get the full details of a dossier including its key dates and key references. ' +
        'Use this before updating key dates or key references to read the existing IDs. ' +
        'If you do not have the dossierId, call dossier_list first.',
      inputSchema: z.object({
        dossierId: z
          .string()
          .optional()
          .describe('Target dossier ID. Omit to use the active dossier.')
      }),
      execute: async (args) => execute('dossier_get', args as Record<string, unknown>)
    }),
    document_search: tool({
      description:
        'Search the pre-extracted text of all documents in a dossier using a natural language query. ' +
        'Returns the most relevant text excerpts (chunks) from matching documents, each tagged with its source document ID and filename. ' +
        'Use this tool whenever the user asks about dossier CONTENT: demands, claims, facts, amounts, dates, positions, history, or any specific information. ' +
        'You MUST call this tool (or document_analyze for a single document) before answering content questions — never answer from memory. ' +
        'QUERY EXPANSION REQUIRED: for any content question, call this tool 2–4 times with DIFFERENT query strings — ' +
        'one per semantic angle (legal concept, party name, synonyms, document type). ' +
        'NEVER repeat the same query string across calls — it returns the same results and wastes a turn. ' +
        'Use known contact names and roles from the active context to craft targeted queries. ' +
        'Aggregate all returned excerpts before answering. ' +
        'Only works for documents whose text has already been extracted via the Documents tab. ' +
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
    contact_upsert: tool({
      description:
        'Create or update a contact in the active dossier. ' +
        'You MUST call this tool to save the contact — do NOT describe the creation or update in text, do NOT say "done" or "corrected" without calling this tool first. ' +
        'Before any create or update, call managed_fields_get so you know the configured contact roles and managed contact fields to populate or look for. ' +
        'Update workflow: (1) call contact_lookup to list contacts, (2) call contact_get to read current field values, (3) call contact_upsert with the contact id and only the fields to change. ' +
        'Create: omit `id`. Update: provide the existing contact `id` and only the fields to change (e.g. just `addressLine` to fix a typo in the address). ' +
        'Always capitalise proper names: first letter uppercase, rest lowercase (e.g. "dupont" → "Dupont", "MARIE" → "Marie"). ' +
        'ROLE RULE: only set `role` to a value from the managed_fields_get result, and only if the user explicitly stated it or it is unambiguously evident from context. ' +
        'If the role is not specified or unclear, omit the `role` field entirely — NEVER guess or invent a role. ' +
        'CUSTOM FIELDS RULE: managed contact fields are optional, never mandatory. Use `customFields` only for managed fields that both (a) actually exist in the managed_fields_get result and (b) are explicitly present and certain in the user request or source text. ' +
        'If no managed field value is clearly present, omit `customFields` entirely. NEVER invent, infer, auto-complete, or mirror standard fields into managed fields. ' +
        'Keys in `customFields` must match the field labels exactly as returned by managed_fields_get (e.g. { "Numéro de dossier": "2024-001" }).',
      inputSchema: z.object({
        id: z.string().optional().describe('Existing contact ID for an update.'),
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
      }),
      execute: async (args) => execute('contact_upsert', args as Record<string, unknown>)
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
    dossier_upsert_key_date: tool({
      description:
        'Add or update a key date on a dossier. ' +
        'Before creating or updating a key date, call managed_fields_get so you know the configured key date labels and field types to target. ' +
        'To update an existing key date, provide its `id` (call dossier_get first to read existing IDs). ' +
        'You MUST call this tool to persist the date — do NOT describe the action in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        id: z.string().optional().describe('Existing key date ID for an update. Omit to create.'),
        label: z.string().describe('Label for the key date.'),
        date: z.string().describe('Date in YYYY-MM-DD format.'),
        note: z.string().optional().describe('Optional note.')
      }),
      execute: async (args) => execute('dossier_upsert_key_date', args as Record<string, unknown>)
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
    dossier_upsert_key_reference: tool({
      description:
        'Add or update a key reference on a dossier. ' +
        'Before creating or updating a key reference, call managed_fields_get so you know the configured key reference labels and field types to target. ' +
        'To update an existing key reference, provide its `id` (call dossier_get first to read existing IDs). ' +
        'You MUST call this tool to persist the reference — do NOT describe the action in text.',
      inputSchema: z.object({
        dossierId: z.string().describe('Target dossier ID.'),
        id: z
          .string()
          .optional()
          .describe('Existing key reference ID for an update. Omit to create.'),
        label: z.string().describe('Label for the key reference.'),
        value: z.string().describe('Value of the key reference.'),
        note: z.string().optional().describe('Optional note.')
      }),
      execute: async (args) =>
        execute('dossier_upsert_key_reference', args as Record<string, unknown>)
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
    document_analyze: tool({
      description:
        'Read the pre-extracted text of a single document and return it as structured JSON. ' +
        'Returns: { uuid, rawContent, totalChars, charsReturned }. ' +
        'Only works if the document text has already been extracted via the Documents tab. ' +
        'If the text is not yet extracted, this tool returns a warning — relay it to the user and suggest they go to the Documents tab and use "Tout extraire". ' +
        'Use charStart and charEnd to read a specific character range (both inclusive). ' +
        'Omit both to read the full document (capped at 12 000 chars). ' +
        'documentId must be the UUID of the document. If you do not have the UUID, call document_list first.',
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
      'You MUST call this tool to trigger generation — do NOT describe the document as generated in text.',
    inputSchema: z.object({
      dossierId: z.string().describe('Target dossier ID.'),
      templateId: z.string().describe('Template ID to use.'),
      contactId: z.string().optional().describe('Optional primary contact ID.'),
      tagOverrides: z
        .record(z.string(), z.string())
        .optional()
        .describe('Override values for unresolved template tags.')
    })
  }),
  document_metadata_save: tool({
    description:
      'Save a description and/or tags for a document. ' +
      'You MUST call this tool to persist metadata — do NOT describe the save in text. ' +
      'If you do not have the documentId, call document_list first. ' +
      'Generate a concise description (1-3 sentences) and at most 5 relevant tags from the document content.',
    inputSchema: z.object({
      documentId: z.string().describe('Document ID to update.'),
      dossierId: z
        .string()
        .optional()
        .describe('Target dossier ID. Omit to use the active dossier.'),
      description: z.string().optional().describe('Short description of the document.'),
      tags: z.array(z.string()).describe('List of tags for the document.')
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
  dossier_list: tool({
    description: 'List available dossiers.',
    inputSchema: z.object({})
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
