import { readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { atomicWrite } from './atomicWrite'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface AppStateWithAi {
  ai?: {
    encryptedApiKey?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readAppState(stateFilePath: string): Promise<AppStateWithAi> {
  if (!(await pathExists(stateFilePath))) {
    return {}
  }

  try {
    const raw = await readFile(stateFilePath, 'utf8')
    return JSON.parse(raw) as AppStateWithAi
  } catch {
    return {}
  }
}

export interface CredentialStore {
  saveApiKey(provider: string, key: string): Promise<void>
  getApiKey(provider: string): Promise<string | null>
  deleteApiKey(provider: string): Promise<void>
}

export function createCredentialStore(
  safeStorage: SafeStorageLike,
  stateFilePath: string
): CredentialStore {
  return {
    async saveApiKey(_provider: string, key: string): Promise<void> {
      const state = await readAppState(stateFilePath)
      const encrypted = safeStorage.encryptString(key)
      const base64 = encrypted.toString('base64')

      const updated: AppStateWithAi = {
        ...state,
        ai: {
          ...(state.ai ?? {}),
          encryptedApiKey: base64
        }
      }

      await atomicWrite(stateFilePath, `${JSON.stringify(updated, null, 2)}\n`)
    },

    async getApiKey(provider: string): Promise<string | null> {
      void provider
      const state = await readAppState(stateFilePath)
      const base64 = state.ai?.encryptedApiKey

      if (!base64) {
        return null
      }

      try {
        return safeStorage.decryptString(Buffer.from(base64, 'base64'))
      } catch {
        return null
      }
    },

    async deleteApiKey(provider: string): Promise<void> {
      void provider
      const state = await readAppState(stateFilePath)

      if (!state.ai?.encryptedApiKey) {
        return
      }

      const { encryptedApiKey, ...aiWithoutKey } = state.ai
      void encryptedApiKey

      const updated: AppStateWithAi = {
        ...state,
        ai: aiWithoutKey
      }

      await atomicWrite(stateFilePath, `${JSON.stringify(updated, null, 2)}\n`)
    }
  }
}
