import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OrdicabAPI, TemplateRecord } from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { useTemplateStore } from '../templateStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: 'tpl-1',
    name: 'Courrier client',
    macros: [],
    hasDocxSource: false,
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides
  }
}

describe('templateStore', () => {
  beforeEach(() => {
    useTemplateStore.setState(useTemplateStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('loads templates through the preload bridge', async () => {
    const list = vi.fn(async () => ({
      success: true as const,
      data: [createTemplate()]
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      template: {
        list,
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        importDocx: vi.fn(),
        openDocx: vi.fn(),
        removeDocx: vi.fn()
      }
    } as unknown as OrdicabAPI

    await useTemplateStore.getState().load()

    expect(list).toHaveBeenCalledTimes(1)
    expect(useTemplateStore.getState().templates).toEqual([createTemplate()])
  })

  it('creates, updates, and removes templates in store state', async () => {
    const create = vi.fn(async () => ({
      success: true as const,
      data: createTemplate()
    }))
    const update = vi.fn(async () => ({
      success: true as const,
      data: createTemplate({
        name: 'Courrier final'
      })
    }))
    const remove = vi.fn(async () => ({
      success: true as const,
      data: null
    }))
    const importDocx = vi.fn(async () => ({
      success: true as const,
      data: createTemplate({ hasDocxSource: true })
    }))
    const openDocx = vi.fn(async () => ({
      success: true as const,
      data: null
    }))
    const removeDocx = vi.fn(async () => ({
      success: true as const,
      data: createTemplate({ hasDocxSource: false })
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      template: {
        list: vi.fn(async () => ({ success: true as const, data: [] })),
        create,
        update,
        delete: remove,
        importDocx,
        openDocx,
        removeDocx
      }
    } as unknown as OrdicabAPI

    await useTemplateStore.getState().create({
      name: 'Courrier client',
      content: 'Bonjour {{client}}'
    })

    await useTemplateStore.getState().update({
      id: 'tpl-1',
      name: 'Courrier final',
      content: 'Version finale'
    })
    await useTemplateStore.getState().importDocx('tpl-1')
    await expect(useTemplateStore.getState().openDocx('tpl-1')).resolves.toEqual({
      success: true,
      data: null
    })
    await useTemplateStore.getState().removeDocx('tpl-1')

    await useTemplateStore.getState().remove('tpl-1')

    expect(useTemplateStore.getState().templates).toEqual([])
  })

  it('generates a document through the preload bridge and returns the result', async () => {
    const generate = vi.fn(async () => ({
      success: true as const,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
      }
    }))
    const preview = vi.fn(async () => ({
      success: true as const,
      data: {
        draftHtml: '<p>Hello</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['entity.firmName']
      }
    }))
    const save = vi.fn(async () => ({
      success: true as const,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.docx'
      }
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      generate: {
        document: generate,
        preview,
        save
      }
    } as unknown as OrdicabAPI

    await expect(
      useTemplateStore.getState().generate({
        dossierId: 'dos-1',
        templateId: 'tpl-1'
      })
    ).resolves.toEqual({
      success: true,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.txt'
      }
    })

    expect(generate).toHaveBeenCalledWith({
      dossierId: 'dos-1',
      templateId: 'tpl-1'
    })

    await expect(
      useTemplateStore.getState().preview({
        dossierId: 'dos-1',
        templateId: 'tpl-1'
      })
    ).resolves.toEqual({
      success: true,
      data: {
        draftHtml: '<p>Hello</p>',
        suggestedFilename: 'Convocation-2026-03-15',
        unresolvedTags: ['entity.firmName']
      }
    })

    await expect(
      useTemplateStore.getState().saveGeneratedDocument({
        dossierId: 'dos-1',
        filename: 'Convocation-2026-03-15',
        format: 'docx' as const,
        html: '<p>Hello</p>'
      })
    ).resolves.toEqual({
      success: true,
      data: {
        outputPath: '/tmp/Client Alpha/Convocation-2026-03-15.docx'
      }
    })
  })

  it('returns the error result without mutating store error state when generation preview or save fails', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      generate: {
        document: vi.fn(async () => ({
          success: false as const,
          error: 'Template was not found.',
          code: IpcErrorCode.NOT_FOUND
        })),
        preview: vi.fn(async () => ({
          success: false as const,
          error: 'Unable to prepare draft.',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        })),
        save: vi.fn(async () => ({
          success: false as const,
          error: 'Unable to save generated document.',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        }))
      }
    } as unknown as OrdicabAPI

    const result = await useTemplateStore.getState().generate({
      dossierId: 'dos-1',
      templateId: 'missing-id'
    })

    expect(result).toEqual({
      success: false,
      error: 'Template was not found.',
      code: IpcErrorCode.NOT_FOUND
    })
    // generate/preview/save actions do not write to store state — callers handle errors locally
    expect(useTemplateStore.getState().error).toBeNull()
    expect(useTemplateStore.getState().errorCode).toBeNull()

    const previewResult = await useTemplateStore.getState().preview({
      dossierId: 'dos-1',
      templateId: 'missing-id'
    })

    expect(previewResult).toEqual({
      success: false,
      error: 'Unable to prepare draft.',
      code: IpcErrorCode.FILE_SYSTEM_ERROR
    })

    const saveResult = await useTemplateStore.getState().saveGeneratedDocument({
      dossierId: 'dos-1',
      filename: 'draft',
      format: 'docx' as const,
      html: '<p>Hello</p>'
    })

    expect(saveResult).toEqual({
      success: false,
      error: 'Unable to save generated document.',
      code: IpcErrorCode.FILE_SYSTEM_ERROR
    })
  })

  it('surfaces API failures during template actions', async () => {
    ;(globalThis as MutableGlobal).ordicabAPI = {
      template: {
        list: vi.fn(async () => ({
          success: false as const,
          error: 'Load failed',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        })),
        create: vi.fn(async () => ({
          success: false as const,
          error: 'A template with this name already exists.',
          code: IpcErrorCode.INVALID_INPUT
        })),
        update: vi.fn(async () => ({
          success: false as const,
          error: 'Template not found',
          code: IpcErrorCode.NOT_FOUND
        })),
        delete: vi.fn(async () => ({
          success: false as const,
          error: 'Delete failed',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        })),
        importDocx: vi.fn(async () => ({
          success: false as const,
          error: 'Import failed',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        })),
        openDocx: vi.fn(async () => ({
          success: false as const,
          error: 'Missing DOCX',
          code: IpcErrorCode.NOT_FOUND
        })),
        removeDocx: vi.fn(async () => ({
          success: false as const,
          error: 'Remove failed',
          code: IpcErrorCode.FILE_SYSTEM_ERROR
        }))
      }
    } as unknown as OrdicabAPI

    await useTemplateStore.getState().load()
    expect(useTemplateStore.getState().error).toBe('Load failed')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)

    await useTemplateStore.getState().create({
      name: 'Courrier client',
      content: 'Bonjour'
    })
    expect(useTemplateStore.getState().error).toBe('A template with this name already exists.')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.INVALID_INPUT)

    await useTemplateStore.getState().update({
      id: 'missing-id',
      name: 'Courrier client',
      content: 'Bonjour'
    })
    expect(useTemplateStore.getState().error).toBe('Template not found')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.NOT_FOUND)

    await useTemplateStore.getState().remove('missing-id')
    expect(useTemplateStore.getState().error).toBe('Delete failed')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)

    await useTemplateStore.getState().importDocx('missing-id')
    expect(useTemplateStore.getState().error).toBe('Import failed')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)

    await expect(useTemplateStore.getState().openDocx('missing-id')).resolves.toEqual({
      success: false,
      error: 'Missing DOCX',
      code: IpcErrorCode.NOT_FOUND
    })

    await useTemplateStore.getState().removeDocx('missing-id')
    expect(useTemplateStore.getState().error).toBe('Remove failed')
    expect(useTemplateStore.getState().errorCode).toBe(IpcErrorCode.FILE_SYSTEM_ERROR)
  })
})
