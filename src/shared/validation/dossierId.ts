import { z } from 'zod'

export const dossierIdSchema = z.string().min(1)
