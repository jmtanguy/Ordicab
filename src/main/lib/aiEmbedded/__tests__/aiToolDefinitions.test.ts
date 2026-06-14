import { describe, expect, it } from 'vitest'

import { buildDataTools, terminalActionTools } from '../aiToolDefinitions'

describe('aiToolDefinitions', () => {
  it('documents mandatory legal research tools and source links', () => {
    const tools = buildDataTools(async () => '{}') as Record<string, { description?: string }>

    expect(tools.legal_search_legifrance?.description).toContain(
      'Mandatory before answering legal-research questions'
    )
    expect(tools.legal_search_legifrance?.description).toContain(
      'https://www.legifrance.gouv.fr'
    )
    expect(tools.legal_consult_legifrance?.description).toContain('returned `url`')

    expect(tools.legal_search_judilibre?.description).toContain(
      'Mandatory before answering legal-research questions'
    )
    expect(tools.legal_search_judilibre?.description).toContain(
      'https://www.courdecassation.fr/recherche-judilibre'
    )
    expect(tools.legal_consult_judilibre?.description).toContain('returned `url`')
    expect(tools.legal_verify_references?.description).toContain('public source links')
  })

  it('exposes document_relocate path fields matching the internal intent contract', () => {
    const schema = (
      terminalActionTools.document_relocate as unknown as {
        inputSchema: { parse(input: unknown): unknown }
      }
    ).inputSchema

    expect(
      schema.parse({
        documentUuid: 'doc-1',
        dossierId: 'dos1',
        fromDocumentPath: 'old.pdf',
        toDocumentPath: 'new.pdf'
      })
    ).toMatchObject({
      documentUuid: 'doc-1',
      dossierId: 'dos1',
      fromDocumentPath: 'old.pdf',
      toDocumentPath: 'new.pdf'
    })

    expect(() =>
      schema.parse({
        documentUuid: 'doc-1',
        dossierId: 'dos1',
        toDocumentId: 'new.pdf'
      })
    ).toThrow()
  })
})
