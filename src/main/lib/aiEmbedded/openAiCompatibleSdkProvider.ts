/**
 * OpenAI-compatible SDK provider factory.
 *
 * Usage:
 *   - used for remote mode in index.ts
 *   - wraps any OpenAI-compatible endpoint as a Vercel AI SDK LanguageModel
 *
 * Middleware responsibilities:
 *   - strip fake citation markers from tool arguments
 *   - normalize <think> reasoning blocks out of plain text
 *   - promote `[TOOL_CALLS]...` text responses into native SDK tool calls
 */
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'

import { deepStripCitationAnnotations } from './pii/citationStrip'

export interface OpenAiCompatibleSdkProviderOptions {
  baseUrl: string
  apiKey: string
  model: string
}

function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/chat\/completions\/?$/, '')
    .replace(/\/$/, '')
}

export function createOpenAiCompatibleSdkModel(
  opts: OpenAiCompatibleSdkProviderOptions
): LanguageModel {
  const openai = createOpenAI({
    baseURL: normalizeOpenAiCompatibleBaseUrl(opts.baseUrl),
    apiKey: opts.apiKey
  })

  return wrapLanguageModel({
    // OpenAI SDK v5+ defaults to the /responses API when calling openai(model).
    // Many OpenAI-compatible gateways only implement /chat/completions.
    model: openai.chat(opts.model),
    middleware: openAiCompatibleSdkMiddleware
  })
}

function stripReasoningBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

// Some OpenAI-compatible gateways/models emit tool calls as text instead of proper
// tool-call content. Convert that format into native SDK tool calls here.
function parseBracketedToolCallsText(
  raw: string
): Array<{ toolCallId: string; toolName: string; input: string }> | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[TOOL_CALLS]')) return null

  try {
    const json = trimmed.slice('[TOOL_CALLS]'.length).trim()
    const arr = JSON.parse(json) as unknown[]
    if (!Array.isArray(arr) || arr.length === 0) return null

    const result: Array<{ toolCallId: string; toolName: string; input: string }> = []
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] as Record<string, unknown>
      if (typeof item?.name !== 'string') continue

      let args: unknown = item.arguments ?? {}
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args)
        } catch {
          args = {}
        }
      }

      result.push({
        toolCallId: `tc_${i}`,
        toolName: item.name,
        input: JSON.stringify(deepStripCitationAnnotations(args))
      })
    }

    return result.length > 0 ? result : null
  } catch {
    return null
  }
}

function patchGenerateResult(result: LanguageModelV3GenerateResult): LanguageModelV3GenerateResult {
  const patchedContent = result.content.map((item) => {
    if (item.type === 'tool-call') {
      let parsed: unknown
      try {
        parsed = JSON.parse(item.input)
      } catch {
        parsed = {}
      }

      return {
        ...item,
        input: JSON.stringify(deepStripCitationAnnotations(parsed))
      }
    }

    if (item.type === 'text') {
      return { ...item, text: stripReasoningBlocks(item.text) }
    }

    return item
  })

  const hasNativeToolCalls = patchedContent.some((item) => item.type === 'tool-call')
  if (!hasNativeToolCalls) {
    for (const item of patchedContent) {
      if (item.type !== 'text') continue
      const promoted = parseBracketedToolCallsText(item.text)
      if (!promoted || promoted.length === 0) continue

      const withoutText = patchedContent.filter((candidate) => candidate !== item)
      return {
        ...result,
        content: [
          ...withoutText,
          ...promoted.map((toolCall) => ({
            type: 'tool-call' as const,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            providerExecuted: false as const
          }))
        ]
      }
    }
  }

  return { ...result, content: patchedContent }
}

const openAiCompatibleSdkMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate }) => patchGenerateResult(await doGenerate()),
  wrapStream: async ({ doStream }) => doStream()
}
