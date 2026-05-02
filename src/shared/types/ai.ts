import type { RemoteProviderKind } from '../ai/remoteProviders'

/**
 * AI domain types — shared between main process and renderer.
 *
 * AI action pipeline (Epic 2):
 *   AiPage → aiStore.executeCommand() → IPC (AiCommandInput)
 *     → aiHandler → aiService → aiSdkAgentRuntime (local/remote SDK model)
 *     → intentDispatcher → service layer → IpcResult<AiCommandResult>
 *
 * Push channel: after dispatch, aiHandler sends the resolved InternalAiCommand back to the
 * renderer via ai:intent-received so aiStore can react immediately.
 *
 * Model selection: AiCommandInput.model carries the model chosen by
 * the user in AiPage (session only, never persisted).
 */
export type AiMode = 'none' | 'local' | 'remote' | 'claude-code' | 'copilot' | 'codex'

export const AI_DELEGATED_MODES: readonly AiMode[] = ['claude-code', 'copilot', 'codex']

export type RemoteApiErrorType = 'auth_error' | 'rate_limit' | 'network_error' | 'server_error'

export interface RemoteApiError {
  type: RemoteApiErrorType
  message: string
  httpStatus?: number
}

export interface AiSettings {
  mode: AiMode
  ollamaEndpoint?: string
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  /** When true, pseudonymize PII in prompts before sending to remote providers. Default: true for remote mode. */
  piiEnabled?: boolean
  /** User-defined sensitive terms to always pseudonymize (company names, project codes, etc.) */
  piiWordlist?: string[]
}

export interface AiSettingsPersisted {
  mode: AiMode
  ollamaEndpoint?: string
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  encryptedApiKey?: string
  piiEnabled?: boolean
  piiWordlist?: string[]
}

export interface AiSettingsResponse extends AiSettings {
  hasApiKey: boolean
  apiKeySuffix?: string
}

export interface OllamaConnectionResult {
  reachable: boolean
  models?: string[]
  error?: string
}

export interface RemoteConnectionResult {
  reachable: boolean
  models?: string[]
  resolvedModel?: string
  usedConfiguredModelFallback?: boolean
  error?: string
}

export interface AiSettingsSaveInput {
  mode: AiMode
  ollamaEndpoint?: string
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  apiKey?: string
  piiEnabled?: boolean
  piiWordlist?: string[]
}

export interface AiDelegatedProviderStatus {
  available: boolean
  reason?: string
}

export const AI_DELEGATED_INSTRUCTIONS_FILES: Partial<Record<AiMode, string>> = {
  'claude-code': 'CLAUDE.md',
  codex: 'AGENTS.md',
  copilot: '.github/copilot-instructions.md'
}

// ── AI Command / Action types ──────────────────────────────────────────────

export type InternalAiCommandType =
  | 'contact_lookup'
  | 'contact_lookup_active'
  | 'contact_get'
  | 'contact_upsert'
  | 'contact_delete'
  | 'template_select'
  | 'template_list'
  | 'template_create'
  | 'template_update'
  | 'template_delete'
  | 'field_populate'
  | 'document_generate'
  | 'document_list'
  | 'document_get'
  | 'document_metadata_save'
  | 'document_metadata_batch'
  | 'document_summary_batch'
  | 'document_analyze'
  | 'document_relocate'
  | 'dossier_list'
  | 'dossier_select'
  | 'dossier_create'
  | 'dossier_update'
  | 'dossier_upsert_key_date'
  | 'dossier_delete_key_date'
  | 'dossier_upsert_key_reference'
  | 'dossier_delete_key_reference'
  | 'text_generate'
  | 'direct_response'
  | 'clarification_request'
  | 'unknown'

export interface ContactLookupIntent {
  type: 'contact_lookup'
  query?: string
  /** Dossier to search in — resolved by LLM from conversation history or context */
  dossierId?: string
}

export interface ContactLookupActiveIntent {
  type: 'contact_lookup_active'
  query?: string
  /** Active dossier from context — this intent type ignores explicit dossierId */
}

export interface ContactGetIntent {
  type: 'contact_get'
  contactId: string
  dossierId?: string
}

export interface ContactUpsertIntent {
  type: 'contact_upsert'
  id?: string
  firstName?: string
  lastName?: string
  role?: string
  email?: string
  phone?: string
  title?: string
  institution?: string
  addressLine?: string
  city?: string
  zipCode?: string
  country?: string
  information?: string
  customFields?: Record<string, string>
}

export interface ContactDeleteIntent {
  type: 'contact_delete'
  contactId: string
}

export interface TemplateSelectIntent {
  type: 'template_select'
  templateName: string
}

export interface TemplateListIntent {
  type: 'template_list'
}

export interface FieldPopulateIntent {
  type: 'field_populate'
  contactId: string
  templateId: string
}

export interface DocumentGenerateIntent {
  type: 'document_generate'
  dossierId: string
  templateId: string
  contactId?: string
  /** Field overrides provided by the user for unresolved template tags (e.g. renvoiDate → "04/04/2026") */
  tagOverrides?: Record<string, string>
}

export interface DocumentListIntent {
  type: 'document_list'
  dossierId?: string
}

export interface DocumentGetIntent {
  type: 'document_get'
  documentId: string
  dossierId?: string
}

export interface DocumentMetadataSaveIntent {
  type: 'document_metadata_save'
  documentId: string
  dossierId?: string
  description?: string
  tags: string[]
}

export interface DocumentMetadataBatchIntent {
  type: 'document_metadata_batch'
  dossierId?: string
  /** Optional explicit list of document UUIDs to process. Omit to target all docs without metadata. */
  documentIds?: string[]
}

export interface DocumentSummaryBatchIntent {
  type: 'document_summary_batch'
  dossierId?: string
  documentIds?: string[]
}

export interface DocumentAnalyzeIntent {
  type: 'document_analyze'
  documentId: string
  dossierId?: string
  lineStart?: number
  lineEnd?: number
  charStart?: number
  charEnd?: number
}

export interface DossierListIntent {
  type: 'dossier_list'
}

export interface DossierSelectIntent {
  type: 'dossier_select'
  dossierId: string
}

export interface TextGenerateIntent {
  type: 'text_generate'
  textType: 'email' | 'letter' | 'analysis' | 'summary' | 'text'
  contactId?: string
  language?: string
  instructions: string
}

export interface DirectResponseIntent {
  type: 'direct_response'
  message: string
}

export interface ClarificationRequestIntent {
  type: 'clarification_request'
  question: string
  options: string[]
  optionIds?: string[]
}

export interface DossierCreateIntent {
  type: 'dossier_create'
  id: string
}

export interface DossierUpdateIntent {
  type: 'dossier_update'
  id: string
  status?: string
  dossierType?: string
  information?: string
}

export interface DossierUpsertKeyDateIntent {
  type: 'dossier_upsert_key_date'
  dossierId: string
  id?: string
  label: string
  date: string
  note?: string
}

export interface DossierDeleteKeyDateIntent {
  type: 'dossier_delete_key_date'
  dossierId: string
  keyDateId: string
}

export interface DossierUpsertKeyReferenceIntent {
  type: 'dossier_upsert_key_reference'
  dossierId: string
  id?: string
  label: string
  value: string
  note?: string
}

export interface DossierDeleteKeyReferenceIntent {
  type: 'dossier_delete_key_reference'
  dossierId: string
  keyReferenceId: string
}

export interface TemplateCreateIntent {
  type: 'template_create'
  name: string
  content: string
  description?: string
}

export interface TemplateUpdateIntent {
  type: 'template_update'
  id: string
  name?: string
  content?: string
  description?: string
}

export interface TemplateDeleteIntent {
  type: 'template_delete'
  id: string
}

export interface DocumentRelocateIntent {
  type: 'document_relocate'
  documentUuid: string
  dossierId: string
  fromDocumentId?: string
  toDocumentId: string
}

export interface UnknownIntent {
  type: 'unknown'
  message: string
}

/**
 * Internal typed representation of the business action requested by the user.
 *
 * `InternalAiCommand` is the canonical internal AI command shape.
 * In practice this is the resolved action/command object that the service
 * layer executes after the model has interpreted natural language.
 *
 * Flow: aiSdkAgentRuntime.sendCommand() resolves the LLM output into one of these union members.
 * aiService.executeCommand() receives it, then intentDispatcher.dispatch() performs the
 * actual side-effect (contact upsert, document generate, etc.) and returns AiCommandResult.
 * The resolved intent is also pushed back to the renderer via the ai:intent-received IPC channel.
 */
export type InternalAiCommand =
  | ContactLookupIntent
  | ContactLookupActiveIntent
  | ContactGetIntent
  | ContactUpsertIntent
  | ContactDeleteIntent
  | TemplateSelectIntent
  | TemplateListIntent
  | TemplateCreateIntent
  | TemplateUpdateIntent
  | TemplateDeleteIntent
  | FieldPopulateIntent
  | DocumentGenerateIntent
  | DocumentListIntent
  | DocumentGetIntent
  | DocumentMetadataSaveIntent
  | DocumentMetadataBatchIntent
  | DocumentSummaryBatchIntent
  | DocumentAnalyzeIntent
  | DocumentRelocateIntent
  | DossierListIntent
  | DossierSelectIntent
  | DossierCreateIntent
  | DossierUpdateIntent
  | DossierUpsertKeyDateIntent
  | DossierDeleteKeyDateIntent
  | DossierUpsertKeyReferenceIntent
  | DossierDeleteKeyReferenceIntent
  | TextGenerateIntent
  | DirectResponseIntent
  | ClarificationRequestIntent
  | UnknownIntent

/**
 * Contextual state carried by each command from the renderer.
 * `dossierId` is the active dossier UUID selected in the AI panel.
 * `contactId` and `templateId` are forwarded to intentDispatcher (e.g. for field_populate).
 * `pendingTagPaths` is set when document_generate found unresolved template tags on the last
 * call; the next user message is treated as values for those fields (bypasses the LLM).
 */
export interface AiCommandContext {
  dossierId?: string
  contactId?: string
  templateId?: string
  /**
   * Unresolved template tag paths from the last document_generate attempt.
   * Injected into the system prompt so the LLM knows to collect these values
   * from the user and retry with tagOverrides.
   */
  pendingTagPaths?: string[]
}

/**
 * Simplified conversation history entry shared between renderer and main process.
 * Only 'user' and 'assistant' roles are exposed here because the renderer never
 * generates tool messages. The full internal type (with 'tool' role and toolCalls)
 * is defined as AiChatHistoryEntry in aiSdkAgentRuntime.ts (main-process only).
 */
export interface AiChatHistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

// tod check if model and context are used and if it can be simplified
export interface AiCommandInput {
  command: string
  context: AiCommandContext
  model?: string
  /** Last N conversation turns to give the LLM memory of prior exchanges */
  history?: AiChatHistoryEntry[]
}

export interface AiCommandResult {
  intent: InternalAiCommand
  feedback: string
  /** Optional context update — e.g. when a dossier_select changes the active dossier */
  contextUpdate?: Partial<AiCommandContext>
  /**
   * The created or updated entity returned by a mutation tool.
   * Fed back to the LLM as the tool result so the model can reference its UUID
   * (e.g. the new contactId, keyDateId, keyReferenceId) in subsequent chained calls.
   */
  entity?: Record<string, unknown>
  /** Path of the generated file — set by document_generate so the UI can offer to open it */
  generatedFilePath?: string
  /** Debug info: system prompt + tool definitions sent to the LLM for this command */
  debugContext?: string
}
