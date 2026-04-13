import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DocumentAvailabilityEvent,
  DocumentChangeEvent,
  DocumentExtractedContent,
  DocumentMetadataUpdate,
  DocumentPreview,
  DocumentPreviewInput,
  DocumentRecord,
  DocumentWatchStatus,
  DossierScopedQuery
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

export interface DocumentPreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  preview: DocumentPreview | null
  error: string | null
}

export interface DocumentContentState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  content: DocumentExtractedContent | null
  error: string | null
}

interface DocumentStoreState {
  documentsByDossierId: Record<string, DocumentRecord[]>
  metadataOverridesByDossierId: Record<string, Record<string, DocumentRecord>>
  watchStatusByDossierId: Record<string, DocumentWatchStatus | null>
  previewStatesByDossierId: Record<string, Record<string, DocumentPreviewState>>
  contentStatesByDossierId: Record<string, Record<string, DocumentContentState>>
  activePreviewDocumentIdByDossierId: Record<string, string | null>
  activeDossierId: string | null
  isLoading: boolean
  isSavingMetadata: boolean
  error: string | null
}

interface DocumentStoreActions {
  load: (query: DossierScopedQuery) => Promise<void>
  open: (query: DossierScopedQuery) => Promise<void>
  closeActive: () => Promise<void>
  openPreview: (input: DocumentPreviewInput) => Promise<void>
  closePreview: (dossierId: string) => void
  extractContent: (input: DocumentPreviewInput) => Promise<boolean>
  extractPendingContent: (input: { dossierId: string }) => Promise<{
    attempted: number
    succeeded: number
    failed: number
  }>
  clearContentCache: (input: { dossierId: string }) => Promise<boolean>
  saveMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  openFile: (input: DocumentPreviewInput) => Promise<void>
}

type DocumentStore = DocumentStoreState & DocumentStoreActions

let unsubscribeDocumentChanges: (() => void) | null = null
let unsubscribeAvailabilityChanges: (() => void) | null = null

function metadataMatches(left: DocumentRecord, right: DocumentRecord): boolean {
  return (
    left.description === right.description && left.tags.join('\u0000') === right.tags.join('\u0000')
  )
}

function mergeDocumentsWithOverrides(
  documents: DocumentRecord[],
  overrides: Record<string, DocumentRecord> | undefined
): {
  documents: DocumentRecord[]
  remainingOverrides: Record<string, DocumentRecord>
} {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { documents, remainingOverrides: {} }
  }

  const remainingOverrides = { ...overrides }
  const mergedDocuments = documents.map((document) => {
    const override = overrides[document.id]

    if (!override) {
      return document
    }

    if (metadataMatches(document, override)) {
      delete remainingOverrides[document.id]
      return document
    }

    return {
      ...document,
      description: override.description,
      tags: override.tags
    }
  })

  return {
    documents: mergedDocuments,
    remainingOverrides
  }
}

function reconcilePreviewState(
  dossierId: string,
  currentDocuments: DocumentRecord[],
  nextDocuments: DocumentRecord[],
  previewStatesByDossierId: Record<string, Record<string, DocumentPreviewState>>,
  activePreviewDocumentIdByDossierId: Record<string, string | null>
): {
  nextPreviewStatesByDossierId: Record<string, Record<string, DocumentPreviewState>>
  nextActivePreviewDocumentIdByDossierId: Record<string, string | null>
} {
  const currentById = new Map(
    currentDocuments.map((document) => [document.id, document.modifiedAt])
  )
  const nextById = new Map(nextDocuments.map((document) => [document.id, document.modifiedAt]))
  const currentPreviewStates = previewStatesByDossierId[dossierId] ?? {}
  const nextPreviewStates: Record<string, DocumentPreviewState> = {}

  for (const [documentId, previewState] of Object.entries(currentPreviewStates)) {
    if (currentById.get(documentId) && currentById.get(documentId) === nextById.get(documentId)) {
      nextPreviewStates[documentId] = previewState
    }
  }

  const activePreviewDocumentId = activePreviewDocumentIdByDossierId[dossierId] ?? null
  const nextActivePreviewDocumentId =
    activePreviewDocumentId && nextPreviewStates[activePreviewDocumentId]
      ? activePreviewDocumentId
      : null

  return {
    nextPreviewStatesByDossierId: {
      ...previewStatesByDossierId,
      [dossierId]: nextPreviewStates
    },
    nextActivePreviewDocumentIdByDossierId: {
      ...activePreviewDocumentIdByDossierId,
      [dossierId]: nextActivePreviewDocumentId
    }
  }
}

async function loadDocuments(
  query: DossierScopedQuery,
  options: { suppressUnavailableError?: boolean } = {}
): Promise<void> {
  const api = getOrdicabApi()

  if (!api) {
    useDocumentStore.setState((state) => ({
      ...state,
      error: IPC_NOT_AVAILABLE_ERROR
    }))
    return
  }

  const result = await api.document.list(query)

  useDocumentStore.setState((state) => {
    if (!result.success) {
      const watchStatus = state.watchStatusByDossierId[query.dossierId]
      const shouldSuppressError =
        options.suppressUnavailableError && watchStatus?.status === 'unavailable'

      return {
        ...state,
        isLoading: false,
        documentsByDossierId: {
          ...state.documentsByDossierId,
          [query.dossierId]: shouldSuppressError
            ? (state.documentsByDossierId[query.dossierId] ?? [])
            : []
        },
        error: shouldSuppressError ? null : result.error
      }
    }

    const merged = mergeDocumentsWithOverrides(
      result.data,
      state.metadataOverridesByDossierId[query.dossierId]
    )
    const reconciledPreviewState = reconcilePreviewState(
      query.dossierId,
      state.documentsByDossierId[query.dossierId] ?? [],
      merged.documents,
      state.previewStatesByDossierId,
      state.activePreviewDocumentIdByDossierId
    )

    return {
      ...state,
      isLoading: false,
      documentsByDossierId: {
        ...state.documentsByDossierId,
        [query.dossierId]: merged.documents
      },
      previewStatesByDossierId: reconciledPreviewState.nextPreviewStatesByDossierId,
      activePreviewDocumentIdByDossierId:
        reconciledPreviewState.nextActivePreviewDocumentIdByDossierId,
      metadataOverridesByDossierId: {
        ...state.metadataOverridesByDossierId,
        [query.dossierId]: merged.remainingOverrides
      },
      error: null
    }
  })
}

function ensureEventSubscriptions(): void {
  const api = getOrdicabApi()

  if (!api || unsubscribeDocumentChanges || unsubscribeAvailabilityChanges) {
    return
  }

  unsubscribeDocumentChanges = api.document.onDidChange((event: DocumentChangeEvent) => {
    if (event.dossierId !== useDocumentStore.getState().activeDossierId) {
      return
    }

    void loadDocuments({ dossierId: event.dossierId })
  })

  unsubscribeAvailabilityChanges = api.document.onAvailabilityChanged(
    (event: DocumentAvailabilityEvent) => {
      useDocumentStore.setState((state) => ({
        ...state,
        watchStatusByDossierId: {
          ...state.watchStatusByDossierId,
          [event.dossierId]: event
        },
        error: event.status === 'unavailable' ? null : state.error
      }))

      if (
        event.status === 'available' &&
        event.dossierId === useDocumentStore.getState().activeDossierId
      ) {
        void loadDocuments({ dossierId: event.dossierId }, { suppressUnavailableError: true })
      }
    }
  )
}

async function closeDossierWatcher(dossierId: string | null): Promise<void> {
  if (!dossierId) {
    return
  }

  const api = getOrdicabApi()

  if (!api) {
    return
  }

  await api.document.stopWatching({ dossierId })
}

export const useDocumentStore = create<DocumentStore>()(
  immer((set, get) => ({
    documentsByDossierId: {},
    metadataOverridesByDossierId: {},
    watchStatusByDossierId: {},
    previewStatesByDossierId: {},
    contentStatesByDossierId: {},
    activePreviewDocumentIdByDossierId: {},
    activeDossierId: null,
    isLoading: false,
    isSavingMetadata: false,
    error: null,
    load: async (query) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      set((state) => {
        state.isLoading = true
        state.error = null
      })

      await loadDocuments(query)
    },
    open: async (query) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      ensureEventSubscriptions()

      if (get().activeDossierId && get().activeDossierId !== query.dossierId) {
        await closeDossierWatcher(get().activeDossierId)
      }

      set((state) => {
        state.activeDossierId = query.dossierId
        state.isLoading = true
        state.error = null
      })

      const watchResult = await api.document.startWatching(query)

      set((state) => {
        if (!watchResult.success) {
          state.isLoading = false
          state.error = watchResult.error
          return
        }

        state.watchStatusByDossierId[query.dossierId] = watchResult.data
      })

      await loadDocuments(query, { suppressUnavailableError: true })
    },
    closeActive: async () => {
      const dossierId = get().activeDossierId
      await closeDossierWatcher(dossierId)

      if (unsubscribeDocumentChanges) {
        unsubscribeDocumentChanges()
        unsubscribeDocumentChanges = null
      }

      if (unsubscribeAvailabilityChanges) {
        unsubscribeAvailabilityChanges()
        unsubscribeAvailabilityChanges = null
      }

      set((state) => {
        state.activeDossierId = null
        state.isLoading = false
        state.isSavingMetadata = false
        state.metadataOverridesByDossierId = {}
        state.previewStatesByDossierId = {}
        state.contentStatesByDossierId = {}
        state.activePreviewDocumentIdByDossierId = {}
      })
    },
    openPreview: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }

      const cachedPreviewState = get().previewStatesByDossierId[input.dossierId]?.[input.documentId]

      set((state) => {
        state.activePreviewDocumentIdByDossierId[input.dossierId] = input.documentId
      })

      if (cachedPreviewState?.status === 'ready') {
        return
      }

      if (cachedPreviewState?.status === 'loading') {
        return
      }

      set((state) => {
        state.previewStatesByDossierId[input.dossierId] = {
          ...(state.previewStatesByDossierId[input.dossierId] ?? {}),
          [input.documentId]: {
            status: 'loading',
            preview: null,
            error: null
          }
        }
      })

      const result = await api.document.preview(input)

      set((state) => {
        state.previewStatesByDossierId[input.dossierId] = {
          ...(state.previewStatesByDossierId[input.dossierId] ?? {}),
          [input.documentId]: result.success
            ? {
                status: 'ready',
                preview: result.data,
                error: null
              }
            : {
                status: 'error',
                preview: null,
                error: result.error
              }
        }
      })
    },
    closePreview: (dossierId) => {
      set((state) => {
        state.activePreviewDocumentIdByDossierId[dossierId] = null
      })
    },
    extractContent: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }

      const cachedContentState = get().contentStatesByDossierId[input.dossierId]?.[input.documentId]

      if (cachedContentState?.status === 'loading') {
        return false
      }

      if (cachedContentState?.status === 'ready' && !input.forceRefresh) {
        return true
      }

      set((state) => {
        state.error = null
        state.contentStatesByDossierId[input.dossierId] = {
          ...(state.contentStatesByDossierId[input.dossierId] ?? {}),
          [input.documentId]: {
            status: 'loading',
            content: null,
            error: null
          }
        }
      })

      const result = await api.document.extractContent(input)

      set((state) => {
        state.contentStatesByDossierId[input.dossierId] = {
          ...(state.contentStatesByDossierId[input.dossierId] ?? {}),
          [input.documentId]: result.success
            ? {
                status: 'ready',
                content: result.data,
                error: null
              }
            : {
                status: 'error',
                content: null,
                error: result.error
              }
        }

        if (!result.success) {
          state.error = result.error
          return
        }

        const documents = state.documentsByDossierId[input.dossierId] ?? []
        const documentIndex = documents.findIndex((document) => document.id === input.documentId)

        if (documentIndex >= 0) {
          documents[documentIndex] = {
            ...documents[documentIndex],
            textExtraction: result.data.status
          }
        }

        state.error = null
      })

      return result.success
    },
    extractPendingContent: async ({ dossierId }) => {
      const documents = get().documentsByDossierId[dossierId] ?? []
      // DEBUG: show what the store knows about pending documents
      console.log('[extractPendingContent] total docs in store:', documents.length)
      const pendingDocuments = documents.filter(
        (document) =>
          document.textExtraction.isExtractable && document.textExtraction.state !== 'extracted'
      )
      console.log(
        '[extractPendingContent] pending docs:',
        pendingDocuments.map((d) => ({ id: d.id, state: d.textExtraction.state }))
      )

      let succeeded = 0
      let failed = 0

      for (const document of pendingDocuments) {
        const ok = await get().extractContent({
          dossierId,
          documentId: document.id
        })

        if (ok) {
          succeeded += 1
        } else {
          failed += 1
        }
      }

      return {
        attempted: pendingDocuments.length,
        succeeded,
        failed
      }
    },
    clearContentCache: async ({ dossierId }) => {
      const api = getOrdicabApi()
      if (!api) return false
      const result = await api.document.clearContentCache({ dossierId })
      if (!result.success) return false
      // Reset extraction state to 'extractable' for all non-plain-text documents
      set((state) => {
        const documents = state.documentsByDossierId[dossierId]
        if (!documents) return
        state.documentsByDossierId[dossierId] = documents.map((doc) => {
          if (doc.textExtraction.isExtractable && doc.textExtraction.state === 'extracted') {
            return { ...doc, textExtraction: { ...doc.textExtraction, state: 'extractable' } }
          }
          return doc
        })
      })
      return true
    },
    saveMetadata: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }

      set((state) => {
        state.isSavingMetadata = true
        state.error = null
      })

      const result = await api.document.saveMetadata(input)

      set((state) => {
        state.isSavingMetadata = false

        if (!result.success) {
          state.error = result.error
          return
        }

        const current = state.documentsByDossierId[input.dossierId] ?? []
        const index = current.findIndex((entry) => entry.id === result.data.id)

        if (index >= 0) {
          current[index] = result.data
        } else {
          current.push(result.data)
        }

        state.documentsByDossierId[input.dossierId] = current
        state.metadataOverridesByDossierId[input.dossierId] = {
          ...(state.metadataOverridesByDossierId[input.dossierId] ?? {}),
          [result.data.id]: result.data
        }
        state.error = null
      })

      return result.success
    },

    openFile: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return
      }

      await api.document.openFile(input)
    }
  }))
)
