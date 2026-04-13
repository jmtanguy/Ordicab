/**
 * Ollama SDK provider factory.
 *
 * Usage:
 *   - used for local mode in index.ts
 *   - points the OpenAI-compatible SDK adapter at Ollama's `/v1` endpoint
 *
 * The middleware is intentionally small: it cleans up tool-call args and strips
 * reasoning blocks, while leaving the runtime itself provider-agnostic.
 */
import { createOpenAI } from '@ai-sdk/openai'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3GenerateResult } from '@ai-sdk/provider'

import { deepStripCitationAnnotations } from './pii/citationStrip'

export interface OllamaSdkProviderOptions {
  baseUrl: string
  model: string
}

export function createOllamaSdkModel(opts: OllamaSdkProviderOptions): LanguageModel {
  const openai = createOpenAI({
    baseURL: `${opts.baseUrl.replace(/\/$/, '')}/v1`,
    apiKey: 'ollama'
  })

  return wrapLanguageModel({
    model: openai(opts.model),
    middleware: ollamaSdkMiddleware
  })
}

function stripReasoningBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function patchGenerateResult(result: LanguageModelV3GenerateResult): LanguageModelV3GenerateResult {
  return {
    ...result,
    content: result.content.map((item) => {
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
  }
}

const ollamaSdkMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  wrapGenerate: async ({ doGenerate }) => patchGenerateResult(await doGenerate()),

  wrapStream: async ({ doStream }) => doStream()
}
