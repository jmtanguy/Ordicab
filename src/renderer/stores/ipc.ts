/**
 * Renderer-side IPC accessor, architecture guard, and shared store utilities.
 *
 * `getOrdicabApi` returns the OrdicabAPI object that was injected onto
 * `globalThis.ordicabAPI` by the preload script (src/preload/index.ts).
 * Returns null when running outside Electron (e.g. browser, Vitest) so callers
 * can degrade gracefully.
 *
 * Architecture rule (enforced by the no-direct-ipc ESLint test):
 *   IPC calls must only originate from Zustand store actions, never directly
 *   inside React components. This keeps side-effects out of the render phase
 *   and makes the data-flow easier to trace and test.
 */
import { IpcErrorCode, type OrdicabAPI } from '@shared/types'

export const IPC_NOT_AVAILABLE_ERROR = 'ordicabAPI bridge is unavailable in the current runtime.'

export function getOrdicabApi(): OrdicabAPI | null {
  return (globalThis as { ordicabAPI?: OrdicabAPI }).ordicabAPI ?? null
}

interface ApiUnavailableState {
  [key: string]: unknown
}

/**
 * Null-guard for the standard error-state pattern in immer store actions.
 *
 * If the IPC bridge is unavailable, writes `IPC_NOT_AVAILABLE_ERROR` /
 * `IpcErrorCode.NOT_FOUND` into the nominated error fields and returns `null`.
 * The caller should `return` immediately when the result is `null`.
 *
 * Default fields: `error` / `errorCode`. Pass `errorKey`/`codeKey` to target
 * secondary namespaces (e.g. `detailError`/`detailErrorCode` in dossierStore).
 *
 * Usage:
 *   const api = requireApi(set)
 *   if (!api) return
 *   set(state => { state.isLoading = true })
 *   const result = await api.contact.list(input)
 */
export function requireApi(
  set: (fn: (state: ApiUnavailableState) => void) => void,
  options?: { errorKey?: string; codeKey?: string }
): OrdicabAPI | null {
  const api = getOrdicabApi()
  if (!api) {
    const errorKey = options?.errorKey ?? 'error'
    const codeKey = options?.codeKey ?? 'errorCode'
    set((state) => {
      state[errorKey] = IPC_NOT_AVAILABLE_ERROR
      state[codeKey] = IpcErrorCode.NOT_FOUND
    })
    return null
  }
  return api
}

/**
 * Safe localStorage get — returns null when localStorage is unavailable
 * (SSR, Vitest, sandboxed renderer) instead of throwing.
 */
export function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Safe localStorage set — silently ignores failures when localStorage is
 * unavailable (SSR, Vitest, sandboxed renderer, quota exceeded).
 */
export function safeLocalStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore renderer preference persistence failures.
  }
}
