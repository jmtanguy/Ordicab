import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ContactRecord, DocumentRecord, DossierDetail } from '@shared/types'

import { createCoworkExportService } from '../coworkExportService'
import {
  getDossierCoworkClaudeMdPath,
  getDossierCoworkDocumentsPath,
  getDossierCoworkResultsPath,
  getDossierCoworkSynthesisPath,
  getDossierPiiMappingPath
} from '../../../lib/ordicab/ordicabPaths'

const DOSSIER_ID = 'dossier-1'

let dossierPath: string

const contacts: ContactRecord[] = [
  {
    uuid: 'c1',
    dossierId: DOSSIER_ID,
    role: 'Client',
    firstName: 'Jean',
    lastName: 'Martinet',
    displayName: 'Jean Martinet',
    email: 'jean.martinet@exemple.fr',
    phone: '06 12 34 56 78',
    addressLine: '12 rue des Lilas',
    zipCode: '69003',
    city: 'Lyon'
  },
  {
    uuid: 'c2',
    dossierId: DOSSIER_ID,
    role: 'Adversaire',
    firstName: 'Sophie',
    lastName: 'Bernardin',
    displayName: 'Sophie Bernardin'
  }
]

const dossierDetail: DossierDetail = {
  slug: DOSSIER_ID,
  uuid: 'uuid-1',
  name: 'Martinet c/ Bernardin',
  type: 'Litige',
  status: 'active',
  updatedAt: '2026-06-01T00:00:00.000Z',
  lastOpenedAt: null,
  nextUpcomingKeyDate: null,
  nextUpcomingKeyDateLabel: null,
  registeredAt: '2026-01-01T00:00:00.000Z',
  information: 'Litige opposant Jean Martinet à Sophie Bernardin.',
  feeAgreements: [],
  billingItems: [],
  keyDates: [
    {
      uuid: 'kd1',
      dossierId: DOSSIER_ID,
      label: 'Audience',
      date: '2026-09-15'
    }
  ],
  keyReferences: [],
  notes: [
    {
      uuid: 'n1',
      dossierId: DOSSIER_ID,
      title: 'Stratégie',
      content: 'Jean Martinet souhaite une médiation.',
      kind: 'note',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z'
    }
  ]
}

const documents: DocumentRecord[] = [
  {
    path: 'Conclusions Martinet.pdf',
    uuid: 'd1',
    dossierId: DOSSIER_ID,
    filename: 'Conclusions Martinet.pdf',
    byteLength: 1000,
    relativePath: 'Conclusions Martinet.pdf',
    modifiedAt: '2026-03-01T00:00:00.000Z',
    tags: [],
    textExtraction: { state: 'extracted', isExtractable: true }
  },
  {
    path: 'photos/constat.jpg',
    uuid: 'd2',
    dossierId: DOSSIER_ID,
    filename: 'constat.jpg',
    byteLength: 5000,
    relativePath: 'photos/constat.jpg',
    modifiedAt: '2026-03-01T00:00:00.000Z',
    tags: [],
    textExtraction: { state: 'not-extractable', isExtractable: false }
  }
]

function createService(): ReturnType<typeof createCoworkExportService> {
  return createCoworkExportService({
    documentService: {
      resolveRegisteredDossierRoot: async () => dossierPath,
      listDocuments: async () => documents,
      extractContent: async ({ documentPath }) => {
        if (documentPath === 'Conclusions Martinet.pdf') {
          return {
            text: 'Conclusions pour Jean Martinet contre Sophie Bernardin, domicilié 12 rue des Lilas, 69003 Lyon.'
          }
        }
        throw new Error('not extractable')
      }
    },
    contactService: { list: async () => contacts },
    dossierService: {
      getDossier: async () => dossierDetail,
      listRegisteredDossiers: async () => []
    },
    templateService: { list: async () => [] },
    loadEntityProfile: async () => null,
    localeService: { getLocale: () => 'fr' },
    stateFilePath: join(dossierPath, 'app-state.json'),
    nerModelPath: null
  })
}

async function readAllExportedText(): Promise<string> {
  const parts: string[] = [
    await readFile(getDossierCoworkSynthesisPath(dossierPath), 'utf8'),
    await readFile(getDossierCoworkClaudeMdPath(dossierPath), 'utf8')
  ]
  const documentsDir = getDossierCoworkDocumentsPath(dossierPath)
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else parts.push(entry.name, await readFile(path, 'utf8'))
    }
  }
  await walk(documentsDir)
  return parts.join('\n')
}

beforeEach(async () => {
  dossierPath = await mkdtemp(join(tmpdir(), 'cowork-export-'))
})

afterEach(async () => {
  await rm(dossierPath, { recursive: true, force: true })
})

describe('coworkExportService', () => {
  it('exports a fully pseudonymized workspace and persists the mapping', async () => {
    const service = createService()
    const result = await service.exportDossier({ dossierId: DOSSIER_ID })

    expect(result.documentCount).toBe(1)
    expect(result.unextractedCount).toBe(1)
    expect(result.noteCount).toBe(1)

    const exported = await readAllExportedText()
    // No original PII string may survive anywhere in the export.
    for (const original of [
      'Jean',
      'Martinet',
      'Sophie',
      'Bernardin',
      'jean.martinet@exemple.fr',
      '06 12 34 56 78',
      '12 rue des Lilas',
      '69003',
      'Lyon'
    ]) {
      expect(exported).not.toContain(original)
    }

    // The persisted mapping lives in .ordicab/, not inside Cowork/.
    const mapping = JSON.parse(await readFile(getDossierPiiMappingPath(dossierPath), 'utf8'))
    expect(mapping.entries.length).toBeGreaterThan(0)
    const clientFirst = mapping.entries.find(
      (entry: { markerPath: string }) => entry.markerPath === 'contact.client.firstName'
    )
    expect(clientFirst.original).toBe('Jean')

    // resultats/ exists and is empty, ready for Claude's deliverables.
    expect(await readdir(getDossierCoworkResultsPath(dossierPath))).toEqual([])
  })

  it('keeps identical fakes across re-exports and preserves resultats/', async () => {
    const service = createService()
    await service.exportDossier({ dossierId: DOSSIER_ID })
    const firstSynthesis = await readFile(getDossierCoworkSynthesisPath(dossierPath), 'utf8')

    const draftPath = join(getDossierCoworkResultsPath(dossierPath), 'brouillon.md')
    await writeFile(draftPath, 'Travail en cours', 'utf8')

    await service.exportDossier({ dossierId: DOSSIER_ID })
    const secondSynthesis = await readFile(getDossierCoworkSynthesisPath(dossierPath), 'utf8')

    expect(secondSynthesis).toBe(firstSynthesis)
    expect(await readFile(draftPath, 'utf8')).toBe('Travail en cours')
  })

  it('reimports markdown results with original identities restored', async () => {
    const service = createService()
    await service.exportDossier({ dossierId: DOSSIER_ID })

    const mapping = JSON.parse(await readFile(getDossierPiiMappingPath(dossierPath), 'utf8'))
    const fakeFor = (markerPath: string): string =>
      mapping.entries.find((entry: { markerPath: string }) => entry.markerPath === markerPath)
        .fakeValue
    const fakeFirst = fakeFor('contact.client.firstName')
    const fakeLast = fakeFor('contact.client.lastName')

    const resultsPath = getDossierCoworkResultsPath(dossierPath)
    await writeFile(
      join(resultsPath, `analyse-${fakeLast}.md`),
      `# Analyse\n\n${fakeFirst} ${fakeLast} dispose d'un délai de prescription.`,
      'utf8'
    )
    await writeFile(join(resultsPath, 'tableau.xlsx'), 'binary', 'utf8')

    const result = await service.reimportResults({ dossierId: DOSSIER_ID })

    expect(result.manual).toEqual([{ filename: 'tableau.xlsx' }])
    expect(result.imported).toHaveLength(1)
    expect(result.imported[0]!.filename).toBe('analyse-Martinet.md')

    const reimported = await readFile(
      join(dossierPath, 'Résultats Cowork', 'analyse-Martinet.md'),
      'utf8'
    )
    expect(reimported).toContain('Jean Martinet')
    expect(reimported).not.toContain(fakeFirst)

    // Source moved to importes/, xlsx left in place.
    const remaining = await readdir(resultsPath)
    expect(remaining.sort()).toEqual(['importes', 'tableau.xlsx'])
    expect(await readdir(join(resultsPath, 'importes'))).toEqual([`analyse-${fakeLast}.md`])

    // Status reflects the leftover manual file only.
    const status = await service.getStatus({ dossierId: DOSSIER_ID })
    expect(status.pendingResultCount).toBe(1)
    expect(status.lastExportAt).not.toBeNull()
  })

  it('fails reimport with a typed error when no mapping exists', async () => {
    const service = createService()
    await mkdir(getDossierCoworkResultsPath(dossierPath), { recursive: true })
    await expect(service.reimportResults({ dossierId: DOSSIER_ID })).rejects.toThrow(
      /No PII mapping/
    )
  })
})
