import type { AppStateStore } from './appStateStore'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface CredentialStore {
  saveSecret(key: string, value: string): Promise<void>
  getSecret(key: string): Promise<string | null>
  deleteSecret(key: string): Promise<void>
  hasSecret(key: string): Promise<boolean>
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
  function assertEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      // On Linux without a desktop keyring, Electron falls back to a hardcoded
      // key — refuse to persist the secret rather than write it effectively in
      // cleartext.
      throw new CredentialStoreUnavailableError(
        'Secure credential storage is not available on this system. Set up a desktop keyring (e.g. gnome-keyring, kwallet) and restart the app.'
      )
    }
  }

  function getEncryptedSecret(credentials: unknown, key: string): string | null {
    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
      return null
    }
    const encrypted = (credentials as Record<string, unknown>)[key]
    return typeof encrypted === 'string' && encrypted ? encrypted : null
  }

  return {
    async saveSecret(key: string, value: string): Promise<void> {
      assertEncryptionAvailable()
      const base64 = safeStorage.encryptString(value).toString('base64')

      await appState.update((state) => ({
        ...state,
        credentials: {
          ...((state.credentials && typeof state.credentials === 'object'
            ? state.credentials
            : {}) as Record<string, unknown>),
          [key]: base64
        }
      }))
    },

    async getSecret(key: string): Promise<string | null> {
      const state = await appState.read()
      const base64 = getEncryptedSecret(state.credentials, key)

      if (!base64) {
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

    async deleteSecret(key: string): Promise<void> {
      const state = await appState.read()

      const credentials =
        state.credentials &&
        typeof state.credentials === 'object' &&
        !Array.isArray(state.credentials)
          ? (state.credentials as Record<string, unknown>)
          : {}

      if (!getEncryptedSecret(credentials, key)) {
        return
      }

      await appState.update((current) => {
        const currentCredentials =
          current.credentials &&
          typeof current.credentials === 'object' &&
          !Array.isArray(current.credentials)
            ? (current.credentials as Record<string, unknown>)
            : {}
        const { [key]: deletedSecret, ...nextCredentials } = currentCredentials
        void deletedSecret
        return {
          ...current,
          credentials: nextCredentials
        }
      })
    },

    async hasSecret(key: string): Promise<boolean> {
      const state = await appState.read()
      return getEncryptedSecret(state.credentials, key) !== null
    }
  }
}
