import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import PizZip from 'pizzip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContactRecord, DossierDetail, EntityProfile, TemplateRecord } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { createGenerateService, GenerateServiceError } from '../generateService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-generate-service-'))
  tempDirs.push(dir)
  return dir
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function createDocxTemplateBuffer(text: string): Promise<Uint8Array> {
  const source = await readFile(
    join(process.cwd(), 'node_modules/mammoth/test/test-data/single-paragraph.docx')
  )
  const zip = new PizZip(source)

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`
  )

  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' })
}

function createDossierDetail(overrides: Partial<DossierDetail> = {}): DossierDetail {
  return {
    id: 'Client Alpha',
    name: 'Client Alpha',
    status: 'active',
    type: 'Civil litigation',
    updatedAt: '2026-03-14T10:00:00.000Z',
    lastOpenedAt: null,
    nextUpcomingKeyDate: '2026-04-01',
    nextUpcomingKeyDateLabel: 'Hearing date',
    registeredAt: '2026-03-01T09:00:00.000Z',
    keyDates: [
      {
        id: 'kd-1',
        dossierId: 'Client Alpha',
        label: 'Hearing date',
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

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl-1',
    name: 'Convocation',
    content:
      '<p>Hello <span data-template-tag-path="contact.displayName">{{contact.displayName}}</span></p>',
    tags: [],
    hasDocxSource: false,
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides,
    macros: overrides.macros ?? []
  }
}

function createContact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    uuid: 'contact-1',
    dossierId: 'Client Alpha',
    firstName: 'Alex',
    lastName: 'Bernard',
    role: 'Client',
    institution: 'Bernard Legal Services',
    addressLine: '99 rue de Lyon',
    city: 'Paris',
    phone: '+33 1 98 76 54 32',
    email: 'alex.bernard@test-example.com',
    ...overrides
  }
}

function createEntity(overrides: Partial<EntityProfile> = {}): EntityProfile {
  return {
    firmName: 'Cabinet Test-Legal',
    address: '50 boulevard de la République',
    vatNumber: 'FR12345678901',
    phone: '+33 1 23 45 67 89',
    email: 'contact@test-legal-firm.fr',
    ...overrides
  }
}

async function createServiceFixture(
  template: TemplateRecord,
  options: {
    contacts?: ContactRecord[]
    dossier?: Partial<DossierDetail>
    entity?: Partial<EntityProfile>
  } = {}
): Promise<{
  domainPath: string
  dossierPath: string
  service: ReturnType<typeof createGenerateService>
}> {
  const domainPath = await createTempDir()
  const dossierPath = join(domainPath, 'Client Alpha')

  await mkdir(join(domainPath, '.ordicab', 'templates'), { recursive: true })
  await mkdir(join(dossierPath, '.ordicab'), { recursive: true })

  // Write content to individual file; store empty content in index JSON.
  if (template.content) {
    await writeFile(
      join(domainPath, '.ordicab', 'templates', `${template.id}.html`),
      template.content,
      'utf8'
    )
  }
  await writeJson(join(domainPath, '.ordicab', 'templates.json'), [{ ...template, content: '' }])
  await writeJson(join(domainPath, '.ordicab', 'entity.json'), createEntity(options.entity))
  await writeJson(join(dossierPath, '.ordicab', 'dossier.json'), {
    ...createDossierDetail(options.dossier),
    documents: []
  })
  await writeJson(
    join(dossierPath, '.ordicab', 'contacts.json'),
    options.contacts ?? [createContact()]
  )

  const service = createGenerateService({
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
    now: () => new Date('2026-03-15T14:30:00.000Z')
  })

  return {
    domainPath,
    dossierPath,
    service
  }
}

async function attachDocxTemplate(
  domainPath: string,
  templateId: string,
  text: string
): Promise<void> {
  const outputPath = join(domainPath, '.ordicab', 'templates', `${templateId}.docx`)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, await createDocxTemplateBuffer(text))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('generateService', () => {
  it('builds a preview with resolved tags, unresolved tags, and correct suggested filename', async () => {
    const { service } = await createServiceFixture(
      createTemplate({
        content: [
          '<p><span data-template-tag-path="dossier.name">{{dossier.name}}</span></p>',
          '<p><span data-template-tag-path="entity.firmName">{{entity.firmName}}</span></p>',
          '<p><span data-template-tag-path="dossier.keyDate.hearingDate">{{dossier.keyDate.hearingDate}}</span></p>',
          '<p><span data-template-tag-path="entity.addressLine2">{{entity.addressLine2}}</span></p>'
        ].join('')
      })
    )

    const result = await service.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })

    expect(result).toEqual({
      draftHtml: expect.stringContaining('Client Alpha'),
      suggestedFilename: 'Convocation-2026-03-15',
      unresolvedTags: ['entity.addressLine2'],
      resolvedTags: {
        'dossier.name': 'Client Alpha',
        'entity.firmName': 'Cabinet Test-Legal',
        'dossier.keyDate.hearingDate': '2026-04-01'
      }
    })
    expect(result.draftHtml).toContain('Cabinet Test-Legal')
    expect(result.draftHtml).toContain('2026-04-01')
    expect(result.draftHtml).toContain('data-template-tag-path="entity.addressLine2"')
    expect(result.draftHtml).toContain('{{entity.addressLine2}}')
  })

  it('resolves contact salutation fields for female, neutral, french alias, and role-based contacts', async () => {
    // female contact
    const { service: serviceF } = await createServiceFixture(
      createTemplate({
        content: [
          '<p><span data-template-tag-path="contact.salutation">{{contact.salutation}}</span></p>',
          '<p><span data-template-tag-path="contact.salutationFull">{{contact.salutationFull}}</span></p>',
          '<p><span data-template-tag-path="contact.dear">{{contact.dear}}</span></p>'
        ].join('')
      }),
      {
        contacts: [
          createContact({
            displayName: 'Alex Bernard',
            firstName: 'Alex',
            lastName: 'Bernard',
            gender: 'F'
          })
        ]
      }
    )
    const resultF = await serviceF.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultF.unresolvedTags).toEqual([])
    expect(resultF.resolvedTags).toEqual({
      'contact.salutation': 'Madame',
      'contact.salutationFull': 'Madame Bernard',
      'contact.dear': 'Chère Madame'
    })

    // neutral (undefined gender)
    const { service: serviceN } = await createServiceFixture(
      createTemplate({
        content: [
          '<p><span data-template-tag-path="contact.salutation">{{contact.salutation}}</span></p>',
          '<p><span data-template-tag-path="contact.salutationFull">{{contact.salutationFull}}</span></p>',
          '<p><span data-template-tag-path="contact.dear">{{contact.dear}}</span></p>'
        ].join('')
      }),
      {
        contacts: [
          createContact({
            firstName: undefined,
            lastName: undefined,
            institution: 'Tribunal judiciaire de Paris',
            gender: undefined
          })
        ]
      }
    )
    const resultN = await serviceN.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultN.unresolvedTags).toEqual([])
    expect(resultN.resolvedTags).toEqual({
      'contact.salutation': '',
      'contact.salutationFull': 'Tribunal judiciaire de Paris',
      'contact.dear': 'Madame, Monsieur,'
    })
    expect(resultN.draftHtml).not.toContain('{{contact.salutation}}')

    // french alias civilite
    const { service: serviceAlias } = await createServiceFixture(
      createTemplate({
        content:
          '<p><span data-template-tag-path="contact.civilite">{{contact.civilite}}</span></p>'
      }),
      {
        contacts: [
          createContact({
            displayName: 'Person-C LASTNAME-A',
            firstName: 'Person-C',
            lastName: 'LASTNAME-A',
            gender: 'M'
          })
        ]
      }
    )
    const resultAlias = await serviceAlias.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultAlias.unresolvedTags).toEqual([])
    expect(resultAlias.resolvedTags).toEqual({ 'contact.salutation': 'Monsieur' })

    // role-based salutation
    const { service: serviceRole } = await createServiceFixture(
      createTemplate({
        content:
          '<p><span data-template-tag-path="contact.adversaryLawyer.salutationFull">{{contact.adversaryLawyer.salutationFull}}</span></p>'
      }),
      {
        contacts: [
          createContact({
            uuid: 'contact-1',
            role: 'Client',
            displayName: 'Alex Bernard',
            gender: 'F'
          }),
          createContact({
            uuid: 'contact-2',
            role: 'Adversary Lawyer',
            displayName: 'John Martin',
            firstName: 'John',
            lastName: 'Martin',
            gender: 'M'
          })
        ]
      }
    )
    const resultRole = await serviceRole.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultRole.unresolvedTags).toEqual([])
    expect(resultRole.resolvedTags).toEqual({
      'contact.adversaryLawyer.salutationFull': 'Monsieur Martin'
    })
  })

  it('resolves contact.prenoms, localized role fields, and formatted address fields', async () => {
    // prenoms
    const { service: servicePrenoms } = await createServiceFixture(
      createTemplate({
        content: '<p><span data-template-tag-path="contact.prenoms">{{contact.prenoms}}</span></p>'
      }),
      {
        contacts: [
          createContact({
            displayName: 'Alex Bernard',
            firstName: 'Alex',
            lastName: 'Bernard',
            customFields: { additionalFirstNames: 'Marie Louise' }
          })
        ]
      }
    )
    const resultPrenoms = await servicePrenoms.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultPrenoms.unresolvedTags).toEqual([])
    expect(resultPrenoms.resolvedTags).toEqual({ 'contact.firstNames': 'Alex Marie Louise' })

    // localized role-based institution and formatted address
    const { service: serviceLocale } = await createServiceFixture(
      createTemplate({
        content: [
          '<p><span data-template-tag-path="contact.juridiction.institution">{{contact.juridiction.institution}}</span></p>',
          '<p><span data-template-tag-path="contact.partieRepresentee.adresseFormatee">{{contact.partieRepresentee.adresseFormatee}}</span></p>'
        ].join('')
      }),
      {
        contacts: [
          createContact({
            uuid: 'contact-1',
            role: 'Juridiction',
            displayName: 'Tribunal judiciaire de Paris',
            institution: 'Tribunal judiciaire de Paris',
            addressLine: undefined,
            city: undefined
          }),
          createContact({
            uuid: 'contact-2',
            role: 'Partie représentée',
            displayName: 'Alex Bernard',
            addressLine: '99 rue de Lyon',
            zipCode: '75001',
            city: 'Paris',
            country: 'France'
          })
        ]
      }
    )
    const resultLocale = await serviceLocale.previewDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(resultLocale.unresolvedTags).toEqual([])
    expect(resultLocale.resolvedTags).toEqual({
      'contact.juridiction.institution': 'Tribunal judiciaire de Paris',
      'contact.partieRepresentee.addressFormatted': '99 rue de Lyon\n75001 Paris France'
    })
  })

  it('generates documents: plain html, docx-sourced with overrides, text save, missing source error, and malformed template error', async () => {
    // plain html generates docx
    const { dossierPath, service } = await createServiceFixture(
      createTemplate({ name: 'Lettre finale', content: '<p>Rendered content</p>' })
    )
    const result = await service.generateDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    expect(result.outputPath).toBe(join(dossierPath, 'Lettre finale-2026-03-15.docx'))
    const bytes = await readFile(result.outputPath)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')

    // text-only path unchanged
    const { service: service2 } = await createServiceFixture(
      createTemplate({ hasDocxSource: false, content: '<p>Rendered content</p>' })
    )
    const result2 = await service2.generateDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1'
    })
    const bytes2 = await readFile(result2.outputPath)
    expect(bytes2.subarray(0, 2).toString()).toBe('PK')

    // docx-sourced with tag overrides
    const {
      domainPath: domainPath3,
      dossierPath: dossierPath3,
      service: service3
    } = await createServiceFixture(
      createTemplate({
        hasDocxSource: true,
        name: 'Audience note',
        content:
          '<p>Follow-up for <span data-template-tag-path="contact.displayName">{{contact.displayName}}</span></p>'
      })
    )
    await attachDocxTemplate(
      domainPath3,
      'tpl-1',
      'Client {{dossier.name}} hearing {{dossier.keyDate.hearingDate}} notes {{app.content}} missing {{dossier.keyDate.judgmentDate}}'
    )
    const result3 = await service3.generateDocument({
      dossierId: 'Client Alpha',
      templateId: 'tpl-1',
      tagOverrides: { 'dossier.keyDate.judgmentDate': '[judgmentDate not set]' }
    })
    expect(result3.outputPath).toBe(join(dossierPath3, 'Audience note-2026-03-15.docx'))
    const zip3 = new PizZip(await readFile(result3.outputPath))
    const xml3 = zip3.file('word/document.xml')?.asText()
    expect(xml3).toContain('Client Alpha')
    expect(xml3).toContain('2026-04-01')
    expect(xml3).toContain('Follow-up for Alex Bernard')
    expect(xml3).toContain('[judgmentDate not set]')

    // missing docx source
    const { service: service4 } = await createServiceFixture(
      createTemplate({ hasDocxSource: true })
    )
    await expect(
      service4.generateDocument({ dossierId: 'Client Alpha', templateId: 'tpl-1' })
    ).rejects.toMatchObject({ code: 'ENOENT' })

    // malformed docx template
    const { domainPath: domainPath5, service: service5 } = await createServiceFixture(
      createTemplate({ hasDocxSource: true })
    )
    await attachDocxTemplate(domainPath5, 'tpl-1', 'Broken {{dossier.name')
    await expect(
      service5.generateDocument({ dossierId: 'Client Alpha', templateId: 'tpl-1' })
    ).rejects.toMatchObject({
      code: IpcErrorCode.UNKNOWN,
      message: expect.stringContaining('Invalid tag in Word template:')
    } satisfies Partial<GenerateServiceError>)
  })

  it('saves a reviewed draft using the requested output format and filename', async () => {
    const { dossierPath, service } = await createServiceFixture(createTemplate())

    const result = await service.saveGeneratedDocument({
      dossierId: 'Client Alpha',
      filename: 'Reviewed draft',
      format: 'txt',
      html: '<h1>Heading</h1><p>Updated body</p>'
    })

    expect(result.outputPath).toBe(join(dossierPath, 'Reviewed draft.txt'))
    await expect(readFile(result.outputPath, 'utf8')).resolves.toBe('HEADING\n\nUpdated body')
  })
})
