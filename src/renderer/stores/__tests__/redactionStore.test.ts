import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrdicabAPI } from '@shared/types'
import type { RedactionSnapshot } from '@shared/domain/redaction'

import { buildRedactionConversationId, useRedactionStore } from '../redactionStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createSnapshot(overrides: Partial<RedactionSnapshot['session']> = {}): RedactionSnapshot {
  return {
    session: {
      schemaVersion: 1,
      sessionId: 'abc12345',
      dossierId: 'dossier-1',
      title: 'Conclusions',
      targetFilename: 'Conclusions.docx',
      docKind: 'conclusions',
      source: { type: 'blank' },
      saveMode: 'new_file',
      sourceContentHash: 'hash',
      events: [],
      cursor: 0,
      chat: [],
      runtimeHistory: [],
      piiLedger: [],
      status: 'active',
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      ...overrides
    },
    previewDataUrl: 'data:application/vnd.openxmlformats;base64,AAAA',
    diffBlocks: [],
    outline: [],
    paragraphs: [{ index: 0, text: 'Premier paragraphe.', html: 'Premier paragraphe.' }],
    pendingOps: [],
    canUndo: false,
    canRedo: false
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function installApi(overrides: Record<string, unknown> = {}) {
  const redaction = {
    list: vi.fn(async () => ({ success: true as const, data: [] })),
    create: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    get: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    manualEdit: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    decideOp: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    undo: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    redo: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    updateMeta: vi.fn(async () => ({ success: true as const, data: createSnapshot() })),
    syncChat: vi.fn(async () => ({ success: true as const, data: null })),
    commit: vi.fn(async () => ({
      success: true as const,
      data: { outputPath: '/dossier/Conclusions.docx', filename: 'Conclusions.docx' }
    })),
    discard: vi.fn(async () => ({ success: true as const, data: null }))
  }
  const ai = {
    executeCommand: vi.fn(async () => ({
      success: true as const,
      data: { intent: { type: 'redaction_edit' }, feedback: '2 modifications proposées.' }
    })),
    cancelCommand: vi.fn(async () => ({ success: true as const, data: null })),
    onTextToken: vi.fn(() => () => undefined),
    onReflection: vi.fn(() => () => undefined)
  }
  ;(globalThis as MutableGlobal).ordicabAPI = {
    redaction,
    ai,
    ...overrides
  } as unknown as OrdicabAPI
  return { redaction, ai }
}

describe('redactionStore', () => {
  beforeEach(() => {
    useRedactionStore.setState(useRedactionStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('createSession stores the snapshot and activates the workspace', async () => {
    const { redaction } = installApi()

    const ok = await useRedactionStore.getState().createSession({
      dossierId: 'dossier-1',
      title: 'Conclusions',
      docKind: 'conclusions',
      source: { type: 'blank' }
    })

    expect(ok).toBe(true)
    expect(redaction.create).toHaveBeenCalledTimes(1)
    const state = useRedactionStore.getState()
    expect(state.activeSessionId).toBe('abc12345')
    expect(state.snapshot?.paragraphs).toHaveLength(1)
  })

  it('sendChat scopes the conversation, appends messages and refreshes the snapshot', async () => {
    const { redaction, ai } = installApi()
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    await useRedactionStore.getState().sendChat('Ajoute une introduction')

    expect(ai.executeCommand).toHaveBeenCalledWith({
      command: 'Ajoute une introduction',
      context: {
        dossierId: 'dossier-1',
        redactionSessionId: 'abc12345',
        conversationId: buildRedactionConversationId('dossier-1', 'abc12345')
      }
    })
    // open + refresh after the turn
    expect(redaction.get).toHaveBeenCalledTimes(2)
    expect(redaction.syncChat).toHaveBeenCalledTimes(1)

    const { chat } = useRedactionStore.getState()
    expect(chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(chat[1]!.text).toBe('2 modifications proposées.')
  })

  it('sendChat records an error message when the command fails', async () => {
    const { ai } = installApi()
    ai.executeCommand.mockResolvedValueOnce({
      success: false as const,
      error: 'Modèle indisponible.'
    } as never)
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    await useRedactionStore.getState().sendChat('Bonjour')

    const { chat, chatBusy } = useRedactionStore.getState()
    expect(chat[1]!.role).toBe('error')
    expect(chat[1]!.text).toBe('Modèle indisponible.')
    expect(chatBusy).toBe(false)
  })

  it('ignores a late AI response after the workspace has closed', async () => {
    const { redaction, ai } = installApi()
    let resolveCommand: ((value: unknown) => void) | undefined
    ai.executeCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCommand = resolve
        }) as never
    )
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    const pending = useRedactionStore.getState().sendChat('Ajoute une introduction')
    useRedactionStore.getState().closeWorkspace()
    resolveCommand?.({
      success: true,
      data: { intent: { type: 'redaction_edit' }, feedback: 'Modification terminée.' }
    })
    await pending

    const state = useRedactionStore.getState()
    expect(state.activeSessionId).toBeNull()
    expect(state.chat).toEqual([])
    expect(redaction.syncChat).not.toHaveBeenCalled()
  })

  it('commitSession returns the saved file and reloads the session list', async () => {
    const { redaction } = installApi()
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    const result = await useRedactionStore.getState().commitSession()

    expect(result).toEqual({
      outputPath: '/dossier/Conclusions.docx',
      filename: 'Conclusions.docx'
    })
    expect(redaction.commit).toHaveBeenCalledWith({
      dossierId: 'dossier-1',
      sessionId: 'abc12345'
    })
    expect(redaction.list).toHaveBeenCalled()
    expect(useRedactionStore.getState().lastSaved?.filename).toBe('Conclusions.docx')
  })

  it('manualEditParagraph submits a tracked replace operation', async () => {
    const { redaction } = installApi()
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    await useRedactionStore.getState().manualEditParagraph(0, 'Texte corrigé.')

    expect(redaction.manualEdit).toHaveBeenCalledTimes(1)
    const input = (redaction.manualEdit.mock.calls[0] as unknown[])[0] as {
      operations: Array<{ op: string; index: number; text: string }>
    }
    expect(input.operations).toHaveLength(1)
    expect(input.operations[0]).toMatchObject({ op: 'replace', index: 0, text: 'Texte corrigé.' })
  })

  it('discardSession closes the workspace and reloads the list', async () => {
    const { redaction } = installApi()
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    await useRedactionStore.getState().discardSession()

    expect(redaction.discard).toHaveBeenCalledWith({
      dossierId: 'dossier-1',
      sessionId: 'abc12345'
    })
    expect(useRedactionStore.getState().activeSessionId).toBeNull()
    expect(useRedactionStore.getState().snapshot).toBeNull()
  })

  it('streaming subscription only accepts events of the active conversation', async () => {
    const { ai } = installApi()
    await useRedactionStore.getState().openSession('dossier-1', 'abc12345')

    let tokenListener: ((event: { text: string; conversationId?: string }) => void) | undefined
    ai.onTextToken.mockImplementation(((listener: typeof tokenListener) => {
      tokenListener = listener
      return () => undefined
    }) as never)

    const unsubscribe = useRedactionStore.getState().subscribeStreaming()
    tokenListener?.({ text: 'ignoré (global)' })
    tokenListener?.({ text: 'ignoré (autre)', conversationId: 'redaction:autre:zzz' })
    tokenListener?.({
      text: 'accepté',
      conversationId: buildRedactionConversationId('dossier-1', 'abc12345')
    })

    expect(useRedactionStore.getState().streamingText).toBe('accepté')
    unsubscribe()
  })
})
