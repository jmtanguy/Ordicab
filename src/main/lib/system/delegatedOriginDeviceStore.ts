import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { atomicWrite } from './atomicWrite'
import { pathExists } from './domainState'

interface AppStateFile {
  delegatedAi?: {
    originDeviceId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface DelegatedOriginDeviceStore {
  getOriginDeviceId(): Promise<string>
}

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

export function createDelegatedOriginDeviceStore(
  stateFilePath: string
): DelegatedOriginDeviceStore {
  let inFlightOriginDeviceId: Promise<string> | null = null

  return {
    async getOriginDeviceId(): Promise<string> {
      if (inFlightOriginDeviceId) {
        return inFlightOriginDeviceId
      }

      inFlightOriginDeviceId = (async () => {
        const state = await readAppState(stateFilePath)
        const existingOriginDeviceId = state.delegatedAi?.originDeviceId

        if (typeof existingOriginDeviceId === 'string' && existingOriginDeviceId.length > 0) {
          return existingOriginDeviceId
        }

        const originDeviceId = randomUUID()
        const updatedState: AppStateFile = {
          ...state,
          delegatedAi: {
            ...(typeof state.delegatedAi === 'object' && state.delegatedAi !== null
              ? state.delegatedAi
              : {}),
            originDeviceId
          }
        }

        await atomicWrite(stateFilePath, `${JSON.stringify(updatedState, null, 2)}\n`)
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
