import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'

import { atomicWrite } from './atomicWrite'

export interface DomainStateFile {
  selectedDomainPath: string | null
  updatedAt: string
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function loadDomainState(stateFilePath: string): Promise<DomainStateFile | null> {
  if (!(await pathExists(stateFilePath))) {
    return null
  }

  let raw: string
  try {
    raw = await readFile(stateFilePath, 'utf8')
  } catch (err) {
    console.error('[DomainState] Failed to read state file:', stateFilePath, err)
    return null
  }

  let parsed: Partial<DomainStateFile>
  try {
    parsed = JSON.parse(raw) as Partial<DomainStateFile>
  } catch (err) {
    console.error(
      '[DomainState] State file is not valid JSON — treating as unconfigured. File will be overwritten on next domain selection.',
      stateFilePath,
      err
    )
    return null
  }

  if (typeof parsed.selectedDomainPath === 'string' || parsed.selectedDomainPath === null) {
    return {
      selectedDomainPath: parsed.selectedDomainPath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString()
    }
  }

  console.error(
    '[DomainState] State file has unexpected schema — treating as unconfigured.',
    stateFilePath,
    parsed
  )
  return null
}

export async function saveDomainState(
  stateFilePath: string,
  selectedDomainPath: string | null,
  now: () => Date
): Promise<void> {
  // `app-state.json` is a shared key/value bag: `selectedDomainPath` lives at the
  // top level alongside namespaces owned by other stores (`legal`, `ai`,
  // `credentials`, `delegatedAi`). A whole-file overwrite here used to wipe those
  // namespaces — most visibly `legal.eulaAcceptedVersion`, so the EULA dialog
  // reappeared on the next launch whenever a domain was (re)selected after
  // acceptance. Read-modify-write to preserve every other key.
  let existing: Record<string, unknown> = {}
  try {
    const raw = await readFile(stateFilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {
    // No (or unparseable) state file yet -> start from an empty bag.
  }

  const state = {
    ...existing,
    selectedDomainPath,
    updatedAt: now().toISOString()
  }

  await atomicWrite(stateFilePath, `${JSON.stringify(state, null, 2)}\n`)
}
