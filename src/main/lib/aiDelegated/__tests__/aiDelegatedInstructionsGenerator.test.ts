import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContactRecord, DossierDetail, EntityProfile, TemplateRecord } from '@shared/types'

import {
  getDomainClaudeMdPath,
  getDomainEntityPath,
  getDomainTemplateRoutinesPath,
  getDomainTemplatesPath,
  getDossierClaudeMdPath,
  getDossierContactsPath,
  getDossierMetadataPath
} from '../../../lib/ordicab/ordicabPaths'
import { buildDelegatedInstructions } from '../../../lib/aiDelegated/aiDelegatedInstructionsContent'
import { createInstructionsGenerator } from '../aiDelegatedInstructionsGenerator'

const tempDirs: string[] = []
const delegatedOriginDeviceStore = {
  getOriginDeviceId: vi.fn(async () => 'device-origin-123')
}

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-claude-md-generator-'))
  tempDirs.push(dir)
  return dir
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeFixturePaths(content: string, domainPath: string): string {
  return content.replaceAll(domainPath, '<DOMAIN_PATH>')
}

function createDossierDetail(overrides: Partial<DossierDetail> = {}): DossierDetail {
  return {
    id: 'Client Alpha',
    uuid: 'dossier-uuid-1',
    name: 'Client Alpha',
    status: 'active',
    type: 'Civil litigation',
    updatedAt: '2026-03-14T10:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: '2026-04-01',
    nextUpcomingKeyDateLabel: 'Hearing',
    registeredAt: '2026-03-01T09:00:00.000Z',
    keyDates: [
      {
        id: 'kd-1',
        dossierId: 'Client Alpha',
        label: 'Hearing',
        date: '2026-04-01',
        note: 'Primary hearing'
      }
    ],
    keyReferences: [
      {
        id: 'kr-1',
        dossierId: 'Client Alpha',
        label: 'Case number',
        value: 'RG 26/001',
        note: 'Tribunal reference'
      }
    ],
    ...overrides
  }
}

function createContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    uuid: 'contact-1',
    dossierId: 'Client Alpha',
    firstName: 'Camille',
    lastName: 'Martin',
    role: 'Client',
    institution: 'Martin Conseil',
    addressLine: '12 rue du Palais',
    city: 'Paris',
    phone: '+33 1 23 45 67 89',
    email: 'camille.martin@example.com',
    ...overrides
  }
}

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl-1',
    name: 'Mise en demeure',
    content: 'Bonjour',
    tags: [],
    hasDocxSource: false,
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides,
    macros: overrides.macros ?? []
  }
}

function createEntity(overrides: Partial<EntityProfile> = {}): EntityProfile {
  return {
    firmName: 'Cabinet Martin',
    profession: 'lawyer',
    title: 'Me',
    firstName: 'Camille',
    lastName: 'Martin',
    address: '1 avenue de Paris',
    vatNumber: 'FR00123456789',
    phone: '+33 1 11 11 11 11',
    email: 'contact@cabinet-martin.fr',
    ...overrides
  }
}

async function createFixture(): Promise<{
  domainPath: string
  dossierPath: string
}> {
  const domainPath = await createTempDir()
  const dossierPath = join(domainPath, 'Client Alpha')

  await mkdir(join(domainPath, '.ordicab'), { recursive: true })
  await mkdir(join(dossierPath, '.ordicab'), { recursive: true })
  await writeJson(join(domainPath, '.ordicab', 'registry.json'), {
    dossiers: [
      {
        id: 'Client Alpha',
        name: 'Client Alpha',
        registeredAt: '2026-03-01T09:00:00.000Z'
      }
    ]
  })
  await writeJson(join(domainPath, '.ordicab', 'entity.json'), createEntity())
  await writeJson(join(domainPath, '.ordicab', 'templates.json'), [createTemplate()])
  await writeJson(join(dossierPath, '.ordicab', 'dossier.json'), {
    ...createDossierDetail(),
    documents: []
  })
  await writeJson(join(dossierPath, '.ordicab', 'contacts.json'), [createContact()])

  return {
    domainPath,
    dossierPath
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('InstructionsGenerator', () => {
  describe('buildDelegatedInstructions', () => {
    it('renders domain-scope and dossier-scope instructions with correct paths', async () => {
      const domainPath = await createTempDir()
      const dossierAlphaPath = join(domainPath, 'Client Alpha')
      const dossierBetaPath = join(domainPath, 'Client Beta')

      // domain scope
      const domainContent = buildDelegatedInstructions({
        domainPath,
        scope: 'domain',
        originDeviceId: 'device-origin-123',
        dossiers: [
          { id: 'alpha', folderName: 'Client Alpha', folderPath: dossierAlphaPath },
          { id: 'beta', folderName: 'Client Beta', folderPath: dossierBetaPath }
        ]
      })

      expect(domainContent).toContain('## Delegated Instructions')
      expect(domainContent).toContain('### How to use these instructions')
      expect(domainContent).toContain('### Intent Workflow')
      expect(domainContent).toContain('### Device-Scoped Responses')
      expect(domainContent).toContain('### Response Workflow')
      expect(domainContent).toContain('### Procedure: "Organize the dossier"')
      expect(domainContent).toContain('### Supported Intent Actions')
      expect(domainContent).toContain('### Intent File Format')
      expect(domainContent).toContain('### Action Payload Examples')
      expect(domainContent).toContain('### File Paths')
      expect(domainContent).toContain(
        'Treat the process as incremental if the dossier was already organized: add only new elements and fill only missing details, without duplicating existing contacts, key dates, document summaries, or tags.'
      )
      expect(domainContent).toContain(
        'For each relevant document, index it: extract its text content, then persist a concise summary and useful tags with `document.saveMetadata`.'
      )
      expect(domainContent).toContain(
        'When the document clearly supports it, include at least one year tag such as `2011` in the document tags, and sort the final `tags` array in alphabetical order before writing the intent.'
      )
      expect(domainContent).toContain(
        'Complete the dossier details that can be inferred reliably from the documents with `dossier.update`, such as dossier type, status, and the dossier `information` note when the evidence is clear.'
      )
      expect(domainContent).toContain(
        'Extract contacts from the documents and persist them with `contact.upsert`.'
      )
      expect(domainContent).toContain(
        'Extract key dates from the documents and persist them with `dossier.upsertKeyDate`.'
      )
      expect(domainContent).toContain(
        'Always sort document tags in alphabetical order before writing the payload.'
      )
      expect(domainContent).toContain('#### Contacts')
      expect(domainContent).toContain('#### Key Dates')
      expect(domainContent).toContain('#### Key References')
      expect(domainContent).toContain('#### Entity Profile')
      expect(domainContent).toContain('#### Dossier Metadata')
      expect(domainContent).toContain('#### Templates')
      expect(domainContent).toContain('All writes must go through delegated intent files.')
      expect(domainContent).toContain('device-origin-123')
      expect(domainContent).toContain('`contact.upsert`')
      expect(domainContent).toContain(getDomainEntityPath(domainPath))
      expect(domainContent).toContain(getDomainTemplatesPath(domainPath))
      expect(domainContent).toContain(join(domainPath, '.ordicab-delegated', 'inbox'))
      expect(domainContent).toContain(getDossierContactsPath(dossierAlphaPath))
      expect(domainContent).toContain(getDossierMetadataPath(dossierAlphaPath))
      expect(domainContent).toContain(getDossierContactsPath(dossierBetaPath))
      expect(domainContent).toContain(getDossierMetadataPath(dossierBetaPath))

      // dossier scope - only one dossier
      const dossierContent = buildDelegatedInstructions({
        domainPath,
        scope: 'dossier',
        originDeviceId: 'device-origin-123',
        dossiers: [{ id: 'alpha', folderName: 'Client Alpha', folderPath: dossierAlphaPath }]
      })

      expect(dossierContent).toContain(getDossierContactsPath(dossierAlphaPath))
      expect(dossierContent).toContain(getDossierMetadataPath(dossierAlphaPath))
      expect(dossierContent).not.toContain(getDossierContactsPath(dossierBetaPath))
      expect(dossierContent).not.toContain(getDossierMetadataPath(dossierBetaPath))
      expect(dossierContent).toContain(getDomainEntityPath(domainPath))
      expect(dossierContent).toContain(getDomainTemplatesPath(domainPath))
    })
  })

  it('generates a domain-root CLAUDE.md with entity, dossier, template, and co-work sections', async () => {
    const { domainPath, dossierPath } = await createFixture()
    const generator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      now: () => new Date('2026-03-20T12:00:00.000Z')
    })

    await generator.generateDomainRoot()

    const content = await readFile(getDomainClaudeMdPath(domainPath), 'utf8')
    const routinesGuide = await readFile(getDomainTemplateRoutinesPath(domainPath), 'utf8')

    expect(content).toContain('# Ordicab Domain Context')
    expect(content).toContain('## Operating Rules')
    expect(content).toContain('workflow instructions and canonical source paths')
    expect(content).toContain('## Domain Source Files')
    expect(content).toContain('## Registered Dossier Source Paths (1 total)')
    expect(content).toContain(`- Folder: ${dossierPath}`)
    expect(content).toContain(`- documents root: ${dossierPath}`)
    expect(content).toContain('## Delegated Instructions')
    expect(content).toContain('### Procedure: "Organize the dossier"')
    expect(content).toContain('### Supported Intent Actions')
    expect(content).toContain('### Intent File Format')
    expect(content).toContain('### File Paths')
    expect(content).toContain('Never invent an `id` for an update.')
    expect(content).toContain('For `contact.upsert`, include `id` to update an existing contact')
    expect(content).toContain(
      'Treat the process as incremental if the dossier was already organized: add only new elements and fill only missing details, without duplicating existing contacts, key dates, document summaries, or tags.'
    )
    expect(content).toContain(
      'For each relevant document, index it: extract its text content, then persist a concise summary and useful tags with `document.saveMetadata`.'
    )
    expect(content).toContain(
      'When the document clearly supports it, include at least one year tag such as `2011` in the document tags, and sort the final `tags` array in alphabetical order before writing the intent.'
    )
    expect(content).toContain(
      'Complete the dossier details that can be inferred reliably from the documents with `dossier.update`, such as dossier type, status, and the dossier `information` note when the evidence is clear.'
    )
    expect(content).toContain(
      'Extract contacts from the documents and persist them with `contact.upsert`.'
    )
    expect(content).toContain(
      'Extract key dates from the documents and persist them with `dossier.upsertKeyDate`.'
    )
    expect(content).toContain(
      'Always sort document tags in alphabetical order before writing the payload.'
    )
    expect(content).toContain('Create a new key date: omit `id`.')
    expect(content).toContain('Update an existing key date: include the real existing `id`')
    expect(content).toContain(getDomainEntityPath(domainPath))
    expect(content).toContain(getDomainTemplatesPath(domainPath))
    expect(content).toContain(getDomainTemplateRoutinesPath(domainPath))
    expect(content).toContain(getDossierContactsPath(dossierPath))
    expect(content).toContain(getDossierMetadataPath(dossierPath))
    expect(content).toContain('The only allowed write target is the inbox folder:')
    expect(content).not.toContain('Cabinet Martin')
    expect(content).not.toContain('camille.martin@example.com')
    expect(content).not.toContain('Mise en demeure (id: tpl-1)')
    expect(routinesGuide).toContain('# Ordicab Template Routines')
    expect(routinesGuide).toContain(
      'Prefer a routine from this file whenever it already matches the requested data.'
    )
    expect(routinesGuide).toContain('{{dossier.name}}')
    expect(routinesGuide).toContain('{{contact.<roleKey>.<field>}}')
    expect(generator.getStatus()).toEqual({
      status: 'idle',
      updatedAt: '2026-03-20T12:00:00.000Z'
    })
    expect(normalizeFixturePaths(content, domainPath)).toMatchSnapshot()
  })

  it('does not rewrite CLAUDE.md when content is unchanged, and still generates when domain has no entity/templates/dossiers', async () => {
    // unchanged content path
    const { domainPath, dossierPath } = await createFixture()

    const initialGenerator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      now: () => new Date('2026-03-20T12:00:00.000Z')
    })

    await initialGenerator.generateDomainRoot()

    const writeClaudeMd = vi.fn(async () => undefined)
    const generator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      writeClaudeMd,
      now: () => new Date('2026-03-20T12:05:00.000Z')
    })

    await generator.generateDomainRoot()
    expect(writeClaudeMd).not.toHaveBeenCalled()

    // empty domain path
    const emptyDomainPath = await createTempDir()
    await mkdir(join(emptyDomainPath, '.ordicab'), { recursive: true })
    await writeJson(join(emptyDomainPath, '.ordicab', 'registry.json'), { dossiers: [] })

    const emptyGenerator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: emptyDomainPath,
          isAvailable: true,
          dossierCount: 0
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn()
      },
      delegatedOriginDeviceStore,
      now: () => new Date('2026-03-20T12:30:00.000Z')
    })

    await emptyGenerator.generateDomainRoot()

    const emptyContent = await readFile(getDomainClaudeMdPath(emptyDomainPath), 'utf8')
    expect(emptyContent).toContain('No registered dossiers available.')
    expect(emptyContent).toContain(getDomainEntityPath(emptyDomainPath))
    expect(emptyContent).toContain(getDomainTemplatesPath(emptyDomainPath))
    await expect(
      readFile(getDomainTemplateRoutinesPath(emptyDomainPath), 'utf8')
    ).resolves.toContain('# Ordicab Template Routines')
  })

  it('regenerates domain-root when generateDossier is invoked, and does not rewrite when unchanged', async () => {
    const { domainPath, dossierPath } = await createFixture()
    const generator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      now: () => new Date('2026-03-20T13:00:00.000Z')
    })

    await generator.generateDossier(domainPath, 'Client Alpha', dossierPath)

    const content = await readFile(getDomainClaudeMdPath(domainPath), 'utf8')
    expect(content).toContain('# Ordicab Domain Context')
    expect(content).toContain(`- Folder: ${dossierPath}`)
    await expect(readFile(getDossierClaudeMdPath(dossierPath), 'utf8')).rejects.toThrow()

    // no rewrite when unchanged
    const initialGenerator2 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      now: () => new Date('2026-03-20T13:00:00.000Z')
    })
    await initialGenerator2.generateDomainRoot(domainPath)

    const writeClaudeMd2 = vi.fn(async () => undefined)
    const generator2 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      writeClaudeMd: writeClaudeMd2,
      now: () => new Date('2026-03-20T13:05:00.000Z')
    })
    await generator2.generateDossier(domainPath, 'Client Alpha', dossierPath)
    expect(writeClaudeMd2).not.toHaveBeenCalled()
  })

  it('handles invalid and missing dossier metadata gracefully during domain-root generation', async () => {
    const { domainPath, dossierPath } = await createFixture()

    // invalid metadata: logs error and counts 0
    const logError1 = vi.fn()
    const generator1 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      logError: logError1
    })

    await writeJson(getDossierMetadataPath(dossierPath), {})
    await expect(generator1.generateDomainRoot(domainPath)).resolves.toBeUndefined()
    const content1 = await readFile(getDomainClaudeMdPath(domainPath), 'utf8')
    expect(logError1).toHaveBeenCalledWith(
      '[InstructionsGenerator] Skipping dossier "Client Alpha" in domain generation.',
      expect.objectContaining({ message: 'Stored dossier metadata is invalid.' })
    )
    expect(content1).toContain('## Registered Dossier Source Paths (0 total)')
    expect(content1).toContain('No registered dossiers available.')

    // missing metadata: no log, counts 0
    const { domainPath: domainPath2, dossierPath: dossierPath2 } = await createFixture()
    const logError2 = vi.fn()
    const generator2 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath2,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath2)
      },
      delegatedOriginDeviceStore,
      logError: logError2
    })

    await unlink(getDossierMetadataPath(dossierPath2))
    await expect(generator2.generateDomainRoot(domainPath2)).resolves.toBeUndefined()
    const content2 = await readFile(getDomainClaudeMdPath(domainPath2), 'utf8')
    expect(logError2).not.toHaveBeenCalled()
    expect(content2).toContain('## Registered Dossier Source Paths (0 total)')
    expect(content2).toContain('No registered dossiers available.')
  })

  it('throws when no domain is configured or domain is unavailable', async () => {
    // no domain
    const generator1 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: null,
          isAvailable: false,
          dossierCount: 0
        }))
      },
      documentService: { resolveRegisteredDossierRoot: vi.fn() },
      delegatedOriginDeviceStore
    })
    await expect(generator1.generateDomainRoot()).rejects.toThrow(
      'Active domain is not configured.'
    )
    expect(generator1.getStatus()).toMatchObject({ status: 'error' })

    // unavailable domain
    const generator2 = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: '/tmp/domain',
          isAvailable: false,
          dossierCount: 0
        }))
      },
      documentService: { resolveRegisteredDossierRoot: vi.fn() },
      delegatedOriginDeviceStore
    })
    await expect(generator2.generateDomainRoot()).rejects.toThrow('Active domain is unavailable.')
    expect(generator2.getStatus()).toMatchObject({ status: 'error' })
  })

  it('surfaces write failures without corrupting an existing CLAUDE.md file', async () => {
    const { domainPath, dossierPath } = await createFixture()
    const targetPath = getDomainClaudeMdPath(domainPath)

    await writeFile(targetPath, 'existing content\n', 'utf8')

    const generator = createInstructionsGenerator({
      domainService: {
        getStatus: vi.fn(async () => ({
          registeredDomainPath: domainPath,
          isAvailable: true,
          dossierCount: 1
        }))
      },
      documentService: {
        resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
      },
      delegatedOriginDeviceStore,
      writeClaudeMd: vi.fn(async () => {
        throw new Error('disk full')
      })
    })

    await expect(generator.generateDomainRoot()).rejects.toThrow('disk full')
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('existing content\n')
    expect(generator.getStatus()).toEqual({
      status: 'error',
      updatedAt: null
    })
  })

  describe('generateForMode', () => {
    function createGeneratorForMode(
      domainPath: string,
      dossierPath: string
    ): ReturnType<typeof createInstructionsGenerator> {
      return createInstructionsGenerator({
        domainService: {
          getStatus: vi.fn(async () => ({
            registeredDomainPath: domainPath,
            isAvailable: true,
            dossierCount: 1
          }))
        },
        documentService: {
          resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
        },
        delegatedOriginDeviceStore,
        now: () => new Date('2026-03-20T12:00:00.000Z')
      })
    }

    it('writes to CLAUDE.md for claude-code, AGENTS.md for codex, and .github/copilot-instructions.md for copilot', async () => {
      const { domainPath, dossierPath } = await createFixture()
      const generator = createGeneratorForMode(domainPath, dossierPath)

      await generator.generateForMode(domainPath, 'claude-code')
      const claudeContent = await readFile(join(domainPath, 'CLAUDE.md'), 'utf8')
      expect(claudeContent).toContain('# Ordicab Domain Context')
      expect(claudeContent).toContain('## Delegated Instructions')
      expect(claudeContent).toContain('### Intent Workflow')

      const { domainPath: domainPath2, dossierPath: dossierPath2 } = await createFixture()
      const generator2 = createGeneratorForMode(domainPath2, dossierPath2)
      await generator2.generateForMode(domainPath2, 'codex')
      const codexContent = await readFile(join(domainPath2, 'AGENTS.md'), 'utf8')
      expect(codexContent).toContain('# Ordicab Domain Context')
      expect(codexContent).toContain('## Delegated Instructions')
      expect(codexContent).toContain('### Intent Workflow')
      await expect(readFile(join(domainPath2, 'CLAUDE.md'), 'utf8')).rejects.toThrow()

      const { domainPath: domainPath3, dossierPath: dossierPath3 } = await createFixture()
      const generator3 = createGeneratorForMode(domainPath3, dossierPath3)
      await generator3.generateForMode(domainPath3, 'copilot')
      const copilotContent = await readFile(
        join(domainPath3, '.github', 'copilot-instructions.md'),
        'utf8'
      )
      expect(copilotContent).toContain('# Ordicab Domain Context')
      expect(copilotContent).toContain('## Delegated Instructions')
      expect(copilotContent).toContain('### Intent Workflow')
      await expect(readFile(join(domainPath3, 'CLAUDE.md'), 'utf8')).rejects.toThrow()
    })

    it('is a no-op for local and none modes', async () => {
      const { domainPath, dossierPath } = await createFixture()
      const writeClaudeMd = vi.fn(async () => undefined)

      for (const mode of ['local', 'none'] as const) {
        const gen = createInstructionsGenerator({
          domainService: {
            getStatus: vi.fn(async () => ({
              registeredDomainPath: domainPath,
              isAvailable: true,
              dossierCount: 1
            }))
          },
          documentService: {
            resolveRegisteredDossierRoot: vi.fn(async () => dossierPath)
          },
          delegatedOriginDeviceStore,
          writeClaudeMd
        })
        await gen.generateForMode(domainPath, mode)
      }

      expect(writeClaudeMd).not.toHaveBeenCalled()
    })
  })
})
