/**
 * aiSystemPrompt — builds the system prompt sent to the LLM on every command.
 *
 * The prompt embeds:
 *   - Current date (for date-aware commands).
 *   - The full InternalAiCommand discriminated-union schema with one JSON example per type.
 *   - Disambiguation rules (when to use clarification_request vs unknown).
 *   - Live application context: active dossier ID, available dossiers, contacts,
 *     templates, and documents. This allows the model to resolve natural names
 *     ("John Martin", "dossier Dupont") to stable IDs before returning an intent.
 *   - Dynamic examples built from the user's actual data (dossiers, contacts, templates)
 *     so the LLM can do reliable pattern matching instead of generic placeholders.
 *
 * The context is populated by aiService.executeCommand() just before calling
 * aiSdkAgentRuntime, so the prompt always reflects the current state.
 *
 * Called by: aiService.executeCommand()
 */

/**
 * Contact shape passed to both buildSystemPrompt and buildToolSystemPrompt
 * for dynamic examples (resolving names to IDs in JSON-mode prompts).
 */
export interface PromptContact {
  uuid: string
  name: string
  role?: string
  email?: string
}

/**
 * Template shape for prompt context.
 * Used in buildSystemPrompt (dynamic examples) and passed into SystemPromptContext.
 * `macros` lists the template's tag names so the LLM knows which tags may need overrides.
 */
export interface PromptTemplate {
  id: string
  name: string
  description?: string
  macros?: string[]
}

/**
 * Dossier shape for prompt context.
 * Used in buildSystemPrompt (dynamic examples) and buildToolSystemPrompt (active context block).
 * Both `id` (folder name / legacy id) and `uuid` (stable UUID) are kept for backward compatibility.
 * The tool system prompt uses `uuid` when available (via `activeDossier.uuid ?? activeDossier.id`).
 * TODO: once all dossiers have UUIDs, make `uuid` required and use it exclusively.
 */
export interface PromptDossier {
  id: string
  uuid?: string
  name: string
  status: string
  type?: string
  /** Relative folder path under the domain root. */
  folderPath?: string
}

/**
 * Context object passed to both prompt builders.
 * `dossierId` identifies the active dossier (UUID preferred, id as fallback).
 * `contacts`, `templates`, `dossiers` are used for dynamic examples in JSON-mode prompts.
 */
export interface SystemPromptContext {
  dossierId?: string
  currentDate?: string
  contacts?: PromptContact[]
  templates?: PromptTemplate[]
  dossiers?: PromptDossier[]
  piiEnabled?: boolean
}

/**
 * JSON-mode intent schema: one example per InternalAiCommand type.
 * Embedded verbatim into buildSystemPrompt() for non-tool-capable models.
 * buildToolSystemPrompt() does NOT include this — it relies on native tool definitions instead.
 * Note: `dossierId` / `id` fields here use the legacy id format; prefer UUIDs in tool mode.
 */
const INTENT_SCHEMA = `
{ "type": "dossier_list" }
{ "type": "dossier_select", "dossierId": "<id from Available Dossiers>" }
{ "type": "dossier_create", "id": "<name or id for the new dossier>" }
{ "type": "dossier_update", "id": "<dossier id>", "status": "<optional>", "dossierType": "<optional>", "information": "<optional>" }
{ "type": "dossier_upsert_key_date", "dossierId": "<dossier id>", "id": "<existing key date id for update — omit to create>", "label": "<label>", "date": "<YYYY-MM-DD>", "note": "<optional>" }
{ "type": "dossier_delete_key_date", "dossierId": "<dossier id>", "keyDateId": "<id from dossier_get result>" }
{ "type": "dossier_upsert_key_reference", "dossierId": "<dossier id>", "id": "<existing key reference id for update — omit to create>", "label": "<label>", "value": "<value>", "note": "<optional>" }
{ "type": "dossier_delete_key_reference", "dossierId": "<dossier id>", "keyReferenceId": "<id from dossier_get result>" }
{ "type": "document_list", "dossierId": "<optional dossier id>" }
{ "type": "document_get", "documentId": "<id from document_list result>", "dossierId": "<optional dossier id>" }
{ "type": "document_metadata_save", "documentId": "<id from document_list result>", "dossierId": "<optional dossier id>", "description": "<short description>", "tags": ["<tag1>", "<tag2>"] }
{ "type": "document_relocate", "documentUuid": "<uuid from document_list result>", "dossierId": "<dossier id>", "fromDocumentId": "<optional previous relative path>", "toDocumentId": "<new relative path inside the same dossier>" }
{ "type": "contact_lookup", "dossierId": "<id from Available Dossiers — omit to use active dossier>", "query": "<optional; tolerated but ignored by runtime>" }
{ "type": "contact_get", "dossierId": "<id from Available Dossiers — omit to use active dossier>", "contactId": "<exact contact id from Available Contacts>" }
{ "type": "contact_upsert", "id": "<existing id for update, omit for create>", "firstName": "<first name>", "lastName": "<last name>", "role": "<role>", "email": "<email>", "phone": "<phone>" }
{ "type": "contact_delete", "contactId": "<id from Available Contacts>" }
{ "type": "template_list" }
{ "type": "template_select", "templateName": "<template name>" }
{ "type": "template_create", "name": "<name>", "content": "<content>", "description": "<optional>" }
{ "type": "template_update", "id": "<template id>", "name": "<optional>", "content": "<optional>", "description": "<optional>" }
{ "type": "template_delete", "id": "<template id>" }
{ "type": "field_populate", "contactId": "<id from Available Contacts>", "templateId": "<id from Available Templates>" }
{ "type": "document_generate", "dossierId": "<active or resolved dossier id>", "templateId": "<id from Available Templates>", "contactId": "<id from Available Contacts>", "tagOverrides": { "<tag.path>": "<value>" } }
{ "type": "text_generate", "textType": "email" | "letter" | "analysis" | "summary" | "text", "contactId": "<id from Available Contacts or omit>", "language": "<fr|en|...>", "instructions": "<what to write>" }
{ "type": "clarification_request", "question": "<question>", "options": ["<option 1>", "<option 2>"], "optionIds": ["<id 1>", "<id 2>"] }
{ "type": "unknown", "message": "<explain what you understood and suggest valid commands>" }
`

export function buildPiiInstructionBlock(): string {
  return `
## Anonymised data / Données anonymisées

In this session, personal and sensitive data has been replaced with anonymisation markers.
Each marker has the form  [[path]] \`replacement\`  where:
- [[path]] identifies the nature of the data using template macro conventions
  (e.g. [[contact.client.firstName]], [[dossier.keyRef.nRg]], [[SSN_1]])
- \`replacement\` is a realistic anonymised value to use in place of the real data

Rules you MUST follow:
1. Use the \`replacement\` value when referring to the data in natural language prose.
2. Preserve the full marker [[path]] \`replacement\` exactly as-is in all tool call arguments and structured outputs — never strip the [[path]] prefix.
3. Never attempt to guess, restore, or comment on the original data behind a marker.
4. If you generate text that repeats an anonymised value you saw earlier, always prefix it with its [[path]] marker.
5. Do not invent new [[...]] markers. Only use markers that already appear in the conversation.`.trim()
}

export function buildToolSystemPrompt(context: SystemPromptContext): string {
  const parts: string[] = []
  const activeDossier = context.dossiers?.find((d) => d.id === context.dossierId)

  parts.push('You are the Ordicab agent runtime assistant.')
  if (context.currentDate) parts.push(`Today's date: ${context.currentDate}`)

  parts.push('')
  parts.push('## Active context')
  if (activeDossier) {
    const ref = activeDossier.uuid ?? activeDossier.id
    parts.push('This context is persistent for the current session.')
    parts.push(`- id: "${ref}"`)
    parts.push(
      'Always use this id as the default `dossierId`. Never ask which dossier to use unless the user explicitly mentions a different one.'
    )
  } else {
    parts.push('No active dossier selected. Invite the user to choose one via `dossier_list`.')
  }

  parts.push('')
  parts.push('## Runtime contract')
  parts.push(
    'For any create/update/delete/select/generate action, you MUST emit the native tool call. ' +
      'Do not claim an action is done unless the corresponding tool call was made.'
  )
  parts.push('Only respond with plain text when no tool matches. Keep it concise.')
  parts.push(
    'You may reuse IDs from recent tool results in the current conversation when still valid; otherwise call the data tool again.'
  )

  parts.push(
    'Before `contact_upsert`, `dossier_upsert_key_date`, or `dossier_upsert_key_reference`, call `managed_fields_get` unless its result is already visible and still relevant.'
  )
  parts.push(
    '`managed_fields_get` is a schema prerequisite for create/update flows, not for read-only contact lookup.'
  )
  parts.push(
    'For destructive actions (`contact_delete`, `template_delete`, `dossier_delete_key_date`, `dossier_delete_key_reference`): load live data first, then call `clarification_request` with exactly two options: `Oui` and `Non`. ' +
      'Do not delete in the same turn as the confirmation request.'
  )

  parts.push('')
  parts.push('## Grounding')
  parts.push(
    'For dossier-content questions (facts, claims, dates, amounts, procedural history), answer only from tool results.' +
      ' Use `document_search` and/or `document_analyze` first; do not invent missing information.'
  )

  parts.push('')
  parts.push('## Document and text generation workflow')
  parts.push(
    'Before free drafting, prefer template-based generation:' +
      '\n1. Call `template_list` (or reuse visible template IDs).' +
      '\n2. If a matching template exists, use `document_generate` (optionally via `template_select`).' +
      '\n3. Use `text_generate` only when no suitable template exists and the user confirms.'
  )

  parts.push('')
  parts.push('## Dossier management')
  parts.push(
    'Use `dossier_create` / `dossier_update` for dossier metadata. ' +
      'For key dates/references: load IDs with `dossier_get` before update/delete, and format dates as YYYY-MM-DD.'
  )

  parts.push('')
  parts.push('## Contact enrichment workflow')
  parts.push(
    'For add/update contact flows, call `managed_fields_get` first, then `contact_lookup`/`contact_get` when needed, then `contact_upsert` with only known fields.' +
      ' Managed fields are optional: omit `customFields` when values are not explicit and certain.'
  )

  parts.push('')
  parts.push('## Template management')
  parts.push(
    'Use `template_create` / `template_update` / `template_delete` with IDs resolved from `template_list` when needed.'
  )

  parts.push('')
  parts.push('## Document metadata workflow')
  parts.push(
    'For indexing/metadata tasks: call `document_list`, process docs with `hasMetadata: false` using `document_get`/`document_analyze`, then persist with `document_metadata_save`.'
  )

  if (context.piiEnabled) {
    parts.push('')
    parts.push(buildPiiInstructionBlock())
  }

  return parts.join('\n')
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  // ── JSON-mode (remote + local models without tool support) ─────────────────
  const parts: string[] = []

  parts.push(
    'You are an AI assistant integrated into Ordicab, a legal document management application.'
  )
  parts.push(
    'Your job is to interpret natural language commands (in French or English) and return a single JSON object matching one of the action schemas below.'
  )
  parts.push(
    'IMPORTANT: Respond ONLY with valid JSON. Do not include any explanation or text outside the JSON object.'
  )
  parts.push('')

  if (context.currentDate) {
    parts.push(`Today's date: ${context.currentDate}`)
    parts.push('')
  }

  parts.push('## Action Schemas')
  parts.push(INTENT_SCHEMA)

  // ── Rules ────────────────────────────────────────────────────────────────
  parts.push('## Rules')
  parts.push('- `dossier_list`: user wants to see or list available dossiers.')
  parts.push(
    '- `dossier_select`: user wants to work on a specific dossier. Look up its ID in Available Dossiers.'
  )
  parts.push(
    '- `dossier_create`: user wants to create a new dossier. Provide the name/id in the `id` field.'
  )
  parts.push(
    '- `dossier_update`: user wants to change the status, type, or information of an existing dossier. ' +
      'Resolve the dossier ID from Available Dossiers. Only include fields that change.'
  )
  parts.push(
    '- `dossier_upsert_key_date`: user wants to add or update a key date on a dossier. ' +
      'Date must be YYYY-MM-DD. To update an existing key date, include its `id` (resolve via dossier_get).'
  )
  parts.push(
    '- `dossier_delete_key_date`: user wants to delete a key date. Requires `keyDateId` from a prior dossier_get result. Before deleting, first surface a yes/no confirmation that cites the loaded key date details.'
  )
  parts.push(
    '- `dossier_upsert_key_reference`: user wants to add or update a key reference on a dossier. ' +
      'To update an existing key reference, include its `id` (resolve via dossier_get).'
  )
  parts.push(
    '- `dossier_delete_key_reference`: user wants to delete a key reference. Requires `keyReferenceId` from a prior dossier_get result. Before deleting, first surface a yes/no confirmation that cites the loaded reference details.'
  )
  parts.push(
    '- `document_list`: user wants to see documents in the active dossier. Use this for ALL document queries including "the most recent", "the latest", "docx files", etc. There is NO `document_latest` intent. ' +
      'The result includes `hasMetadata: true/false` for each document.'
  )
  parts.push(
    '- `document_get`: user wants to read details or metadata of a specific document. Requires `documentId` from a prior `document_list` result.'
  )
  parts.push(
    '- `document_metadata_save`: user wants to save a description and/or tags for a document. Requires `documentId`. ' +
      'When the user asks to "organise", "index", or "generate metadata" for documents: ' +
      '(1) emit `document_list` first; (2) for each document with `hasMetadata: false`, emit `document_get` then `document_metadata_save` with inferred description and tags; ' +
      '(3) process all unindexed documents without asking for confirmation between each one.'
  )
  parts.push(
    '- `contact_lookup`: user wants to list or inspect contacts. ' +
      'If the user names a dossier, set `dossierId` to its ID from Available Dossiers. ' +
      'The runtime returns the full contact list for that dossier; do not rely on `query` to filter server-side.'
  )
  parts.push(
    '- `contact_upsert`: user wants to add or update a contact in the active dossier. ' +
      'In tool mode, call `managed_fields_get` first so the configured roles and managed fields are known before choosing what to extract. ' +
      'Use this for any partial update such as adding an email, phone, role, or address. ' +
      'Include `id` only when updating an existing contact (look up ID from Available Contacts). ' +
      'When updating, send only the fields that change.'
  )
  parts.push(
    '- `managed_fields_get` (tool mode): load the configured contact roles and managed fields for contacts, key dates, and key references before creating or updating those entities.'
  )
  parts.push(
    '- `contact_delete`: user wants to remove a contact. Resolve name to ID from Available Contacts, then ask for explicit yes/no confirmation before deleting.'
  )
  parts.push(
    '- If several contacts match a delete target, do not pick the first one. Emit `clarification_request` listing the candidates, and once the user chooses one, carry its exact `optionId`/UUID forward into the final `contact_delete` call.'
  )
  parts.push('- `template_list`: user wants to see all available templates.')
  parts.push(
    '- `template_create`: user wants to create a new template. Requires `name` and `content`.'
  )
  parts.push(
    '- `template_update`: user wants to modify an existing template. ' +
      'Resolve template ID from Available Templates. Only include fields that change.'
  )
  parts.push(
    '- `template_delete`: user wants to delete a template. Resolve template ID from Available Templates, then ask for explicit yes/no confirmation before deleting.'
  )
  parts.push(
    '- `document_relocate`: user wants to rebind a document after the file was moved or renamed anywhere inside the same dossier. ' +
      'Requires `documentUuid`, `dossierId`, and `toDocumentId`; `fromDocumentId` is optional as a safety check. ' +
      'Do not use this for dossier-to-dossier moves.'
  )
  parts.push(
    '- `template_select`: user wants to choose a template. Match by SEMANTIC SIMILARITY between the user intent ' +
      'and the template name + description in "Available Templates". ' +
      'Prefer the template whose name or description best reflects the purpose of the document the user wants to produce. ' +
      'Generic templates (e.g. "Lettre 1", "Lettre 3") should only be chosen if no more specific template matches.'
  )
  parts.push(
    '- `document_generate`: user wants to generate a document. ' +
      'Resolve template by SEMANTIC SIMILARITY to name + description in Available Templates (same rule as template_select). ' +
      'Resolve contact names to IDs from Available Contacts. ' +
      'Use the active dossier ID if no other dossier is specified.'
  )
  parts.push(
    '- `text_generate`: ONLY use this when no suitable template exists AND the user has explicitly confirmed they want a free-text draft (see Document and text generation workflow step 3). ' +
      'For any document, letter, or email related to the dossier, ALWAYS check Available Templates first: ' +
      'if a relevant template is found, use `document_generate` instead. ' +
      'Before calling `text_generate`, load relevant dossier context: call `dossier_get` for key dates and references, ' +
      'and call `document_search` to extract content from relevant documents (jugements, actes, conventions…) — never invent facts not found in the documents. ' +
      'Include all extracted key facts (dates, amounts, references, parties) in the `instructions` field. ' +
      'Detect language from the command.'
  )
  parts.push(
    '- `clarification_request`: use when the command is ambiguous, or multiple contacts/templates match. ' +
      'Provide `optionIds` when options correspond to entity IDs.'
  )
  parts.push(
    '- `unknown`: use only when intent is completely unrecognisable. Suggest valid commands.'
  )
  parts.push(
    '- `document_generate` with `tagOverrides`: IMPORTANT — when "## Pending Tag Fields" is present below, ' +
      "the user's message provides values for those fields. " +
      'Generate `document_generate` using the Active Dossier and Active Template IDs, ' +
      'with `tagOverrides` mapping each pending field path to the value the user provided. ' +
      'Do NOT generate `clarification_request` in this case.'
  )
  parts.push(
    '- For destructive deletions (`contact_delete`, `template_delete`, `dossier_delete_key_date`, `dossier_delete_key_reference`): never delete immediately after resolving the target. First ask a yes/no confirmation that includes the exact loaded item details, then delete only if the user explicitly confirms in the next turn.'
  )
  parts.push('')

  // ── Dynamic examples built from real data ────────────────────────────────
  parts.push('## Examples')

  // Dossier examples
  parts.push('User: "List the dossiers" → { "type": "dossier_list" }')

  const firstDossier = context.dossiers?.[0]
  if (firstDossier) {
    parts.push(
      `User: "Open ${firstDossier.name}" → { "type": "dossier_select", "dossierId": "${firstDossier.id}" }`
    )
    parts.push(
      `User: "Contacts for dossier ${firstDossier.name}" → { "type": "contact_lookup", "dossierId": "${firstDossier.id}" }`
    )
    parts.push(
      `User: "Show the contacts for ${firstDossier.name}" → { "type": "contact_lookup", "dossierId": "${firstDossier.id}" }`
    )
  } else {
    parts.push(
      'User: "Contacts for dossier Dupont" → { "type": "contact_lookup", "dossierId": "<Dupont id from Available Dossiers>" }'
    )
  }

  // Contact examples
  const firstContact = context.contacts?.[0]
  if (firstContact) {
    parts.push(
      `User: "Find ${firstContact.name}" → { "type": "contact_lookup", "query": "${firstContact.name}" }`
    )
    parts.push(
      `User: "Phone number for ${firstContact.name}" → { "type": "contact_get", "contactId": "${firstContact.uuid}" }`
    )
    parts.push(
      `User: "Add email ${firstContact.email} to ${firstContact.name}" → { "type": "contact_upsert", "id": "${firstContact.uuid}", "email": "${firstContact.email}" }`
    )
    parts.push(
      `User: "Delete ${firstContact.name}" → { "type": "contact_delete", "contactId": "${firstContact.uuid}" }`
    )
  }
  parts.push('User: "Show all contacts" → { "type": "contact_lookup" }')

  // Counter-example: dossier name must NOT go in query
  if (firstDossier) {
    parts.push(
      `WRONG: "Contacts for ${firstDossier.name}" → { "type": "contact_lookup", "query": "${firstDossier.name}" }`
    )
    parts.push(
      `RIGHT: "Contacts for ${firstDossier.name}" → { "type": "contact_lookup", "dossierId": "${firstDossier.id}" }`
    )
  }

  // Template / document examples
  parts.push('User: "List the templates" → { "type": "template_list" }')

  const firstTemplate = context.templates?.[0]
  const dossierId = context.dossierId ?? firstDossier?.id ?? '<active dossier id>'
  if (firstTemplate) {
    parts.push(
      `User: "Use the template ${firstTemplate.name}" → { "type": "template_select", "templateName": "${firstTemplate.name}" }`
    )
    if (firstContact) {
      parts.push(
        `User: "Generate ${firstTemplate.name} for ${firstContact.name}" → { "type": "document_generate", "dossierId": "${dossierId}", "templateId": "${firstTemplate.id}", "contactId": "${firstContact.uuid}" }`
      )
    } else {
      parts.push(
        `User: "Generate ${firstTemplate.name}" → { "type": "document_generate", "dossierId": "${dossierId}", "templateId": "${firstTemplate.id}" }`
      )
    }
  } else {
    parts.push(
      'User: "Prepare the NDA for John Martin" → { "type": "document_generate", "dossierId": "<active dossier id>", "templateId": "<NDA id>", "contactId": "<John Martin id>" }'
    )
  }

  parts.push('User: "List the documents" → { "type": "document_list" }')
  parts.push(
    'User: "What is the most recent document?" → { "type": "document_list" }  ← use document_list, NOT document_latest'
  )
  parts.push(
    'User: "Latest docx document in the dossier" → { "type": "document_list" }  ← always document_list for document queries'
  )
  parts.push(
    'User: "Organize the documents" / "Index the documents" / "Generate metadata" → ' +
      '{ "type": "document_list" }  ← then for each doc without metadata: document_get → document_metadata_save'
  )

  // Text generation examples
  parts.push(
    'User: "Write an email to request an appointment" → { "type": "text_generate", "textType": "email", "language": "en", "instructions": "request a future appointment" }'
  )
  parts.push(
    'User: "Analyze the dossier" → { "type": "text_generate", "textType": "analysis", "language": "en", "instructions": "analyze the dossier" }'
  )

  parts.push(
    'User: "Calculate my taxes" → { "type": "unknown", "message": "I cannot calculate taxes. Available commands: list dossiers, list contacts, generate a document, write an email..." }'
  )

  if (context.piiEnabled) {
    parts.push('')
    parts.push(buildPiiInstructionBlock())
  }

  return parts.join('\n')
}
