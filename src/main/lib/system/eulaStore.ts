import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { AppLocale, EulaStatus } from '@shared/types'

import { atomicWrite } from './atomicWrite'
import { pathExists } from './domainState'

interface AppStateFile {
  legal?: {
    eulaAcceptedVersion?: string
    acceptedAt?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

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
  stateFilePath: string
  appContext: AppPathContext
}

const EULA_VERSION = '2026-04-14'

async function readAppState(stateFilePath: string): Promise<AppStateFile> {
  if (!(await pathExists(stateFilePath))) {
    return {}
  }

  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as AppStateFile)
      : {}
  } catch {
    return {}
  }
}

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
  const { stateFilePath, appContext } = options

  return {
    async getStatus(locale: AppLocale): Promise<EulaStatus> {
      const state = await readAppState(stateFilePath)
      const acceptedVersion = state.legal?.eulaAcceptedVersion

      return {
        required: acceptedVersion !== EULA_VERSION,
        version: EULA_VERSION,
        content: await readEulaText(appContext, locale)
      }
    },

    async accept(version: string, locale: AppLocale): Promise<EulaStatus> {
      const state = await readAppState(stateFilePath)
      const updatedState: AppStateFile = {
        ...state,
        legal: {
          ...(typeof state.legal === 'object' && state.legal !== null ? state.legal : {}),
          eulaAcceptedVersion: version,
          acceptedAt: new Date().toISOString()
        }
      }

      await atomicWrite(stateFilePath, `${JSON.stringify(updatedState, null, 2)}\n`)
      return this.getStatus(locale)
    }
  }
}
