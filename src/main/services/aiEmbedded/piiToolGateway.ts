/**
 * piiToolGateway — single decision point for PII wrapping around tool executors.
 *
 * Without PII enabled, the gateway returns raw executor passthroughs. With PII
 * enabled, every tool call is wrapped: arguments are reverted from markers,
 * tool-specific post-revert sanitization runs, the underlying executor is
 * invoked, and the JSON result is pseudonymized via a per-tool dispatch table
 * before being fed back to the LLM.
 *
 * Adding a new tool that needs PII handling means adding one entry to
 * `toolResultPseudonymizers` below — not three call sites in aiService.
 */
import { BATCHABLE_ACTION_TOOL_NAMES } from '../../lib/aiEmbedded/aiToolDefinitions'

import {
  pseudonymizeActionToolResultAsync,
  pseudonymizeAnalyzeToolResultAsync,
  pseudonymizeDocumentToolResultAsync,
  pseudonymizeTemplateListResultAsync
} from './dataToolExecutor'

export interface ToolExecutorLike {
  execute(toolName: string, args: Record<string, unknown>): Promise<string>
}

export interface PiiHelpers {
  pseudonymizeText: (text: string) => Promise<string>
  pseudonymizeAuto: (text: string) => Promise<string>
  revertPiiText: (text: string) => string
  revertPiiJson: <T>(obj: T) => T
}

export interface ToolGateway {
  executeDataTool: (toolName: string, args: Record<string, unknown>) => Promise<string>
  executeActionTool: (toolName: string, args: Record<string, unknown>) => Promise<string>
}

// ── Contact upsert post-revert sanitization ──────────────────────────────────
// PII reversion can leave behind stray markers, backticks, or stuck
// "<zip> <city>" pairs that the LLM combined. Sanitize before persistence.

const CONTACT_UPSERT_TEXT_FIELDS = [
  'firstName',
  'lastName',
  'role',
  'email',
  'phone',
  'title',
  'institution',
  'addressLine',
  'addressLine2',
  'city',
  'zipCode',
  'country',
  'information'
] as const

function sanitizePiiRevertedStringValue(
  value: string,
  revertPiiText: (text: string) => string
): string {
  return revertPiiText(value)
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/[`'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeContactUpsertArgsAfterPiiRevert(
  args: Record<string, unknown>,
  revertPiiText: (text: string) => string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }

  for (const field of CONTACT_UPSERT_TEXT_FIELDS) {
    if (typeof out[field] === 'string') {
      out[field] = sanitizePiiRevertedStringValue(out[field] as string, revertPiiText)
    }
  }

  if (out['customFields'] && typeof out['customFields'] === 'object') {
    const customFields = out['customFields'] as Record<string, unknown>
    const sanitizedCustomFields: Record<string, string> = {}
    for (const [key, value] of Object.entries(customFields)) {
      if (typeof value !== 'string') continue
      const sanitizedValue = sanitizePiiRevertedStringValue(value, revertPiiText)
      if (sanitizedValue) sanitizedCustomFields[key] = sanitizedValue
    }
    out['customFields'] = sanitizedCustomFields
  }

  // The LLM occasionally collapses a postal code into the city field, e.g.
  // city="75001 Paris", zipCode="". Split it back so persistence is clean.
  if (typeof out['city'] === 'string' && typeof out['zipCode'] === 'string') {
    const cityValue = out['city'] as string
    const zipValue = out['zipCode'] as string
    const match = cityValue.match(/^(\d{5})\s+(.+)$/)
    if (match) {
      if (!zipValue || zipValue === match[1]) out['zipCode'] = match[1]
      out['city'] = match[2]
    }
  }

  return out
}

// ── Tool result pseudonymization dispatch ────────────────────────────────────

type ResultPseudonymizer = (result: string, helpers: PiiHelpers) => Promise<string>

/**
 * Tool-name → result-pseudonymizer dispatch.
 *
 * Tools listed here override the default `pseudonymizeAuto` fallback. Each
 * entry preserves whichever structural fields that tool's caller (the LLM)
 * needs to round-trip verbatim — e.g. UUIDs, template macro paths, document
 * IDs. See the per-function jsdoc in dataToolExecutor for the rationale.
 *
 * Tools NOT listed here fall through to `pseudonymizeAuto`, which parses JSON
 * and pseudonymizes only string values.
 */
const toolResultPseudonymizers: Record<string, ResultPseudonymizer> = {
  managed_fields_get: async (result) => result,
  template_list: (result, h) => pseudonymizeTemplateListResultAsync(result, h.pseudonymizeText),
  document_list: (result, h) => pseudonymizeDocumentToolResultAsync(result, h.pseudonymizeText),
  document_get: (result, h) => pseudonymizeDocumentToolResultAsync(result, h.pseudonymizeText),
  document_search: (result, h) => pseudonymizeDocumentToolResultAsync(result, h.pseudonymizeText),
  document_analyze: (result, h) => pseudonymizeAnalyzeToolResultAsync(result, h.pseudonymizeText)
}

async function pseudonymizeToolResult(
  toolName: string,
  result: string,
  helpers: PiiHelpers
): Promise<string> {
  const handler = toolResultPseudonymizers[toolName]
  if (handler) return handler(result, helpers)
  // Batchable action tools (contact_upsert, contact_delete, dossier_select, …):
  // pseudonymize only the human-readable `feedback` field. Structural fields
  // (contactId, dossierId, templateId, entity.id) are UUIDs that must not be
  // altered — PII detection can match digit sequences inside UUIDs as phone
  // numbers and break round-trip.
  if (BATCHABLE_ACTION_TOOL_NAMES.has(toolName)) {
    return pseudonymizeActionToolResultAsync(result, helpers.pseudonymizeText)
  }
  return helpers.pseudonymizeAuto(result)
}

// ── Gateway factory ─────────────────────────────────────────────────────────

export function createPiiToolGateway(
  piiHelpers: PiiHelpers | null,
  dataToolExecutor: ToolExecutorLike,
  actionToolExecutor: ToolExecutorLike
): ToolGateway {
  if (!piiHelpers) {
    return {
      executeDataTool: (toolName, args) => dataToolExecutor.execute(toolName, args),
      executeActionTool: async (toolName, args) => {
        console.log(`\n[aiService] executeActionTool:start name=${toolName}`)
        const result = await actionToolExecutor.execute(toolName, args)
        console.log(
          `[aiService] executeActionTool:done  name=${toolName} resultSize=${typeof result === 'string' ? result.length : 0}`
        )
        return result
      }
    }
  }

  const helpers = piiHelpers

  return {
    async executeDataTool(toolName, args) {
      const revertedArgs = helpers.revertPiiJson(args) as Record<string, unknown>
      const result = await dataToolExecutor.execute(toolName, revertedArgs)
      return pseudonymizeToolResult(toolName, result, helpers)
    },

    async executeActionTool(toolName, args) {
      console.log(`\n[aiService] executeActionTool:start name=${toolName}`)
      const revertedArgs = helpers.revertPiiJson(args) as Record<string, unknown>
      const normalizedArgs =
        toolName === 'contact_upsert'
          ? sanitizeContactUpsertArgsAfterPiiRevert(revertedArgs, helpers.revertPiiText)
          : revertedArgs
      const result = await actionToolExecutor.execute(toolName, normalizedArgs)
      console.log(
        `[aiService] executeActionTool:done  name=${toolName} resultSize=${typeof result === 'string' ? result.length : 0}`
      )
      return pseudonymizeToolResult(toolName, result, helpers)
    }
  }
}
