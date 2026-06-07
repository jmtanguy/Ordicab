import { readFile } from 'node:fs/promises'

import { atomicWrite } from './atomicWrite'
import { pathExists } from './domainState'

/**
 * Single owner of `app-state.json`.
 *
 * Previously every consumer (credentialStore, eulaStore, delegatedOriginDeviceStore,
 * i18nMain, aiHandler) independently did read → spread → atomicWrite of the WHOLE
 * file, each with its own narrow `AppStateFile` interface. Two concurrent writers
 * therefore clobbered each other's namespaces (last-write-wins on the entire file).
 *
 * This store centralises access and serialises every read-modify-write through a
 * single chained promise (`writeQueue`), so concurrent `update()` calls compose
 * instead of overwriting. Reads outside a transaction stay lock-free.
 *
 * The shape is intentionally open — `app-state.json` is a loose key/value bag
 * shared by unrelated features; each caller owns the typing of its own namespace
 * via the `mutate` callback it passes to `update`.
 */
export interface AppStateFile {
  ai?: Record<string, unknown>
  credentials?: Record<string, unknown>
  legal?: Record<string, unknown>
  delegatedAi?: Record<string, unknown>
  locale?: string
  [key: string]: unknown
}

export interface AppStateStore {
  /** Read the whole state object (lock-free; `{}` if missing or unparseable). */
  read(): Promise<AppStateFile>
  /**
   * Atomically read-modify-write the whole state. `mutate` receives the current
   * state and returns the next state. Serialised against other `update` calls so
   * concurrent writers cannot clobber each other's namespaces.
   */
  update(mutate: (current: AppStateFile) => AppStateFile): Promise<AppStateFile>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createAppStateStore(stateFilePath: string): AppStateStore {
  // Serialises writes: each update() chains onto the previous one so the
  // read-modify-write is never interleaved.
  let writeQueue: Promise<unknown> = Promise.resolve()

  async function readState(): Promise<AppStateFile> {
    if (!(await pathExists(stateFilePath))) {
      return {}
    }

    try {
      const parsed = JSON.parse(await readFile(stateFilePath, 'utf8')) as unknown
      return isPlainObject(parsed) ? (parsed as AppStateFile) : {}
    } catch {
      return {}
    }
  }

  return {
    read: readState,

    update(mutate: (current: AppStateFile) => AppStateFile): Promise<AppStateFile> {
      const run = writeQueue.then(async () => {
        const current = await readState()
        const next = mutate(current)
        await atomicWrite(stateFilePath, `${JSON.stringify(next, null, 2)}\n`)
        return next
      })
      // Keep the queue alive even if this update rejects, so a single failure
      // doesn't wedge every subsequent writer.
      writeQueue = run.catch(() => undefined)
      return run
    }
  }
}
