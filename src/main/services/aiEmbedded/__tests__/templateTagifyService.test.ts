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
  piiEnabled?: boolean
  nerModelPath?: string | null
  nerModelReady?: boolean
}): Promise<{
  service: ReturnType<typeof createTemplateTagifyService>
  templateService: TemplateService
  domainPath: string
  generateOneShot: ReturnType<typeof vi.fn>
  configureRemoteLanguageModel: ReturnType<typeof vi.fn>
}> {
  const dir = await createTempDir()
  const statePath = join(dir, 'state.json')
  await writeFile(
    statePath,
    JSON.stringify({
      ai: { mode: options.mode ?? 'remote', piiEnabled: options.piiEnabled ?? false }
    }),
    'utf8'
  )

  const domainPath = join(dir, 'domain')
  await mkdir(join(domainPath, '.ordicab', 'templates'), { recursive: true })

  const generateOneShot = vi.fn(async () => options.modelResponse ?? '[]')
  const configureRemoteLanguageModel = vi.fn(async () => {})
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
    configureRemoteLanguageModel,
    nerModelPath: options.nerModelPath ?? null,
    isNerModelReady: async () => options.nerModelReady ?? true
  })

  return { service, templateService, domainPath, generateOneShot, configureRemoteLanguageModel }
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

  it('keeps FR alias tags from the model as authored', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Me Durand vous écrit.</p>',
      modelResponse: JSON.stringify([
        { originalText: 'Me Durand', suggestedTag: 'contact.nomAffiche', confidence: 'high' }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]?.suggestedTag).toBe('contact.nomAffiche')
  })

  it('keeps only the most confident routine when the AI maps one literal twice', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse: JSON.stringify([
        { originalText: 'Jean Dupont', suggestedTag: 'contact.displayName', confidence: 'medium' },
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals).toEqual([
      {
        originalText: 'Jean Dupont',
        suggestedTag: 'contact.client.displayName',
        confidence: 'high',
        occurrences: 1
      }
    ])
  })

  it('keeps the exact source text when the AI normalizes non-breaking spaces', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean&nbsp;Dupont.</p>',
      modelResponse: JSON.stringify([
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]?.originalText.replace(/\s/g, ' ')).toBe('Jean Dupont')
    expect(result.proposals[0]).toMatchObject({
      suggestedTag: 'contact.client.displayName',
      occurrences: 1
    })
  })

  it('tolerates trailing commas and markdown code fences in the model output', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse:
        '```json\n[\n  { "originalText": "Jean Dupont", "suggestedTag": "contact.client.displayName", "confidence": "high" },\n]\n```'
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]?.originalText).toBe('Jean Dupont')
  })

  it('extracts the proposal array from prose with stray brackets around it', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse:
        'Voici les valeurs détectées [voir ci-dessous] :\n' +
        '[ { "originalText": "Jean Dupont", "suggestedTag": "contact.client.displayName", "confidence": "high" } ]\n' +
        'Ces propositions [1] sont à valider.'
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]?.originalText).toBe('Jean Dupont')
  })

  it('accepts common field-name variants from the model', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse: JSON.stringify({
        proposals: [{ text: 'Jean Dupont', tag: 'contact.client.displayName', confidence: 'high' }]
      })
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals[0]).toMatchObject({
      originalText: 'Jean Dupont',
      suggestedTag: 'contact.client.displayName'
    })
  })

  it('keeps valid proposals when the model marks some entries with a null tag', async () => {
    const { service, generateOneShot } = await createFixture({
      template: createTemplate(),
      html: '<p>Nice, le 12 juin. Cher Jean Dupont.</p>',
      // Observed in the wild: the model flags "no tag found" as suggestedTag: null.
      modelResponse: JSON.stringify([
        { originalText: 'Nice, le ', suggestedTag: null, confidence: 'low' },
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(generateOneShot).toHaveBeenCalledTimes(1)
    expect(result.proposals).toEqual([
      {
        originalText: 'Jean Dupont',
        suggestedTag: 'contact.client.displayName',
        confidence: 'high',
        occurrences: 1
      }
    ])
  })

  it('treats an all-malformed proposal array as a failure and retries', async () => {
    const { service, generateOneShot } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse: JSON.stringify([
        { originalText: 'Jean Dupont', suggestedTag: null, confidence: 'high' }
      ])
    })

    await expect(service.analyze({ templateUuid: 'tpl-1' })).rejects.toThrow(
      'The AI response did not match the expected proposal format.'
    )
    expect(generateOneShot).toHaveBeenCalledTimes(2)
  })

  it('drops proposals that overlap an existing {{tag}} in the document', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher {{contact.partieRepresentee.formuleAppel}}, votre affaire Jean Dupont avance.</p>',
      modelResponse: JSON.stringify([
        // Re-tagging an existing tag (with or without braces) must be ignored…
        {
          originalText: '{{contact.partieRepresentee.formuleAppel}}',
          suggestedTag: 'contact.partieRepresentee.dear',
          confidence: 'high'
        },
        {
          originalText: 'contact.partieRepresentee.formuleAppel',
          suggestedTag: 'contact.partieRepresentee.dear',
          confidence: 'high'
        },
        // …while plain text outside tags is still proposable.
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        }
      ])
    })

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(result.proposals).toEqual([
      {
        originalText: 'Jean Dupont',
        suggestedTag: 'contact.client.displayName',
        confidence: 'high',
        occurrences: 1
      }
    ])
  })

  it('retries with a fresh call when the model output is unusable, then succeeds', async () => {
    const { service, generateOneShot } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse: JSON.stringify([
        {
          originalText: 'Jean Dupont',
          suggestedTag: 'contact.client.displayName',
          confidence: 'high'
        }
      ])
    })
    // Degenerate first response observed in the wild: no JSON array at all.
    generateOneShot.mockResolvedValueOnce('omitemptyO###补充 整理后针对模版替换推荐：')

    const result = await service.analyze({ templateUuid: 'tpl-1' })
    expect(generateOneShot).toHaveBeenCalledTimes(2)
    expect(result.proposals[0]?.originalText).toBe('Jean Dupont')
  })

  it('gives up after the retry when the model keeps returning garbage', async () => {
    const { service, generateOneShot } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      modelResponse: 'toujours pas de JSON'
    })

    await expect(service.analyze({ templateUuid: 'tpl-1' })).rejects.toThrow(
      'The AI response is not valid JSON.'
    )
    expect(generateOneShot).toHaveBeenCalledTimes(2)
  })

  it('reconfigures the runtime with the requested model before calling it', async () => {
    const { service, generateOneShot, configureRemoteLanguageModel } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>'
    })

    await service.analyze({ templateUuid: 'tpl-1', model: 'google/gemma-4-31B-it' })
    expect(configureRemoteLanguageModel).toHaveBeenCalledWith('google/gemma-4-31B-it')
    expect(configureRemoteLanguageModel.mock.invocationCallOrder[0]).toBeLessThan(
      generateOneShot.mock.invocationCallOrder[0] ?? Infinity
    )
  })

  it('lets the dialog disable PII for one analysis while the global setting stays on', async () => {
    const { service } = await createFixture({
      template: createTemplate(),
      html: '<p>Cher Jean Dupont.</p>',
      piiEnabled: true,
      nerModelPath: '/missing/ner-model',
      nerModelReady: false
    })

    // Without an override the fail-closed NER gate blocks the remote call…
    await expect(service.analyze({ templateUuid: 'tpl-1' })).rejects.toMatchObject({
      code: 'AI_RUNTIME_UNAVAILABLE'
    })

    // …but an explicit per-analysis opt-out skips pseudonymization entirely.
    const result = await service.analyze({ templateUuid: 'tpl-1', piiEnabled: false })
    expect(result.proposals).toEqual([])
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
