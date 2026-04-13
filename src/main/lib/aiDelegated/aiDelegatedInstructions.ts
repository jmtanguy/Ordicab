import { join } from 'node:path'

import { AI_DELEGATED_INSTRUCTIONS_FILES, type AiMode } from '@shared/types'

/**
 * Delegated AI modes do not use the built-in runtime directly.
 * Instead, Ordicab writes tool-specific instruction files at the domain root.
 */
export function getAiDelegatedInstructionsRelativePath(mode: AiMode): string | null {
  return AI_DELEGATED_INSTRUCTIONS_FILES[mode] ?? null
}

/**
 * Resolves the absolute instructions file path written into a domain for a delegated AI mode.
 */
export function getAiDelegatedInstructionsPath(domainPath: string, mode: AiMode): string | null {
  const relativePath = getAiDelegatedInstructionsRelativePath(mode)
  return relativePath ? join(domainPath, relativePath) : null
}

// Used to ignore external assistant instructions files when scanning ordinary user files.
const AI_DELEGATED_INSTRUCTIONS_FILENAMES = new Set(
  Object.values(AI_DELEGATED_INSTRUCTIONS_FILES).flatMap((relativePath) => {
    if (typeof relativePath !== 'string') return []
    const segments = relativePath.split('/')
    return [segments[segments.length - 1] ?? relativePath]
  })
)

/**
 * Returns true when a filename matches one of the generated delegated-instructions artifacts.
 */
export function isAiDelegatedInstructionsFilename(filename: string): boolean {
  return AI_DELEGATED_INSTRUCTIONS_FILENAMES.has(filename)
}
