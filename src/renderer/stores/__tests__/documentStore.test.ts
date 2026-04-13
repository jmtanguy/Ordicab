import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DocumentAvailabilityEvent,
  DocumentChangeEvent,
  DocumentExtractedContent,
  DocumentPreview,
  DocumentRecord,
  OrdicabAPI
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { useDocumentStore } from '../documentStore'

type MutableGlobal = typeof globalThis & { ordicabAPI?: OrdicabAPI }

function createDocument(options: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'letter.txt',
    dossierId: 'dos-1',
    filename: 'letter.txt',
    byteLength: 11,
    relativePath: 'letter.txt',
    modifiedAt: '2026-03-14T10:00:00.000Z',
    description: undefined,
    tags: [],
    textExtraction: { state: 'extractable', isExtractable: true },
    ...options
  }
}

describe('documentStore', () => {
  beforeEach(() => {
    useDocumentStore.setState(useDocumentStore.getInitialState(), true)
    delete (globalThis as MutableGlobal).ordicabAPI
  })

  it('loads documents, subscribes to watcher events, and refreshes on change notifications', async () => {
    let changeListener: ((event: DocumentChangeEvent) => void) | undefined
    let availabilityListener: ((event: DocumentAvailabilityEvent) => void) | undefined
    const list = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: [createDocument()] })
      .mockResolvedValueOnce({
        success: true as const,
        data: [
          createDocument({
            id: 'evidence/photo.png',
            filename: 'photo.png',
            relativePath: 'evidence/photo.png'
          })
        ]
      })
    const startWatching = vi.fn(async () => ({
      success: true as const,
      data: {
        dossierId: 'dos-1',
        status: 'available' as const,
        changedAt: '2026-03-14T10:00:00.000Z',
        message: null
      }
    }))
    const stopWatching = vi.fn(async () => ({ success: true as const, data: null }))
    const unsubscribeChanged = vi.fn()
    const unsubscribeAvailability = vi.fn()

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list,
        saveMetadata: vi.fn(),
        startWatching,
        stopWatching,
        onDidChange: (listener) => {
          changeListener = listener
          return unsubscribeChanged
        },
        onAvailabilityChanged: (listener) => {
          availabilityListener = listener
          return unsubscribeAvailability
        }
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().open({ dossierId: 'dos-1' })

    expect(useDocumentStore.getState().documentsByDossierId['dos-1']).toEqual([createDocument()])
    expect(useDocumentStore.getState().watchStatusByDossierId['dos-1']).toEqual(
      expect.objectContaining({
        status: 'available'
      })
    )

    changeListener?.({
      dossierId: 'dos-1',
      kind: 'documents-changed',
      changedAt: '2026-03-14T10:00:05.000Z'
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(list).toHaveBeenCalledTimes(2)
    expect(useDocumentStore.getState().documentsByDossierId['dos-1']).toEqual([
      createDocument({
        id: 'evidence/photo.png',
        filename: 'photo.png',
        relativePath: 'evidence/photo.png'
      })
    ])

    availabilityListener?.({
      dossierId: 'dos-1',
      status: 'unavailable',
      changedAt: '2026-03-14T10:00:06.000Z',
      message: 'Waiting for dossier folder to come back online.'
    })

    expect(useDocumentStore.getState().watchStatusByDossierId['dos-1']).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        message: 'Waiting for dossier folder to come back online.'
      })
    )

    await useDocumentStore.getState().closeActive()

    expect(stopWatching).toHaveBeenCalledWith({ dossierId: 'dos-1' })
    expect(unsubscribeChanged).toHaveBeenCalledTimes(1)
    expect(unsubscribeAvailability).toHaveBeenCalledTimes(1)
  })

  it('load fetches documents without starting a watcher', async () => {
    const list = vi.fn(async () => ({
      success: true as const,
      data: [createDocument()]
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })

    expect(list).toHaveBeenCalledWith({ dossierId: 'dos-1' })
    expect(useDocumentStore.getState().documentsByDossierId['dos-1']).toEqual([createDocument()])
    expect(useDocumentStore.getState().watchStatusByDossierId['dos-1']).toBeUndefined()
  })

  it('saveMetadata patches the document in the store on success', async () => {
    const updatedDoc = createDocument({
      description: 'Incoming note',
      tags: ['urgent']
    })
    const saveMetadata = vi.fn(async () => ({ success: true as const, data: updatedDoc }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        saveMetadata,
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    await useDocumentStore.getState().saveMetadata({
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      description: 'Incoming note',
      tags: ['urgent']
    })

    expect(saveMetadata).toHaveBeenCalledWith({
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      description: 'Incoming note',
      tags: ['urgent']
    })
    expect(useDocumentStore.getState().documentsByDossierId['dos-1']?.[0]?.description).toBe(
      'Incoming note'
    )
    expect(useDocumentStore.getState().documentsByDossierId['dos-1']?.[0]?.tags).toEqual(['urgent'])
  })

  it('saveMetadata preserves the latest saved metadata when a watcher refresh returns stale rows', async () => {
    let changeListener: ((event: DocumentChangeEvent) => void) | undefined
    const list = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: [createDocument()] })
      .mockResolvedValueOnce({ success: true as const, data: [createDocument()] })
      .mockResolvedValueOnce({
        success: true as const,
        data: [createDocument({ description: 'Incoming note', tags: ['urgent'] })]
      })
    const saveMetadata = vi.fn(async () => ({
      success: true as const,
      data: createDocument({ description: 'Incoming note', tags: ['urgent'] })
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list,
        saveMetadata,
        startWatching: vi.fn(async () => ({
          success: true as const,
          data: {
            dossierId: 'dos-1',
            status: 'available' as const,
            changedAt: '2026-03-14T10:00:00.000Z',
            message: null
          }
        })),
        stopWatching: vi.fn(async () => ({ success: true as const, data: null })),
        onDidChange: (listener) => {
          changeListener = listener
          return vi.fn()
        },
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().open({ dossierId: 'dos-1' })
    await useDocumentStore.getState().saveMetadata({
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      description: 'Incoming note',
      tags: ['urgent']
    })

    changeListener?.({
      dossierId: 'dos-1',
      kind: 'documents-changed',
      changedAt: '2026-03-14T10:00:05.000Z'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useDocumentStore.getState().documentsByDossierId['dos-1']?.[0]).toMatchObject({
      description: 'Incoming note',
      tags: ['urgent']
    })

    changeListener?.({
      dossierId: 'dos-1',
      kind: 'documents-changed',
      changedAt: '2026-03-14T10:00:06.000Z'
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useDocumentStore.getState().metadataOverridesByDossierId['dos-1'] ?? {}).toEqual({})
  })

  it('extractContent stores extracted text and updates the document extraction status', async () => {
    const extractedContent: DocumentExtractedContent = {
      documentId: 'letter.txt',
      filename: 'letter.txt',
      text: 'Extracted body',
      textLength: 14,
      method: 'cached',
      status: { state: 'extracted', isExtractable: true }
    }
    const extractContent = vi.fn(async () => ({
      success: true as const,
      data: extractedContent
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        preview: vi.fn(),
        contentStatus: vi.fn(),
        extractContent,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        openFile: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    const success = await useDocumentStore.getState().extractContent({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })

    expect(success).toBe(true)
    expect(extractContent).toHaveBeenCalledWith({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })
    expect(useDocumentStore.getState().contentStatesByDossierId['dos-1']?.['letter.txt']).toEqual({
      status: 'ready',
      content: extractedContent,
      error: null
    })
    expect(useDocumentStore.getState().documentsByDossierId['dos-1']?.[0]?.textExtraction).toEqual({
      state: 'extracted',
      isExtractable: true
    })
  })

  it('extractContent with forceRefresh bypasses the ready content cache', async () => {
    const firstExtractedContent: DocumentExtractedContent = {
      documentId: 'letter.txt',
      filename: 'letter.txt',
      text: 'Old body',
      textLength: 8,
      method: 'cached',
      status: { state: 'extracted', isExtractable: true }
    }
    const refreshedExtractedContent: DocumentExtractedContent = {
      ...firstExtractedContent,
      text: 'New body',
      method: 'tesseract'
    }
    const extractContent = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: firstExtractedContent })
      .mockResolvedValueOnce({ success: true as const, data: refreshedExtractedContent })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        preview: vi.fn(),
        contentStatus: vi.fn(),
        extractContent,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        openFile: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    await useDocumentStore.getState().extractContent({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })
    await useDocumentStore.getState().extractContent({
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      forceRefresh: true
    })

    expect(extractContent).toHaveBeenNthCalledWith(1, {
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })
    expect(extractContent).toHaveBeenNthCalledWith(2, {
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      forceRefresh: true
    })
    expect(useDocumentStore.getState().contentStatesByDossierId['dos-1']?.['letter.txt']).toEqual({
      status: 'ready',
      content: refreshedExtractedContent,
      error: null
    })
  })

  it('saveMetadata sets error on failure', async () => {
    const saveMetadata = vi.fn(async () => ({
      success: false as const,
      error: 'Document metadata save failed',
      code: IpcErrorCode.UNKNOWN
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        saveMetadata,
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    await useDocumentStore.getState().saveMetadata({
      dossierId: 'dos-1',
      documentId: 'letter.txt',
      description: 'Incoming note',
      tags: ['urgent']
    })

    expect(useDocumentStore.getState().error).toBe('Document metadata save failed')
  })

  it('loads, caches, and closes document previews through the store without direct component IPC', async () => {
    const preview: DocumentPreview = {
      kind: 'text',
      sourceType: 'txt',
      documentId: 'letter.txt',
      filename: 'letter.txt',
      mimeType: 'text/plain',
      byteLength: 11,
      text: 'Letter body'
    }
    const previewSpy = vi.fn(async () => ({ success: true as const, data: preview }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        preview: previewSpy,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    await useDocumentStore.getState().openPreview({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })

    expect(previewSpy).toHaveBeenCalledTimes(1)
    expect(useDocumentStore.getState().activePreviewDocumentIdByDossierId['dos-1']).toBe(
      'letter.txt'
    )
    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['letter.txt']
    ).toMatchObject({
      status: 'ready',
      preview
    })

    await useDocumentStore.getState().openPreview({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })

    expect(previewSpy).toHaveBeenCalledTimes(1)

    useDocumentStore.getState().closePreview('dos-1')

    expect(useDocumentStore.getState().activePreviewDocumentIdByDossierId['dos-1']).toBeNull()
  })

  it('sets error state when openPreview IPC call fails', async () => {
    const previewSpy = vi.fn(async () => ({
      success: false as const,
      error: 'Document preview failed',
      code: IpcErrorCode.FILE_SYSTEM_ERROR
    }))

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        preview: previewSpy,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })
    await useDocumentStore.getState().openPreview({
      dossierId: 'dos-1',
      documentId: 'letter.txt'
    })

    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['letter.txt']
    ).toMatchObject({
      status: 'error',
      preview: null,
      error: 'Document preview failed'
    })
  })

  it('loads PDF, DOCX, image, and email preview payloads through the store', async () => {
    const pdfPreview: DocumentPreview = {
      kind: 'pdf',
      sourceType: 'pdf',
      documentId: 'brochure.pdf',
      filename: 'brochure.pdf',
      mimeType: 'application/pdf',
      byteLength: 4,
      data: new ArrayBuffer(4)
    }
    const docxPreview: DocumentPreview = {
      kind: 'docx',
      sourceType: 'docx',
      documentId: 'brief.docx',
      filename: 'brief.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteLength: 4,
      data: new ArrayBuffer(4)
    }
    const imagePreview: DocumentPreview = {
      kind: 'image',
      sourceType: 'tif',
      documentId: 'scan.tif',
      filename: 'scan.tif',
      mimeType: 'image/tiff',
      byteLength: 4,
      data: new ArrayBuffer(4)
    }
    const emailPreview: DocumentPreview = {
      kind: 'email',
      sourceType: 'msg',
      documentId: 'mail.msg',
      filename: 'mail.msg',
      mimeType: 'application/vnd.ms-outlook',
      byteLength: 4,
      subject: 'Client follow-up',
      from: 'advisor@example.com',
      to: 'client@example.com',
      cc: null,
      date: '2026-03-14T12:05:00.000Z',
      attachments: ['scan.tif'],
      text: 'MSG body'
    }
    const previewSpy = vi
      .fn()
      .mockResolvedValueOnce({ success: true as const, data: pdfPreview })
      .mockResolvedValueOnce({ success: true as const, data: docxPreview })
      .mockResolvedValueOnce({ success: true as const, data: imagePreview })
      .mockResolvedValueOnce({ success: true as const, data: emailPreview })

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({
          success: true as const,
          data: [
            createDocument({ id: 'brochure.pdf', filename: 'brochure.pdf' }),
            createDocument({ id: 'brief.docx', filename: 'brief.docx' }),
            createDocument({ id: 'scan.tif', filename: 'scan.tif' }),
            createDocument({ id: 'mail.msg', filename: 'mail.msg' })
          ]
        })),
        preview: previewSpy,
        saveMetadata: vi.fn(),
        startWatching: vi.fn(),
        stopWatching: vi.fn(),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().load({ dossierId: 'dos-1' })

    await useDocumentStore
      .getState()
      .openPreview({ dossierId: 'dos-1', documentId: 'brochure.pdf' })
    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['brochure.pdf']
    ).toMatchObject({ status: 'ready', preview: pdfPreview })

    await useDocumentStore.getState().openPreview({ dossierId: 'dos-1', documentId: 'brief.docx' })
    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['brief.docx']
    ).toMatchObject({ status: 'ready', preview: docxPreview })

    await useDocumentStore.getState().openPreview({ dossierId: 'dos-1', documentId: 'scan.tif' })
    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['scan.tif']
    ).toMatchObject({ status: 'ready', preview: imagePreview })

    await useDocumentStore.getState().openPreview({ dossierId: 'dos-1', documentId: 'mail.msg' })
    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['mail.msg']
    ).toMatchObject({ status: 'ready', preview: emailPreview })

    expect(previewSpy).toHaveBeenCalledTimes(4)
  })

  it('closeActive clears preview states for all dossiers', async () => {
    const preview: DocumentPreview = {
      kind: 'text',
      sourceType: 'txt',
      documentId: 'letter.txt',
      filename: 'letter.txt',
      mimeType: 'text/plain',
      byteLength: 11,
      text: 'Letter body'
    }

    ;(globalThis as MutableGlobal).ordicabAPI = {
      document: {
        list: vi.fn(async () => ({ success: true as const, data: [createDocument()] })),
        preview: vi.fn(async () => ({ success: true as const, data: preview })),
        saveMetadata: vi.fn(),
        startWatching: vi.fn(async () => ({
          success: true as const,
          data: {
            dossierId: 'dos-1',
            status: 'available' as const,
            changedAt: '2026-03-14T10:00:00.000Z',
            message: null
          }
        })),
        stopWatching: vi.fn(async () => ({ success: true as const, data: null })),
        onDidChange: vi.fn(() => vi.fn()),
        onAvailabilityChanged: vi.fn(() => vi.fn())
      }
    } as unknown as OrdicabAPI

    await useDocumentStore.getState().open({ dossierId: 'dos-1' })
    await useDocumentStore.getState().openPreview({ dossierId: 'dos-1', documentId: 'letter.txt' })

    expect(
      useDocumentStore.getState().previewStatesByDossierId['dos-1']?.['letter.txt']?.status
    ).toBe('ready')

    await useDocumentStore.getState().closeActive()

    expect(useDocumentStore.getState().previewStatesByDossierId).toEqual({})
    expect(useDocumentStore.getState().activePreviewDocumentIdByDossierId).toEqual({})
  })
})
