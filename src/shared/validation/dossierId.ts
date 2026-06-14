import { z } from 'zod'

/**
 * A dossier identifier (UUID or slug) is routinely joined into filesystem paths
 * (`join(domainPath, id)`, dossier-root resolution, `mkdir` on create). It must
 * therefore be a single safe path segment: no separators, no traversal, no NUL.
 * This is the central trust boundary for both IPC and delegated-AI payloads, so
 * the guard lives here rather than at each call site.
 */
export const dossierIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      value !== '.' &&
      value !== '..',
    { message: 'Invalid dossier id: it must be a single path segment without separators.' }
  )
