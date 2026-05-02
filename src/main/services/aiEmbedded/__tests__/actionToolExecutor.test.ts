import { describe, expect, it, vi } from 'vitest'

import { ActionToolExecutor } from '../actionToolExecutor'
import type { AiCommandResult, AiCommandContext } from '@shared/types'

function makeExecutor(dispatchResult: AiCommandResult): ActionToolExecutor {
  const intentDispatcher = {
    dispatch: vi.fn().mockResolvedValue(dispatchResult)
  }
  const documentService = {} as never
  const context = {} as AiCommandContext
  return new ActionToolExecutor({
    dossierId: null,
    documentService,
    intentDispatcher: intentDispatcher as never,
    context
  })
}

describe('ActionToolExecutor._dispatchInline', () => {
  it('reports success:true and echoes feedback when the dispatcher executes the requested action', async () => {
    const executor = makeExecutor({
      intent: {
        type: 'contact_upsert',
        firstName: 'Luc',
        lastName: 'Merlin'
      } as never,
      feedback: 'Contact "Luc Merlin" ajouté.',
      entity: { id: 'c-123', firstName: 'Luc', lastName: 'Merlin' }
    })

    const raw = await executor.execute('contact_upsert', { firstName: 'Luc', lastName: 'Merlin' })
    const parsed = JSON.parse(raw)

    expect(parsed.success).toBe(true)
    expect(parsed.feedback).toBe('Contact "Luc Merlin" ajouté.')
    expect(parsed.entity).toEqual({ id: 'c-123', firstName: 'Luc', lastName: 'Merlin' })
    expect(parsed.needsClarification).toBeUndefined()
  })

  it('reports success:false and surfaces clarification details when the dispatcher swaps the intent to clarification_request', async () => {
    // contact_upsert without an active dossier → dispatcher returns a
    // clarification_request; the LLM must learn that the contact was NOT added
    // instead of claiming success to the user.
    const executor = makeExecutor({
      intent: {
        type: 'clarification_request',
        question: 'Pour quel dossier ?',
        options: ['Dossier A', 'Dossier B'],
        optionIds: ['a', 'b']
      } as never,
      feedback: 'Pour quel dossier ?'
    })

    const raw = await executor.execute('contact_upsert', { firstName: 'Luc', lastName: 'Merlin' })
    const parsed = JSON.parse(raw)

    expect(parsed.success).toBe(false)
    expect(parsed.feedback).toBe('Pour quel dossier ?')
    expect(parsed.needsClarification).toBe(true)
    expect(parsed.question).toBe('Pour quel dossier ?')
    expect(parsed.options).toEqual(['Dossier A', 'Dossier B'])
  })
})
