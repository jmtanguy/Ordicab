import { z } from 'zod'
import {
  JUDILIBRE_JURISDICTION_VALUES,
  JUDILIBRE_SORT_VALUES,
  LEGIFRANCE_FIELD_VALUES,
  LEGIFRANCE_FOND_VALUES,
  LEGIFRANCE_SEARCH_TYPE_VALUES,
  LEGIFRANCE_SORT_VALUES
} from '../domain/legal'

const optionalTrimmedString = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1))
  .optional()

export const legalSettingsSaveSchema = z.object({
  clientId: optionalTrimmedString,
  clientSecret: optionalTrimmedString
})

export const legalConnectionStatusSchema = z.object({
  clientId: optionalTrimmedString,
  clientSecret: optionalTrimmedString
})

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const legifranceSearchSchema = z.object({
  recherche: z.string().trim().min(1),
  fond: z.enum(LEGIFRANCE_FOND_VALUES).optional(),
  typeChamp: z.enum(LEGIFRANCE_FIELD_VALUES).optional(),
  typeRecherche: z.enum(LEGIFRANCE_SEARCH_TYPE_VALUES).optional(),
  code: optionalTrimmedString,
  dateDebut: isoDateSchema.optional(),
  dateFin: isoDateSchema.optional(),
  page: z.number().int().min(0).optional(),
  pageTaille: z.number().int().min(1).max(50).optional(),
  tri: z.enum(LEGIFRANCE_SORT_VALUES).optional(),
  operateur: z.enum(['ET', 'OU']).optional()
})

export const legifranceConsultSchema = z.object({
  id: z.string().trim().min(1)
})

export const judilibreSearchSchema = z.object({
  recherche: z.string().trim().min(1).optional(),
  juridiction: z.enum(JUDILIBRE_JURISDICTION_VALUES).optional(),
  localisation: optionalTrimmedString,
  chambre: optionalTrimmedString,
  typeDecision: optionalTrimmedString,
  theme: optionalTrimmedString,
  solution: optionalTrimmedString,
  dateDebut: isoDateSchema.optional(),
  dateFin: isoDateSchema.optional(),
  tri: z.enum(JUDILIBRE_SORT_VALUES).optional(),
  ordre: z.enum(['asc', 'desc']).optional(),
  nombreResultats: z.number().int().min(1).max(50).optional(),
  page: z.number().int().min(0).optional()
})

export const judilibreConsultSchema = z.object({
  decisionId: z.string().trim().min(1)
})

export const judilibreTaxonomySchema = z.object({
  taxonomyId: optionalTrimmedString,
  key: optionalTrimmedString,
  value: optionalTrimmedString,
  contextValue: optionalTrimmedString
})

export const legalReferenceCheckSchema = z.object({
  text: z.string().trim().min(1)
})
