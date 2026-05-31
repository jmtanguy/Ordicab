import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppLocale, EulaStatus } from '@shared/types'

import type { AppStateStore } from './appStateStore'

/**
 * Minimal subset of Electron's `app` that the store needs to locate the
 * bundled EULA text. Injected so the lib stays free of `electron` imports
 * (ARCHITECTURE.md §5).
 */
export interface AppPathContext {
  isPackaged: boolean
  getAppPath(): string
}

export interface EulaStoreOptions {
  appState: AppStateStore
  appContext: AppPathContext
}

const EULA_VERSION = '2026-04-14'

function resolveEulaPath(appContext: AppPathContext, locale: AppLocale): string {
  if (appContext.isPackaged) {
    return join(process.resourcesPath, 'legal', `license_${locale}.txt`)
  }

  return join(appContext.getAppPath(), 'build', `license_${locale}.txt`)
}

async function readEulaText(appContext: AppPathContext, locale: AppLocale): Promise<string> {
  const preferredPath = resolveEulaPath(appContext, locale)
  try {
    return await readFile(preferredPath, 'utf8')
  } catch {
    const fallbackPath = resolveEulaPath(appContext, locale === 'fr' ? 'en' : 'fr')
    try {
      return await readFile(fallbackPath, 'utf8')
    } catch {
      return 'EULA text unavailable.'
    }
  }
}

export interface EulaStore {
  getStatus(locale: AppLocale): Promise<EulaStatus>
  accept(version: string, locale: AppLocale): Promise<EulaStatus>
}

export function createEulaStore(options: EulaStoreOptions): EulaStore {
  const { appState, appContext } = options

  async function getStatus(locale: AppLocale): Promise<EulaStatus> {
    const state = await appState.read()
    const acceptedVersion = state.legal?.eulaAcceptedVersion

    return {
      required: acceptedVersion !== EULA_VERSION,
      version: EULA_VERSION,
      content: await readEulaText(appContext, locale)
    }
  }

  return {
    getStatus,

    async accept(version: string, locale: AppLocale): Promise<EulaStatus> {
      await appState.update((state) => ({
        ...state,
        legal: {
          ...(state.legal ?? {}),
          eulaAcceptedVersion: version,
          acceptedAt: new Date().toISOString()
        }
      }))
      return getStatus(locale)
    }
  }
}
