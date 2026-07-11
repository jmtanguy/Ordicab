/**
 * Zustand store for the « Rédaction assistée » page.
 *
 * Owns the drafting session lifecycle (wizard → workspace → save), the
 * per-document AI conversation (scoped conversationId 'redaction:…', so the
 * global assistant chat is untouched) and the workspace UI state.
 *
 * All IPC lives in store actions (no-direct-ipc rule). Every mutating call
 * returns a full RedactionSnapshot — the single source the workspace renders.
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  RedactionChatMessage,
  RedactionCommitResult,
  RedactionCreateInput,
  RedactionDecision,
  RedactionSessionSummary,
  RedactionSnapshot
} from '@shared/domain/redaction'
import { IpcErrorCode } from '@shared/types'

import { getOrdicabApi, requireApi } from './ipc'
import { useAiStore } from './aiStore'

export function buildRedactionConversationId(dossierId: string, sessionId: string): string {
  return `redaction:${dossierId}:${sessionId}`
}

export type RedactionViewMode = 'preview' | 'diff'
export type RedactionAssistantTab = 'chat' | 'revisions' | 'outline'

export interface RedactionStoreState {
  // Session list (wizard screen)
  sessions: RedactionSessionSummary[]
  sessionsLoading: boolean
  activeDossierId: string | null

  // Active workspace
  activeSessionId: string | null
  snapshot: RedactionSnapshot | null
  loading: boolean
  error: string | null

  // Conversation
  chat: RedactionChatMessage[]
  chatBusy: boolean
  streamingText: string
  reflections: string[]
  /** Invalidates in-flight AI responses when the active workspace changes. */
  chatRequestEpoch: number

  // UI
  viewMode: RedactionViewMode
  assistantTab: RedactionAssistantTab
  selectedParagraphIndex: number | null
  editingParagraphIndex: number | null
  /** Session to auto-open when the page mounts (set by AiPage redirection). */
  pendingOpenSessionId: string | null
  saving: boolean
  lastSaved: RedactionCommitResult | null
  /** The original Word file changed externally; wait for an explicit overwrite choice. */
  replaceConflict: boolean

  // Actions
  loadSessions(dossierId: string): Promise<void>
  createSession(input: RedactionCreateInput): Promise<boolean>
  openSession(dossierId: string, sessionId: string): Promise<boolean>
  closeWorkspace(): void
  refreshSnapshot(): Promise<void>
  sendChat(text: string): Promise<void>
  cancelChat(): Promise<void>
  /** Fresh start: clears the scoped runtime conversation AND the persisted chat/history. */
  resetChat(): Promise<void>
  manualEditParagraph(index: number, newText: string, html?: string): Promise<void>
  insertParagraphAfter(anchorIndex: number, text: string): Promise<void>
  deleteParagraph(index: number): Promise<void>
  decideOp(opId: string, decision: RedactionDecision): Promise<void>
  acceptAllOps(): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  updateMeta(meta: {
    title?: string
    targetFilename?: string
    docKind?: RedactionCreateInput['docKind']
  }): Promise<void>
  commitSession(forceReplace?: boolean): Promise<RedactionCommitResult | null>
  dismissReplaceConflict(): void
  discardSession(): Promise<void>
  setViewMode(mode: RedactionViewMode): void
  setAssistantTab(tab: RedactionAssistantTab): void
  selectParagraph(index: number | null): void
  setEditingParagraph(index: number | null): void
  setPendingOpenSessionId(sessionId: string | null): void
  clearError(): void
  /** Subscribe to scoped streaming tokens/reflections. Returns unsubscribe. */
  subscribeStreaming(): () => void
}

function applySnapshot(
  state: RedactionStoreState,
  snapshot: RedactionSnapshot,
  options?: { adoptChat?: boolean }
): void {
  state.snapshot = snapshot
  state.activeSessionId = snapshot.session.sessionId
  state.activeDossierId = snapshot.session.dossierId
  // The in-memory chat is the live source during a session; the persisted one
  // (session.chat, synced after each turn) is only adopted on open/resume.
  if (options?.adoptChat) {
    state.chat = snapshot.session.chat
  }
  // Selected paragraph may no longer exist after an edit/undo
  if (
    state.selectedParagraphIndex !== null &&
    state.selectedParagraphIndex >= snapshot.paragraphs.length
  ) {
    state.selectedParagraphIndex = null
  }
  state.editingParagraphIndex = null
}

export const useRedactionStore = create<RedactionStoreState>()(
  immer((set, get) => ({
    sessions: [],
    sessionsLoading: false,
    activeDossierId: null,
    activeSessionId: null,
    snapshot: null,
    loading: false,
    error: null,
    chat: [],
    chatBusy: false,
    streamingText: '',
    reflections: [],
    chatRequestEpoch: 0,
    viewMode: 'preview',
    assistantTab: 'chat',
    selectedParagraphIndex: null,
    editingParagraphIndex: null,
    pendingOpenSessionId: null,
    saving: false,
    lastSaved: null,
    replaceConflict: false,

    loadSessions: async (dossierId) => {
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.sessionsLoading = true
        state.activeDossierId = dossierId
      })
      const result = await api.redaction.list({ dossierId })
      set((state) => {
        state.sessionsLoading = false
        if (result.success) {
          state.sessions = result.data
        } else {
          state.error = result.error
        }
      })
    },

    createSession: async (input) => {
      const api = requireApi(set)
      if (!api) return false
      set((state) => {
        state.loading = true
        state.error = null
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.create(input)
      set((state) => {
        state.loading = false
        if (result.success) {
          applySnapshot(state, result.data, { adoptChat: true })
          state.lastSaved = null
          state.replaceConflict = false
          state.reflections = []
          state.streamingText = ''
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    openSession: async (dossierId, sessionId) => {
      const api = requireApi(set)
      if (!api) return false
      set((state) => {
        state.loading = true
        state.error = null
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.get({ dossierId, sessionId })
      set((state) => {
        state.loading = false
        if (result.success) {
          applySnapshot(state, result.data, { adoptChat: true })
          state.lastSaved = null
          state.replaceConflict = false
          state.reflections = []
          state.streamingText = ''
        } else {
          state.error = result.error
        }
      })
      return result.success
    },

    closeWorkspace: () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (chatBusy && activeDossierId && activeSessionId) {
        void getOrdicabApi()?.ai.cancelCommand({
          conversationId: buildRedactionConversationId(activeDossierId, activeSessionId)
        })
      }
      set((state) => {
        state.activeSessionId = null
        state.snapshot = null
        state.chat = []
        state.chatBusy = false
        state.streamingText = ''
        state.reflections = []
        state.chatRequestEpoch += 1
        state.selectedParagraphIndex = null
        state.editingParagraphIndex = null
        state.lastSaved = null
        state.replaceConflict = false
        state.error = null
      })
    },

    refreshSnapshot: async () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      const result = await api.redaction.get({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    sendChat: async (text) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const trimmed = text.trim()
      if (!trimmed) return
      const api = requireApi(set)
      if (!api) return

      const userMessage: RedactionChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: trimmed,
        createdAt: new Date().toISOString()
      }
      let requestEpoch = 0
      set((state) => {
        state.chatRequestEpoch += 1
        requestEpoch = state.chatRequestEpoch
        state.chat.push(userMessage)
        state.chatBusy = true
        state.streamingText = ''
        state.reflections = []
        state.error = null
      })

      // Same model choice as the main assistant (persisted per provider).
      const selectedModel = useAiStore.getState().selectedModel

      const isCurrentRequest = (): boolean => {
        const state = get()
        return (
          state.chatRequestEpoch === requestEpoch &&
          state.activeDossierId === activeDossierId &&
          state.activeSessionId === activeSessionId
        )
      }

      const result = await api.ai.executeCommand({
        command: trimmed,
        context: {
          dossierId: activeDossierId,
          redactionSessionId: activeSessionId,
          conversationId: buildRedactionConversationId(activeDossierId, activeSessionId)
        },
        model: selectedModel ?? undefined
      })

      // The user may have closed this workspace, opened another draft or
      // cancelled this turn while the model was running. Its result belongs to
      // the captured session only and must never touch the current store.
      if (!isCurrentRequest()) return

      const assistantMessage: RedactionChatMessage = {
        id: crypto.randomUUID(),
        role: result.success ? 'assistant' : 'error',
        text: result.success ? result.data.feedback : result.error,
        createdAt: new Date().toISOString()
      }
      set((state) => {
        state.chat.push(assistantMessage)
        state.chatBusy = false
        state.streamingText = ''
        state.reflections = []
      })

      // The turn may have applied operations — reload the CAPTURED session,
      // not whichever workspace happens to be active when the request ends.
      const snapshotResult = await api.redaction.get({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      if (!isCurrentRequest()) return
      set((state) => {
        if (snapshotResult.success) applySnapshot(state, snapshotResult.data)
        else state.error = snapshotResult.error
      })

      // Persist the displayed conversation with the draft (best-effort).
      const { chat } = get()
      void api.redaction.syncChat({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        chat
      })
    },

    cancelChat: async () => {
      const { activeDossierId, activeSessionId } = get()
      const api = getOrdicabApi()
      if (!api || !activeDossierId || !activeSessionId) return
      set((state) => {
        state.chatRequestEpoch += 1
        state.chatBusy = false
        state.streamingText = ''
      })
      await api.ai.cancelCommand({
        conversationId: buildRedactionConversationId(activeDossierId, activeSessionId)
      })
    },

    resetChat: async () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      // Clear the runtime conversation (main memory) AND the persisted state —
      // otherwise the next turn would re-seed the old history from the draft.
      await api.ai.resetConversation({
        conversationId: buildRedactionConversationId(activeDossierId, activeSessionId)
      })
      const result = await api.redaction.resetChat({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      set((state) => {
        if (!result.success) {
          state.error = result.error
          return
        }
        state.chat = []
        state.streamingText = ''
        state.reflections = []
      })
    },

    manualEditParagraph: async (index, newText, html) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.manualEdit({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        operations: [
          { id: crypto.randomUUID().slice(0, 8), op: 'replace', index, text: newText, html }
        ]
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    insertParagraphAfter: async (anchorIndex, text) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.manualEdit({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        operations: [{ id: crypto.randomUUID().slice(0, 8), op: 'insert_after', anchorIndex, text }]
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    deleteParagraph: async (index) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.manualEdit({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        operations: [{ id: crypto.randomUUID().slice(0, 8), op: 'delete', index }]
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    decideOp: async (opId, decision) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.decideOp({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        opId,
        decision
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    acceptAllOps: async () => {
      const { snapshot } = get()
      if (!snapshot) return
      const pending = snapshot.pendingOps.filter((op) => op.decision === 'keep_tracked')
      for (const op of pending) {
        // Sequential: each decision is one journal event (one undo step).
        await get().decideOp(op.opId, 'accept')
      }
    },

    undo: async () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.undo({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    redo: async () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.redo({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    updateMeta: async (meta) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.chatRequestEpoch += 1
      })
      const result = await api.redaction.updateMeta({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        ...meta
      })
      if (get().activeDossierId !== activeDossierId || get().activeSessionId !== activeSessionId) {
        return
      }
      set((state) => {
        if (result.success) applySnapshot(state, result.data)
        else state.error = result.error
      })
    },

    commitSession: async (forceReplace = false) => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return null
      const api = requireApi(set)
      if (!api) return null
      set((state) => {
        state.chatRequestEpoch += 1
        state.saving = true
        state.error = null
      })
      const result = await api.redaction.commit({
        dossierId: activeDossierId,
        sessionId: activeSessionId,
        ...(forceReplace ? { forceReplace: true } : {})
      })
      set((state) => {
        state.saving = false
        if (result.success) {
          state.lastSaved = result.data
          state.replaceConflict = false
        } else if (result.code === IpcErrorCode.INTEGRITY_CONFLICT) {
          state.replaceConflict = true
        } else {
          state.error = result.error
        }
      })
      if (result.success) {
        await get().loadSessions(activeDossierId)
        return result.data
      }
      return null
    },

    dismissReplaceConflict: () =>
      set((state) => {
        state.replaceConflict = false
      }),

    discardSession: async () => {
      const { activeDossierId, activeSessionId, chatBusy } = get()
      if (!activeDossierId || !activeSessionId || chatBusy) return
      const api = requireApi(set)
      if (!api) return
      const result = await api.redaction.discard({
        dossierId: activeDossierId,
        sessionId: activeSessionId
      })
      if (result.success) {
        get().closeWorkspace()
        await get().loadSessions(activeDossierId)
      } else {
        set((state) => {
          state.error = result.error
        })
      }
    },

    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode
      }),

    setAssistantTab: (tab) =>
      set((state) => {
        state.assistantTab = tab
      }),

    selectParagraph: (index) =>
      set((state) => {
        state.selectedParagraphIndex = index
      }),

    setEditingParagraph: (index) =>
      set((state) => {
        state.editingParagraphIndex = index
      }),

    setPendingOpenSessionId: (sessionId) =>
      set((state) => {
        state.pendingOpenSessionId = sessionId
      }),

    clearError: () =>
      set((state) => {
        state.error = null
      }),

    subscribeStreaming: () => {
      const api = getOrdicabApi()
      if (!api) return () => undefined

      const matchesActiveConversation = (conversationId?: string): boolean => {
        const { activeDossierId, activeSessionId } = get()
        if (!conversationId || !activeDossierId || !activeSessionId) return false
        return conversationId === buildRedactionConversationId(activeDossierId, activeSessionId)
      }

      const unsubscribeTokens = api.ai.onTextToken((event) => {
        if (!matchesActiveConversation(event.conversationId)) return
        set((state) => {
          state.streamingText += event.text
        })
      })
      const unsubscribeReflections = api.ai.onReflection((event) => {
        if (!matchesActiveConversation(event.conversationId)) return
        const text = event.text.trim()
        if (!text) return
        set((state) => {
          if (state.reflections[state.reflections.length - 1] === text) return
          state.reflections.push(text)
          if (state.reflections.length > 8) {
            state.reflections.splice(0, state.reflections.length - 8)
          }
        })
      })

      return () => {
        unsubscribeTokens()
        unsubscribeReflections()
      }
    }
  }))
)
