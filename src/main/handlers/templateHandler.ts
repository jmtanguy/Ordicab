import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { dialog, shell } from 'electron'
import mammoth from 'mammoth'

import { ZodError } from 'zod'

import {
  IPC_CHANNELS,
  IpcErrorCode,
  type DomainStatusSnapshot,
  type IpcError,
  type IpcResult,
  type TemplateDeleteInput,
  type TemplateDocxInput,
  type TemplateDraft,
  type TemplateRecord,
  type TemplateUpdate
} from '@shared/types'

import {
  templateDeleteInputSchema,
  templateDocxInputSchema,
  templateDraftSchema,
  templateRecordSchema,
  templateUpdateSchema
} from '@renderer/schemas'

import { normalizeTagPath, RAW_TAG_PATTERN, TAG_SPAN_PATTERN } from '@shared/templateContent'

import { atomicWrite } from '../lib/system/atomicWrite'
import { pathExists } from '../lib/system/domainState'
import {
  getDomainTemplateContentPath,
  getDomainTemplateDocxPath,
  getDomainTemplatesPath
} from '../lib/ordicab/ordicabPaths'

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

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (_event: unknown, input?: unknown) => Promise<unknown>
  ) => void
}

interface DomainServiceLike {
  getStatus: () => Promise<DomainStatusSnapshot>
}

class TemplateHandlerError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TemplateHandlerError'
  }
}

function mapTemplateError(error: unknown, fallbackMessage: string): IpcError {
  if (error instanceof ZodError) {
    return {
      success: false,
      error: 'Invalid template input.',
      code: IpcErrorCode.VALIDATION_FAILED
    }
  }

  if (error instanceof TemplateHandlerError) {
    return {
      success: false,
      error: error.message,
      code: error.code
    }
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : fallbackMessage,
    code: IpcErrorCode.FILE_SYSTEM_ERROR
  }
}

async function resolveActiveDomainPath(domainService: DomainServiceLike): Promise<string> {
  const status = await domainService.getStatus()

  if (!status.registeredDomainPath) {
    throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'Active domain is not configured.')
  }

  if (!status.isAvailable) {
    throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'Active domain is unavailable.')
  }

  return status.registeredDomainPath
}

function normalizeTemplateNameForComparison(name: string): string {
  return name.trim().toLocaleLowerCase()
}

function toTemplateIndexRecord(template: TemplateRecord): TemplateRecord {
  const indexRecord = { ...template }
  delete indexRecord.content
  delete indexRecord.tags
  return indexRecord
}

async function loadTemplates(templatesPath: string, domainPath: string): Promise<TemplateRecord[]> {
  if (!(await pathExists(templatesPath))) {
    return []
  }

  let raw: string

  try {
    raw = await readFile(templatesPath, 'utf8')
  } catch {
    throw new TemplateHandlerError(IpcErrorCode.FILE_SYSTEM_ERROR, 'Unable to read templates.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new TemplateHandlerError(IpcErrorCode.VALIDATION_FAILED, 'Stored templates are invalid.')
  }

  const result = templateRecordSchema.array().safeParse(parsed)

  if (!result.success) {
    throw new TemplateHandlerError(IpcErrorCode.VALIDATION_FAILED, 'Stored templates are invalid.')
  }

  // Migration: if any record still has content inline (legacy format), offload it to individual files.
  const rawArray = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []
  const needsMigration = rawArray.some((r) => typeof r.content === 'string' && r.content !== '')

  if (needsMigration) {
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
    return migrated
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

function extractMacrosFromHtml(html: string): string[] {
  const seen = new Set<string>()

  for (const match of html.matchAll(TAG_SPAN_PATTERN)) {
    const path = normalizeTagPath(match[2].trim())
    if (path) seen.add(path)
  }

  for (const match of html.matchAll(RAW_TAG_PATTERN)) {
    const path = normalizeTagPath(match[1].trim())
    if (path) seen.add(path)
  }

  return [...seen].sort()
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

function ensureNoDuplicateName(
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
    throw new TemplateHandlerError(
      IpcErrorCode.INVALID_INPUT,
      'A template with this name already exists.'
    )
  }
}

function createTemplateRecord(input: {
  id: string
  name: string
  description?: string
  macros: string[]
  hasDocxSource?: boolean
  updatedAt: string
}): TemplateRecord {
  return templateRecordSchema.parse(input)
}

function findTemplateIndex(templates: TemplateRecord[], id: string): number {
  return templates.findIndex((template) => template.id === id)
}

function requireTemplate(
  templates: TemplateRecord[],
  id: string
): {
  index: number
  template: TemplateRecord
} {
  const index = findTemplateIndex(templates, id)

  if (index < 0) {
    throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'This template was not found.')
  }

  return {
    index,
    template: templates[index]
  }
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

async function copyDocxAtomically(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.tmp`
  await copyFile(sourcePath, temporaryPath)
  await rename(temporaryPath, destinationPath)
}

/**
 * Story 4.1 storage decision: keep template content inline in `templates.json`.
 * This preserves the existing CRUD-only IPC surface while making edit flows synchronous for the renderer.
 */
export function registerTemplateHandlers(options: {
  domainService: DomainServiceLike
  ipcMain: IpcMainLike
  showOpenDialog?: typeof dialog.showOpenDialog
  openPath?: (path: string) => Promise<string>
}): void {
  const showOpenDialog =
    options.showOpenDialog ??
    (async (...args: Parameters<typeof dialog.showOpenDialog>) => {
      if (!dialog?.showOpenDialog) {
        throw new TemplateHandlerError(
          IpcErrorCode.NOT_IMPLEMENTED,
          'DOCX import is unavailable in this environment.'
        )
      }

      return dialog.showOpenDialog(...args)
    })
  const openPath =
    options.openPath ??
    (async (path: string) => {
      if (!shell?.openPath) {
        throw new TemplateHandlerError(
          IpcErrorCode.NOT_IMPLEMENTED,
          'Native DOCX open is unavailable in this environment.'
        )
      }

      return shell.openPath(path)
    })

  options.ipcMain.handle(
    IPC_CHANNELS.template.list,
    async (): Promise<IpcResult<TemplateRecord[]>> => {
      try {
        const domainPath = await resolveActiveDomainPath(options.domainService)
        return {
          success: true,
          data: await loadTemplates(getDomainTemplatesPath(domainPath), domainPath)
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to load templates.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.getContent,
    async (_event, input: unknown): Promise<IpcResult<string>> => {
      try {
        const parsed = templateDeleteInputSchema.parse(input)
        const domainPath = await resolveActiveDomainPath(options.domainService)
        return {
          success: true,
          data: await readTemplateContent(domainPath, parsed.id)
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to load template content.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.create,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDraftSchema.parse(input) as TemplateDraft
        const domainPath = await resolveActiveDomainPath(options.domainService)
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath, domainPath)

        ensureNoDuplicateName(templates, parsed.name)

        const id = randomUUID()
        await writeTemplateContent(domainPath, id, parsed.content)

        const nextTemplate = createTemplateRecord({
          id,
          name: parsed.name,
          description: parsed.description,
          macros: extractMacrosFromHtml(parsed.content),
          hasDocxSource: false,
          updatedAt: new Date().toISOString()
        })

        await saveTemplates(templatesPath, [...templates, nextTemplate])

        return {
          success: true,
          data: nextTemplate
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to create template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.update,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateUpdateSchema.parse(input) as TemplateUpdate
        const domainPath = await resolveActiveDomainPath(options.domainService)
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath, domainPath)
        const { index, template } = requireTemplate(templates, parsed.id)

        ensureNoDuplicateName(templates, parsed.name, parsed.id)

        await writeTemplateContent(domainPath, parsed.id, parsed.content)

        const nextTemplate = createTemplateRecord({
          id: parsed.id,
          name: parsed.name,
          description: parsed.description,
          macros: extractMacrosFromHtml(parsed.content),
          hasDocxSource: template.hasDocxSource,
          updatedAt: new Date().toISOString()
        })

        const nextTemplates = [...templates]
        nextTemplates[index] = nextTemplate

        await saveTemplates(templatesPath, nextTemplates)

        return {
          success: true,
          data: nextTemplate
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to update template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.delete,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = templateDeleteInputSchema.parse(input) as TemplateDeleteInput
        const domainPath = await resolveActiveDomainPath(options.domainService)
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath, domainPath)
        const { template } = requireTemplate(templates, parsed.id)
        const nextTemplates = templates.filter(
          (currentTemplate) => currentTemplate.id !== parsed.id
        )

        await saveTemplates(templatesPath, nextTemplates)
        await deleteTemplateContent(domainPath, parsed.id)

        if (template.hasDocxSource) {
          try {
            await unlink(getDomainTemplateDocxPath(domainPath, parsed.id))
          } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
              throw error
            }
          }
        }

        return {
          success: true,
          data: null
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to delete template.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.pickDocxFile,
    async (): Promise<IpcResult<{ filePath: string; html: string } | null>> => {
      try {
        const pickerResult = await showOpenDialog({
          filters: [{ name: 'Word Documents', extensions: ['docx'] }],
          properties: ['openFile']
        })

        if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
          return { success: true, data: null }
        }

        const filePath = pickerResult.filePaths[0]
        let html = '<p></p>'

        try {
          const result = await mammothConverter.convertToHtml(
            { path: filePath },
            {
              styleMap: [
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
              ],
              ignoreEmptyParagraphs: false,
              transformDocument: (document) => {
                return transformDocumentWithStyles(document)
              }
            }
          )
          if (result.value) {
            html = result.value
          }
        } catch {
          // Non-fatal: return empty content
        }

        return { success: true, data: { filePath, html } }
      } catch (error) {
        return mapTemplateError(error, 'Unable to open file picker.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.importDocx,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput & {
          filePath?: string
        }

        let sourceFilePath: string

        if (parsed.filePath) {
          sourceFilePath = parsed.filePath
        } else {
          const pickerResult = await showOpenDialog({
            filters: [{ name: 'Word Documents', extensions: ['docx'] }],
            properties: ['openFile']
          })

          if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
            return {
              success: false,
              error: 'Cancelled by user',
              code: IpcErrorCode.VALIDATION_FAILED
            }
          }

          sourceFilePath = pickerResult.filePaths[0]
        }

        const domainPath = await resolveActiveDomainPath(options.domainService)
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath, domainPath)
        const { index, template } = requireTemplate(templates, parsed.id)
        const destinationPath = getDomainTemplateDocxPath(domainPath, parsed.id)

        await copyDocxAtomically(sourceFilePath, destinationPath)

        let extractedContent = await readTemplateContent(domainPath, template.id)
        try {
          const { value } = await mammoth.convertToHtml({ path: sourceFilePath })
          if (value) {
            extractedContent = value
          }
        } catch {
          // Extraction failure is non-fatal — preserve existing content
        }

        await writeTemplateContent(domainPath, template.id, extractedContent)

        const nextTemplate = createTemplateRecord({
          ...template,
          macros: extractMacrosFromHtml(extractedContent),
          hasDocxSource: true,
          updatedAt: new Date().toISOString()
        })
        const nextTemplates = [...templates]
        nextTemplates[index] = nextTemplate
        await saveTemplates(templatesPath, nextTemplates)

        return {
          success: true,
          data: nextTemplate
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to import DOCX source.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.openDocx,
    async (_event, input: unknown): Promise<IpcResult<null>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput
        const domainPath = await resolveActiveDomainPath(options.domainService)
        const docxPath = getDomainTemplateDocxPath(domainPath, parsed.id)

        if (!(await pathExists(docxPath))) {
          throw new TemplateHandlerError(IpcErrorCode.NOT_FOUND, 'DOCX source was not found.')
        }

        const openResult = await openPath(docxPath)
        if (openResult) {
          throw new TemplateHandlerError(IpcErrorCode.FILE_SYSTEM_ERROR, openResult)
        }

        return {
          success: true,
          data: null
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to open DOCX source.')
      }
    }
  )

  options.ipcMain.handle(
    IPC_CHANNELS.template.removeDocx,
    async (_event, input: unknown): Promise<IpcResult<TemplateRecord>> => {
      try {
        const parsed = templateDocxInputSchema.parse(input) as TemplateDocxInput
        const domainPath = await resolveActiveDomainPath(options.domainService)
        const templatesPath = getDomainTemplatesPath(domainPath)
        const templates = await loadTemplates(templatesPath, domainPath)
        const { index, template } = requireTemplate(templates, parsed.id)

        try {
          await unlink(getDomainTemplateDocxPath(domainPath, parsed.id))
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error
          }
        }

        const nextTemplate = createTemplateRecord({
          ...template,
          hasDocxSource: false,
          updatedAt: new Date().toISOString()
        })
        const nextTemplates = [...templates]
        nextTemplates[index] = nextTemplate
        await saveTemplates(templatesPath, nextTemplates)

        return {
          success: true,
          data: nextTemplate
        }
      } catch (error) {
        return mapTemplateError(error, 'Unable to remove DOCX source.')
      }
    }
  )
}

/**
 * Re-converts the stored .docx for a template to HTML, updates the .html file
 * and refreshes macros + updatedAt in templates.json.
 * Returns the new HTML string, or null if the docx file does not exist or conversion fails.
 */
export async function syncDocxTemplate(
  domainPath: string,
  templateId: string
): Promise<{ html: string } | null> {
  const docxPath = getDomainTemplateDocxPath(domainPath, templateId)

  if (!(await pathExists(docxPath))) {
    return null
  }

  let html: string

  try {
    const result = await mammothConverter.convertToHtml(
      { path: docxPath },
      {
        styleMap: [
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
        ],
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
    const templates = await loadTemplates(templatesPath, domainPath)
    const index = templates.findIndex((t) => t.id === templateId)

    if (index >= 0) {
      const template = templates[index]
      const nextTemplate = createTemplateRecord({
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
