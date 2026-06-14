import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import HTMLToDOCX from 'html-to-docx'
import PizZip from 'pizzip'
import { afterEach, describe, expect, it } from 'vitest'

import { createTemplateService } from '../templateService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-template-service-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createService(domainPath: string | null): ReturnType<typeof createTemplateService> {
  return createTemplateService({
    domainService: {
      getStatus: async () => ({
        registeredDomainPath: domainPath,
        isAvailable: domainPath !== null,
        dossierCount: 0
      })
    }
  })
}

async function writeCabinetDocx(domainPath: string, marker: string): Promise<void> {
  // A real DOCX wrapper with a distinct text marker (used to assert that
  // injected template content sits inside the cabinet body).
  const html = `<!DOCTYPE html><html><body><p>${marker}</p></body></html>`
  const output = await HTMLToDOCX(html, undefined, {
    title: 'Cabinet',
    creator: 'Ordicab',
    font: 'Aptos',
    fontSize: 22,
    decodeUnicode: true,
    lang: 'fr-FR'
  })
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer)
  const cabinetPath = join(domainPath, '.ordicab', 'cabinet-default-template.docx')
  await mkdir(join(domainPath, '.ordicab'), { recursive: true })
  await writeFile(cabinetPath, buffer)
}

async function readDocxBodyText(docxPath: string): Promise<string> {
  const buffer = await readFile(docxPath)
  const zip = new PizZip(buffer)
  return zip.file('word/document.xml')?.asText() ?? ''
}

describe('templateService — Partie A: auto-DOCX on create', () => {
  it('non-email template with cabinet DOCX → hasDocxSource=true, wrapped in cabinet body', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_MARKER_XYZ')

    const service = createService(domainPath)
    const created = await service.create({
      name: 'Lettre simple',
      content: '<p>TEMPLATE_BODY_ABC</p>',
      tags: ['client']
    })

    expect(created.hasDocxSource).toBe(true)
    expect(created.tags).toEqual(['client'])

    const docxPath = join(domainPath, '.ordicab', 'templates', `${created.uuid}.docx`)
    const xml = await readDocxBodyText(docxPath)
    expect(xml).toContain('CABINET_MARKER_XYZ')
    expect(xml).toContain('TEMPLATE_BODY_ABC')
  })

  it('non-email template without cabinet DOCX → hasDocxSource=true, plain html-to-docx output', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    const created = await service.create({
      name: 'Convention',
      content: '<p>STANDALONE_DOCX_CONTENT</p>',
      tags: ['convention']
    })

    expect(created.hasDocxSource).toBe(true)
    const docxPath = join(domainPath, '.ordicab', 'templates', `${created.uuid}.docx`)
    const xml = await readDocxBodyText(docxPath)
    expect(xml).toContain('STANDALONE_DOCX_CONTENT')
  })

  it('email template → hasDocxSource=false, no .docx file', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_MARKER')

    const service = createService(domainPath)
    const created = await service.create({
      name: 'Email — RDV',
      content: '<p>Hello</p>',
      tags: ['email', 'rdv']
    })

    expect(created.hasDocxSource).toBe(false)
    expect(created.tags).toEqual(['email', 'rdv'])

    const docxPath = join(domainPath, '.ordicab', 'templates', `${created.uuid}.docx`)
    await expect(readFile(docxPath)).rejects.toThrow()
  })

  it('tags persisted in templates.json and reloaded by list()', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    await service.create({
      name: 'With tags',
      content: '<p>x</p>',
      tags: ['alpha', 'beta']
    })

    const fresh = createService(domainPath)
    const listed = await fresh.list()
    expect(listed[0]?.tags).toEqual(['alpha', 'beta'])
  })

  it('persists the category on create, moves it on lightweight update, and clears it with an empty string', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    const created = await service.create({
      name: 'Courrier RDV',
      content: '<p>BODY_KEPT</p>',
      tags: ['email'],
      category: 'Correspondance'
    })
    expect(created.category).toBe('Correspondance')

    // Reloaded from templates.json
    const fresh = createService(domainPath)
    expect((await fresh.list())[0]?.category).toBe('Correspondance')

    // Lightweight category move (no content) keeps the stored body
    const moved = await service.update({
      uuid: created.uuid,
      name: created.name,
      category: 'Procédure'
    })
    expect(moved.category).toBe('Procédure')
    await expect(service.getContent(created.uuid)).resolves.toContain('BODY_KEPT')

    // Empty string clears the category
    const cleared = await service.update({ uuid: created.uuid, name: created.name, category: '' })
    expect(cleared.category).toBeUndefined()
  })
})

describe('templateService — Partie B: seedDefaultTemplatesIfEmpty', () => {
  it('seeds 14 essentials on empty domain and reports the count', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    const result = await service.seedDefaultTemplatesIfEmpty()
    expect(result).toEqual({ seeded: 14 })

    const listed = await service.list()
    expect(listed.length).toBe(14)
    const names = listed.map((t) => t.name).sort()
    expect(names).toContain('Facture — Standard')
    expect(names).toContain('Convention d’honoraires — Forfait')
    expect(names).toContain('Email — Confirmation de rendez-vous')
    expect(names).toContain('Désignation — Aide juridictionnelle')
  })

  it('is idempotent — second call returns { seeded: 0 } and does not duplicate', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    await service.seedDefaultTemplatesIfEmpty()
    const second = await service.seedDefaultTemplatesIfEmpty()
    expect(second).toEqual({ seeded: 0 })

    const listed = await service.list()
    expect(listed.length).toBe(14)
  })

  it('does not run on already-populated domains', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    await service.create({ name: 'Pre-existing', content: '<p>x</p>' })
    const result = await service.seedDefaultTemplatesIfEmpty()
    expect(result).toEqual({ seeded: 0 })

    const listed = await service.list()
    expect(listed.length).toBe(1)
    expect(listed[0]?.name).toBe('Pre-existing')
  })

  it('combines with Partie A: 13 non-emails get hasDocxSource=true, the lone email stays HTML-only', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    await service.seedDefaultTemplatesIfEmpty()
    const listed = await service.list()

    const emails = listed.filter((t) => (t.tags ?? []).some((tag) => tag.toLowerCase() === 'email'))
    const nonEmails = listed.filter(
      (t) => !(t.tags ?? []).some((tag) => tag.toLowerCase() === 'email')
    )
    expect(emails.length).toBe(1)
    expect(emails[0]?.hasDocxSource).toBe(false)
    expect(nonEmails.length).toBe(13)
    for (const tpl of nonEmails) {
      expect(tpl.hasDocxSource).toBe(true)
    }
  })

  it('returns { seeded: 0 } cleanly when no domain is configured', async () => {
    const service = createService(null)
    await expect(service.seedDefaultTemplatesIfEmpty()).resolves.toEqual({ seeded: 0 })
  })
})

describe('templateService — Partie C: applyCabinetDocxToAllExisting', () => {
  it('re-wraps non-email DOCX templates with the new cabinet, preserving their body content', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_V1')

    const service = createService(domainPath)
    const a = await service.create({
      name: 'Non-email A',
      content: '<p>BODY_A</p>',
      tags: ['client']
    })
    const b = await service.create({
      name: 'Non-email B',
      content: '<p>BODY_B</p>',
      tags: ['client']
    })
    const email = await service.create({
      name: 'Email C',
      content: '<p>EMAIL_C</p>',
      tags: ['email']
    })

    // Sanity: V1 marker is in the non-email DOCX, not in the email (which has no DOCX).
    expect(
      await readDocxBodyText(join(domainPath, '.ordicab', 'templates', `${a.uuid}.docx`))
    ).toContain('CABINET_V1')

    // Replace cabinet with V2.
    await writeCabinetDocx(domainPath, 'CABINET_V2')

    const result = await service.applyCabinetDocxToAllExisting()
    expect(result.updated).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.failed).toEqual([])

    // V2's cabinet wrapper is now around each non-email template's body. The
    // body still carries the template content (BODY_A / BODY_B). In production,
    // cabinet templates put their distinctive marks in headers/footers (not in
    // the body), so V1's mark would not survive the re-wrap; in this test the
    // marker is in the cabinet body and is preserved as part of the body —
    // that is the documented "copy current body content into the new wrapper"
    // contract.
    const aXml = await readDocxBodyText(join(domainPath, '.ordicab', 'templates', `${a.uuid}.docx`))
    expect(aXml).toContain('CABINET_V2')
    expect(aXml).toContain('BODY_A')

    const bXml = await readDocxBodyText(join(domainPath, '.ordicab', 'templates', `${b.uuid}.docx`))
    expect(bXml).toContain('CABINET_V2')
    expect(bXml).toContain('BODY_B')

    // Email is unchanged: no .docx exists.
    await expect(
      readFile(join(domainPath, '.ordicab', 'templates', `${email.uuid}.docx`))
    ).rejects.toThrow()
  })

  it('preserves manual Word edits stored in the existing .docx', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_V1')

    const service = createService(domainPath)
    const tpl = await service.create({
      name: 'Non-email edit',
      content: '<p>INITIAL_BODY</p>',
      tags: ['client']
    })

    // Simulate the user opening the DOCX in Word and inserting a distinctive
    // paragraph. We rebuild the DOCX from HTML containing the edit.
    const editedHtml = '<p>INITIAL_BODY</p><p>MANUAL_WORD_EDIT_ZZZ</p>'
    const editedOutput = await HTMLToDOCX(
      `<!DOCTYPE html><html><body>${editedHtml}</body></html>`,
      undefined,
      { title: 'edit', creator: 'Ordicab', font: 'Aptos', fontSize: 22, lang: 'fr-FR' }
    )
    const editedBuffer = Buffer.isBuffer(editedOutput)
      ? editedOutput
      : Buffer.from(editedOutput as ArrayBuffer)
    await writeFile(join(domainPath, '.ordicab', 'templates', `${tpl.uuid}.docx`), editedBuffer)

    await writeCabinetDocx(domainPath, 'CABINET_V2')
    const result = await service.applyCabinetDocxToAllExisting()
    expect(result.updated).toBe(1)

    const xml = await readDocxBodyText(
      join(domainPath, '.ordicab', 'templates', `${tpl.uuid}.docx`)
    )
    expect(xml).toContain('CABINET_V2')
    expect(xml).toContain('MANUAL_WORD_EDIT_ZZZ')
  })

  it('throws NOT_FOUND when no cabinet DOCX is configured', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const service = createService(domainPath)
    await expect(service.applyCabinetDocxToAllExisting()).rejects.toThrowError(
      /Modèle DOCX cabinet/
    )
  })

  it('reports 0 updated when no candidates exist (only emails)', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_V1')

    const service = createService(domainPath)
    await service.create({
      name: 'Email A',
      content: '<p>x</p>',
      tags: ['email']
    })

    const result = await service.applyCabinetDocxToAllExisting()
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.failed).toEqual([])
  })

  it('records the id in failed when a single template DOCX is corrupted but processes the rest', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeCabinetDocx(domainPath, 'CABINET_V1')

    const service = createService(domainPath)
    const good = await service.create({
      name: 'Good',
      content: '<p>GOOD_BODY</p>',
      tags: ['client']
    })
    const broken = await service.create({
      name: 'Broken',
      content: '<p>BROKEN_BODY</p>',
      tags: ['client']
    })

    // Corrupt one template's DOCX by overwriting with garbage that PizZip
    // cannot parse as a Word document.
    await writeFile(
      join(domainPath, '.ordicab', 'templates', `${broken.uuid}.docx`),
      Buffer.from('not a real docx')
    )

    await writeCabinetDocx(domainPath, 'CABINET_V2')
    const result = await service.applyCabinetDocxToAllExisting()
    expect(result.updated).toBe(1)
    expect(result.failed).toEqual([broken.uuid])

    const goodXml = await readDocxBodyText(
      join(domainPath, '.ordicab', 'templates', `${good.uuid}.docx`)
    )
    expect(goodXml).toContain('CABINET_V2')
    expect(goodXml).toContain('GOOD_BODY')
  })
})
