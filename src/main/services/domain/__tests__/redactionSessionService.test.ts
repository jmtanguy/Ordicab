/**
 * Tests for redactionSessionService — journal fold, undo/redo replay,
 * decisions, commit modes and crash resume.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import type { DocumentRecord } from '@shared/domain/document'
import {
  buildRedactionConversationId,
  createRedactionSessionService,
  parseRedactionConversationId,
  type RedactionSessionService
} from '../redactionSessionService'
import { readDocumentXml } from '../documentAugmentService'
import { buildTestDocx } from './docxFixture'

const DOSSIER_ID = 'dossier-test'

function makeService(
  dossierRoot: string,
  documents: DocumentRecord[] = []
): RedactionSessionService {
  return createRedactionSessionService({
    documentService: {
      resolveRegisteredDossierRoot: async () => dossierRoot,
      listDocuments: async () => documents
    },
    generateService: {
      generateDocument: async (input) => {
        const buffer = buildTestDocx(['Généré depuis le modèle.'])
        await writeFile(input.outputPath!, buffer)
        return { outputPath: input.outputPath! }
      }
    },
    entityService: {
      get: async () => ({ firmName: 'Cabinet Test', firstName: 'Jeanne', lastName: 'Avocate' }),
      getDefaultTemplatePath: async () => join(dossierRoot, 'cabinet-default.docx')
    }
  })
}

function docRecord(filename: string): DocumentRecord {
  return {
    // Matches the real DocumentRecord shape: `path` is dossier-RELATIVE
    // (documentService fills it from relativePath), never absolute.
    path: filename,
    uuid: randomUUID(),
    dossierId: DOSSIER_ID,
    filename,
    byteLength: 0,
    relativePath: filename,
    modifiedAt: new Date().toISOString(),
    tags: [],
    textExtraction: 'none'
  } as unknown as DocumentRecord
}

describe('redactionSessionService', () => {
  let dossierRoot: string
  let service: RedactionSessionService

  beforeEach(async () => {
    dossierRoot = join(tmpdir(), `redaction-test-${randomUUID()}`)
    await mkdir(dossierRoot, { recursive: true })
    service = makeService(dossierRoot)
  })

  describe('createSession', () => {
    it('creates a blank session with base/current/session.json on disk', async () => {
      const snapshot = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Conclusions Dupont',
        docKind: 'conclusions',
        source: { type: 'blank' }
      })

      expect(snapshot.session.sessionId).toHaveLength(8)
      expect(snapshot.session.status).toBe('active')
      expect(snapshot.session.saveMode).toBe('new_file')
      expect(snapshot.session.targetFilename).toBe('Conclusions Dupont.docx')
      expect(snapshot.canUndo).toBe(false)
      expect(snapshot.canRedo).toBe(false)
      expect(snapshot.previewDataUrl).toMatch(/^data:application\/vnd\.openxml/)

      const dir = join(dossierRoot, '.ordicab', 'redaction', snapshot.session.sessionId)
      const files = await readdir(dir)
      expect(files.sort()).toEqual(['base.docx', 'current.docx', 'session.json'])
    })

    it('creates a session from the entity default template', async () => {
      await writeFile(
        join(dossierRoot, 'cabinet-default.docx'),
        buildTestDocx(['En-tête cabinet.'])
      )
      const snapshot = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Courrier',
        docKind: 'courrier',
        source: { type: 'entity_default' }
      })
      expect(snapshot.paragraphs.map((p) => p.text)).toContain('En-tête cabinet.')
    })

    it('creates a session from a template via generateService', async () => {
      const snapshot = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Depuis modèle',
        docKind: 'autre',
        source: { type: 'template', templateUuid: 'tpl-1' }
      })
      expect(snapshot.paragraphs.map((p) => p.text)).toContain('Généré depuis le modèle.')
    })

    it('keeps unresolved template routines visible as {{tag}} instead of failing', async () => {
      const generateDocument = vi.fn(
        async (input: {
          outputPath?: string
          tagOverrides?: Record<string, string>
        }): Promise<{ outputPath: string }> => {
          // generateService reports unresolved paths in their French form.
          if (!input.tagOverrides?.['date.audience.texte']) {
            const { GenerateServiceError } = await import('../generateService')
            const { IpcErrorCode } = await import('@shared/types')
            throw new GenerateServiceError(
              IpcErrorCode.VALIDATION_FAILED,
              'Document generation failed: some template fields could not be resolved.',
              ['date.audience.texte', 'contact.juridiction.nomAffiche']
            )
          }
          await writeFile(
            input.outputPath!,
            buildTestDocx([
              `Audience : ${input.tagOverrides['date.audience.texte']}`,
              `Juridiction : ${input.tagOverrides['contact.juridiction.nomAffiche']}`
            ])
          )
          return { outputPath: input.outputPath! }
        }
      )
      service = createRedactionSessionService({
        documentService: {
          resolveRegisteredDossierRoot: async () => dossierRoot,
          listDocuments: async () => []
        },
        generateService: { generateDocument },
        entityService: {
          get: async () => ({ firmName: 'Cabinet Test' }),
          getDefaultTemplatePath: async () => join(dossierRoot, 'cabinet-default.docx')
        }
      })

      const snapshot = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Avec routines manquantes',
        docKind: 'conclusions',
        source: { type: 'template', templateUuid: 'tpl-1' }
      })

      expect(generateDocument).toHaveBeenCalledTimes(2)
      const texts = snapshot.paragraphs.map((p) => p.text)
      // Placeholders are localized to their French routine form before being
      // written back into the drafted document.
      expect(texts).toContain('Audience : {{date.audience.texte}}')
      expect(texts).toContain('Juridiction : {{contact.juridiction.nomAffiche}}')
    })

    it('copy keeps new_file mode; edit_existing switches to replace_original', async () => {
      await writeFile(join(dossierRoot, 'existant.docx'), buildTestDocx(['Contenu existant.']))
      const record = docRecord('existant.docx')
      service = makeService(dossierRoot, [record])

      const copied = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Copie',
        docKind: 'autre',
        source: { type: 'copy', sourceDocumentUuid: record.uuid }
      })
      expect(copied.session.saveMode).toBe('new_file')
      expect(copied.session.originalDocRelPath).toBeUndefined()

      const editing = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Édition',
        docKind: 'autre',
        source: { type: 'edit_existing', sourceDocumentUuid: record.uuid }
      })
      expect(editing.session.saveMode).toBe('replace_original')
      expect(editing.session.originalDocRelPath).toBe('existant.docx')
      expect(editing.paragraphs.map((p) => p.text)).toContain('Contenu existant.')
    })

    it('rejects non-docx source documents', async () => {
      await writeFile(join(dossierRoot, 'scan.pdf'), 'not a docx')
      const record = docRecord('scan.pdf')
      service = makeService(dossierRoot, [record])

      await expect(
        service.createSession({
          dossierId: DOSSIER_ID,
          title: 'PDF',
          docKind: 'autre',
          source: { type: 'edit_existing', sourceDocumentUuid: record.uuid }
        })
      ).rejects.toThrow(/\.docx/)
    })
  })

  describe('applyOps / manualEdit', () => {
    async function createFromDoc(paragraphs: string[]): Promise<string> {
      await writeFile(join(dossierRoot, 'doc.docx'), buildTestDocx(paragraphs))
      const record = docRecord('doc.docx')
      service = makeService(dossierRoot, [record])
      const snapshot = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Doc',
        docKind: 'conclusions',
        source: { type: 'copy', sourceDocumentUuid: record.uuid }
      })
      return snapshot.session.sessionId
    }

    it('applies AI operations as pending tracked ops', async () => {
      const sessionId = await createFromDoc(['Intro.', 'Corps.'])
      const snapshot = await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'replace', index: 1, text: 'Corps révisé.', rationale: 'Clarté' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )

      expect(snapshot.pendingOps).toHaveLength(1)
      expect(snapshot.pendingOps[0]!).toMatchObject({
        opId: 'op1',
        decision: 'keep_tracked',
        authorKind: 'ai',
        rationale: 'Clarté'
      })
      expect(snapshot.canUndo).toBe(true)
      expect(snapshot.paragraphs.map((p) => p.text).join(' ')).toContain('Corps révisé.')
      expect(snapshot.diffBlocks.some((b) => b.type !== 'unchanged')).toBe(true)
    })

    it('manualEdit records the lawyer as revision author', async () => {
      const sessionId = await createFromDoc(['Texte initial.'])
      await service.manualEdit(DOSSIER_ID, sessionId, [
        { id: 'op1', op: 'replace', index: 0, text: 'Texte modifié à la main.' }
      ])

      const currentPath = join(dossierRoot, '.ordicab', 'redaction', sessionId, 'current.docx')
      const xml = readDocumentXml(await readFile(currentPath))
      expect(xml).toContain('w:author="Jeanne Avocate"')
    })

    it('supports a second AI turn on the already-revised document', async () => {
      const sessionId = await createFromDoc(['Un.', 'Deux.'])
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'replace', index: 0, text: 'Un révisé.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )
      const indexed = await service.getIndexedText(DOSSIER_ID, sessionId)
      // The AI sees the current (revised) state
      expect(indexed.previewText).toContain('Un révisé.')

      const snapshot = await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op2', op: 'insert_after', anchorIndex: 1, text: 'Trois.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )
      expect(snapshot.pendingOps).toHaveLength(2)
      expect(snapshot.paragraphs.map((p) => p.text)).toContain('Trois.')
    })

    it('rejects out-of-range and duplicate targets', async () => {
      const sessionId = await createFromDoc(['Seul.'])
      await expect(
        service.applyOps(
          DOSSIER_ID,
          sessionId,
          [{ id: 'x', op: 'replace', index: 4, text: 'Hors limite.' }],
          {
            author: 'IA',
            authorKind: 'ai'
          }
        )
      ).rejects.toThrow(/paragraph 4/)

      await expect(
        service.applyOps(
          DOSSIER_ID,
          sessionId,
          [
            { id: 'a', op: 'replace', index: 0, text: 'V1.' },
            { id: 'b', op: 'delete', index: 0 }
          ],
          { author: 'IA', authorKind: 'ai' }
        )
      ).rejects.toThrow(/same batch/)
    })

    it('serializes concurrent edits instead of losing one journal event', async () => {
      const sessionId = await createFromDoc(['Base.'])
      await Promise.all([
        service.applyOps(
          DOSSIER_ID,
          sessionId,
          [{ id: 'first', op: 'insert_after', anchorIndex: 0, text: 'Premier ajout.' }],
          { author: 'IA', authorKind: 'ai' }
        ),
        service.applyOps(
          DOSSIER_ID,
          sessionId,
          [{ id: 'second', op: 'insert_after', anchorIndex: 0, text: 'Second ajout.' }],
          { author: 'IA', authorKind: 'ai' }
        )
      ])

      const snapshot = await service.getSnapshot(DOSSIER_ID, sessionId)
      expect(snapshot.pendingOps.map((op) => op.opId).sort()).toEqual(['first', 'second'])
    })

    it('rejects an unsafe session id before it can be used as a path', async () => {
      await expect(service.getSnapshot(DOSSIER_ID, '../..')).rejects.toThrow(
        /Invalid drafting session id/
      )
    })
  })

  describe('decisions, undo/redo', () => {
    async function seedSession(): Promise<string> {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Brouillon',
        docKind: 'conclusions',
        source: { type: 'blank' }
      })
      const sessionId = created.session.sessionId
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Premier ajout.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )
      return sessionId
    }

    it('decideOp accept flattens the revision; undo restores it as pending', async () => {
      const sessionId = await seedSession()

      const accepted = await service.decideOp(DOSSIER_ID, sessionId, 'op1', 'accept')
      expect(accepted.pendingOps[0]!.decision).toBe('accept')
      const currentPath = join(dossierRoot, '.ordicab', 'redaction', sessionId, 'current.docx')
      let xml = readDocumentXml(await readFile(currentPath))
      expect(xml).toContain('Premier ajout.')
      expect(xml).not.toContain('<w:ins')

      const undone = await service.undo(DOSSIER_ID, sessionId)
      expect(undone.pendingOps[0]!.decision).toBe('keep_tracked')
      xml = readDocumentXml(await readFile(currentPath))
      expect(xml).toContain('<w:ins')
    })

    it('decideOp reject removes the insertion; redo re-applies after undo', async () => {
      const sessionId = await seedSession()
      const rejected = await service.decideOp(DOSSIER_ID, sessionId, 'op1', 'reject')
      expect(rejected.paragraphs.map((p) => p.text).join(' ')).not.toContain('Premier ajout.')

      await service.undo(DOSSIER_ID, sessionId)
      const redone = await service.redo(DOSSIER_ID, sessionId)
      expect(redone.paragraphs.map((p) => p.text).join(' ')).not.toContain('Premier ajout.')
      expect(redone.canRedo).toBe(false)
    })

    it('undo then a new mutation truncates the redo tail', async () => {
      const sessionId = await seedSession()
      await service.undo(DOSSIER_ID, sessionId)
      const snapshot = await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op2', op: 'insert_after', anchorIndex: 0, text: 'Autre ajout.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )
      expect(snapshot.canRedo).toBe(false)
      expect(snapshot.session.events).toHaveLength(1)
      expect(snapshot.pendingOps.map((op) => op.opId)).toEqual(['op2'])
    })

    it('decideOp on an unknown op fails', async () => {
      const sessionId = await seedSession()
      await expect(service.decideOp(DOSSIER_ID, sessionId, 'nope', 'accept')).rejects.toThrow(
        /not found/
      )
    })
  })

  describe('resume & persistence', () => {
    it('a fresh service instance resumes the full session from disk', async () => {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Longue rédaction',
        docKind: 'conclusions',
        source: { type: 'blank' }
      })
      const sessionId = created.session.sessionId
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Travail en cours.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )
      await service.syncChat(DOSSIER_ID, sessionId, [
        { id: 'm1', role: 'user', text: 'Ajoute une intro', createdAt: new Date().toISOString() }
      ])
      await service.persistConversation(DOSSIER_ID, sessionId, [{ role: 'user' }], [{ token: 'x' }])

      // Simulate an app restart
      const fresh = makeService(dossierRoot)
      const sessions = await fresh.listSessions(DOSSIER_ID)
      expect(sessions).toHaveLength(1)
      expect(sessions[0]!.status).toBe('active')

      const snapshot = await fresh.getSnapshot(DOSSIER_ID, sessionId)
      expect(snapshot.paragraphs.map((p) => p.text)).toContain('Travail en cours.')
      expect(snapshot.session.chat).toHaveLength(1)
      expect(snapshot.session.runtimeHistory).toHaveLength(1)
      expect(snapshot.session.piiLedger).toHaveLength(1)
      expect(snapshot.canUndo).toBe(true)
    })

    it('rebuilds current.docx from the journal even if the cache is corrupted', async () => {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Crash',
        docKind: 'autre',
        source: { type: 'blank' }
      })
      const sessionId = created.session.sessionId
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Récupéré.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )

      const currentPath = join(dossierRoot, '.ordicab', 'redaction', sessionId, 'current.docx')
      await writeFile(currentPath, 'corrupted')

      const snapshot = await service.getSnapshot(DOSSIER_ID, sessionId)
      expect(snapshot.paragraphs.map((p) => p.text)).toContain('Récupéré.')
      const xml = readDocumentXml(await readFile(currentPath))
      expect(xml).toContain('Récupéré.')
    })
  })

  describe('commit', () => {
    it('new_file keeps pending revisions tracked by default and writes a unique file', async () => {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Conclusions finales',
        docKind: 'conclusions',
        source: { type: 'blank' }
      })
      const sessionId = created.session.sessionId
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Ajout tracké.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )

      const result = await service.commit({ dossierId: DOSSIER_ID, sessionId })
      expect(result.filename).toBe('Conclusions finales.docx')
      const xml = readDocumentXml(await readFile(result.outputPath))
      expect(xml).toContain('<w:ins')
      expect(xml).toContain('Ajout tracké.')

      const sessions = await service.listSessions(DOSSIER_ID)
      expect(sessions[0]!.status).toBe('saved')
    })

    it('finalDecisions accept flattens remaining revisions in the output', async () => {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Propre',
        docKind: 'courrier',
        source: { type: 'blank' }
      })
      const sessionId = created.session.sessionId
      await service.applyOps(
        DOSSIER_ID,
        sessionId,
        [{ id: 'op1', op: 'insert_after', anchorIndex: 0, text: 'Contenu accepté.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )

      const result = await service.commit({
        dossierId: DOSSIER_ID,
        sessionId,
        finalDecisions: { op1: 'accept' }
      })
      const xml = readDocumentXml(await readFile(result.outputPath))
      expect(xml).toContain('Contenu accepté.')
      expect(xml).not.toContain('<w:ins')
    })

    it('replace_original overwrites the source document', async () => {
      await writeFile(join(dossierRoot, 'original.docx'), buildTestDocx(['Version originale.']))
      const record = docRecord('original.docx')
      service = makeService(dossierRoot, [record])

      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Édition sur place',
        docKind: 'autre',
        source: { type: 'edit_existing', sourceDocumentUuid: record.uuid }
      })
      await service.applyOps(
        DOSSIER_ID,
        created.session.sessionId,
        [{ id: 'op1', op: 'replace', index: 0, text: 'Version remplacée.' }],
        { author: 'Ordicab IA', authorKind: 'ai' }
      )

      const result = await service.commit({
        dossierId: DOSSIER_ID,
        sessionId: created.session.sessionId,
        finalDecisions: { op1: 'accept' }
      })
      expect(result.outputPath).toBe(join(dossierRoot, 'original.docx'))
      const xml = readDocumentXml(await readFile(result.outputPath))
      expect(xml).toContain('Version remplacée.')
      expect(xml).not.toContain('Version originale.')
    })

    it('refuses to overwrite an original changed outside the session', async () => {
      await writeFile(join(dossierRoot, 'original.docx'), buildTestDocx(['Version originale.']))
      const record = docRecord('original.docx')
      service = makeService(dossierRoot, [record])
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Édition avec conflit',
        docKind: 'autre',
        source: { type: 'edit_existing', sourceDocumentUuid: record.uuid }
      })

      await writeFile(join(dossierRoot, 'original.docx'), buildTestDocx(['Version externe.']))

      await expect(
        service.commit({ dossierId: DOSSIER_ID, sessionId: created.session.sessionId })
      ).rejects.toThrow(/has changed since this drafting session started/)
      const xml = readDocumentXml(await readFile(join(dossierRoot, 'original.docx')))
      expect(xml).toContain('Version externe.')

      const result = await service.commit({
        dossierId: DOSSIER_ID,
        sessionId: created.session.sessionId,
        forceReplace: true
      })
      expect(result.outputPath).toBe(join(dossierRoot, 'original.docx'))
    })

    it('new_file does not clobber an existing file with the same name', async () => {
      await writeFile(join(dossierRoot, 'Doublon.docx'), buildTestDocx(['Déjà là.']))
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'Doublon',
        docKind: 'autre',
        source: { type: 'blank' }
      })
      const result = await service.commit({
        dossierId: DOSSIER_ID,
        sessionId: created.session.sessionId
      })
      expect(result.filename).toBe('Doublon-2.docx')
    })
  })

  describe('discard', () => {
    it('removes the session directory', async () => {
      const created = await service.createSession({
        dossierId: DOSSIER_ID,
        title: 'À jeter',
        docKind: 'autre',
        source: { type: 'blank' }
      })
      await service.discard(DOSSIER_ID, created.session.sessionId)
      const sessions = await service.listSessions(DOSSIER_ID)
      expect(sessions).toHaveLength(0)
    })
  })
})

describe('redaction conversation ids', () => {
  it('round-trips dossier and session ids, including colons in the slug', () => {
    expect(
      parseRedactionConversationId(buildRedactionConversationId('mon-dossier', 'abc12345'))
    ).toEqual({ dossierId: 'mon-dossier', sessionId: 'abc12345' })
    expect(
      parseRedactionConversationId(buildRedactionConversationId('slug:étrange', 'abc12345'))
    ).toEqual({ dossierId: 'slug:étrange', sessionId: 'abc12345' })
    expect(parseRedactionConversationId('global')).toBeNull()
  })
})
