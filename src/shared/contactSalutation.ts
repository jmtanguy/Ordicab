export type ContactGender = 'M' | 'F' | 'N' | undefined

export interface SalutationFields {
  salutation: string
  salutationFull: string
  dear: string
}

export function buildSalutationFields(
  gender: ContactGender,
  lastName: string | undefined,
  displayName: string
): SalutationFields {
  if (gender === 'M') {
    return {
      salutation: 'Monsieur',
      salutationFull: `Monsieur${lastName ? ` ${lastName}` : ''}`,
      dear: 'Cher Monsieur'
    }
  }

  if (gender === 'F') {
    return {
      salutation: 'Madame',
      salutationFull: `Madame${lastName ? ` ${lastName}` : ''}`,
      dear: 'Chère Madame'
    }
  }

  return {
    salutation: '',
    salutationFull: displayName,
    dear: 'Madame, Monsieur,'
  }
}
