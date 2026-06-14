import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  mergeMappingEntries,
  readDossierPiiMapping,
  writeDossierPiiMapping
} from '../piiMappingStore'
import { getDossierPiiMappingPath } from '../../../ordicab/ordicabPaths'

let dossierPath: string

beforeEach(async () => {
  dossierPath = await mkdtemp(join(tmpdir(), 'pii-mapping-store-'))
})

afterEach(async () => {
  await rm(dossierPath, { recursive: true, force: true })
})

describe('piiMappingStore', () => {
  it('round-trips entries through write and read', async () => {
    const entries = [
      { original: 'Jean', markerPath: 'contact.client.firstName', fakeValue: 'Camille' },
      { original: 'Martin', markerPath: 'contact.client.lastName', fakeValue: 'Dupont' }
    ]

    await writeDossierPiiMapping(dossierPath, entries)
    expect(await readDossierPiiMapping(dossierPath)).toEqual(entries)

    const raw = JSON.parse(await readFile(getDossierPiiMappingPath(dossierPath), 'utf8'))
    expect(raw.version).toBe(1)
    expect(typeof raw.updatedAt).toBe('string')
  })

  it('returns [] when the file is missing or malformed', async () => {
    expect(await readDossierPiiMapping(dossierPath)).toEqual([])

    const mappingPath = getDossierPiiMappingPath(dossierPath)
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await writeFile(mappingPath, 'not-json', 'utf8')
    expect(await readDossierPiiMapping(dossierPath)).toEqual([])

    await writeFile(mappingPath, JSON.stringify({ version: 1, entries: 'nope' }), 'utf8')
    expect(await readDossierPiiMapping(dossierPath)).toEqual([])
  })

  it('drops malformed entries while keeping valid ones', async () => {
    await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
    await writeFile(
      getDossierPiiMappingPath(dossierPath),
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { original: 'Jean', markerPath: 'name_1', fakeValue: 'Paul' },
          { original: 42, markerPath: 'name_2', fakeValue: 'Marc' },
          null
        ]
      }),
      'utf8'
    )

    expect(await readDossierPiiMapping(dossierPath)).toEqual([
      { original: 'Jean', markerPath: 'name_1', fakeValue: 'Paul' }
    ])
  })

  it('mergeMappingEntries dedupes exact triples and keeps both sides otherwise', () => {
    const base = [
      { original: 'Jean', markerPath: 'contact.client.firstName', fakeValue: 'Camille' },
      { original: 'Lyon', markerPath: 'city_1', fakeValue: 'Nantes' }
    ]
    const next = [
      // exact duplicate of base[0]
      { original: 'Jean', markerPath: 'contact.client.firstName', fakeValue: 'Camille' },
      { original: 'Martin', markerPath: 'contact.client.lastName', fakeValue: 'Dupont' }
    ]

    const merged = mergeMappingEntries(base, next)
    expect(merged).toHaveLength(3)
    expect(merged.filter((e) => e.original === 'Jean')).toHaveLength(1)
  })

  it('mergeMappingEntries skips incomplete entries and caps growth', () => {
    const merged = mergeMappingEntries(
      [{ original: '', markerPath: 'name_1', fakeValue: 'Paul' }],
      [{ original: 'Jean', markerPath: '', fakeValue: 'Paul' }]
    )
    expect(merged).toEqual([])

    const many = Array.from({ length: 10_050 }, (_, i) => ({
      original: `original-${i}`,
      markerPath: `name_${i}`,
      fakeValue: `fake-${i}`
    }))
    expect(mergeMappingEntries(many, [])).toHaveLength(10_000)
  })
})
