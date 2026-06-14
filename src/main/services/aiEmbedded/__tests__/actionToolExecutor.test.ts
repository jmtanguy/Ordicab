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
    dossiers: [],
    documentService,
    intentDispatcher: intentDispatcher as never,
    context
  })
}

describe('ActionToolExecutor._dispatchInline', () => {
  it('reports success:true and echoes feedback when the dispatcher executes the requested action', async () => {
    const executor = makeExecutor({
      intent: {
        type: 'contact_create',
        firstName: 'Luc',
        lastName: 'Merlin'
      } as never,
      feedback: 'Contact "Luc Merlin" ajouté.',
      entity: { id: 'c-123', firstName: 'Luc', lastName: 'Merlin' }
    })

    const raw = await executor.execute('contact_create', { firstName: 'Luc', lastName: 'Merlin' })
    const parsed = JSON.parse(raw)

    expect(parsed.success).toBe(true)
    expect(parsed.feedback).toBe('Contact "Luc Merlin" ajouté.')
    expect(parsed.entity).toEqual({ id: 'c-123', firstName: 'Luc', lastName: 'Merlin' })
    expect(parsed.needsClarification).toBeUndefined()
  })

  it('reports success:false and surfaces clarification details when the dispatcher swaps the intent to clarification_request', async () => {
    // contact_create without an active dossier → dispatcher returns a
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

    const raw = await executor.execute('contact_create', { firstName: 'Luc', lastName: 'Merlin' })
    const parsed = JSON.parse(raw)

    expect(parsed.success).toBe(false)
    expect(parsed.feedback).toBe('Pour quel dossier ?')
    expect(parsed.needsClarification).toBe(true)
    expect(parsed.question).toBe('Pour quel dossier ?')
    expect(parsed.options).toEqual(['Dossier A', 'Dossier B'])
  })

  it('resolves dossier_update id UUIDs to dossier slugs before dispatching', async () => {
    const intentDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        intent: { type: 'dossier_update', id: 'dos1', status: 'active' },
        feedback: 'Dossier "dos1" mis à jour.'
      })
    }
    const executor = new ActionToolExecutor({
      dossierId: null,
      dossiers: [
        {
          slug: 'dos1',
          uuid: 'uuid-dos1',
          name: 'Dupont',
          status: 'active',
          type: 'contentieux',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null
        }
      ],
      documentService: {} as never,
      intentDispatcher: intentDispatcher as never,
      context: {} as AiCommandContext
    })

    await executor.execute('dossier_update', { id: 'uuid-dos1', status: 'active' })

    expect(intentDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'dossier_update', id: 'dos1' }),
      expect.any(Object)
    )
  })

  it('resolves UUID dossierId values in the dispatch context for active-dossier actions', async () => {
    const intentDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        intent: { type: 'contact_create', firstName: 'Luc' },
        feedback: 'Contact ajouté.'
      })
    }
    const executor = new ActionToolExecutor({
      dossierId: 'dos1',
      dossiers: [
        {
          slug: 'dos1',
          uuid: 'uuid-dos1',
          name: 'Dupont',
          status: 'active',
          type: 'contentieux',
          updatedAt: '2026-01-01T00:00:00.000Z',
          lastOpenedAt: '2026-01-01T00:00:00.000Z',
          nextUpcomingKeyDate: null,
          nextUpcomingKeyDateLabel: null
        }
      ],
      documentService: {} as never,
      intentDispatcher: intentDispatcher as never,
      context: { dossierId: 'uuid-dos1' }
    })

    await executor.execute('contact_create', { firstName: 'Luc' })

    expect(intentDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'contact_create', firstName: 'Luc' }),
      expect.objectContaining({ dossierId: 'dos1' })
    )
  })
})
