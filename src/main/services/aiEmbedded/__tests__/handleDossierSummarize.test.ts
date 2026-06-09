import { describe, expect, it, vi } from 'vitest'

import type { DossierDetail, DossierSummarizeIntent } from '@shared/types'

import { handleDossierSummarize, type IntentHandlerContext } from '../intentHandlers'

function makeDossierDetail(overrides: Partial<DossierDetail> = {}): DossierDetail {
  return {
    id: 'dos-1',
    uuid: 'dos-uuid-1',
    name: 'Dupont c/ Martin',
    type: 'Contentieux',
    status: 'active',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: null,
    nextUpcomingKeyDateLabel: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    description: 'Litige de voisinage',
    information: undefined,
    juridiction: 'TJ Paris',
    tribunal: undefined,
    feeAgreements: [],
    billingItems: [],
    keyDates: [
      {
        id: 'kd-1',
        dossierId: 'dos-1',
        label: 'Audience de mise en état',
        date: '2026-09-15',
        time: '09:00',
        tags: ['urgent'],
        isClosed: false
      }
    ],
    keyReferences: [{ id: 'kr-1', dossierId: 'dos-1', label: 'RG', value: '24/01234' }],
    notes: [
      {
        id: 'n-1',
        dossierId: 'dos-1',
        title: 'Vérifier la prescription',
        content: 'Délai à confirmer',
        kind: 'to_verify',
        status: 'open',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'n-2',
        dossierId: 'dos-1',
        title: 'Tâche close',
        content: '',
        kind: 'todo',
        status: 'done',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ],
    ...overrides
  }
}

function makeContext(overrides: Partial<IntentHandlerContext> = {}): IntentHandlerContext {
  const streamText = vi.fn().mockResolvedValue('## Objet\nSynthèse générée.')
  const commitIntentToHistory = vi.fn()
  const ctx = {
    aiAgentRuntime: {
      streamText,
      getDebugTrace: () => 'trace'
    },
    dossierId: 'dos-1',
    dossierDetail: makeDossierDetail(),
    documents: [],
    appLocale: 'fr',
    intentDebugTrace: undefined,
    pseudonymizeText: async (text: string) => text,
    revertPiiText: (text: string) => text,
    commitIntentToHistory,
    onToken: undefined
  } as unknown as IntentHandlerContext
  return Object.assign(ctx, overrides)
}

const intent: DossierSummarizeIntent = { type: 'dossier_summarize', dossierId: 'dos-1' }

describe('handleDossierSummarize', () => {
  it('builds a structured prompt and returns the generated synthesis', async () => {
    const ctx = makeContext()
    const result = await handleDossierSummarize(ctx, intent)

    expect(result.feedback).toBe('## Objet\nSynthèse générée.')
    expect(ctx.commitIntentToHistory).toHaveBeenCalledWith(
      '## Objet\nSynthèse générée.',
      'dossier_summarize'
    )

    const streamText = ctx.aiAgentRuntime.streamText as unknown as ReturnType<typeof vi.fn>
    const [prompt, systemPrompt] = streamText.mock.calls[0] as [string, string]
    // Structured sections present
    expect(prompt).toContain('## Objet du dossier')
    expect(prompt).toContain('## Chronologie & échéances')
    expect(prompt).toContain('Audience de mise en état')
    expect(prompt).toContain('## Références clés')
    expect(prompt).toContain('RG: 24/01234')
    // Open to_verify note included, done todo excluded
    expect(prompt).toContain('Vérifier la prescription')
    expect(prompt).not.toContain('Tâche close')
    // System prompt grounds the model
    expect(systemPrompt).toContain('never invent facts')
  })

  it('falls back to the active dossier when intent omits dossierId', async () => {
    const ctx = makeContext()
    await handleDossierSummarize(ctx, { type: 'dossier_summarize' })
    expect(ctx.aiAgentRuntime.streamText).toHaveBeenCalledOnce()
  })

  it('returns a guard message when no dossier is active', async () => {
    const ctx = makeContext({ dossierId: null, dossierDetail: null })
    const result = await handleDossierSummarize(ctx, { type: 'dossier_summarize' })

    expect(result.feedback).toContain('Aucun dossier actif')
    expect(ctx.aiAgentRuntime.streamText).not.toHaveBeenCalled()
    expect(ctx.commitIntentToHistory).toHaveBeenCalledWith(
      expect.stringContaining('Aucun dossier actif'),
      'dossier_summarize'
    )
  })
})
