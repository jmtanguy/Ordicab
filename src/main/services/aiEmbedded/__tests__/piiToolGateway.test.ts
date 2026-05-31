import { describe, expect, it, vi } from 'vitest'

import { createPiiToolGateway, type PiiHelpers } from '../piiToolGateway'

const fakeHelpers = (): PiiHelpers => ({
  pseudonymizeText: async (s) => `PS(${s})`,
  pseudonymizeAuto: async (s) => `AUTO(${s})`,
  revertPiiText: (s) => s.replace(/\bAlicia\b/g, 'Alice'),
  revertPiiJson: <T>(obj: T): T => {
    const json = JSON.stringify(obj).replace(/\bAlicia\b/g, 'Alice')
    return JSON.parse(json) as T
  }
})

describe('piiToolGateway', () => {
  describe('with PII disabled', () => {
    it('passes args and results through unchanged', async () => {
      const dataExec = { execute: vi.fn(async () => 'raw-data-result') }
      const actionExec = { execute: vi.fn(async () => 'raw-action-result') }
      const gateway = createPiiToolGateway(null, dataExec, actionExec)

      const data = await gateway.executeDataTool('document_list', { dossierId: 'd1' })
      const action = await gateway.executeActionTool('contact_create', { firstName: 'Bob' })

      expect(data).toBe('raw-data-result')
      expect(action).toBe('raw-action-result')
      expect(dataExec.execute).toHaveBeenCalledWith('document_list', { dossierId: 'd1' })
      expect(actionExec.execute).toHaveBeenCalledWith('contact_create', { firstName: 'Bob' })
    })
  })

  describe('with PII enabled', () => {
    it('reverts data tool args before executing and pseudonymizes the result', async () => {
      const dataExec = {
        execute: vi.fn(async (_name: string, args: Record<string, unknown>) =>
          JSON.stringify({ echo: args })
        )
      }
      const actionExec = { execute: vi.fn(async () => '{}') }
      const gateway = createPiiToolGateway(fakeHelpers(), dataExec, actionExec)

      // contact_lookup is not in the dispatch table → falls through to pseudonymizeAuto
      const result = await gateway.executeDataTool('contact_lookup', { name: 'Alicia' })

      expect(dataExec.execute).toHaveBeenCalledWith('contact_lookup', { name: 'Alice' })
      expect(result).toMatch(/^AUTO\(/)
    })

    it('routes document_list through the document-tool pseudonymizer', async () => {
      const docResult = JSON.stringify({
        documents: [{ documentId: 'doc-1', filename: 'plaidoirie.pdf', tags: ['urgent'] }]
      })
      const dataExec = { execute: vi.fn(async () => docResult) }
      const actionExec = { execute: vi.fn(async () => '{}') }
      const gateway = createPiiToolGateway(fakeHelpers(), dataExec, actionExec)

      const result = await gateway.executeDataTool('document_list', {})
      const parsed = JSON.parse(result) as {
        documents: Array<{ documentId: string; filename: string }>
      }
      const [first] = parsed.documents

      // Structural id round-trips verbatim, free-text fields are pseudonymized.
      expect(first?.documentId).toBe('doc-1')
      expect(first?.filename).toBe('PS(plaidoirie.pdf)')
    })

    it('passes managed_fields_get through verbatim (allowlisted labels)', async () => {
      const labels = JSON.stringify({ managedFields: { contactRoles: ['avocat'] } })
      const dataExec = { execute: vi.fn(async () => labels) }
      const actionExec = { execute: vi.fn(async () => '{}') }
      const gateway = createPiiToolGateway(fakeHelpers(), dataExec, actionExec)

      const result = await gateway.executeDataTool('managed_fields_get', {})
      expect(result).toBe(labels)
    })

    it('sanitizes contact_update args after PII revert', async () => {
      // The LLM occasionally collapses zip+city. Gateway should split them
      // back so persistence is clean.
      const actionExec = {
        execute: vi.fn(async (_name: string, args: Record<string, unknown>) =>
          JSON.stringify({ feedback: 'ok', entity: args })
        )
      }
      const dataExec = { execute: vi.fn(async () => '{}') }
      const gateway = createPiiToolGateway(fakeHelpers(), dataExec, actionExec)

      await gateway.executeActionTool('contact_update', {
        contactId: 'c1',
        firstName: 'Alicia',
        city: '75001 Paris',
        zipCode: ''
      })

      expect(actionExec.execute).toHaveBeenCalledWith('contact_update', {
        contactId: 'c1',
        firstName: 'Alice',
        city: 'Paris',
        zipCode: '75001'
      })
    })

    it('only pseudonymizes feedback for batchable action tools, leaving structural fields intact', async () => {
      const actionExec = {
        execute: vi.fn(async () =>
          JSON.stringify({
            success: true,
            contactId: 'contact-uuid-123',
            feedback: 'Contact créé.'
          })
        )
      }
      const dataExec = { execute: vi.fn(async () => '{}') }
      const gateway = createPiiToolGateway(fakeHelpers(), dataExec, actionExec)

      const result = await gateway.executeActionTool('contact_create', { firstName: 'Bob' })
      const parsed = JSON.parse(result) as {
        success: boolean
        contactId: string
        feedback: string
      }

      expect(parsed.success).toBe(true)
      expect(parsed.contactId).toBe('contact-uuid-123')
      expect(parsed.feedback).toBe('PS(Contact créé.)')
    })
  })
})
