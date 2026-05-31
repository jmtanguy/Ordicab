import type { AppStateStore } from './appStateStore'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface CredentialStore {
  saveApiKey(provider: string, key: string): Promise<void>
  getApiKey(provider: string): Promise<string | null>
  deleteApiKey(provider: string): Promise<void>
}

export class CredentialStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialStoreUnavailableError'
  }
}

export function createCredentialStore(
  safeStorage: SafeStorageLike,
  appState: AppStateStore
): CredentialStore {
  return {
    async saveApiKey(_provider: string, key: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        // On Linux without a desktop keyring, Electron falls back to a hardcoded
        // key — refuse to persist the secret rather than write it effectively in
        // cleartext.
        throw new CredentialStoreUnavailableError(
          'Secure credential storage is not available on this system. Set up a desktop keyring (e.g. gnome-keyring, kwallet) and restart the app.'
        )
      }
      const base64 = safeStorage.encryptString(key).toString('base64')

      await appState.update((state) => ({
        ...state,
        ai: {
          ...(state.ai ?? {}),
          encryptedApiKey: base64
        }
      }))
    },

    async getApiKey(provider: string): Promise<string | null> {
      void provider
      const state = await appState.read()
      const base64 = state.ai?.encryptedApiKey

      if (typeof base64 !== 'string' || !base64) {
        return null
      }

      if (!safeStorage.isEncryptionAvailable()) {
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
      const state = await appState.read()

      if (!state.ai?.encryptedApiKey) {
        return
      }

      await appState.update((current) => {
        const { encryptedApiKey, ...aiWithoutKey } = current.ai ?? {}
        void encryptedApiKey
        return {
          ...current,
          ai: aiWithoutKey
        }
      })
    }
  }
}
