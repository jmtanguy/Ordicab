/**
 * Renderer-side IPC accessor and architecture guard.
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
 *   `STORE_IPC_RULE` is the canonical error message for violations.
 */
import type { OrdicabAPI } from '@shared/types'

export const STORE_IPC_RULE = 'IPC calls live in store actions, never in React components.'

export const IPC_NOT_AVAILABLE_ERROR = 'ordicabAPI bridge is unavailable in the current runtime.'

export function getOrdicabApi(): OrdicabAPI | null {
  return (globalThis as { ordicabAPI?: OrdicabAPI }).ordicabAPI ?? null
}
