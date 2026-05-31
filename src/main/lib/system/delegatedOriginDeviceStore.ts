import { randomUUID } from 'node:crypto'

import type { AppStateStore } from './appStateStore'

export interface DelegatedOriginDeviceStore {
  getOriginDeviceId(): Promise<string>
}

export function createDelegatedOriginDeviceStore(
  appState: AppStateStore
): DelegatedOriginDeviceStore {
  let inFlightOriginDeviceId: Promise<string> | null = null

  return {
    async getOriginDeviceId(): Promise<string> {
      if (inFlightOriginDeviceId) {
        return inFlightOriginDeviceId
      }

      inFlightOriginDeviceId = (async () => {
        const existing = (await appState.read()).delegatedAi?.originDeviceId

        if (typeof existing === 'string' && existing.length > 0) {
          return existing
        }

        const originDeviceId = randomUUID()
        await appState.update((state) => ({
          ...state,
          delegatedAi: {
            ...(state.delegatedAi ?? {}),
            originDeviceId
          }
        }))
        return originDeviceId
      })()

      try {
        return await inFlightOriginDeviceId
      } finally {
        inFlightOriginDeviceId = null
      }
    }
  }
}
