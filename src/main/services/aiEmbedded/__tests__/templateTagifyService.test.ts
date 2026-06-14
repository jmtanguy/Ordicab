import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import PizZip from 'pizzip'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TemplateRecord } from '@shared/types'

import { createTemplateTagifyService } from '../templateTagifyService'
import type { TemplateService } from '../../domain/templateService'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-tagify-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    uuid: 'tpl-1',
    name: 'Lettre client',
    macros: [],
    hasDocxSource: false,
    updatedAt: '2026-06-12T10:00:00.000Z',
    ...overrides
  }
}

async function createFixture(options: {
  template: TemplateRecord
  html: string
  modelResponse?: string
  mode?: 'remote' | 'none'
}): Promise<{
  service: ReturnType<typeof createTemplateTagifyService>
  templateService: TemplateService
  domainPath: string
  generateOneShot: ReturnType<typeof vi.fn>
}> {
  const dir = await createTempDir()
  const statePath = join(dir, 'state.json')
  await writeFile(
    statePath,
    JSON.stringify({ ai: { mode: options.mode ?? 'remote', piiEnabled: false } }),
    'utf8'
  )

  const domainPath = join(dir, 'domain')
  await mkdir(join(domainPath, '.ordicab', 'templates'), { recursive: true })

  const generateOneShot = vi.fn(async () => options.modelResponse ?? '[]')
  const templateService = {
    list: vi.fn(async () => [options.template]),
    getContent: vi.fn(async () => options.html),
    update: vi.fn(async (input: { content?: string }) => ({
      ...options.template,
      content: input.content
    })),
    syncDocx: vi.fn(async () => ({ html: '<p></p>' }))
  } as unknown as TemplateService

  const service = createTemplateTagifyService({
    aiAgentRuntime: { generateOneShot },
    templateService,
    domainService: {
      getStatus: async () => ({ registeredDomainPath: domainPath, isAvailable: true })
    },
    localeService: { getLocale: () => 'fr' },
    stateFilePath: statePath,
    nerModelPath: null,
    isNerModelReady: async () => true
  })

  return { service, templateService, domainPath, generateOneShot }
}

describe('templateTagifyService.analyze', () => {
  it('keeps valid proposals found in the document and drops invalid or absent ones', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont, votre audience du 12 juin approche. Jean Dupont est convoqué.</p>',
      modelResponse: JSON.stringify([
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        },
        { originalText: 'Pierre Martin', suggestedTag: 'contact.displayName', confidence: 'high' },
        { originalText: '12 juin', suggestedTag: 'not.a.real.tag', confidence: 'medium' }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals).toEqual([
      {
        originalText: 'Jean Dupont',
        suggestedTag: 'contact.client.displayName',
        confidence: 'high',
        occurrences: 2
      }
    ])
  })

  it('normalizes FR alias tags from the model', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Me Durand vous écrit.</p>',
      modelResponse: JSON.stringify([
        { originalText: 'Me Durand', suggestedTag: 'contact.nomAffiche', confidence: 'high' }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]?.suggestedTag).toBe('contact.displayName')
  })

  it('throws AI_RUNTIME_UNAVAILABLE when no remote model is configured', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Texte</p>',
      mode: 'none'
    })

    await expect(service.analyze({ templateUuid: 'tpl-1' })).rejects.toMatchObject({
      code: 'AI_RUNTIME_UNAVAILABLE'
    })
  })
})

describe('templateTagifyService.apply', () => {
  it('rewrites text templates through templateService.update', async () => {
    const { service, templateService } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont, bonjour.</p>'
    })

    const result = await service.apply({
      templateUuid: 'tpl-1',
      replacements: [{ originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }]
    })

    expect(result.applied).toBe(1)
    expect(result.failed).toHaveLength(0)
    expect(templateService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: 'tpl-1',
        content: expect.stringContaining('data-template-tag-path="contact.client.displayName"')
      })
    )
  })

  it('rejects invalid tags without touching the template', async () => {
    const { service, templateService } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>'
    })

    const result = await service.apply({
      templateUuid: 'tpl-1',
      replacements: [{ originalText: 'Jean Dupont', tagPath: 'definitely.not.valid' }]
    })

    expect(result.applied).toBe(0)
    expect(result.failed).toEqual([{ originalText: 'Jean Dupont', reason: 'invalid-tag' }])
    expect(templateService.update).not.toHaveBeenCalled()
  })

  it('mutates the .docx binary and resyncs for DOCX-backed templates', async () => {
    const { service, templateService, domainPath } = await createFixture({
      template: createTemplate({ hasDocxSource: true }),
      html: '<p>Cher Jean Dupont.</p>'
    })

    const docxPath = join(domainPath, '.ordicab', 'templates', 'tpl-1.docx')
    await mkdir(dirname(docxPath), { recursive: true })
    const zip = new PizZip()
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Cher Jean Dupont.</w:t></w:r></w:p></w:body></w:document>'
    )
    await writeFile(docxPath, zip.generate({ type: 'nodebuffer' }))

    const result = await service.apply({
      templateUuid: 'tpl-1',
      replacements: [{ originalText: 'Jean Dupont', tagPath: 'contact.client.displayName' }]
    })

    expect(result.applied).toBe(1)
    expect(templateService.syncDocx).toHaveBeenCalledWith('tpl-1')
    const updatedXml = new PizZip(await readFile(docxPath)).file('word/document.xml')!.asText()
    expect(updatedXml).toContain('Cher {{contact.client.displayName}}.')
  })
})
