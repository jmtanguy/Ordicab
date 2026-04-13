/**
 * templateService — service wrapper for reading and writing templates from the domain directory.
 *
 * Templates are stored in the active domain at paths resolved by
 * getDomainTemplatesPath() and getDomainTemplateContentPath().
 * This service allows intentDispatcher and aiService to access template data
 * directly without going through the templateHandler IPC path.
 *
 * Called by: intentDispatcher (template_select, field_populate, template_create, template_update, template_delete intents)
 *            aiService (context enrichment for system prompt)
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { DomainStatusSnapshot, TemplateRecord } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { templateRecordSchema } from '@renderer/schemas'
import { pathExists } from '../../lib/system/domainState'
import {
  getDomainTemplateContentPath,
  getDomainTemplatesPath
} from '../../lib/ordicab/ordicabPaths'
import { atomicWrite } from '../../lib/system/atomicWrite'

interface DomainServiceLike {
  getStatus(): Promise<DomainStatusSnapshot>
}

class TemplateServiceError extends Error {
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
}

export function createTemplateService(options: {
  domainService: DomainServiceLike
}): TemplateService {
  const { domainService } = options

  function toTemplateIndexRecord(template: TemplateRecord): TemplateRecord {
    const indexRecord = { ...template }
    delete indexRecord.content
    delete indexRecord.tags
    return indexRecord
  }

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
      return []
    }

    const result = templateRecordSchema.array().safeParse(parsed)
    return result.success ? result.data : []
  }

  async function saveTemplates(templatesPath: string, templates: TemplateRecord[]): Promise<void> {
    const index = templates.map((template) => {
      const record = { ...template }
      delete record.content
      return record
    })
    await atomicWrite(templatesPath, `${JSON.stringify(index, null, 2)}\n`)
  }

  function normalizeTemplateName(name: string): string {
    return name.trim().toLowerCase()
  }

  function ensureNoDuplicateTemplateName(
    templates: TemplateRecord[],
    name: string,
    excludeId?: string
  ): void {
    const normalized = normalizeTemplateName(name)
    const duplicate = templates.some((template) => {
      if (template.id === excludeId) {
        return false
      }
      return normalizeTemplateName(template.name) === normalized
    })

    if (duplicate) {
      throw new TemplateServiceError(
        IpcErrorCode.INVALID_INPUT,
        'A template with this name already exists.'
      )
    }
  }

  return {
    async list(): Promise<TemplateRecord[]> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)
      return templates.map(toTemplateIndexRecord)
    },

    async getContent(templateId: string): Promise<string> {
      const domainPath = await resolveDomainPath()
      const contentPath = getDomainTemplateContentPath(domainPath, templateId)

      if (!(await pathExists(contentPath))) {
        return ''
      }

      try {
        return await readFile(contentPath, 'utf8')
      } catch {
        throw new TemplateServiceError(
          IpcErrorCode.FILE_SYSTEM_ERROR,
          `Unable to read template content for ${templateId}.`
        )
      }
    },

    async create(input: {
      name: string
      content: string
      description?: string
    }): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      ensureNoDuplicateTemplateName(templates, input.name)

      const id = randomUUID()
      const contentPath = getDomainTemplateContentPath(domainPath, id)

      const newTemplate: TemplateRecord = {
        id,
        name: input.name,
        description: input.description,
        updatedAt: new Date().toISOString(),
        macros: [],
        hasDocxSource: false
      }

      // Write content file
      await atomicWrite(contentPath, input.content)
      // Update index
      await saveTemplates(templatesPath, [...templates, newTemplate])

      return newTemplate
    },

    async update(input: {
      id: string
      name?: string
      content?: string
      description?: string
    }): Promise<TemplateRecord> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      const index = templates.findIndex((t) => t.id === input.id)
      if (index < 0) {
        throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'Template not found.')
      }

      const current = templates[index]
      if (input.name && input.name !== current.name) {
        ensureNoDuplicateTemplateName(templates, input.name, input.id)
      }

      const updated: TemplateRecord = {
        ...current,
        name: input.name ?? current.name,
        description: input.description ?? current.description,
        updatedAt: new Date().toISOString()
      }

      // Update content if provided
      if (input.content !== undefined) {
        const contentPath = getDomainTemplateContentPath(domainPath, input.id)
        await atomicWrite(contentPath, input.content)
      }

      // Update index
      templates[index] = updated
      await saveTemplates(templatesPath, templates)

      return updated
    },

    async delete(input: { id: string }): Promise<void> {
      const domainPath = await resolveDomainPath()
      const templatesPath = getDomainTemplatesPath(domainPath)
      const templates = await loadTemplates(templatesPath)

      const nextTemplates = templates.filter((t) => t.id !== input.id)
      if (nextTemplates.length === templates.length) {
        throw new TemplateServiceError(IpcErrorCode.NOT_FOUND, 'Template not found.')
      }

      // Note: We don't delete the content file, just remove from index
      // This allows recovery if needed. The content file will be cleaned up
      // as part of normal file management operations.
      await saveTemplates(templatesPath, nextTemplates)
    }
  }
}
