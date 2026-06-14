import type { RemoteProviderKind } from '../ai/remoteProviders'
import type { KeyDateTag } from '../domain/dossier'
import type {
  BillingItemDiscountKind,
  BillingItemQuantityUnit,
  BillingItemStatus
} from '../domain/billing'

/**
 * AI domain types — shared between main process and renderer.
 *
 * AI action pipeline (Epic 2):
 *   AiPage → aiStore.executeCommand() → IPC (AiCommandInput)
 *     → aiHandler → aiService → aiSdkAgentRuntime (remote SDK model)
 *     → intentDispatcher → service layer → IpcResult<AiCommandResult>
 *
 * Push channel: after dispatch, aiHandler sends the resolved InternalAiCommand back to the
 * renderer via ai:intent-received so aiStore can react immediately.
 *
 * Model selection: AiCommandInput.model carries the model chosen by
 * the user in AiPage (session only, never persisted).
 */
export const AI_MODE_VALUES = ['none', 'remote', 'claude-code'] as const

export type AiMode = (typeof AI_MODE_VALUES)[number]

export const AI_DELEGATED_MODES: readonly AiMode[] = ['claude-code']

export type RemoteApiErrorType = 'auth_error' | 'rate_limit' | 'network_error' | 'server_error'

export interface RemoteApiError {
  type: RemoteApiErrorType
  message: string
  httpStatus?: number
}

export interface AiSettings {
  mode: AiMode
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  /** When true, pseudonymize PII in prompts before sending to remote providers. Default: true for remote mode. */
  piiEnabled?: boolean
  /** User-defined sensitive terms to always pseudonymize (company names, project codes, etc.) */
  piiWordlist?: string[]
  /** When true, Claude Cowork (claude-code) runs in parallel alongside the primary AI mode. */
  claudeCoworkEnabled?: boolean
}

export interface AiSettingsPersisted {
  mode: AiMode
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  encryptedApiKey?: string
  piiEnabled?: boolean
  piiWordlist?: string[]
  claudeCoworkEnabled?: boolean
}

export interface AiSettingsResponse extends AiSettings {
  hasApiKey: boolean
  apiKeySuffix?: string
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
  remoteProviderKind?: RemoteProviderKind
  remoteProjectRef?: string
  remoteProvider?: string
  apiKey?: string
  piiEnabled?: boolean
  piiWordlist?: string[]
  claudeCoworkEnabled?: boolean
}

export interface AiDelegatedProviderStatus {
  available: boolean
  reason?: string
}

export const AI_DELEGATED_INSTRUCTIONS_FILES: Partial<Record<AiMode, string>> = {
  'claude-code': 'CLAUDE.md'
}

// ── AI Command / Action types ──────────────────────────────────────────────

export type InternalAiCommandType =
  | 'contact_lookup'
  | 'contact_get'
  | 'contact_create'
  | 'contact_update'
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
  | 'dossier_create_key_date'
  | 'dossier_update_key_date'
  | 'dossier_delete_key_date'
  | 'dossier_create_key_reference'
  | 'dossier_update_key_reference'
  | 'dossier_delete_key_reference'
  | 'dossier_create_billing_item'
  | 'dossier_update_billing_item'
  | 'dossier_delete_billing_item'
  | 'note_create'
  | 'note_update'
  | 'note_delete'
  | 'note_search'
  | 'note_get'
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

export interface ContactGetIntent {
  type: 'contact_get'
  contactUuid: string
  dossierId?: string
}

export interface ContactMutationFields {
  firstName?: string
  lastName?: string
  role?: string
  email?: string
  phone?: string
  title?: string
  institution?: string
  addressLine?: string
  addressLine2?: string
  city?: string
  zipCode?: string
  country?: string
  information?: string
  customFields?: Record<string, string>
}

export interface ContactCreateIntent extends ContactMutationFields {
  type: 'contact_create'
}

export interface ContactUpdateIntent extends ContactMutationFields {
  type: 'contact_update'
  contactUuid: string
}

export interface ContactDeleteIntent {
  type: 'contact_delete'
  contactUuid: string
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
  contactUuid: string
  templateUuid: string
}

export interface DocumentGenerateIntent {
  type: 'document_generate'
  dossierId: string
  templateUuid: string
  contactUuid?: string
  /** Field overrides provided by the user for unresolved template tags (e.g. renvoiDate → "04/04/2026") */
  tagOverrides?: Record<string, string>
}

export interface DocumentListIntent {
  type: 'document_list'
  dossierId?: string
}

export interface DocumentGetIntent {
  type: 'document_get'
  documentUuid: string
  dossierId?: string
}

export interface DocumentMetadataSaveIntent {
  type: 'document_metadata_save'
  documentUuid: string
  dossierId?: string
  description?: string
  tags: string[]
}

export interface DocumentMetadataBatchIntent {
  type: 'document_metadata_batch'
  dossierId?: string
  /** Optional explicit list of document UUIDs to process. Omit to target all docs without metadata. */
  documentUuids?: string[]
}

export interface DocumentSummaryBatchIntent {
  type: 'document_summary_batch'
  dossierId?: string
  documentUuids?: string[]
}

export interface DocumentAnalyzeIntent {
  type: 'document_analyze'
  documentUuid: string
  dossierId?: string
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
  contactUuid?: string
  language?: string
  instructions: string
}

export interface DossierSummarizeIntent {
  type: 'dossier_summarize'
  dossierId?: string
  language?: string
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

export interface DossierKeyDateFields {
  dossierId: string
  label: string
  date: string
  time?: string
  duration?: number
  tags?: KeyDateTag[]
  isClosed?: boolean
  note?: string
}

export interface DossierCreateKeyDateIntent extends DossierKeyDateFields {
  type: 'dossier_create_key_date'
}

export interface DossierUpdateKeyDateIntent extends DossierKeyDateFields {
  type: 'dossier_update_key_date'
  keyDateUuid: string
}

export interface DossierDeleteKeyDateIntent {
  type: 'dossier_delete_key_date'
  dossierId: string
  keyDateUuid: string
}

export interface DossierKeyReferenceFields {
  dossierId: string
  label: string
  value: string
  note?: string
}

export interface DossierCreateKeyReferenceIntent extends DossierKeyReferenceFields {
  type: 'dossier_create_key_reference'
}

export interface DossierUpdateKeyReferenceIntent extends DossierKeyReferenceFields {
  type: 'dossier_update_key_reference'
  keyReferenceUuid: string
}

export interface DossierDeleteKeyReferenceIntent {
  type: 'dossier_delete_key_reference'
  dossierId: string
  keyReferenceUuid: string
}

export interface DossierBillingItemFields {
  dossierId: string
  date: string
  label: string
  description?: string
  quantity: number
  quantityUnit: BillingItemQuantityUnit
  unitPriceHtCents: number
  vatRateBasisPoints: number
  status: BillingItemStatus
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
  sourceServicePresetUuid?: string
  sourceKeyDateUuid?: string
}

export interface DossierCreateBillingItemIntent extends DossierBillingItemFields {
  type: 'dossier_create_billing_item'
}

export interface DossierUpdateBillingItemIntent extends DossierBillingItemFields {
  type: 'dossier_update_billing_item'
  billingItemUuid: string
}

export interface DossierDeleteBillingItemIntent {
  type: 'dossier_delete_billing_item'
  dossierId: string
  billingItemUuid: string
}

export interface DossierNoteFields {
  dossierId: string
  title: string
  content?: string
  kind?: 'note' | 'todo' | 'idea' | 'to_verify' | 'ai_log'
  status?: 'open' | 'done'
  tags?: string[]
  pinned?: boolean
}

export interface NoteCreateIntent extends DossierNoteFields {
  type: 'note_create'
}

export interface NoteUpdateIntent extends DossierNoteFields {
  type: 'note_update'
  noteUuid: string
}

export interface NoteDeleteIntent {
  type: 'note_delete'
  dossierId: string
  noteUuid: string
}

export interface TemplateCreateIntent {
  type: 'template_create'
  name: string
  content: string
  description?: string
}

export interface TemplateUpdateIntent {
  type: 'template_update'
  uuid: string
  name?: string
  content?: string
  description?: string
}

export interface TemplateDeleteIntent {
  type: 'template_delete'
  uuid: string
}

export interface DocumentRelocateIntent {
  type: 'document_relocate'
  documentUuid: string
  dossierId: string
  fromDocumentPath?: string
  toDocumentPath: string
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
  | ContactGetIntent
  | ContactCreateIntent
  | ContactUpdateIntent
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
  | DossierCreateKeyDateIntent
  | DossierUpdateKeyDateIntent
  | DossierDeleteKeyDateIntent
  | DossierCreateKeyReferenceIntent
  | DossierUpdateKeyReferenceIntent
  | DossierDeleteKeyReferenceIntent
  | DossierCreateBillingItemIntent
  | DossierUpdateBillingItemIntent
  | DossierDeleteBillingItemIntent
  | NoteCreateIntent
  | NoteUpdateIntent
  | NoteDeleteIntent
  | TextGenerateIntent
  | DossierSummarizeIntent
  | DirectResponseIntent
  | ClarificationRequestIntent
  | UnknownIntent

/**
 * Contextual state carried by each command from the renderer.
 * `dossierId` is the active dossier UUID selected in the AI panel.
 * `contactUuid` and `templateUuid` are forwarded to intentDispatcher (e.g. for field_populate).
 * `pendingTagPaths` is set when document_generate found unresolved template tags on the last
 * call; the next user message is treated as values for those fields (bypasses the LLM).
 */
export interface AiCommandContext {
  dossierId?: string
  contactUuid?: string
  templateUuid?: string
  /**
   * Unresolved template tag paths from the last document_generate attempt.
   * Injected into the system prompt so the LLM knows to collect these values
   * from the user and retry with tagOverrides.
   */
  pendingTagPaths?: string[]
  /**
   * Resolved `@<filename>` mentions detected in the user's latest message.
   * Each entry carries the document UUID alongside the user-visible filename so
   * the LLM does not need to call `document_list` to look them up — important
   * when PII pseudonymization rewrites the filename in the chat text.
   * UUID-shaped strings survive the pseudonymizer verbatim.
   */
  documentMentions?: Array<{ uuid: string; filename: string }>
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
  /**
   * Optional conversation-history fallback. The renderer no longer sends this:
   * the main-process runtime (aiSdkAgentRuntime) owns the canonical conversation
   * history and only consults this when its own rolling history is empty.
   */
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
   * (e.g. the new contactUuid, keyDateUuid, keyReferenceUuid) in subsequent chained calls.
   */
  entity?: Record<string, unknown>
  /** Path of the generated file — set by document_generate so the UI can offer to open it */
  generatedFilePath?: string
  /** Debug info: system prompt + tool definitions sent to the LLM for this command */
  debugContext?: string
}
