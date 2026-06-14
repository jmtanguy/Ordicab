import { z } from 'zod'

import type { CompareRunInput } from '@shared/domain/compare'

import { dossierIdSchema } from './dossierId'

export const compareRunInputSchema = z
  .object({
    dossierId: dossierIdSchema,
    oldDocumentPath: z.string().min(1),
    newDocumentPath: z.string().min(1),
    verifyCitations: z.boolean().default(true)
  })
  .refine((input) => input.oldDocumentPath !== input.newDocumentPath, {
    message: 'The two documents must differ.',
    path: ['newDocumentPath']
  })

export type { CompareRunInput }
