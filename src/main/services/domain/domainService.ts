import { readFile, stat } from 'node:fs/promises'

import type { DomainSelectionResult, DomainStatusSnapshot } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { getDomainMetadataPath, getDomainRegistryPath } from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'
import { loadDomainState, pathExists, saveDomainState } from '../../lib/system/domainState'

interface DomainMetadataFile {
  domainPath: string
  initializedAt: string
}

export interface OpenDirectoryDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface DomainServiceOptions {
  stateFilePath: string
  now?: () => Date
  openDirectoryDialog: () => Promise<OpenDirectoryDialogResult>
}

export interface DomainService {
  selectDomain: () => Promise<DomainSelectionResult>
  getStatus: () => Promise<DomainStatusSnapshot>
}

export class DomainServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'DomainServiceError'
  }
}

async function ensureDomainBootstrap(domainPath: string, now: () => Date): Promise<void> {
  const stats = await stat(domainPath)
  if (!stats.isDirectory()) {
    throw new DomainServiceError(
      IpcErrorCode.INVALID_INPUT,
      `Selected path is not a directory: ${domainPath}`
    )
  }

  const metadataPath = getDomainMetadataPath(domainPath)

  // Preserve the original initializedAt if the domain was previously bootstrapped.
  let initializedAt = now().toISOString()
  if (await pathExists(metadataPath)) {
    try {
      const existing = JSON.parse(
        await readFile(metadataPath, 'utf8')
      ) as Partial<DomainMetadataFile>
      if (typeof existing.initializedAt === 'string') {
        initializedAt = existing.initializedAt
      }
    } catch {
      // Corrupted metadata — overwrite with fresh timestamp.
    }
  }

  const metadata: DomainMetadataFile = {
    domainPath,
    initializedAt
  }
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
}

async function countDossiers(domainPath: string): Promise<number> {
  const registryPath = getDomainRegistryPath(domainPath)

  if (!(await pathExists(registryPath))) {
    return 0
  }

  try {
    const parsed = JSON.parse(await readFile(registryPath, 'utf8')) as {
      dossiers?: unknown[]
    }
    return Array.isArray(parsed.dossiers) ? parsed.dossiers.length : 0
  } catch (error) {
    console.error('[DomainService] Failed to parse dossier registry:', registryPath, error)
    return 0
  }
}

export function createDomainService(options: DomainServiceOptions): DomainService {
  const now = options.now ?? (() => new Date())

  return {
    selectDomain: async (): Promise<DomainSelectionResult> => {
      const selection = await options.openDirectoryDialog()
      const selectedPath = selection.canceled ? null : (selection.filePaths[0] ?? null)

      if (!selectedPath) {
        return { selectedPath: null }
      }

      await ensureDomainBootstrap(selectedPath, now)
      await saveDomainState(options.stateFilePath, selectedPath, now)
      return { selectedPath }
    },

    getStatus: async (): Promise<DomainStatusSnapshot> => {
      const state = await loadDomainState(options.stateFilePath)
      const selectedPath = state?.selectedDomainPath ?? null

      if (!selectedPath) {
        return {
          registeredDomainPath: null,
          isAvailable: false,
          dossierCount: 0
        }
      }

      const isAvailable = await pathExists(selectedPath)
      if (!isAvailable) {
        return {
          registeredDomainPath: selectedPath,
          isAvailable: false,
          dossierCount: 0
        }
      }

      return {
        registeredDomainPath: selectedPath,
        isAvailable: true,
        dossierCount: await countDossiers(selectedPath)
      }
    }
  }
}
