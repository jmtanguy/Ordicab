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

import mammoth from 'mammoth'

import { IpcErrorCode, type DomainStatusSnapshot, type TemplateRecord } from '@shared/types'

import { templateRecordSchema } from '@shared/validation'
import { normalizeTagPath, RAW_TAG_PATTERN, TAG_SPAN_PATTERN } from '@shared/templateContent'

import { pathExists } from '../../lib/system/domainState'
import {
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
  getContent(templateId: string): Promise<string>
  create(input: { name: string; content: string; description?: string }): Promise<TemplateRecord>
  update(input: {
    id: string
    name?: string
    content?: string
    description?: string
  }): Promise<TemplateRecord>
  delete(input: { id: string }): Promise<void>
  /**
   * One-shot migration from the legacy `templates.json` shape (where each
   * record had its HTML inline under `content`) to the current shape (one
   * `<id>.html` file per template, no `content` in the index). Idempotent:
   * a no-op once `templates.json` no longer carries inline content. Safe to
   * call when no domain is configured — it just resolves to `{ migrated: false }`.
   * Container.ts invokes this once at startup; nothing else should call it.
   */
  migrateLegacyTemplatesIfNeeded(): Promise<{ migrated: boolean }>
  /** Convert a .docx at the given path to HTML — used by handler for preview before import. */
  convertDocxToHtml(filePath: string): Promise<string>
  /** Import a .docx file as the source for an existing template id and rebuild HTML + macros. */
  importDocxFromPath(input: { id: string; sourceFilePath: string }): Promise<TemplateRecord>
  /** Remove the .docx companion of a template; flips hasDocxSource to false. */
  removeDocx(input: { id: string }): Promise<TemplateRecord>
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
  syncDocx(templateId: string): Promise<{ html: string } | null>
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
    if (path) seen.add(path)
  }

  for (const match of html.matchAll(RAW_TAG_PATTERN)) {
    const path = normalizeTagPath((match[1] ?? '').trim())
    if (path) seen.add(path)
  }

  return [...seen].sort()
}

function toTemplateIndexRecord(template: TemplateRecord): TemplateRecord {
  const indexRecord = { ...template }
  delete indexRecord.content
  delete indexRecord.tags
  return indexRecord
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

  /**
   * Inline-content migration. Kept separate from loadTemplates so that the
   * normal read path stays a pure parse — the migration runs once per process
   * at boot via container.ts, not on every IPC list call.
   */
  async function runLegacyMigration(
    templatesPath: string,
    domainPath: string
  ): Promise<{ migrated: boolean }> {
    if (!(await pathExists(templatesPath))) {
      return { migrated: false }
    }

    let raw: string
    try {
      raw = await readFile(templatesPath, 'utf8')
    } catch {
      return { migrated: false }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return { migrated: false }
    }

    const rawArray = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
    const needsMigration = rawArray.some((r) => typeof r.content === 'string' && r.content !== '')
    if (!needsMigration) {
      return { migrated: false }
    }

    const result = templateRecordSchema.array().safeParse(parsed)
    if (!result.success) {
      // Stored data is invalid — leave it for loadTemplates to surface as a
      // VALIDATION_FAILED error on the next read instead of silently rewriting.
      return { migrated: false }
    }

    for (const rawRecord of rawArray) {
      const inlineContent = typeof rawRecord.content === 'string' ? rawRecord.content : ''
      const id = typeof rawRecord.id === 'string' ? rawRecord.id : ''
      if (inlineContent && id) {
        const contentPath = getDomainTemplateContentPath(domainPath, id)
        await mkdir(dirname(contentPath), { recursive: true })
        await writeFile(contentPath, inlineContent, 'utf8')
      }
    }

    const migrated = result.data.map((r, i) => {
      const rawRecord = rawArray[i] ?? {}
      const inlineContent = typeof rawRecord.content === 'string' ? rawRecord.content : ''
      return {
        ...toTemplateIndexRecord(r),
        macros: r.macros.length > 0 ? r.macros : extractMacrosFromHtml(inlineContent)
      }
    })
    await saveTemplates(templatesPath, migrated)
    return { migrated: true }
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
      if (template.id === excludeId) {
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
    id: string
  ): { index: number; template: TemplateRecord } {
    const index = templates.findIndex((t) => t.id === id)
    const template = index >= 0 ? templates[index] : undefined
    if (index < 0 || !template) {
      throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'This template was not found.')
    }
    return { index, template }
  }

  function buildTemplateRecord(input: {
    id: string
    name: string
    description?: string
    macros: string[]
    hasDocxSource?: boolean
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
    async migrateLegacyTemplatesIfNeeded(): Promise<{ migrated: boolean }> {
      // Resolve the domain ourselves so the boot caller can stay agnostic of
      // domain readiness — a missing or unavailable domain is a silent skip.
      const status = await domainService.getStatus()
      if (!status.registeredDomainPath || !status.isAvailable) {
        return { migrated: false }
      }
      const domainPath = status.registeredDomainPath
      return runLegacyMigration(getDomainTemplatesPath(domainPath), domainPath)
    },

    async list(): Promise<TemplateRecord[]> {
      const domainPath = await resolveDomainPath()
      return loadTemplates(getDomainTemplatesPath(domainPath))
    },

    async getContent(templateId: string): Promise<string> {
      const domainPath = await resolveDomainPath()
      return readTemplateContent(domainPath, templateId)
    },

    async create(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      ensureNoDuplicateTemplateName(templates, input.name)

      const id = randomUUID()
      await writeTemplateContent(domainPath, id, input.content)

      const nextTemplate = buildTemplateRecord({
        id,
        name: input.name,
        description: input.description,
        macros: extractMacrosFromHtml(input.content),
        hasDocxSource: false,
        updatedAt: new Date().toISOString()
      })

      await saveTemplates(templatesPath, [...templates, nextTemplate])
      return nextTemplate
    },

    async update(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.id)

      const nextName = input.name ?? template.name
      if (input.name && input.name !== template.name) {
        ensureNoDuplicateTemplateName(templates, input.name, input.id)
      }

      // Macros come from the new content if provided, otherwise stay as-is.
      let nextMacros = template.macros
      if (input.content !== undefined) {
        await writeTemplateContent(domainPath, input.id, input.content)
        nextMacros = extractMacrosFromHtml(input.content)
      }

      const nextTemplate = buildTemplateRecord({
        id: input.id,
        name: nextName,
        description: input.description ?? template.description,
        macros: nextMacros,
        hasDocxSource: template.hasDocxSource,
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
      const { template } = requireTemplate(templates, input.id)

      const nextTemplates = templates.filter((t) => t.id !== input.id)
      await saveTemplates(templatesPath, nextTemplates)
      await deleteTemplateContent(domainPath, input.id)

      if (template.hasDocxSource) {
        try {
          await unlink(getDomainTemplateDocxPath(domainPath, input.id))
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
      const { index, template } = requireTemplate(templates, input.id)
      const destinationPath = getDomainTemplateDocxPath(domainPath, input.id)

      await copyDocxAtomically(input.sourceFilePath, destinationPath)

      let extractedContent = await readTemplateContent(domainPath, template.id)
      try {
        const { value } = await mammoth.convertToHtml({ path: input.sourceFilePath })
        if (value) {
          extractedContent = value
        }
      } catch {
        // Extraction failure is non-fatal — preserve existing content
      }

      await writeTemplateContent(domainPath, template.id, extractedContent)

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

    async removeDocx(input): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      const { index, template } = requireTemplate(templates, input.id)

      try {
        await unlink(getDomainTemplateDocxPath(domainPath, input.id))
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

    async syncDocx(templateId: string): Promise<{ html: string } | null> {
      const domainPath = await resolveDomainPath()
      const docxPath = getDomainTemplateDocxPath(domainPath, templateId)

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

      await writeTemplateContent(domainPath, templateId, html)

      try {
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath)
        const index = templates.findIndex((t) => t.id === templateId)
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
