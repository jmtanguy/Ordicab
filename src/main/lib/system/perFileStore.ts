import { mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import type { ZodType } from 'zod'

import { atomicWrite } from './atomicWrite'
import { pathExists } from './domainState'

/**
 * Reads all JSON records from a directory, parsing each file with the given schema.
 * Files that fail to parse are silently skipped.
 */
export async function loadAllRecords<T>(dirPath: string, schema: ZodType<T>): Promise<T[]> {
  if (!(await pathExists(dirPath))) return []
  let files: string[]
  try {
    files = await readdir(dirPath)
  } catch {
    return []
  }
  const records = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (filename) => {
        try {
          const raw = await readFile(join(dirPath, filename), 'utf8')
          const result = schema.safeParse(JSON.parse(raw))
          return result.success ? result.data : null
        } catch {
          return null
        }
      })
  )
  return records.filter((r): r is Awaited<T> => r !== null) as T[]
}

/**
 * Reads a single record file. Returns null if missing or unparseable.
 */
export async function loadRecord<T>(recordPath: string, schema: ZodType<T>): Promise<T | null> {
  if (!(await pathExists(recordPath))) return null
  try {
    const raw = await readFile(recordPath, 'utf8')
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Writes a record as a JSON file, creating the directory if needed.
 */
export async function saveRecord(
  dirPath: string,
  recordPath: string,
  record: unknown
): Promise<void> {
  await mkdir(dirPath, { recursive: true })
  await atomicWrite(recordPath, `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * Deletes a record file. Silently ignores if missing.
 */
export async function deleteRecord(recordPath: string): Promise<void> {
  await unlink(recordPath).catch(() => undefined)
}
