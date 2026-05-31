import { z } from 'zod'
import { REMOTE_PROVIDER_KIND_VALUES } from '../ai/remoteProviders'
import { AI_MODE_VALUES } from '../types/ai'

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'URL must use http:// or https://.'
  })

export const aiSettingsSchema = z.object({
  mode: z.enum(AI_MODE_VALUES),
  ollamaEndpoint: httpUrlSchema.optional(),
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: httpUrlSchema.optional()
})

export const aiSettingsSaveSchema = z.object({
  mode: z.enum(AI_MODE_VALUES),
  ollamaEndpoint: httpUrlSchema.optional(),
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: httpUrlSchema.optional(),
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
    type: z.literal('contact_create'),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    institution: z.string().optional(),
    addressLine: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    information: z.string().optional(),
    customFields: z.record(z.string(), z.string()).optional()
  }),
  z.object({
    type: z.literal('contact_update'),
    contactId: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    institution: z.string().optional(),
    addressLine: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional(),
    information: z.string().optional(),
    customFields: z.record(z.string(), z.string()).optional()
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
    type: z.literal('dossier_create_key_date'),
    dossierId: z.string(),
    label: z.string(),
    date: z.string(),
    time: z.string().optional(),
    duration: z.number().optional(),
    tags: z.array(z.string()).optional(),
    isClosed: z.boolean().optional(),
    note: z.string().optional()
  }),
  z.object({
    type: z.literal('dossier_update_key_date'),
    dossierId: z.string(),
    keyDateId: z.string(),
    label: z.string(),
    date: z.string(),
    time: z.string().optional(),
    duration: z.number().optional(),
    tags: z.array(z.string()).optional(),
    isClosed: z.boolean().optional(),
    note: z.string().optional()
  }),
  z.object({
    type: z.literal('dossier_delete_key_date'),
    dossierId: z.string(),
    keyDateId: z.string()
  }),
  z.object({
    type: z.literal('dossier_create_key_reference'),
    dossierId: z.string(),
    label: z.string(),
    value: z.string(),
    note: z.string().optional()
  }),
  z.object({
    type: z.literal('dossier_update_key_reference'),
    dossierId: z.string(),
    keyReferenceId: z.string(),
    label: z.string(),
    value: z.string(),
    note: z.string().optional()
  }),
  z.object({
    type: z.literal('dossier_delete_key_reference'),
    dossierId: z.string(),
    keyReferenceId: z.string()
  }),
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
