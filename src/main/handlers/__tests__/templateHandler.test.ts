import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS, IpcErrorCode, type IpcResult, type TemplateRecord } from '@shared/types'

import { createTemplateService } from '../../services/domain/templateService'
import { registerTemplateHandlers } from '../templateHandler'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ordicab-template-handler-'))
  tempDirs.push(dir)
  return dir
}

function createIpcMainHarness(): {
  invoke: (channel: string, input?: unknown) => Promise<unknown>
  ipcMain: {
    handle: (
      channel: string,
      listener: (_event: unknown, input?: unknown) => Promise<unknown>
    ) => void
  }
} {
  const handlers = new Map<string, (_event: unknown, input?: unknown) => Promise<unknown>>()

  return {
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      }
    },
    invoke: async (channel, input) => {
      const handler = handlers.get(channel)

      if (!handler) {
        throw new Error(`No IPC handler registered for ${channel}`)
      }

      return handler({}, input)
    }
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('templateHandler', () => {
  it('lists templates from templates.json and returns an empty array when the file is missing', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    await expect(harness.invoke(IPC_CHANNELS.template.list)).resolves.toEqual({
      success: true,
      data: []
    })
  })

  it('creates templates atomically, trims names, persists content, and blocks duplicates', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: '  Courrier client  ',
      content: 'Bonjour {{client}}'
    })) as IpcResult<TemplateRecord>

    expect(created).toMatchObject({
      success: true,
      data: {
        name: 'Courrier client',
        macros: ['client']
      }
    })
    expect(created.success && created.data.uuid).toBeTruthy()

    const createdId = created.success ? created.data.uuid : ''
    const storedHtml = await readFile(
      join(domainPath, '.ordicab', 'templates', `${createdId}.html`),
      'utf8'
    )
    expect(storedHtml).toBe('Bonjour {{client}}')

    const stored = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'templates.json'), 'utf8')
    ) as TemplateRecord[]

    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: 'Courrier client',
      macros: ['client']
    })
    expect(stored[0]).not.toHaveProperty('content')

    await expect(
      harness.invoke(IPC_CHANNELS.template.create, {
        name: 'courrier client',
        content: 'Autre contenu'
      })
    ).resolves.toEqual({
      success: false,
      error: 'A template with this name already exists.',
      code: IpcErrorCode.INVALID_INPUT
    })
  })

  it('updates and deletes templates in templates.json', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier',
      content: 'Version 1'
    })) as IpcResult<TemplateRecord>
    const createdId = created.success ? created.data.uuid : ''

    await expect(
      harness.invoke(IPC_CHANNELS.template.update, {
        uuid: createdId,
        name: 'Courrier final',
        content: 'Version 2'
      })
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        uuid: createdId,
        name: 'Courrier final',
        macros: []
      })
    })

    await expect(
      harness.invoke(IPC_CHANNELS.template.delete, {
        uuid: createdId
      })
    ).resolves.toEqual({
      success: true,
      data: null
    })

    const stored = JSON.parse(
      await readFile(join(domainPath, '.ordicab', 'templates.json'), 'utf8')
    ) as TemplateRecord[]

    expect(stored).toEqual([])
  })

  it('imports a docx file, marks the template, opens it natively, removes it, and cleans it on delete', async () => {
    const domainPath = await createTempDir()
    const sourceDir = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    const sourceDocxPath = join(sourceDir, 'template.docx')
    await writeFile(sourceDocxPath, Buffer.from('docx-binary'))

    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [sourceDocxPath]
    }))
    const openPath = vi.fn(async () => '')

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService }),
      showOpenDialog,
      openPath
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier',
      content: 'Version 1'
    })) as IpcResult<TemplateRecord>
    const createdId = created.success ? created.data.uuid : ''

    await expect(
      harness.invoke(IPC_CHANNELS.template.importDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        uuid: createdId,
        hasDocxSource: true
      })
    })

    const importedDocxPath = join(domainPath, '.ordicab', 'templates', `${createdId}.docx`)
    await expect(readFile(importedDocxPath)).resolves.toEqual(Buffer.from('docx-binary'))

    await expect(
      harness.invoke(IPC_CHANNELS.template.openDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: true,
      data: null
    })
    expect(openPath).toHaveBeenCalledWith(importedDocxPath)

    await expect(
      harness.invoke(IPC_CHANNELS.template.removeDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        uuid: createdId,
        hasDocxSource: false
      })
    })

    await expect(
      harness.invoke(IPC_CHANNELS.template.importDocx, { uuid: createdId })
    ).resolves.toMatchObject({
      success: true
    })

    await expect(
      harness.invoke(IPC_CHANNELS.template.delete, { uuid: createdId })
    ).resolves.toEqual({
      success: true,
      data: null
    })

    await expect(readFile(importedDocxPath)).rejects.toThrow()
  })

  it('returns an error when shell.openPath fails to open the file', async () => {
    const domainPath = await createTempDir()
    const sourceDir = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    const sourceDocxPath = join(sourceDir, 'template.docx')
    await writeFile(sourceDocxPath, Buffer.from('docx-binary'))

    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: [sourceDocxPath]
    }))
    const openPath = vi.fn(async () => 'No application is registered to open this file.')

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService }),
      showOpenDialog,
      openPath
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier',
      content: 'Version 1'
    })) as IpcResult<TemplateRecord>
    const createdId = created.success ? created.data.uuid : ''

    await harness.invoke(IPC_CHANNELS.template.importDocx, { uuid: createdId })

    await expect(
      harness.invoke(IPC_CHANNELS.template.openDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: false,
      error: 'No application is registered to open this file.',
      code: IpcErrorCode.FILE_SYSTEM_ERROR
    })
  })

  it('treats docx import cancel, missing binaries, and missing source file cleanup gracefully', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const showOpenDialog = vi.fn(async () => ({
      canceled: true,
      filePaths: []
    }))
    const openPath = vi.fn(async () => '')

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService }),
      showOpenDialog,
      openPath
    })

    // Email templates intentionally skip the auto-DOCX materialization, which
    // gives us a clean baseline to assert the missing-DOCX failure modes below.
    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier',
      content: 'Version 1',
      tags: ['email']
    })) as IpcResult<TemplateRecord>
    const createdId = created.success ? created.data.uuid : ''

    await expect(
      harness.invoke(IPC_CHANNELS.template.importDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: false,
      error: 'Cancelled by user',
      code: IpcErrorCode.VALIDATION_FAILED
    })

    await expect(
      harness.invoke(IPC_CHANNELS.template.openDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: false,
      error: 'DOCX source was not found.',
      code: IpcErrorCode.NOT_FOUND
    })

    await expect(
      harness.invoke(IPC_CHANNELS.template.removeDocx, { uuid: createdId })
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        uuid: createdId,
        hasDocxSource: false
      })
    })
  })

  it('returns validation failures when stored templates JSON is malformed', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })
    await writeFile(join(domainPath, '.ordicab', 'templates.json'), '{not-json}\n', 'utf8')

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    await expect(harness.invoke(IPC_CHANNELS.template.list)).resolves.toEqual({
      success: false,
      error: 'Stored templates are invalid.',
      code: IpcErrorCode.VALIDATION_FAILED
    })
  })

  it('does not include content in returned TemplateRecord from create, update, or list', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }

    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier',
      content: '<p>Hello {{client}}</p>'
    })) as IpcResult<TemplateRecord>

    expect(created.success && 'content' in created.data).toBe(false)

    const createdId = created.success ? created.data.uuid : ''

    const updated = (await harness.invoke(IPC_CHANNELS.template.update, {
      uuid: createdId,
      name: 'Courrier v2',
      content: '<p>Bonjour {{client}}</p>'
    })) as IpcResult<TemplateRecord>

    expect(updated.success && 'content' in updated.data).toBe(false)

    const listed = (await harness.invoke(IPC_CHANNELS.template.list)) as IpcResult<TemplateRecord[]>
    expect(listed.success && listed.data.every((r) => !('content' in r))).toBe(true)
  })

  it('persists the category through the full IPC round-trip (create, lightweight move, list)', async () => {
    const domainPath = await createTempDir()
    await mkdir(join(domainPath, '.ordicab'), { recursive: true })

    const harness = createIpcMainHarness()
    const domainService = {
      getStatus: vi.fn(async () => ({
        registeredDomainPath: domainPath,
        isAvailable: true,
        dossierCount: 0
      }))
    }
    registerTemplateHandlers({
      ipcMain: harness.ipcMain,
      templateService: createTemplateService({ domainService })
    })

    const created = (await harness.invoke(IPC_CHANNELS.template.create, {
      name: 'Courrier RDV',
      content: '<p>BODY</p>',
      tags: ['email'],
      category: 'Correspondance'
    })) as IpcResult<TemplateRecord>
    expect(created.success && created.data.category).toBe('Correspondance')

    const createdId = created.success ? created.data.uuid : ''

    // Drag-and-drop style lightweight update: no content in the payload
    const moved = (await harness.invoke(IPC_CHANNELS.template.update, {
      uuid: createdId,
      name: 'Courrier RDV',
      category: 'Procédure'
    })) as IpcResult<TemplateRecord>
    expect(moved.success && moved.data.category).toBe('Procédure')

    // Content untouched by the lightweight update
    const content = (await harness.invoke(IPC_CHANNELS.template.getContent, {
      uuid: createdId
    })) as IpcResult<string>
    expect(content.success && content.data).toContain('BODY')

    const listed = (await harness.invoke(IPC_CHANNELS.template.list)) as IpcResult<TemplateRecord[]>
    expect(listed.success && listed.data[0]?.category).toBe('Procédure')
  })
})
