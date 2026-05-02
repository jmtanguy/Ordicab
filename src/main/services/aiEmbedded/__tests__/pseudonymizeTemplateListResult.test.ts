import { describe, expect, it } from 'vitest'

import { pseudonymizeTemplateListResultAsync } from '../dataToolExecutor'

describe('pseudonymizeTemplateListResultAsync', () => {
  it('keeps the structural macros array verbatim while pseudonymizing human-readable fields', async () => {
    const pseudonymize = async (s: string): Promise<string> =>
      s === 'Modèle Conseil Pelican' ? '[[custom.dossier_1]] `Cabinet Acme`' : s

    const input = JSON.stringify({
      templates: [
        {
          id: 'tpl-1',
          name: 'Modèle Conseil Pelican',
          description: 'Lettre de renvoi',
          macros: ['dossier.keyDate.audience.long', 'dossier.keyDate.renvoi.long']
        }
      ]
    })

    const result = await pseudonymizeTemplateListResultAsync(input, pseudonymize)
    const parsed = JSON.parse(result) as {
      templates: Array<{ name: string; macros: string[] }>
    }

    expect(parsed.templates[0]!.name).toBe('[[custom.dossier_1]] `Cabinet Acme`')
    expect(parsed.templates[0]!.macros).toEqual([
      'dossier.keyDate.audience.long',
      'dossier.keyDate.renvoi.long'
    ])
  })

  it('returns input unchanged when payload is not the expected shape', async () => {
    const pseudonymize = async (s: string): Promise<string> => `pseudo:${s}`
    const malformed = '{ not: json'
    expect(await pseudonymizeTemplateListResultAsync(malformed, pseudonymize)).toBe(malformed)

    const wrongShape = JSON.stringify({ unrelated: 1 })
    expect(await pseudonymizeTemplateListResultAsync(wrongShape, pseudonymize)).toBe(wrongShape)
  })
})
