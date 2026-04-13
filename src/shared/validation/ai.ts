import { z } from 'zod'
import { REMOTE_PROVIDER_KIND_VALUES } from '../ai/remoteProviders'

export const aiSettingsSchema = z.object({
  mode: z.enum(['none', 'local', 'remote', 'claude-code', 'copilot', 'codex']),
  ollamaEndpoint: z.string().url().optional(),
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: z.string().optional()
})

export const aiSettingsSaveSchema = z.object({
  mode: z.enum(['none', 'local', 'remote', 'claude-code', 'copilot', 'codex']),
  ollamaEndpoint: z.string().optional(),
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: z.string().optional(),
  apiKey: z.string().optional(),
  piiEnabled: z.boolean().optional()
})

export const aiCommandContextSchema = z.object({
  dossierId: z.string().optional(),
  contactId: z.string().optional(),
  templateId: z.string().optional()
})

const aiChatHistoryEntrySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string()
})

export const aiCommandInputSchema = z.object({
  command: z.string().min(1),
  context: aiCommandContextSchema,
  model: z.string().optional(),
  history: z.array(aiChatHistoryEntrySchema).optional()
})

export const aiIntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('contact_lookup'),
    query: z.string().optional(),
    dossierId: z.string().optional()
  }),
  z.object({
    type: z.literal('contact_get'),
    contactId: z.string(),
    dossierId: z.string().optional()
  }),
  z.object({
    type: z.literal('contact_upsert'),
    id: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    institution: z.string().optional(),
    addressLine: z.string().optional(),
    city: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    information: z.string().optional()
  }),
  z.object({ type: z.literal('contact_delete'), contactId: z.string() }),
  z.object({ type: z.literal('template_select'), templateName: z.string() }),
  z.object({ type: z.literal('template_list') }),
  z.object({ type: z.literal('field_populate'), contactId: z.string(), templateId: z.string() }),
  z.object({
    type: z.literal('document_generate'),
    dossierId: z.string(),
    templateId: z.string(),
    contactId: z.string().optional()
  }),
  z.object({ type: z.literal('document_list'), dossierId: z.string().optional() }),
  z.object({
    type: z.literal('document_analyze'),
    documentId: z.string(),
    dossierId: z.string().optional()
  }),
  z.object({ type: z.literal('dossier_list') }),
  z.object({ type: z.literal('dossier_select'), dossierId: z.string() }),
  z.object({
    type: z.literal('text_generate'),
    textType: z.enum(['email', 'letter', 'analysis', 'summary', 'text']),
    contactId: z.string().optional(),
    language: z.string().optional(),
    instructions: z.string()
  }),
  z.object({
    type: z.literal('direct_response'),
    message: z.string()
  }),
  z.object({
    type: z.literal('clarification_request'),
    question: z.string(),
    options: z.array(z.string()),
    optionIds: z.array(z.string()).optional()
  }),
  z.object({ type: z.literal('unknown'), message: z.string() })
])
