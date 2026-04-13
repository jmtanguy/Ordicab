import { describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'

import { IpcErrorCode } from '@shared/types'

import { createAiSdkAgentRuntime } from '../aiSdkAgentRuntime'

function textResponse(text: string): {
  content: Array<{ type: 'text'; text: string }>
  finishReason: 'stop'
  usage: { inputTokens: number; outputTokens: number }
  rawCall: { rawPrompt: null; rawSettings: Record<string, never> }
} {
  return {
    content: [{ type: 'text' as const, text }],
    finishReason: 'stop' as const,
    usage: { inputTokens: 1, outputTokens: 1 },
    rawCall: { rawPrompt: null, rawSettings: {} }
  }
}

function toolCallResponse(
  toolName: string,
  input: Record<string, unknown>
): {
  content: Array<{
    type: 'tool-call'
    toolCallId: string
    toolName: string
    input: string
    providerExecuted: false
  }>
  finishReason: 'tool-calls'
  usage: { inputTokens: number; outputTokens: number }
  rawCall: { rawPrompt: null; rawSettings: Record<string, never> }
} {
  return {
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: `tc_${toolName}`,
        toolName,
        input: JSON.stringify(input),
        providerExecuted: false as const
      }
    ],
    finishReason: 'tool-calls' as const,
    usage: { inputTokens: 1, outputTokens: 1 },
    rawCall: { rawPrompt: null, rawSettings: {} }
  }
}

describe('createAiSdkAgentRuntime', () => {
  it('returns a terminal tool call as an intent', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi.fn().mockResolvedValue(
        toolCallResponse('clarification_request', {
          question: 'Confirmer ?',
          options: ['Oui', 'Non']
        })
      )
    })
    const runtime = createAiSdkAgentRuntime({
      localLanguageModel: model
    })

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({
      type: 'clarification_request',
      question: 'Confirmer ?',
      options: ['Oui', 'Non']
    })
  })

  it('executes data tools inside the SDK loop and returns the final text response', async () => {
    const executeDataTool = vi
      .fn()
      .mockResolvedValue('{"contacts":[{"id":"c1","firstName":"Alice"}]}')
    const model = new MockLanguageModelV3({
      doGenerate: vi
        .fn()
        .mockResolvedValueOnce(toolCallResponse('contact_lookup', {}))
        .mockResolvedValueOnce(textResponse('Alice est dans le dossier.'))
    })
    const runtime = createAiSdkAgentRuntime({
      localLanguageModel: model
    })

    await expect(
      runtime.sendCommand(
        {
          command: 'liste des contacts',
          context: {},
          systemPrompt: 'sys',
          executeDataTool
        },
        'local'
      )
    ).resolves.toEqual({ type: 'direct_response', message: 'Alice est dans le dossier.' })

    expect(executeDataTool).toHaveBeenCalledWith('contact_lookup', expect.any(Object))
  })

  it('handles duplicate data-tool calls with identical args without breaking the loop', async () => {
    const executeDataTool = vi
      .fn()
      .mockResolvedValue('{"matches":[{"documentId":"d1","excerpt":"Karine Calvez"}]}')
    const model = new MockLanguageModelV3({
      doGenerate: vi
        .fn()
        .mockResolvedValueOnce(
          toolCallResponse('document_search', { query: 'Karine Calvez avocat', dossierId: 'dos-1' })
        )
        .mockResolvedValueOnce(
          toolCallResponse('document_search', { query: 'Karine Calvez avocat', dossierId: 'dos-1' })
        )
        .mockResolvedValueOnce(textResponse('Recherche terminée, je passe à contact_upsert.'))
    })

    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    await expect(
      runtime.sendCommand(
        {
          command: 'extrais le contact',
          context: {},
          systemPrompt: 'sys',
          executeDataTool
        },
        'local'
      )
    ).resolves.toEqual({
      type: 'direct_response',
      message: 'Recherche terminée, je passe à contact_upsert.'
    })

    expect(executeDataTool.mock.calls.length).toBeLessThanOrEqual(2)
    expect(executeDataTool.mock.calls.length).toBeGreaterThan(0)
    expect(executeDataTool).toHaveBeenCalledWith(
      'document_search',
      expect.objectContaining({ query: 'Karine Calvez avocat', dossierId: 'dos-1' })
    )
  })

  it('throws AI_RUNTIME_UNAVAILABLE when no SDK model is configured', async () => {
    const runtime = createAiSdkAgentRuntime({})

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).rejects.toMatchObject({ code: IpcErrorCode.AI_RUNTIME_UNAVAILABLE })
  })

  it('throws AI_RUNTIME_UNAVAILABLE when both SDK and legacy resolution fail', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi.fn().mockRejectedValue(new Error('network error'))
    })
    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).rejects.toMatchObject({ code: IpcErrorCode.AI_RUNTIME_UNAVAILABLE })
  })

  it('returns REMOTE_API_ERROR with debug trace on provider 400/bad request payloads', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi.fn().mockRejectedValue({
        object: 'error',
        message: '',
        type: 'BadRequestError',
        param: null,
        code: 400
      })
    })
    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).rejects.toMatchObject({
      code: IpcErrorCode.REMOTE_API_ERROR
    })

    await runtime
      .sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).toContain('AI debug trace:')
      })
  })

  it('executes embedded [TOOL_CALLS] when wrapped inside a direct_response JSON', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi.fn().mockResolvedValue(
        textResponse(
          JSON.stringify({
            type: 'direct_response',
            message:
              '[TOOL_CALLS][{"name":"contact_upsert","arguments":{"firstName":"Emmanuel","lastName":"Martin"}}]'
          })
        )
      )
    })
    const runtime = createAiSdkAgentRuntime({
      localLanguageModel: model
    })

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({
      type: 'contact_upsert',
      firstName: 'Emmanuel',
      lastName: 'Martin'
    })
  })

  it('parses a malformed trailing [TOOL_CALLS] payload and still executes contact_upsert', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi
        .fn()
        .mockResolvedValue(
          textResponse(
            '[TOOL_CALLS][{"name":"contact_upsert","arguments":{"firstName":"Karine","lastName":"Calvez","role":"Avocat de la partie adverse"}}'
          )
        )
    })
    const runtime = createAiSdkAgentRuntime({
      localLanguageModel: model
    })

    await expect(
      runtime.sendCommand({ command: 'test', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({
      type: 'contact_upsert',
      firstName: 'Karine',
      lastName: 'Calvez',
      role: 'Avocat de la partie adverse'
    })
  })

  it('sanitizes stale-pruned history so assistant tool calls always have matching tool results', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi
        .fn()
        .mockResolvedValue(textResponse(JSON.stringify({ type: 'direct_response', message: 'ok' })))
    })
    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    runtime.appendHistory(
      [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tc1',
              type: 'function',
              function: { name: 'contact_lookup', arguments: '{}' }
            },
            {
              id: 'tc2',
              type: 'function',
              function: { name: 'document_search', arguments: '{"query":"x"}' }
            }
          ]
        },
        { role: 'tool', content: '{"contacts":[]}', toolCallId: 'tc1', name: 'contact_lookup' },
        { role: 'tool', content: '{"matches":[]}', toolCallId: 'tc2', name: 'document_search' }
      ],
      'contact_upsert'
    )

    await expect(
      runtime.sendCommand({ command: 'next', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({ type: 'direct_response', message: 'ok' })
  })

  it('keeps a contiguous message suffix under context compaction', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: vi.fn().mockResolvedValue(textResponse('ok'))
    })
    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    const huge = 'x'.repeat(25000)
    runtime.appendHistory([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tc_hole', type: 'function', function: { name: 'contact_lookup', arguments: '{}' } }
        ]
      },
      { role: 'tool', content: '{"contacts":[]}', toolCallId: 'tc_hole', name: 'contact_lookup' },
      { role: 'assistant', content: huge },
      { role: 'assistant', content: 'recent-tail' }
    ])

    await expect(
      runtime.sendCommand({ command: 'next', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({ type: 'direct_response', message: 'ok' })
  })

  it('does not send empty assistant text messages to the provider', async () => {
    const doGenerate = vi.fn().mockResolvedValue(textResponse('ok'))
    const model = new MockLanguageModelV3({ doGenerate })
    const runtime = createAiSdkAgentRuntime({ localLanguageModel: model })

    runtime.appendHistory([
      { role: 'assistant', content: '' },
      { role: 'assistant', content: 'non-empty assistant' }
    ])

    await expect(
      runtime.sendCommand({ command: 'next', context: {}, systemPrompt: 'sys' }, 'local')
    ).resolves.toEqual({ type: 'direct_response', message: 'ok' })

    const firstCallArg = doGenerate.mock.calls[0]?.[0] as { prompt?: unknown } | undefined
    const prompt = firstCallArg?.prompt as Array<{ role: string; content?: string }> | undefined
    const emptyAssistant = (prompt ?? []).find(
      (msg) => msg.role === 'assistant' && (msg.content ?? '') === ''
    )
    expect(emptyAssistant).toBeUndefined()
  })
})
