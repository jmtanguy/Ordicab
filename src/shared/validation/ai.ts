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
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: httpUrlSchema.optional(),
  piiWordlist: z.array(z.string()).optional(),
  claudeCoworkEnabled: z.boolean().optional()
})

export const aiSettingsSaveSchema = z.object({
  mode: z.enum(AI_MODE_VALUES),
  remoteProviderKind: z.enum(REMOTE_PROVIDER_KIND_VALUES).optional(),
  remoteProjectRef: z.string().optional(),
  remoteProvider: httpUrlSchema.optional(),
  apiKey: z.string().optional(),
  piiEnabled: z.boolean().optional(),
  piiWordlist: z.array(z.string()).optional(),
  claudeCoworkEnabled: z.boolean().optional()
})

const piiPersonaSchema = z.object({
  roleKey: z.string().min(1),
  roleLabel: z.string().min(1),
  // Every name token must survive the ≥4-char revert filter, enforced more
  // precisely by isPersonaNameSafe — here we only guard the obvious cases.
  firstName: z.string().min(4),
  lastName: z.string().min(4),
  gender: z.enum(['M', 'F', 'N']),
  institution: z.string().optional()
})

export const piiPersonaSettingsSchema = z.object({
  personas: z.array(piiPersonaSchema)
})

const documentMentionSchema = z.object({
  uuid: z.string().min(1),
  filename: z.string().min(1)
})

const aiCommandContextSchema = z.object({
  dossierId: z.string().optional(),
  contactUuid: z.string().optional(),
  templateUuid: z.string().optional(),
  pendingTagPaths: z.array(z.string().min(1)).optional(),
  documentMentions: z.array(documentMentionSchema).optional(),
  // zod strips unknown keys: any context field the renderer round-trips from
  // contextUpdate MUST be declared here or it is silently dropped.
  conversationId: z.string().optional(),
  redactionSessionId: z.string().optional()
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
