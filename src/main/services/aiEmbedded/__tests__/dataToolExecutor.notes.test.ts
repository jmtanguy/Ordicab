import { describe, expect, it, vi } from 'vitest'

import { DataToolExecutor } from '../dataToolExecutor'

// Minimal stubs — only the surfaces the note data tools touch are populated.
function makeExecutor(opts: { searchNotes?: ReturnType<typeof vi.fn>; notes?: unknown[] }): {
  executor: DataToolExecutor
  searchNotes: ReturnType<typeof vi.fn>
  getDossier: ReturnType<typeof vi.fn>
} {
  const searchNotes = opts.searchNotes ?? vi.fn().mockResolvedValue([])
  const getDossier = vi.fn().mockResolvedValue({
    id: 'dos1',
    name: 'Dupont',
    billingItems: [],
    notes: opts.notes ?? []
  })
  const noop = vi.fn()
  const executor = new DataToolExecutor({
    dossierId: 'dos1',
    dossiers: [
      {
        slug: 'dos1',
        uuid: 'uuid-dos1',
        name: 'Dupont',
        status: 'active',
        type: 'contentieux',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-01-01T00:00:00.000Z',
        nextUpcomingKeyDate: null,
        nextUpcomingKeyDateLabel: null
      }
    ],
    contactService: { list: noop, upsert: noop, delete: noop } as never,
    templateService: {
      list: noop,
      getContent: noop,
      create: noop,
      update: noop,
      delete: noop
    } as never,
    documentService: {} as never,
    dossierService: { getDossier, searchNotes } as never,
    invoiceService: { list: noop, get: noop } as never,
    entityProfile: null
  })
  return { executor, searchNotes, getDossier }
}

describe('note_search executor', () => {
  it('lists all notes (no query) and surfaces kind/status/truncated', async () => {
    const searchNotes = vi.fn().mockResolvedValue([
      {
        noteUuid: 'n1',
        title: 'Idée pinnée',
        snippet: 'court',
        score: 1,
        matchKind: 'keyword',
        kind: 'idea',
        truncated: false
      },
      {
        noteUuid: 'n2',
        title: 'Note longue',
        snippet: 'début seulement',
        score: 1,
        matchKind: 'semantic',
        kind: 'note',
        truncated: true
      }
    ])
    const { executor } = makeExecutor({ searchNotes })

    const raw = await executor.execute('note_search', { dossierId: 'dos1' })
    const parsed = JSON.parse(raw)

    // Empty/omitted query is passed through verbatim (the service lists all).
    expect(searchNotes).toHaveBeenCalledWith({
      dossierId: 'dos1',
      query: '',
      kind: undefined,
      status: undefined
    })
    // `status: undefined` is dropped by JSON serialization, so it is absent here.
    expect(parsed.notes).toEqual([
      {
        noteUuid: 'n1',
        title: 'Idée pinnée',
        kind: 'idea',
        excerpt: 'court',
        truncated: false,
        matchType: 'exact'
      },
      {
        noteUuid: 'n2',
        title: 'Note longue',
        kind: 'note',
        excerpt: 'début seulement',
        truncated: true,
        matchType: 'semantic'
      }
    ])
  })
})

describe('note_get executor', () => {
  it('returns the full note content by id', async () => {
    const longContent = 'a'.repeat(400)
    const { executor, getDossier } = makeExecutor({
      notes: [
        {
          uuid: 'n2',
          dossierId: 'dos1',
          title: 'Note longue',
          content: longContent,
          kind: 'note',
          status: undefined,
          tags: ['stratégie'],
          pinned: true,
          createdAt: '2026-03-21T09:00:00.000Z',
          updatedAt: '2026-03-21T09:00:00.000Z'
        }
      ]
    })

    const raw = await executor.execute('note_get', { noteUuid: 'n2', dossierId: 'dos1' })
    const parsed = JSON.parse(raw)

    expect(getDossier).toHaveBeenCalledWith({ dossierId: 'dos1' })
    expect(parsed.note).toMatchObject({
      noteUuid: 'n2',
      title: 'Note longue',
      content: longContent,
      kind: 'note',
      tags: ['stratégie'],
      pinned: true
    })
    expect(parsed.note.content).toHaveLength(400)
  })

  it('errors when noteUuid is missing or unknown', async () => {
    const { executor } = makeExecutor({ notes: [] })

    const missing = JSON.parse(await executor.execute('note_get', { dossierId: 'dos1' }))
    expect(missing.error).toMatch(/noteUuid is required/)

    const unknown = JSON.parse(
      await executor.execute('note_get', { noteUuid: 'nope', dossierId: 'dos1' })
    )
    expect(unknown.error).toMatch(/Note not found/)
  })
})
