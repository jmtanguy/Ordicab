/**
 * aiHandler — IPC handler registrations for all AI-related channels.
 *
 * Handles (invoke/response pattern):
 *   ai:settings-get        — read current AI settings from state file.
 *   ai:settings-save       — persist AI settings + optional API key encryption.
 *   ai:delete-api-key      — remove stored API key via credentialStore.
 *   ai:connection-status   — probe Ollama endpoint reachability.
 *   ai:cloud-provider-status — check CLI tool availability for external modes.
 *   ai:execute-command     — run a natural language command through the AI pipeline.
 *   ai:reset-conversation  — clear the current AI conversation state.
 *                            Also pushes ai:intent-received to the renderer after dispatch.
 *
 * All handlers follow the IpcResult<T> contract: never throw, always return
 * { success: true, data } or { success: false, error, code }.
 *
 * The aiService and webContents dependencies are optional so existing tests
 * that don't provide them still pass; the handler returns AI_RUNTIME_UNAVAILABLE
 * if aiService is missing at runtime.
 *
 * Called by: main/index.ts → registerIpcHandlers()
 * Calls:     aiService | credentialStore | externalProviderChecker
 */
import { readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type AiCommandResult,
  type AiDelegatedProviderStatus,
  type AiMode,
  type RemoteConnectionResult,
  type AiSettingsSaveInput,
  type AiSettingsResponse,
  type InternalAiCommand,
  type IpcError,
  type IpcResult,
  type OllamaConnectionResult
} from '@shared/types'

import { atomicWrite } from '../lib/system/atomicWrite'
import { aiCommandInputSchema, aiSettingsSaveSchema } from '@shared/validation/ai'
import {
  normalizeOpenAiCompatibleBaseUrl,
  REMOTE_PROVIDER_KIND_VALUES,
  inferRemoteProviderKind,
  inferInfomaniakProjectRef,
  type RemoteProviderKind
} from '@shared/ai/remoteProviders'
import type { AiDelegatedProviderChecker } from '../lib/aiDelegated/aiDelegatedProviderChecker'
import { createAiDelegatedProviderChecker } from '../lib/aiDelegated/aiDelegatedProviderChecker'
import type { CredentialStore } from '../lib/system/credentialStore'
import type { AiService } from '../services/aiEmbedded/aiService'

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

interface AppStateFile {
  ai?: {
    mode?: string
    ollamaEndpoint?: string
    remoteProviderKind?: string
    remoteProjectRef?: string
    remoteProvider?: string
    encryptedApiKey?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

const DEFAULT_AI_SETTINGS = {
  mode: 'local' as const,
  ollamaEndpoint: 'http://localhost:11434'
}

function toRemoteAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}

function extractRemoteModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const data = (payload as { data?: unknown }).data
  if (!Array.isArray(data)) return []

  return data.flatMap((entry) => {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { id?: unknown }).id === 'string'
    ) {
      return [(entry as { id: string }).id]
    }
    return []
  })
}

async function probeRemoteProvider(input: {
  remoteProvider: string
  apiKey: string
  remoteModel?: string
}): Promise<RemoteConnectionResult> {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(input.remoteProvider)
  const authHeaders = toRemoteAuthHeaders(input.apiKey)
  const configuredModel = input.remoteModel?.trim() || undefined

  try {
    const modelsResponse = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: authHeaders,
      signal: AbortSignal.timeout(10_000)
    })

    if (modelsResponse.ok) {
      const payload = await modelsResponse.json()
      const models = extractRemoteModelIds(payload)
      if (models.length > 0) {
        return {
          reachable: true,
          models,
          resolvedModel:
            configuredModel && models.includes(configuredModel) ? configuredModel : models[0]
        }
      }
    }
  } catch {
    // Fallback handled below via explicit model validation.
  }

  if (!configuredModel) {
    return {
      reachable: false,
      error:
        'Unable to list remote models. Enter a model name manually, then verify the connection again.'
    }
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders,
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: configuredModel,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 1
      })
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      return {
        reachable: false,
        error:
          bodyText.trim() ||
          `Remote provider check failed with HTTP ${response.status} for model "${configuredModel}".`
      }
    }

    return {
      reachable: true,
      models: [configuredModel],
      resolvedModel: configuredModel,
      usedConfiguredModelFallback: true
    }
  } catch (error) {
    return {
      reachable: false,
      error:
        error instanceof Error ? error.message : `Unable to reach remote provider at ${baseUrl}.`
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readAppState(stateFilePath: string): Promise<AppStateFile> {
  if (!(await pathExists(stateFilePath))) {
    return {}
  }

  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as AppStateFile
    }

    return {}
  } catch {
    return {}
  }
}

function mapAiError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid AI settings input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code
    if (Object.values(IpcErrorCode).includes(code as IpcErrorCode)) {
      return {
        success: false,
        error: error.message,
        code: code as IpcErrorCode
      }
    }
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    code: IpcErrorCode.UNKNOWN
  }
}

function getSuffix(key: string | null): string | undefined {
  if (!key || key.length < 4) return undefined
  return key.slice(-4)
}

interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void
}

export function registerAiHandlers(options: {
  ipcMain: IpcMainLike
  credentialStore: CredentialStore
  stateFilePath: string
  onModeChanged?: (settings: AiSettingsSaveInput) => void
  checker?: AiDelegatedProviderChecker
  aiService?: AiService
  webContents?: WebContentsLike
}): void {
  const { ipcMain, credentialStore, stateFilePath, onModeChanged } = options
  const checker = options.checker ?? createAiDelegatedProviderChecker()
  const { aiService, webContents } = options

  ipcMain.handle(IPC_CHANNELS.ai.settingsGet, async (): Promise<IpcResult<AiSettingsResponse>> => {
    try {
      const state = await readAppState(stateFilePath)
      const ai = state.ai

      if (!ai || typeof ai.mode === 'undefined') {
        const storedKey = await credentialStore.getApiKey('default')
        const response: AiSettingsResponse = {
          ...DEFAULT_AI_SETTINGS,
          hasApiKey: false,
          apiKeySuffix: getSuffix(storedKey)
        }
        return { success: true, data: response }
      }

      const validModes = ['none', 'local', 'remote', 'claude-code', 'copilot', 'codex'] as const
      type ValidMode = (typeof validModes)[number]
      const mode: ValidMode =
        typeof ai.mode === 'string' && (validModes as readonly string[]).includes(ai.mode)
          ? (ai.mode as ValidMode)
          : 'local'
      const storedKey = await credentialStore.getApiKey('default')

      const response: AiSettingsResponse = {
        mode,
        ollamaEndpoint:
          typeof ai.ollamaEndpoint === 'string'
            ? ai.ollamaEndpoint
            : mode === 'local'
              ? DEFAULT_AI_SETTINGS.ollamaEndpoint
              : undefined,
        remoteProviderKind:
          typeof ai.remoteProviderKind === 'string'
            ? REMOTE_PROVIDER_KIND_VALUES.includes(ai.remoteProviderKind as RemoteProviderKind)
              ? (ai.remoteProviderKind as RemoteProviderKind)
              : inferRemoteProviderKind(ai.remoteProviderKind)
            : inferRemoteProviderKind(
                typeof ai.remoteProvider === 'string' ? ai.remoteProvider : undefined
              ),
        remoteProjectRef:
          typeof ai.remoteProjectRef === 'string'
            ? ai.remoteProjectRef
            : inferInfomaniakProjectRef(
                typeof ai.remoteProvider === 'string' ? ai.remoteProvider : undefined
              ),
        remoteProvider: typeof ai.remoteProvider === 'string' ? ai.remoteProvider : undefined,
        piiEnabled: typeof ai.piiEnabled === 'boolean' ? ai.piiEnabled : true,
        hasApiKey: storedKey !== null,
        apiKeySuffix: getSuffix(storedKey)
      }

      return { success: true, data: response }
    } catch (error) {
      return mapAiError(error, 'Unable to load AI settings.')
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.ai.settingsSave,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = aiSettingsSaveSchema.parse(input)

        const state = await readAppState(stateFilePath)

        const { apiKey, ...settingsToSave } = parsed

        const updated: AppStateFile = {
          ...state,
          ai: {
            ...(typeof state.ai === 'object' && state.ai !== null ? state.ai : {}),
            ...settingsToSave
          }
        }

        await atomicWrite(stateFilePath, `${JSON.stringify(updated, null, 2)}\n`)

        if (apiKey) {
          await credentialStore.saveApiKey('default', apiKey)
        }

        onModeChanged?.(parsed)

        return { success: true, data: null }
      } catch (error) {
        return mapAiError(error, 'Unable to save AI settings.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.ai.deleteApiKey,
    async (_event, provider: unknown): Promise<IpcResult<null>> => {
      try {
        const providerName = typeof provider === 'string' ? provider : 'default'
        await credentialStore.deleteApiKey(providerName)
        return { success: true, data: null }
      } catch (error) {
        return mapAiError(error, 'Unable to delete API key.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.ai.connectionStatus,
    async (): Promise<IpcResult<OllamaConnectionResult>> => {
      try {
        const state = await readAppState(stateFilePath)
        const endpoint =
          typeof state.ai?.ollamaEndpoint === 'string'
            ? state.ai.ollamaEndpoint
            : 'http://localhost:11434'

        const url = `${endpoint.replace(/\/$/, '')}/api/tags`
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })

        if (!res.ok) {
          return {
            success: false,
            error: `Cannot reach ${endpoint} — HTTP ${res.status}`,
            code: IpcErrorCode.OLLAMA_UNREACHABLE
          }
        }

        const data = (await res.json()) as { models?: Array<{ name: string }> }
        const result: OllamaConnectionResult = {
          reachable: true,
          models: (data.models ?? []).map((model) => model.name)
        }

        return { success: true, data: result }
      } catch (error) {
        return mapAiError(error, 'Unable to check Ollama connection.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.ai.remoteConnectionStatus,
    async (_event, input: unknown): Promise<IpcResult<RemoteConnectionResult>> => {
      try {
        const state = await readAppState(stateFilePath)
        const payload =
          typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
        const remoteProvider =
          typeof payload['remoteProvider'] === 'string'
            ? payload['remoteProvider']
            : typeof state.ai?.remoteProvider === 'string'
              ? state.ai.remoteProvider
              : ''
        const remoteModel =
          typeof payload['remoteModel'] === 'string' ? payload['remoteModel'] : undefined
        const draftApiKey =
          typeof payload['apiKey'] === 'string' && payload['apiKey'].trim()
            ? payload['apiKey'].trim()
            : null
        const apiKey = draftApiKey ?? (await credentialStore.getApiKey('default'))

        if (!remoteProvider.trim()) {
          return {
            success: false,
            error: 'Remote provider URL is required.',
            code: IpcErrorCode.INVALID_INPUT
          }
        }

        if (!apiKey) {
          return {
            success: false,
            error: 'API key is required to verify the remote provider.',
            code: IpcErrorCode.INVALID_INPUT
          }
        }

        const result = await probeRemoteProvider({
          remoteProvider,
          apiKey,
          remoteModel
        })

        if (!result.reachable) {
          return {
            success: false,
            error: result.error ?? 'Unable to verify remote provider.',
            code: IpcErrorCode.REMOTE_API_ERROR
          }
        }

        return { success: true, data: result }
      } catch (error) {
        return mapAiError(error, 'Unable to verify remote provider.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.ai.cloudProviderStatus,
    async (_event, mode: unknown): Promise<IpcResult<AiDelegatedProviderStatus>> => {
      try {
        const validModes: AiMode[] = ['none', 'local', 'remote', 'claude-code', 'copilot', 'codex']
        const resolvedMode: AiMode = (validModes as readonly string[]).includes(mode as string)
          ? (mode as AiMode)
          : 'none'
        const result = await checker.checkAvailability(resolvedMode)
        return { success: true, data: result }
      } catch (error) {
        return mapAiError(error, 'Unable to check cloud provider availability.')
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.ai.executeCommand,
    async (_event, input: unknown): Promise<IpcResult<AiCommandResult>> => {
      try {
        if (!aiService) {
          return {
            success: false,
            error: 'AI service is not available.',
            code: IpcErrorCode.AI_RUNTIME_UNAVAILABLE
          }
        }
        const parsed = aiCommandInputSchema.parse(input)
        const onToken = webContents
          ? (token: string) => webContents.send(IPC_CHANNELS.ai.textToken, token)
          : undefined
        const result = await aiService.executeCommand(parsed, onToken)
        // Push the intent via the separate push channel so the renderer can
        // react immediately (e.g. update lastIntent in aiStore) in addition
        // to receiving it as part of the IpcResult below.
        const intent: InternalAiCommand = result.intent
        webContents?.send(IPC_CHANNELS.ai.intentReceived, intent)
        return { success: true, data: result }
      } catch (error) {
        return mapAiError(error, 'AI command failed.')
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.ai.cancelCommand, async (): Promise<IpcResult<null>> => {
    aiService?.cancelCommand()
    return { success: true, data: null }
  })

  ipcMain.handle(IPC_CHANNELS.ai.resetConversation, async (): Promise<IpcResult<null>> => {
    try {
      if (!aiService) {
        return {
          success: false,
          error: 'AI service is not available.',
          code: IpcErrorCode.AI_RUNTIME_UNAVAILABLE
        }
      }

      await aiService.resetConversation()
      return { success: true, data: null }
    } catch (error) {
      return mapAiError(error, 'Unable to reset AI conversation.')
    }
  })
}
