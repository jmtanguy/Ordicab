/**
 * personaRegistry — reads the role-persona settings from `app-state.json`
 * (namespace `piiPersonas`) and merges them over the built-in defaults.
 *
 * Mirrors `readAiSettings` in aiService.ts: a plain read of the state file,
 * defensive against a missing/corrupt file, so both the embedded AI pipeline
 * and the Cowork export service can call it with the path they already have.
 */

import { readFile } from 'node:fs/promises'

import {
  mergePersonasWithDefaults,
  type PiiPersona,
  type PiiPersonaSettings
} from '@shared/types/piiPersonas'
import { pathExists } from '../../system/domainState'

export const PII_PERSONAS_STATE_NAMESPACE = 'piiPersonas'

function parseStoredPersonas(value: unknown): PiiPersona[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const personas = (value as Partial<PiiPersonaSettings>).personas
  return Array.isArray(personas) ? (personas as PiiPersona[]) : undefined
}

/** Stored personas merged over defaults; unsafe names dropped defensively. */
async function readPiiPersonas(stateFilePath: string): Promise<PiiPersona[]> {
  if (!(await pathExists(stateFilePath))) return mergePersonasWithDefaults(undefined)

  try {
    const parsed = JSON.parse(await readFile(stateFilePath, 'utf8')) as Record<string, unknown>
    return mergePersonasWithDefaults(parseStoredPersonas(parsed[PII_PERSONAS_STATE_NAMESPACE]))
  } catch {
    return mergePersonasWithDefaults(undefined)
  }
}

/** Personas keyed by roleKey, the shape consumed by PiiContext. */
export async function readPiiPersonaMap(
  stateFilePath: string
): Promise<Record<string, PiiPersona>> {
  const personas = await readPiiPersonas(stateFilePath)
  return Object.fromEntries(personas.map((persona) => [persona.roleKey, persona]))
}
