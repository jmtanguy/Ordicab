/**
 * templateService — orchestrates everything related to the active domain's
 * templates.json index plus the per-template `.html` content files and
 * optional `.docx` companions.
 *
 * The renderer-facing IPC handler (`templateHandler`) and the AI command
 * dispatchers (`intentDispatcher`, `dataToolExecutor`) both go through this
 * service so the file-system layout, the schema migration from the legacy
 * inline-content format and the DOCX import pipeline all live in one place.
 *
 * The service deliberately does not depend on `electron`. Picking a `.docx`
 * source via the OS file picker stays in the handler; the service only
 * accepts an absolute path and handles the import/extraction.
 *
 * Called by:
 *   - templateHandler (IPC `template.*`)
 *   - intentDispatcher (`template_list/select/create/update/delete`)
 *   - dataToolExecutor (read-only listings for the embedded assistant)
 *   - container.ts (DOCX file-watcher → `syncDocx`)
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import HTMLToDOCX from 'html-to-docx'
import mammoth from 'mammoth'
import PizZip from 'pizzip'

import {
  IpcErrorCode,
  type DomainStatusSnapshot,
  type TemplateDocumentKind,
  type TemplateRecord
} from '@shared/types'

import { templateRecordSchema } from '@shared/validation'
import {
  normalizeTagPath,
  RAW_TAG_PATTERN,
  shouldExposeTemplateTagPath,
  TAG_SPAN_PATTERN
} from '@shared/templateContent'
import { ESSENTIAL_TEMPLATE_IDS, getLibraryItem } from '@shared/templateLibrary'

import { pathExists } from '../../lib/system/domainState'
import {
  getDomainCabinetDefaultTemplateDocxPath,
  getDomainTemplateContentPath,
  getDomainTemplateDocxPath,
  getDomainTemplatesPath
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

type MammothConverter = {
  convertToHtml: (
    input: { path: string },
    options?: {
      styleMap?: string[]
      ignoreEmptyParagraphs?: boolean
      transformDocument?: (document: unknown) => unknown
    }
  ) => Promise<{ value?: string }>
}

const mammothConverter = mammoth as unknown as MammothConverter

const DOCX_STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Titre 1'] => h1:fresh",
  "p[style-name='Titre 2'] => h2:fresh",
  "p[style-name='Titre 3'] => h3:fresh",
  'b => strong',
  'i => em',
  'u => u',
  'strike => s'
]

export class TemplateServiceError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TemplateServiceError'
  }
}

export interface TemplateService {
  list(): Promise<TemplateRecord[]>
  getContent(templateUuid: string): Promise<string>
  create(input: {
    name: string
    content: string
    description?: string
    tags?: string[]
    documentKind?: TemplateDocumentKind
    category?: string
  }): Promise<TemplateRecord>
  update(input: {
    uuid: string
    name?: string
    content?: string
    description?: string
    tags?: string[]
    documentKind?: TemplateDocumentKind
    category?: string
  }): Promise<TemplateRecord>
  delete(input: { uuid: string }): Promise<void>
  /**
   * Seed the essential default templates (factures, conventions, première
   * correspondance) when `templates.json` is empty or missing. Idempotent:
   * a no-op once any template exists. Safe to call when no domain is
   * configured — it just resolves to `{ seeded: 0 }`. Triggered at app
   * startup and after every successful domain selection.
   */
  seedDefaultTemplatesIfEmpty(): Promise<{ seeded: number }>
  /**
   * Re-wrap every existing non-email template that has a DOCX companion in
   * the current cabinet default DOCX. The body of each template's `.docx`
   * is extracted as-is (preserving any manual Word edits) and re-injected
   * into a fresh copy of the cabinet template. Used by the renderer right
   * after the user uploads a new cabinet DOCX.
   */
  applyCabinetDocxToAllExisting(): Promise<{
    updated: number
    skipped: number
    failed: string[]
  }>
  /** Convert a .docx at the given path to HTML — used by handler for preview before import. */
  convertDocxToHtml(filePath: string): Promise<string>
  /** Import a .docx file as the source for an existing template id and rebuild HTML + macros. */
  importDocxFromPath(input: { uuid: string; sourceFilePath: string }): Promise<TemplateRecord>
  /**
   * Copies the cabinet-level default DOCX template (set on the EntityProfile) onto a text
   * template, making it a DOCX-backed template. The existing HTML content is preserved and
   * will be injected at generation time into the cabinet template's `{{app.content}}` placeholder.
   */
  applyCabinetDefaultDocx(input: { uuid: string }): Promise<TemplateRecord>
  /** Remove the .docx companion of a template; flips hasDocxSource to false. */
  removeDocx(input: { uuid: string }): Promise<TemplateRecord>
  /** Whether the template currently has a `.docx` companion in the active domain. */
  hasDocxSource(id: string): Promise<boolean>
  /** Filesystem path of the `.docx` companion in the active domain. */
  getDocxPath(id: string): Promise<string>
  /**
   * Re-converts the persisted `.docx` for a template, refreshes the `.html`
   * content file and rebuilds macros + updatedAt in templates.json.
   * Returns null when the template has no `.docx` companion or when the
   * conversion fails (no error surfaced — the watcher loop tolerates misses).
   */
  syncDocx(templateUuid: string): Promise<{ html: string } | null>
}

function transformDocumentWithStyles(document: unknown): unknown {
  const mammothTransforms = (
    mammoth as unknown as {
      transforms?: {
        paragraph: (fn: (paragraph: unknown) => unknown) => (document: unknown) => unknown
      }
    }
  ).transforms
  if (!mammothTransforms) {
    return document
  }

  const transformParagraph = mammothTransforms.paragraph((paragraph) => {
    const styles: string[] = []

    const p = paragraph as Record<string, unknown>
    const alignment = p['alignment'] as string | undefined
    if (alignment === 'center') styles.push('text-align: center')
    else if (alignment === 'right') styles.push('text-align: right')
    else if (alignment === 'justify') styles.push('text-align: justify')

    const indent = p['indent'] as Record<string, number> | undefined
    if (indent?.left && indent.left > 0) {
      styles.push(`margin-left: ${Math.round(indent.left / 914)}em`)
    }

    if (styles.length === 0) {
      return paragraph
    }

    return {
      ...p,
      attributes: {
        ...(p['attributes'] as Record<string, unknown>),
        style: styles.join('; ')
      }
    }
  })

  return transformParagraph(document)
}

function extractMacrosFromHtml(html: string): string[] {
  const seen = new Set<string>()

  for (const match of html.matchAll(TAG_SPAN_PATTERN)) {
    const path = normalizeTagPath((match[2] ?? '').trim())
    if (path && shouldExposeTemplateTagPath(path)) seen.add(path)
  }

  for (const match of html.matchAll(RAW_TAG_PATTERN)) {
    const path = normalizeTagPath((match[1] ?? '').trim())
    if (path && shouldExposeTemplateTagPath(path)) seen.add(path)
  }

  return [...seen].sort()
}

function toTemplateIndexRecord(template: TemplateRecord): TemplateRecord {
  const indexRecord = { ...template }
  delete indexRecord.content
  return indexRecord
}

function isEmailTemplate(tags: string[] | undefined): boolean {
  return (tags ?? []).some((tag) => tag.trim().toLowerCase() === 'email')
}

async function htmlToStandaloneDocxBuffer(html: string, title: string): Promise<Buffer> {
  const output = await HTMLToDOCX(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${html || '<p></p>'}</body></html>`,
    undefined,
    {
      title,
      creator: 'Ordicab',
      font: 'Aptos',
      fontSize: 22,
      decodeUnicode: true,
      lang: 'fr-FR'
    }
  )
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer)
}

function extractBodyInnerFromDocxBuffer(docxBuffer: Buffer): string {
  const zip = new PizZip(docxBuffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) {
    throw new Error('Le contenu DOCX est introuvable (word/document.xml manquant).')
  }
  const match = /<w:body[^>]*>([\s\S]*?)<\/w:body>/.exec(docXml)
  if (!match) {
    throw new Error('Impossible de localiser le corps du document DOCX.')
  }
  return match[1]!.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '')
}

function wrapBodyInCabinetDocx(bodyInner: string, cabinetDocxBuffer: Buffer): Buffer {
  const cabinetZip = new PizZip(cabinetDocxBuffer)
  const cabinetDocFile = cabinetZip.file('word/document.xml')
  if (!cabinetDocFile) {
    throw new Error('Le modèle DOCX cabinet est invalide (word/document.xml manquant).')
  }
  const cabinetDocXml = cabinetDocFile.asText()
  const cabinetBodyOpenRe = /<w:body[^>]*>/
  if (!cabinetBodyOpenRe.test(cabinetDocXml)) {
    throw new Error('Le modèle DOCX cabinet est invalide (balise <w:body> introuvable).')
  }
  const mergedDocXml = cabinetDocXml.replace(
    cabinetBodyOpenRe,
    (openTag) => `${openTag}${bodyInner}`
  )
  cabinetZip.file('word/document.xml', mergedDocXml)
  return cabinetZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

async function renderTemplateDocxBuffer(args: {
  html: string
  name: string
  cabinetDocxBuffer: Buffer | null
}): Promise<Buffer> {
  const standalone = await htmlToStandaloneDocxBuffer(args.html, args.name)
  if (!args.cabinetDocxBuffer) {
    return standalone
  }
  const bodyInner = extractBodyInnerFromDocxBuffer(standalone)
  return wrapBodyInCabinetDocx(bodyInner, args.cabinetDocxBuffer)
}

function normalizeTemplateNameForComparison(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function createTemplateService(options: {
  domainService: DomainServiceLike
}): TemplateService {
  const { domainService } = options

  async function resolveDomainPath(): Promise<string> {
    const status = await domainService.getStatus()
    if (!status.registeredDomainPath) {
      throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
    }
    if (!status.isAvailable) {
      throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
    }
    return status.registeredDomainPath
  }

  async function loadTemplates(templatesPath: string): Promise<TemplateRecord[]> {
    if (!(await pathExists(templatesPath))) {
      return []
    }

    let raw: string
    try {
      raw = await readFile(templatesPath, 'utf8')
    } catch {
      throw new TemplateServiceError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read templates.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new TemplateServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored templates are invalid.'
      )
    }

    const result = templateRecordSchema.array().safeParse(parsed)
    if (!result.success) {
      throw new TemplateServiceError(
        IpcErrorCode.VALIDATION_FAILED,
        'Stored templates are invalid.'
      )
    }

    return result.data.map(toTemplateIndexRecord)
  }

  async function saveTemplates(templatesPath: string, templates: TemplateRecord[]): Promise<void> {
    await atomicWrite(
      templatesPath,
      `${JSON.stringify(templates.map(toTemplateIndexRecord), null, 2)}\n`
    )
  }

  async function writeTemplateContent(
    domainPath: string,
    id: string,
    content: string
  ): Promise<void> {
    const contentPath = getDomainTemplateContentPath(domainPath, id)
    await mkdir(dirname(contentPath), { recursive: true })
    await writeFile(contentPath, content, 'utf8')
  }

  async function readTemplateContent(domainPath: string, id: string): Promise<string> {
    const contentPath = getDomainTemplateContentPath(domainPath, id)
    if (!(await pathExists(contentPath))) {
      return ''
    }
    try {
      return await readFile(contentPath, 'utf8')
    } catch {
      return ''
    }
  }

  async function deleteTemplateContent(domainPath: string, id: string): Promise<void> {
    try {
      await unlink(getDomainTemplateContentPath(domainPath, id))
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  function ensureNoDuplicateTemplateName(
    templates: TemplateRecord[],
    name: string,
    excludeId?: string
  ): void {
    const normalized = normalizeTemplateNameForComparison(name)
    const duplicate = templates.some((template) => {
      if (template.uuid === excludeId) {
        return false
      }
      return normalizeTemplateNameForComparison(template.name) === normalized
    })

    if (duplicate) {
      throw new TemplateServiceError(
        IpcErrorCode.INVALID_INPUT,
        'A template with this name already exists.'
      )
    }
  }

  function requireTemplate(
    templates: TemplateRecord[],
    uuid: string
  ): { index: number; template: TemplateRecord } {
    const index = templates.findIndex((t) => t.uuid === uuid)
    const template = index >= 0 ? templates[index] : undefined
    if (index < 0 || !template) {
      throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'This template was not found.')
    }
    return { index, template }
  }

  function buildTemplateRecord(input: {
    uuid: string
    name: string
    description?: string
    tags?: string[]
    macros: string[]
    hasDocxSource?: boolean
    documentKind?: TemplateDocumentKind
    category?: string
    updatedAt: string
  }): TemplateRecord {
    return templateRecordSchema.parse(input)
  }

  async function copyDocxAtomically(sourcePath: string, destinationPath: string): Promise<void> {
    await mkdir(dirname(destinationPath), { recursive: true })
    const temporaryPath = `${destinationPath}.tmp`
    await copyFile(sourcePath, temporaryPath)
    await rename(temporaryPath, destinationPath)
  }

  return {
    async seedDefaultTemplatesIfEmpty(): Promise<{ seeded: number }> {
      const status = await domainService.getStatus()
      if (!status.registeredDomainPath || !status.isAvailable) {
        return { seeded: 0 }
      }
      const domainPath = status.registeredDomainPath
      const templatesPath = getDomainTemplatesPath(domainPath)
      const existing = await loadTemplates(templatesPath)
      if (existing.length > 0) {
        return { seeded: 0 }
      }

      let seeded = 0
      for (const id of ESSENTIAL_TEMPLATE_IDS) {
        const item = getLibraryItem(id)
        if (!item) {
          console.warn(`[TemplateService] Essential template id "${id}" not found in library.`)
          continue
        }
        try {
          await this.create({
            name: item.name,
            content: item.content,
            description: item.description,
            tags: item.tags,
            documentKind: item.kind ?? 'document'
          })
          seeded += 1
        } catch (error) {
          console.warn(
            `[TemplateService] Failed to seed essential template "${item.name}": ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      return { seeded }
    },

    async applyCabinetDocxToAllExisting(): Promise<{
      updated: number
      skipped: number
      failed: string[]
    }> {
      const domainPath = await resolveDomainPath()
      const cabinetDocxPath = getDomainCabinetDefaultTemplateDocxPath(domainPath)

      if (!(await pathExists(cabinetDocxPath))) {
        throw new TemplateServiceError(
          IpcErrorCode.NOT_FOUND,
          'Modèle DOCX cabinet par défaut introuvable.'
        )
      }

      const cabinetBuffer = await readFile(cabinetDocxPath)
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      let updated = 0
      let skipped = 0
      const failed: string[] = []
      const nextTemplates = [...templates]

      for (let i = 0; i < nextTemplates.length; i += 1) {
        const template = nextTemplates[i]!
        if (isEmailTemplate(template.tags) || !template.hasDocxSource) {
          skipped += 1
          continue
        }
        try {
          const existingDocxPath = getDomainTemplateDocxPath(domainPath, template.uuid)
          const existingBuffer = await readFile(existingDocxPath)
          const bodyInner = extractBodyInnerFromDocxBuffer(existingBuffer)
          const merged = wrapBodyInCabinetDocx(bodyInner, cabinetBuffer)
          await mkdir(dirname(existingDocxPath), { recursive: true })
          await atomicWrite(existingDocxPath, merged)
          nextTemplates[i] = buildTemplateRecord({
            ...template,
            updatedAt: new Date().toISOString()
          })
          updated += 1
        } catch (error) {
          console.warn(
            `[TemplateService] Failed to re-wrap template "${template.name}" with new cabinet DOCX: ${error instanceof Error ? error.message : String(error)}`
          )
          failed.push(template.uuid)
        }
      }

      if (updated > 0) {
        await saveTemplates(templatesPath, nextTemplates)
      }
      return { updated, skipped, failed }
    },

    async list(): Promise<TemplateRecord[]> {
      const domainPath = await resolveDomainPath()
      return loadTemplates(getDomainTemplatesPath(domainPath))
    },

    async getContent(templateUuid: string): Promise<string> {
      const domainPath = await resolveDomainPath()
      return readTemplateContent(domainPath, templateUuid)
    },

    async create(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      ensureNoDuplicateTemplateName(templates, input.name)

      const uuid = randomUUID()
      await writeTemplateContent(domainPath, uuid, input.content)

      // Non-email templates get a DOCX companion materialized at creation time:
      // cabinet wrapper if available, plain html-to-docx otherwise. Failure is
      // logged and falls back to hasDocxSource=false — never blocks creation.
      let hasDocxSource = false
      if (!isEmailTemplate(input.tags) && input.content) {
        try {
          const cabinetDocxPath = getDomainCabinetDefaultTemplateDocxPath(domainPath)
          const cabinetBuffer = (await pathExists(cabinetDocxPath))
            ? await readFile(cabinetDocxPath)
            : null
          const docxBuffer = await renderTemplateDocxBuffer({
            html: input.content,
            name: input.name,
            cabinetDocxBuffer: cabinetBuffer
          })
          const destinationPath = getDomainTemplateDocxPath(domainPath, uuid)
          await mkdir(dirname(destinationPath), { recursive: true })
          await atomicWrite(destinationPath, docxBuffer)
          hasDocxSource = true
        } catch (error) {
          console.warn(
            `[TemplateService] Failed to materialize DOCX for template "${input.name}": ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      const nextTemplate = buildTemplateRecord({
        uuid,
        name: input.name,
        description: input.description,
        tags: input.tags,
        macros: extractMacrosFromHtml(input.content),
        hasDocxSource,
        documentKind: input.documentKind ?? 'document',
        category: input.category?.trim() || undefined,
        updatedAt: new Date().toISOString()
      })

      await saveTemplates(templatesPath, [...templates, nextTemplate])
      return nextTemplate
    },

    async update(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.uuid)

      const nextName = input.name ?? template.name
      if (input.name && input.name !== template.name) {
        ensureNoDuplicateTemplateName(templates, input.name, input.uuid)
      }

      // Macros come from the new content if provided, otherwise stay as-is.
      let nextMacros = template.macros
      if (input.content !== undefined) {
        await writeTemplateContent(domainPath, input.uuid, input.content)
        nextMacros = extractMacrosFromHtml(input.content)
      }

      const nextTemplate = buildTemplateRecord({
        uuid: input.uuid,
        name: nextName,
        description: input.description ?? template.description,
        tags: input.tags ?? template.tags,
        macros: nextMacros,
        hasDocxSource: template.hasDocxSource,
        documentKind: input.documentKind ?? template.documentKind,
        // Explicit empty string clears the category; undefined keeps the stored one
        category:
          input.category !== undefined ? input.category.trim() || undefined : template.category,
        updatedAt: new Date().toISOString()
      })

      const nextTemplates = [...templates]
      nextTemplates[index] = nextTemplate
      await saveTemplates(templatesPath, nextTemplates)
      return nextTemplate
    },

    async delete(input): Promise<void> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { template } = requireTemplate(templates, input.uuid)

      const nextTemplates = templates.filter((t) => t.uuid !== input.uuid)
      await saveTemplates(templatesPath, nextTemplates)
      await deleteTemplateContent(domainPath, input.uuid)

      if (template.hasDocxSource) {
        try {
          await unlink(getDomainTemplateDocxPath(domainPath, input.uuid))
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error
          }
        }
      }
    },

    async convertDocxToHtml(filePath: string): Promise<string> {
      try {
        const result = await mammothConverter.convertToHtml(
          { path: filePath },
          {
            styleMap: DOCX_STYLE_MAP,
            ignoreEmptyParagraphs: false,
            transformDocument: (document) => transformDocumentWithStyles(document)
          }
        )
        return result.value ?? '<p></p>'
      } catch {
        // Conversion failures are non-fatal at the picker stage — the caller
        // shows a placeholder content and lets the user decide whether to
        // import.
        return '<p></p>'
      }
    },

    async importDocxFromPath(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.uuid)
      const destinationPath = getDomainTemplateDocxPath(domainPath, input.uuid)

      await copyDocxAtomically(input.sourceFilePath, destinationPath)

      let extractedContent = await readTemplateContent(domainPath, template.uuid)
      try {
        const { value } = await mammoth.convertToHtml({ path: input.sourceFilePath })
        if (value) {
          extractedContent = value
        }
      } catch {
        // Extraction failure is non-fatal — preserve existing content
      }

      await writeTemplateContent(domainPath, template.uuid, extractedContent)

      const nextTemplate = buildTemplateRecord({
        ...template,
        macros: extractMacrosFromHtml(extractedContent),
        hasDocxSource: true,
        updatedAt: new Date().toISOString()
      })
      const nextTemplates = [...templates]
      nextTemplates[index] = nextTemplate
      await saveTemplates(templatesPath, nextTemplates)
      return nextTemplate
    },

    async applyCabinetDefaultDocx(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const cabinetDocxPath = getDomainCabinetDefaultTemplateDocxPath(domainPath)

      if (!(await pathExists(cabinetDocxPath))) {
        throw new TemplateServiceError(
          IpcErrorCode.NOT_FOUND,
          'Modèle DOCX cabinet par défaut introuvable.'
        )
      }

      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.uuid)
      const destinationPath = getDomainTemplateDocxPath(domainPath, input.uuid)

      const templateHtml = await readTemplateContent(domainPath, template.uuid)

      let renderedBuffer: Buffer
      try {
        const cabinetBuffer = await readFile(cabinetDocxPath)
        renderedBuffer = await renderTemplateDocxBuffer({
          html: templateHtml,
          name: template.name,
          cabinetDocxBuffer: cabinetBuffer
        })
      } catch (error) {
        throw new TemplateServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          `Impossible d'insérer le contenu dans le modèle DOCX cabinet : ${error instanceof Error ? error.message : String(error)}`
        )
      }

      await mkdir(dirname(destinationPath), { recursive: true })
      await atomicWrite(destinationPath, renderedBuffer)

      const nextTemplate = buildTemplateRecord({
        ...template,
        hasDocxSource: true,
        updatedAt: new Date().toISOString()
      })
      const nextTemplates = [...templates]
      nextTemplates[index] = nextTemplate
      await saveTemplates(templatesPath, nextTemplates)
      return nextTemplate
    },

    async removeDocx(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.uuid)

      try {
        await unlink(getDomainTemplateDocxPath(domainPath, input.uuid))
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw error
        }
      }

      const nextTemplate = buildTemplateRecord({
        ...template,
        hasDocxSource: false,
        updatedAt: new Date().toISOString()
      })
      const nextTemplates = [...templates]
      nextTemplates[index] = nextTemplate
      await saveTemplates(templatesPath, nextTemplates)
      return nextTemplate
    },

    async hasDocxSource(id: string): Promise<boolean> {
      const domainPath = await resolveDomainPath()
      return pathExists(getDomainTemplateDocxPath(domainPath, id))
    },

    async getDocxPath(id: string): Promise<string> {
      const domainPath = await resolveDomainPath()
      return getDomainTemplateDocxPath(domainPath, id)
    },

    async syncDocx(templateUuid: string): Promise<{ html: string } | null> {
      const domainPath = await resolveDomainPath()
      const docxPath = getDomainTemplateDocxPath(domainPath, templateUuid)

      if (!(await pathExists(docxPath))) {
        return null
      }

      let html: string
      try {
        const result = await mammothConverter.convertToHtml(
          { path: docxPath },
          {
            styleMap: DOCX_STYLE_MAP,
            ignoreEmptyParagraphs: false,
            transformDocument: (document) => transformDocumentWithStyles(document)
          }
        )
        html = result.value || '<p></p>'
      } catch {
        return null
      }

      await writeTemplateContent(domainPath, templateUuid, html)

      try {
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath)
        const index = templates.findIndex((t) => t.uuid === templateUuid)
        const template = index >= 0 ? templates[index] : undefined
        if (template) {
          const nextTemplate = buildTemplateRecord({
            ...template,
            macros: extractMacrosFromHtml(html),
            updatedAt: new Date().toISOString()
          })
          const nextTemplates = [...templates]
          nextTemplates[index] = nextTemplate
          await saveTemplates(templatesPath, nextTemplates)
        }
      } catch {
        // Non-fatal — HTML was already written, metadata update failure is acceptable
      }

      return { html }
    }
  }
}
