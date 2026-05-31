/**
 * Single source of truth for the contact/entity gender union.
 *
 * Previously the `'M' | 'F' | 'N'` union was hand-written in five places
 * (contactSalutation, ContactRecord, ContactUpsertInput, EntityProfile, and two
 * Zod schemas), so adding a value meant editing all of them. Everything now
 * derives from `GENDER_VALUES`.
 *
 * M = masculine, F = feminine, N = neutral/unspecified.
 */
export const GENDER_VALUES = ['M', 'F', 'N'] as const

export type Gender = (typeof GENDER_VALUES)[number]
