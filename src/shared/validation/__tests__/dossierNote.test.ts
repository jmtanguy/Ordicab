import { describe, expect, it } from 'vitest'

import {
  dossierNoteDeleteInputSchema,
  dossierNoteIndexSchema,
  dossierNoteSchema,
  dossierNoteUpsertInputSchema
} from '../dossierNote'

describe('dossierNote validation', () => {
  it('accepts a full note record and defaults content to empty', () => {
    const parsed = dossierNoteSchema.parse({
      id: 'note-1',
      dossierId: 'Client Alpha',
      title: 'Vérifier la prescription',
      kind: 'to_verify',
      tags: ['prescription'],
      pinned: true,
      source: 'ai',
      createdAt: '2026-03-21T09:00:00.000Z',
      updatedAt: '2026-03-21T09:00:00.000Z'
    })
    expect(parsed.content).toBe('')
    expect(parsed.kind).toBe('to_verify')
  })

  it('rejects an unknown kind and an empty title', () => {
    expect(() =>
      dossierNoteSchema.parse({
        id: 'note-1',
        dossierId: 'Client Alpha',
        title: 'X',
        kind: 'reminder',
        createdAt: 'a',
        updatedAt: 'a'
      })
    ).toThrow()

    expect(() =>
      dossierNoteUpsertInputSchema.parse({ dossierId: 'Client Alpha', title: '' })
    ).toThrow()
  })

  it('allows the upsert input to omit kind/content (service applies defaults)', () => {
    const parsed = dossierNoteUpsertInputSchema.parse({
      dossierId: 'Client Alpha',
      title: 'Idée'
    })
    expect(parsed.content).toBe('')
    expect(parsed.kind).toBeUndefined()
  })

  it('validates the delete input and the index shape', () => {
    expect(
      dossierNoteDeleteInputSchema.parse({ dossierId: 'Client Alpha', noteId: 'note-1' })
    ).toEqual({ dossierId: 'Client Alpha', noteId: 'note-1' })

    const index = dossierNoteIndexSchema.parse({ updatedAt: '2026-03-21T09:00:00.000Z' })
    expect(index.notes).toEqual([])
  })
})
