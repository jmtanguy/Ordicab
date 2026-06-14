import { z } from 'zod'

export const coworkScopedInputSchema = z.object({
  dossierId: z.string().min(1)
})

export type CoworkScopedInput = z.infer<typeof coworkScopedInputSchema>
