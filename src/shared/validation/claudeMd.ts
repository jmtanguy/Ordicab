import { z } from 'zod'

export const claudeMdRegenerateInputSchema = z
  .object({
    dossierId: z.string().min(1).optional()
  })
  .strict()

export type ClaudeMdRegenerateInput = z.infer<typeof claudeMdRegenerateInputSchema>
