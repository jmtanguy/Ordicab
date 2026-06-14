/**
 * piiMappingStore — persistent per-dossier PII mapping (`.ordicab/pii-mapping.json`).
 *
 * Written by the Cowork export (merge of the persisted entries with the
 * entries produced by the export's pseudonymizer), read by the Cowork
 * re-import (to revert fakes back to originals) and by the embedded AI
 * pipeline (read-only, as priorEntries) so the assistant and the export share
 * the same fakes for the same originals.
 *
 * The file must NEVER be written inside the Cowork/ export folder — it maps
 * fakes back to real identities and would defeat the pseudonymization.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { atomicWrite } from '../../system/atomicWrite'
import { pathExists } from '../../system/domainState'
import { getDossierPiiMappingPath } from '../../ordicab/ordicabPaths'
import type { MappingSnapshotEntry } from './piiMapping'

export interface DossierPiiMappingFile {
  version: 1
  updatedAt: string
  entries: MappingSnapshotEntry[]
}

// A dossier archive, not a chat ledger: generous bound that only guards
// against pathological growth.
const MAX_PERSISTED_ENTRIES = 10_000

function isMappingEntry(value: unknown): value is MappingSnapshotEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<MappingSnapshotEntry>
  return (
    typeof entry.original === 'string' &&
    typeof entry.markerPath === 'string' &&
    typeof entry.fakeValue === 'string'
  )
}

export async function readDossierPiiMapping(dossierPath: string): Promise<MappingSnapshotEntry[]> {
  const mappingPath = getDossierPiiMappingPath(dossierPath)
  if (!(await pathExists(mappingPath))) return []

  try {
    const parsed = JSON.parse(await readFile(mappingPath, 'utf8')) as Partial<DossierPiiMappingFile>
    return Array.isArray(parsed.entries) ? parsed.entries.filter(isMappingEntry) : []
  } catch {
    return []
  }
}

export async function writeDossierPiiMapping(
  dossierPath: string,
  entries: MappingSnapshotEntry[]
): Promise<void> {
  const mappingPath = getDossierPiiMappingPath(dossierPath)
  await mkdir(dirname(mappingPath), { recursive: true })
  const file: DossierPiiMappingFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries
  }
  await atomicWrite(mappingPath, `${JSON.stringify(file, null, 2)}\n`)
}

/** Exact-triple dedupe (same convention as aiService.mergePiiDecodeLedger). */
export function mergeMappingEntries(
  base: MappingSnapshotEntry[],
  next: MappingSnapshotEntry[]
): MappingSnapshotEntry[] {
  const byExactEntry = new Map<string, MappingSnapshotEntry>()
  for (const entry of [...base, ...next]) {
    if (!entry.original || !entry.markerPath || !entry.fakeValue) continue
    byExactEntry.set(`${entry.original}\u0000${entry.markerPath}\u0000${entry.fakeValue}`, entry)
  }
  return Array.from(byExactEntry.values()).slice(-MAX_PERSISTED_ENTRIES)
}
