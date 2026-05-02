/**
 * aiStore — Zustand store for all AI settings and command-panel state.
 *
 * Two concerns are merged in one store intentionally, because they share the
 * same settings state (mode, API key, etc.) and the command panel must know
 * the current mode to decide whether to render the input or a guard message.
 *
 * Settings slice (Epic 1):  loadSettings, saveSettings, checkConnection, etc.
 * Command slice  (Epic 2):  executeCommand, resolveClarification, subscribeToIntentEvents.
 *
 * Model selection (session only, never persisted):
 *   availableModels — populated by checkConnection() from ollama.list().
 *   selectedModel   — the model the user chose in AiPage; auto-set to the
 *                     first available model when checkConnection succeeds.
 *   setSelectedModel() — called by the AiPage model selector dropdown.
 *   executeCommand() passes selectedModel to the IPC call so agentRuntime
 *   can forward it to ollamaClient.generateIntent().
 *
 * Chat history (session only):
 *   messages — AiChatMessage[] appended by executeCommand(); displayed in
 *   the scrollable panel in AiPage. Cleared by clearMessages().
 *
 * Clarification flow:
 *   1. executeCommand() stores originalCommand + pendingClarification in state.
 *   2. AiPage renders the options from pendingClarification inline.
 *   3. User clicks an option → resolveClarification(option) appends the choice
 *      to originalCommand and calls executeCommand() again.
 *   4. clarificationRound tracks depth; at round ≥ 2 a rephrasing hint is
 *      appended to prevent infinite loops.
 *
 * subscribeToIntentEvents() registers the ai:intent-received push listener and
 * returns an unsubscribe function suitable for useEffect cleanup.
 */
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  AiChatHistoryEntry,
  AiCommandContext,
  AiCommandResult,
  AiDelegatedProviderStatus,
  AiMode,
  AiSettingsResponse,
  AiSettingsSaveInput,
  ClarificationRequestIntent,
  InternalAiCommand,
  RemoteApiError
} from '@shared/types'
import {
  buildRemoteProviderUrl,
  inferRemoteProviderKind,
  REMOTE_PROVIDER_TOOL_MODEL_NAMES
} from '@shared/ai/remoteProviders'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

const CLOUD_MANAGED_MODES: AiMode[] = ['claude-code', 'copilot', 'codex']
const MODEL_CACHE_STORAGE_KEY = 'ordicab.ai.modelCache.v1'
const SELECTED_MODEL_STORAGE_PREFIX = 'ordicab.ai.selectedModel.'
const MODEL_CACHE_TTL_MS: Record<'local' | 'remote', number> = {
  local: 60_000,
  remote: 5 * 60_000
}

interface ModelCacheEntry {
  fetchedAt: number
  models: string[]
}

function safeGetStorageItem(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetStorageItem(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore renderer preference persistence failures.
  }
}

function loadModelCache(): Record<string, ModelCacheEntry> {
  const raw = safeGetStorageItem(MODEL_CACHE_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelCacheEntry>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveModelCache(cache: Record<string, ModelCacheEntry>): void {
  safeSetStorageItem(MODEL_CACHE_STORAGE_KEY, JSON.stringify(cache))
}

function resolveModelContextKey(
  mode: 'local' | 'remote',
  input?: { ollamaEndpoint?: string; remoteProvider?: string }
): string {
  if (mode === 'local') {
    const endpoint = (input?.ollamaEndpoint ?? 'http://localhost:11434').trim().replace(/\/$/, '')
    return `local:${endpoint}`
  }
  const provider = (input?.remoteProvider ?? '').trim().replace(/\/$/, '')
  return `remote:${provider}`
}

function loadCachedModels(contextKey: string, mode: 'local' | 'remote'): string[] | null {
  const cache = loadModelCache()
  const entry = cache[contextKey]
  if (!entry || !Array.isArray(entry.models) || entry.models.length === 0) return null
  if (Date.now() - entry.fetchedAt > MODEL_CACHE_TTL_MS[mode]) return null
  return entry.models
}

function storeCachedModels(contextKey: string, models: string[]): void {
  const unique = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))
  if (unique.length === 0) return
  const cache = loadModelCache()
  cache[contextKey] = { fetchedAt: Date.now(), models: unique }
  saveModelCache(cache)
}

function selectedModelStorageKey(contextKey: string): string {
  return `${SELECTED_MODEL_STORAGE_PREFIX}${contextKey}`
}

function loadPersistedSelectedModel(contextKey: string): string | null {
  return safeGetStorageItem(selectedModelStorageKey(contextKey))
}

function persistSelectedModel(contextKey: string, model: string): void {
  safeSetStorageItem(selectedModelStorageKey(contextKey), model)
}

function resolveSelectedModelForContext(
  contextKey: string,
  currentSelectedModel: string | null,
  models: string[]
): string | null {
  if (models.length === 0) return null
  if (currentSelectedModel && models.includes(currentSelectedModel)) return currentSelectedModel
  const stored = loadPersistedSelectedModel(contextKey)
  if (stored && models.includes(stored)) return stored
  return models[0] ?? null
}

function normalizeClarificationToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function isBinaryClarification(intent: ClarificationRequestIntent | null): boolean {
  if (!intent || intent.options.length !== 2) return false
  const normalized = intent.options.map(normalizeClarificationToken).sort()
  const joined = normalized.join('|')
  return joined === 'non|oui' || joined === 'no|yes'
}

function resolveClarificationOption(
  input: string,
  intent: ClarificationRequestIntent | null
): string | null {
  if (!intent) return null

  const normalizedInput = normalizeClarificationToken(input)
  if (!normalizedInput) return null

  const directMatch = intent.options.find(
    (option) => normalizeClarificationToken(option) === normalizedInput
  )
  if (directMatch) return directMatch

  if (isBinaryClarification(intent)) {
    if (['oui', 'yes', 'y', 'ok', 'confirme', 'confirmer'].includes(normalizedInput)) {
      return (
        intent.options.find((option) =>
          ['oui', 'yes'].includes(normalizeClarificationToken(option))
        ) ?? null
      )
    }
    if (['non', 'no', 'n', 'annuler', 'cancel'].includes(normalizedInput)) {
      return (
        intent.options.find((option) =>
          ['non', 'no'].includes(normalizeClarificationToken(option))
        ) ?? null
      )
    }
  }

  return null
}

function resolveClarificationOptionId(
  selectedOption: string,
  intent: ClarificationRequestIntent | null
): string | null {
  if (!intent?.optionIds?.length) return null
  const optionIndex = intent.options.findIndex((option) => option === selectedOption)
  if (optionIndex < 0) return null
  const optionId = intent.optionIds[optionIndex]?.trim()
  return optionId ? optionId : null
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  text: string
  /** Path of a generated file — shown as an "Open" button in the UI */
  filePath?: string
  /** The user command that triggered this assistant/error message */
  userRequest?: string
  /** Execution time in milliseconds */
  executionTime?: number
  /** System prompt + tool definitions sent to the LLM for this command */
  systemPrompt?: string
}

export interface AiReflectionMessage {
  id: string
  text: string
}

function toAiChatHistory(messages: AiChatMessage[]): AiChatHistoryEntry[] {
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    return [{ role: message.role, content: message.text }]
  })
}

interface AiStoreState {
  settings: AiSettingsResponse | null
  loading: boolean
  error: string | null
  privacyWarningPending: boolean
  pendingMode: AiMode | null
  connectionStatus: 'idle' | 'checking' | 'connected' | 'unreachable'
  connectionError: string | null
  remoteApiError: RemoteApiError | null
  cloudAvailability: AiDelegatedProviderStatus | null
  // Command panel state
  commandLoading: boolean
  commandFeedback: string | null
  commandError: string | null
  lastIntent: InternalAiCommand | null
  pendingClarification: ClarificationRequestIntent | null
  lastContext: AiCommandContext
  originalCommand: string | null
  clarificationRound: number
  // Chat state (session only, not persisted)
  availableModels: string[]
  selectedModel: string | null
  messages: AiChatMessage[]
  // Active dossier synced from DomainDashboard (null = no dossier open)
  activeDossierId: string | null
  /** ID of the assistant message currently being streamed (null when not streaming) */
  streamingMessageId: string | null
  /** Live reasoning steps emitted between tool calls during the current command.
   *  Cleared when the command completes — not persisted across turns. */
  reflections: AiReflectionMessage[]
}

interface AiStoreActions {
  loadSettings: () => Promise<void>
  saveSettings: (patch: Partial<AiSettingsSaveInput>) => Promise<void>
  requestRemoteMode: (mode: AiMode) => void
  confirmRemoteMode: () => void
  cancelRemoteMode: () => void
  openExternal: (url: string) => Promise<void>
  checkConnection: (input?: {
    mode?: AiMode
    ollamaEndpoint?: string
    remoteProvider?: string
    apiKey?: string
    refresh?: boolean
  }) => Promise<void>
  deleteApiKey: () => Promise<void>
  checkCloudAvailability: (mode: AiMode) => Promise<void>
  executeCommand: (command: string, context?: AiCommandContext) => Promise<void>
  cancelCommand: () => void
  resolveClarification: (selectedOption: string) => Promise<void>
  subscribeToIntentEvents: () => () => void
  setSelectedModel: (model: string) => void
  setActiveDossierId: (id: string | null) => void
  clearMessages: () => void
  resetConversation: () => Promise<void>
  subscribeToTextTokens: () => () => void
  subscribeToReflections: () => () => void
}

type AiStore = AiStoreState & AiStoreActions

export const useAiStore = create<AiStore>()(
  immer((set, get) => ({
    settings: null,
    loading: false,
    error: null,
    privacyWarningPending: false,
    pendingMode: null,
    connectionStatus: 'idle',
    connectionError: null,
    remoteApiError: null,
    cloudAvailability: null,
    commandLoading: false,
    commandFeedback: null,
    commandError: null,
    lastIntent: null,
    pendingClarification: null,
    lastContext: {},
    originalCommand: null,
    clarificationRound: 0,
    availableModels: [],
    selectedModel: null,
    messages: [],
    activeDossierId: null,
    streamingMessageId: null,
    reflections: [],

    loadSettings: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      set((state) => {
        state.loading = true
        state.error = null
      })

      try {
        const result = await api.ai.getSettings()

        if (result.success) {
          set((state) => {
            state.settings = result.data
          })

          if (result.data.mode === 'local' || result.data.mode === 'remote') {
            void get().checkConnection({ mode: result.data.mode })
          }
        } else {
          set((state) => {
            state.error = result.error
          })
        }
      } finally {
        set((state) => {
          state.loading = false
        })
      }
    },

    saveSettings: async (patch) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      const current = get().settings

      const input: AiSettingsSaveInput = {
        mode: patch.mode ?? current?.mode ?? 'local',
        ollamaEndpoint: patch.ollamaEndpoint ?? current?.ollamaEndpoint,
        remoteProviderKind: patch.remoteProviderKind ?? current?.remoteProviderKind,
        remoteProjectRef: patch.remoteProjectRef ?? current?.remoteProjectRef,
        remoteProvider: patch.remoteProvider ?? current?.remoteProvider,
        apiKey: patch.apiKey,
        piiEnabled: patch.piiEnabled ?? current?.piiEnabled
      }

      set((state) => {
        state.loading = true
        state.error = null
      })

      try {
        const result = await api.ai.saveSettings(input)

        if (result.success) {
          // Clear remote error when mode changes away from remote
          if (patch.mode && patch.mode !== 'remote') {
            set((state) => {
              state.remoteApiError = null
            })
          }
          // Check cloud provider availability after saving if mode is cloud managed
          if (patch.mode && CLOUD_MANAGED_MODES.includes(patch.mode)) {
            await get().checkCloudAvailability(patch.mode)
          } else if (patch.mode) {
            set((state) => {
              state.cloudAvailability = null
            })
          }
          // Reload to get fresh state (apiKeySuffix, etc.)
          await get().loadSettings()
        } else {
          set((state) => {
            state.error = result.error
          })
        }
      } catch (err) {
        set((state) => {
          state.error = err instanceof Error ? err.message : 'Failed to save AI settings.'
        })
      } finally {
        set((state) => {
          state.loading = false
        })
      }
    },

    requestRemoteMode: (mode: AiMode) => {
      set((state) => {
        state.privacyWarningPending = true
        state.pendingMode = mode
      })
    },

    confirmRemoteMode: () => {
      set((state) => {
        const mode = state.pendingMode
        state.privacyWarningPending = false
        state.pendingMode = null
        if (state.settings && mode) {
          state.settings.mode = mode
        }
      })
    },

    cancelRemoteMode: () => {
      set((state) => {
        state.privacyWarningPending = false
        state.pendingMode = null
        if (state.settings) {
          state.settings.mode = 'local'
        }
      })
    },

    deleteApiKey: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      const provider = get().settings?.remoteProvider ?? 'default'
      const result = await api.ai.deleteApiKey(provider)

      if (result.success) {
        await get().loadSettings()
      } else {
        set((state) => {
          state.error = result.error
        })
      }
    },

    openExternal: async (url: string) => {
      const api = getOrdicabApi()
      if (api) {
        await api.app.openExternal({ url })
      }
    },

    checkConnection: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.connectionStatus = 'unreachable'
          state.connectionError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      set((state) => {
        state.connectionStatus = 'checking'
        state.connectionError = null
      })

      try {
        const mode = input?.mode ?? get().settings?.mode ?? 'local'
        const resolvedMode: 'local' | 'remote' = mode === 'remote' ? 'remote' : 'local'
        const settings = get().settings
        const resolvedRemoteProvider =
          input?.remoteProvider ??
          buildRemoteProviderUrl({
            providerKind: settings?.remoteProviderKind ?? 'custom',
            customProviderUrl: settings?.remoteProvider,
            projectRef: settings?.remoteProjectRef
          }) ??
          settings?.remoteProvider ??
          ''
        const contextKey = resolveModelContextKey(resolvedMode, {
          ollamaEndpoint: input?.ollamaEndpoint ?? settings?.ollamaEndpoint,
          remoteProvider: resolvedRemoteProvider
        })

        if (resolvedMode === 'remote') {
          const hasRemoteStatus = typeof api.ai.remoteConnectionStatus === 'function'
          if (!hasRemoteStatus) {
            set((state) => {
              state.connectionStatus = 'idle'
            })
            return
          }
          const providerKind =
            settings?.remoteProviderKind ?? inferRemoteProviderKind(resolvedRemoteProvider)
          const models = REMOTE_PROVIDER_TOOL_MODEL_NAMES[providerKind] ?? []

          set((state) => {
            state.availableModels = models
            state.selectedModel = resolveSelectedModelForContext(
              contextKey,
              state.selectedModel,
              models
            )
          })

          const result = await api.ai.remoteConnectionStatus({
            remoteProvider: resolvedRemoteProvider,
            apiKey: input?.apiKey
          })

          set((state) => {
            if (result.success) {
              state.connectionStatus = 'connected'
              state.connectionError = null
            } else {
              state.connectionStatus = 'unreachable'
              state.connectionError = result.error
            }
          })

          const selected = get().selectedModel
          if (selected && models.includes(selected)) {
            persistSelectedModel(contextKey, selected)
          }
          return
        }

        if (!input?.refresh) {
          const cachedModels = loadCachedModels(contextKey, resolvedMode)
          if (cachedModels && cachedModels.length > 0) {
            set((state) => {
              state.connectionStatus = 'connected'
              state.connectionError = null
              state.availableModels = cachedModels
              state.selectedModel = resolveSelectedModelForContext(
                contextKey,
                state.selectedModel,
                cachedModels
              )
            })
            return
          }
        }

        const hasLocalStatus = typeof api.ai.connectionStatus === 'function'
        if (resolvedMode === 'local' && !hasLocalStatus) {
          set((state) => {
            state.connectionStatus = 'idle'
          })
          return
        }

        const result = await api.ai.connectionStatus()

        set((state) => {
          if (result.success) {
            state.connectionStatus = 'connected'
            state.connectionError = null
            const models = result.data.models ?? []
            state.availableModels = models
            state.selectedModel = resolveSelectedModelForContext(
              contextKey,
              state.selectedModel,
              models
            )
          } else {
            state.connectionStatus = 'unreachable'
            state.connectionError = result.error
          }
        })

        if (result.success) {
          const models = result.data.models ?? []
          if (models.length > 0) {
            storeCachedModels(contextKey, models)
            const selected = get().selectedModel
            if (selected && models.includes(selected)) {
              persistSelectedModel(contextKey, selected)
            }
          }
        }
      } finally {
        set((state) => {
          if (state.connectionStatus === 'checking') {
            state.connectionStatus = 'idle'
          }
        })
      }
    },

    checkCloudAvailability: async (mode: AiMode) => {
      const api = getOrdicabApi()

      if (!api) return

      if (!CLOUD_MANAGED_MODES.includes(mode)) {
        set((state) => {
          state.cloudAvailability = null
        })
        return
      }

      const result = await api.ai.cloudProviderStatus(mode)

      set((state) => {
        if (result.success) {
          state.cloudAvailability = result.data
        } else {
          state.cloudAvailability = { available: false, reason: result.error }
        }
      })
    },

    executeCommand: async (command: string, context?: AiCommandContext) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.commandError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      const clarificationSelection = resolveClarificationOption(command, get().pendingClarification)
      if (clarificationSelection) {
        await get().resolveClarification(clarificationSelection)
        return
      }

      // Merge provided context with the active dossier id from the store
      const activeDossierId = get().activeDossierId
      const resolvedContext: AiCommandContext = {
        dossierId: activeDossierId ?? undefined,
        ...get().lastContext,
        ...(context ?? {})
      }
      const history = toAiChatHistory(get().messages)

      const streamingId = crypto.randomUUID()
      set((state) => {
        state.commandLoading = true
        state.commandError = null
        state.commandFeedback = null
        state.lastContext = resolvedContext
        state.originalCommand = command
        state.streamingMessageId = null
        state.reflections = []
        state.messages.push({ id: crypto.randomUUID(), role: 'user', text: command })
      })

      const startTime = Date.now()
      try {
        const model = get().selectedModel ?? undefined

        const result = await api.ai.executeCommand({
          command,
          context: resolvedContext,
          model,
          history
        })
        const executionTime = Date.now() - startTime

        set((state) => {
          if (result.success) {
            const data: AiCommandResult = result.data
            state.lastIntent = data.intent
            state.commandFeedback = data.feedback
            // Use the actual streaming message ID if streaming started, otherwise use streamingId
            const actualStreamingId = state.streamingMessageId ?? streamingId
            state.streamingMessageId = null

            const streamIdx = state.messages.findIndex((m) => m.id === actualStreamingId)
            const streamMessage = streamIdx !== -1 ? state.messages[streamIdx] : undefined
            if (streamMessage) {
              streamMessage.text = data.feedback
              streamMessage.filePath = data.generatedFilePath
              streamMessage.userRequest = command
              streamMessage.executionTime = executionTime
              streamMessage.systemPrompt = data.debugContext
            } else {
              state.messages.push({
                id: actualStreamingId,
                role: 'assistant',
                text: data.feedback,
                filePath: data.generatedFilePath,
                userRequest: command,
                executionTime,
                systemPrompt: data.debugContext
              })
            }

            // Apply contextUpdate (e.g. dossier_select sets active dossier)
            if (data.contextUpdate) {
              state.lastContext = { ...state.lastContext, ...data.contextUpdate }
              // Explicitly clear pendingTagPaths when the dispatcher sets it to undefined
              if (!data.contextUpdate.pendingTagPaths) {
                state.lastContext.pendingTagPaths = undefined
              }
              if (data.contextUpdate.dossierId) {
                state.activeDossierId = data.contextUpdate.dossierId
              }
            }

            if (data.intent.type === 'clarification_request') {
              state.pendingClarification = data.intent
            } else {
              state.pendingClarification = null
              state.originalCommand = null
              state.clarificationRound = 0
            }
          } else {
            state.commandError = result.error
            state.streamingMessageId = null
            state.messages.push({
              id: crypto.randomUUID(),
              role: 'error',
              text: result.error,
              userRequest: command,
              executionTime
            })
          }
        })
      } catch (err) {
        // Silently discard abort errors — the user cancelled intentionally
        const isAbort =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && /abort|cancel/i.test(err.message))
        if (!isAbort) {
          const errMsg = err instanceof Error ? err.message : 'Command failed.'
          const executionTime = Date.now() - startTime
          set((state) => {
            state.commandError = errMsg
            const actualStreamingId = state.streamingMessageId ?? streamingId
            state.streamingMessageId = null
            // Remove any partial streaming placeholder
            state.messages = state.messages.filter((m) => m.id !== actualStreamingId)
            state.messages.push({
              id: crypto.randomUUID(),
              role: 'error',
              text: errMsg,
              userRequest: command,
              executionTime
            })
          })
        }
      } finally {
        set((state) => {
          state.commandLoading = false
          state.streamingMessageId = null
          state.reflections = []
        })
      }
    },

    cancelCommand: () => {
      const api = getOrdicabApi()
      if (!api) return
      void api.ai.cancelCommand()
      // Optimistically clear loading state; the in-flight IPC call will resolve with an error
      // that we will silently swallow because commandLoading will already be false.
      set((state) => {
        state.commandLoading = false
        state.streamingMessageId = null
        state.reflections = []
        // Remove any partial streaming placeholder that has no real content yet
        state.messages = state.messages.filter((m) => !(m.role === 'assistant' && m.text === ''))
      })
    },

    resolveClarification: async (selectedOption: string) => {
      const { pendingClarification, originalCommand, lastContext, clarificationRound } = get()

      if (!pendingClarification || !originalCommand) return

      // Reconstruct the original command with the user's chosen option appended.
      // We do NOT create a separate "clarification" IPC call — we just re-run
      // executeCommand() with an enriched natural-language string. The LLM sees
      // the full context ("Prepare NDA — specifically: Thomas Renard") and is
      // more likely to return a resolved intent on the second attempt.
      // At round ≥ 2 we add a hint so the LLM knows to give up rather than
      // emitting another clarification_request, which would loop indefinitely.
      const nextRound = clarificationRound + 1
      const selectedOptionId = resolveClarificationOptionId(selectedOption, pendingClarification)
      const clarifiedCommand = isBinaryClarification(pendingClarification)
        ? selectedOption
        : `${originalCommand} — specifically: ${selectedOption}${
            selectedOptionId ? ` (id: ${selectedOptionId})` : ''
          }${nextRound >= 2 ? ' — Still unclear, please try rephrasing.' : ''}`

      set((state) => {
        state.pendingClarification = null
        state.clarificationRound = nextRound
      })

      await get().executeCommand(clarifiedCommand, lastContext)
    },

    setSelectedModel: (model: string) => {
      if (get().selectedModel === model) return
      const settings = get().settings
      const mode: 'local' | 'remote' = settings?.mode === 'remote' ? 'remote' : 'local'
      const contextKey = resolveModelContextKey(mode, {
        ollamaEndpoint: settings?.ollamaEndpoint,
        remoteProvider:
          settings?.remoteProvider ??
          buildRemoteProviderUrl({
            providerKind: settings?.remoteProviderKind ?? 'custom',
            customProviderUrl: settings?.remoteProvider,
            projectRef: settings?.remoteProjectRef
          }) ??
          ''
      })

      set((state) => {
        state.selectedModel = model
      })
      persistSelectedModel(contextKey, model)
    },

    setActiveDossierId: (id: string | null) => {
      set((state) => {
        state.activeDossierId = id
        // Keep lastContext in sync so clarification re-runs use the right dossier
        state.lastContext = { ...state.lastContext, dossierId: id ?? undefined }
      })
    },

    clearMessages: () => {
      set((state) => {
        state.messages = []
      })
    },

    resetConversation: async () => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.commandError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      const result = await api.ai.resetConversation()

      set((state) => {
        if (!result.success) {
          state.commandError = result.error
          return
        }

        state.messages = []
        state.commandLoading = false
        state.commandFeedback = null
        state.commandError = null
        state.lastIntent = null
        state.pendingClarification = null
        state.originalCommand = null
        state.clarificationRound = 0
        state.streamingMessageId = null
        state.lastContext = {
          ...state.lastContext,
          contactId: undefined,
          templateId: undefined,
          pendingTagPaths: undefined
        }
      })
    },

    subscribeToIntentEvents: () => {
      const api = getOrdicabApi()
      if (!api) return () => undefined

      return api.ai.onIntentReceived((intent: InternalAiCommand) => {
        set((state) => {
          state.lastIntent = intent
        })
      })
    },

    subscribeToTextTokens: () => {
      const api = getOrdicabApi()
      if (!api) return () => undefined

      let inactivityTimer: ReturnType<typeof setTimeout> | null = null
      const armInactivityFallback = (): void => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer)
        }
        inactivityTimer = setTimeout(() => {
          set((state) => {
            // Fallback: if the token stream produced content but the IPC command never
            // resolves (provider edge-case), avoid leaving the UI in an infinite loading state.
            if (state.commandLoading && state.streamingMessageId) {
              state.commandLoading = false
            }
          })
        }, 2500)
      }

      const unsubscribe = api.ai.onTextToken((token: string) => {
        set((state) => {
          // Find or create the streaming assistant message
          if (!state.streamingMessageId) {
            // First token — create placeholder message
            const id = state.messages.findLast?.((m) => m.role === 'user')?.id
            void id // just for reference; we use a dedicated id
            const newId = crypto.randomUUID()
            state.streamingMessageId = newId
            state.messages.push({ id: newId, role: 'assistant', text: token })
          } else {
            const msg = state.messages.find((m) => m.id === state.streamingMessageId)
            if (msg) msg.text += token
          }
        })
        armInactivityFallback()
      })

      return () => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer)
          inactivityTimer = null
        }
        unsubscribe()
      }
    },

    subscribeToReflections: () => {
      const api = getOrdicabApi()
      if (!api) return () => undefined

      return api.ai.onReflection((text: string) => {
        const normalizedText = text.trim()
        if (!normalizedText) return

        set((state) => {
          const lastReflection = state.reflections[state.reflections.length - 1]
          if (lastReflection?.text.trim() === normalizedText) {
            return
          }

          state.reflections.push({
            id: crypto.randomUUID(),
            text: normalizedText
          })

          if (state.reflections.length > 8) {
            state.reflections.splice(0, state.reflections.length - 8)
          }
        })
      })
    }
  }))
)
