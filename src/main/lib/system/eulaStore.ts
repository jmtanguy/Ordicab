import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

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

function resolveEulaPath(locale: AppLocale): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'legal', `license_${locale}.txt`)
  }

  return join(app.getAppPath(), 'build', `license_${locale}.txt`)
}

async function readEulaText(locale: AppLocale): Promise<string> {
  const preferredPath = resolveEulaPath(locale)
  try {
    return await readFile(preferredPath, 'utf8')
  } catch {
    const fallbackPath = resolveEulaPath(locale === 'fr' ? 'en' : 'fr')
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

export function createEulaStore(stateFilePath: string): EulaStore {
  return {
    async getStatus(locale: AppLocale): Promise<EulaStatus> {
      const state = await readAppState(stateFilePath)
      const acceptedVersion = state.legal?.eulaAcceptedVersion

      return {
        required: acceptedVersion !== EULA_VERSION,
        version: EULA_VERSION,
        content: await readEulaText(locale)
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
