import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DocxPreviewResult,
  GenerateDocumentInput,
  GeneratePreviewInput,
  GeneratedDraftResult,
  GeneratedDocumentResult,
  IpcResult,
  SaveGeneratedDocumentInput,
  SelectOutputPathInput,
  TemplateDraft,
  TemplateDocxInput,
  TemplateRecord,
  TemplateTagifyAnalyzeInput,
  TemplateTagifyAnalyzeResult,
  TemplateTagifyApplyInput,
  TemplateTagifyApplyResult,
  TemplateUpdate
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'
import type { TemplateDocxSyncedEvent } from '@shared/contracts/documents'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR, requireApi } from './ipc'

interface TemplateStoreState {
  templates: TemplateRecord[]
  isLoading: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface TemplateStoreActions {
  load: () => Promise<void>
  getContent: (id: string) => Promise<IpcResult<string>>
  create: (input: TemplateDraft) => Promise<void>
  update: (input: TemplateUpdate) => Promise<void>
  remove: (id: string) => Promise<void>
  pickDocxFile: () => Promise<
    IpcResult<{ pickToken: string; fileName: string; html: string } | null>
  >
  importDocx: (id: string, pickToken?: string) => Promise<void>
  openDocx: (id: string) => Promise<IpcResult<null>>
  removeDocx: (id: string) => Promise<void>
  applyCabinetDefaultDocx: (id: string) => Promise<void>
  applyCabinetDocxToAllExisting: () => Promise<
    IpcResult<{ updated: number; skipped: number; failed: string[] }>
  >
  tagifyAnalyze: (
    input: TemplateTagifyAnalyzeInput
  ) => Promise<IpcResult<TemplateTagifyAnalyzeResult>>
  tagifyApply: (input: TemplateTagifyApplyInput) => Promise<IpcResult<TemplateTagifyApplyResult>>
  generate: (input: GenerateDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
  preview: (input: GeneratePreviewInput) => Promise<IpcResult<GeneratedDraftResult>>
  previewDocx: (input: GeneratePreviewInput) => Promise<IpcResult<DocxPreviewResult>>
  selectOutputPath: (input: SelectOutputPathInput) => Promise<IpcResult<string | null>>
  saveGeneratedDocument: (
    input: SaveGeneratedDocumentInput
  ) => Promise<IpcResult<GeneratedDocumentResult>>
  openGeneratedFile: (path: string) => Promise<void>
  copyToClipboard: (input: { text?: string; html?: string }) => Promise<void>
  /**
   * Subscribes to "DOCX file synced from disk" events. Used by the template
   * editor to refresh its draft when the user edits the file in Word.
   */
  subscribeToDocxSynced: (listener: (event: TemplateDocxSyncedEvent) => void) => () => void
}

type TemplateStore = TemplateStoreState & TemplateStoreActions

function replaceTemplate(
  templates: TemplateRecord[],
  nextTemplate: TemplateRecord
): TemplateRecord[] {
  const index = templates.findIndex((entry) => entry.uuid === nextTemplate.uuid)

  if (index < 0) {
    return templates
  }

  const nextTemplates = [...templates]
  nextTemplates[index] = nextTemplate
  return nextTemplates
}

export const useTemplateStore = create<TemplateStore>()(
  immer((set) => ({
    // IPC calls live in store actions, never in React components.
    templates: [],
    isLoading: false,
    error: null,
    errorCode: null,
    load: async () => {
      const api = requireApi(set)
      if (!api) return

      set((state) => {
        state.isLoading = true
        state.error = null
        state.errorCode = null
      })

      const result = await api.template.list()

      set((state) => {
        state.isLoading = false
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = result.data
        state.errorCode = null
      })
    },
    getContent: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.template.getContent({ uuid: id })
    },
    create: async (input) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.create(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates.unshift(result.data)
        state.error = null
        state.errorCode = null
      })
    },
    update: async (input) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.update(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        const index = state.templates.findIndex((entry) => entry.uuid === result.data.uuid)
        if (index >= 0) {
          state.templates[index] = result.data
        }
        state.error = null
        state.errorCode = null
      })
    },
    remove: async (id) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.delete({ uuid: id })

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = state.templates.filter((entry) => entry.uuid !== id)
        state.error = null
        state.errorCode = null
      })
    },
    pickDocxFile: async () => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.template.pickDocxFile()
    },
    importDocx: async (id, pickToken) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.importDocx(
        pickToken ? { uuid: id, pickToken } : { uuid: id }
      )

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = replaceTemplate(state.templates, result.data)
        state.error = null
        state.errorCode = null
      })
    },
    openDocx: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.template.openDocx({ uuid: id } satisfies TemplateDocxInput)
    },
    removeDocx: async (id) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.removeDocx({ uuid: id } satisfies TemplateDocxInput)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = replaceTemplate(state.templates, result.data)
        state.error = null
        state.errorCode = null
      })
    },
    applyCabinetDefaultDocx: async (id) => {
      const api = requireApi(set)
      if (!api) return

      const result = await api.template.applyCabinetDefaultDocx({
        uuid: id
      } satisfies TemplateDocxInput)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = replaceTemplate(state.templates, result.data)
        state.error = null
        state.errorCode = null
      })
    },
    applyCabinetDocxToAllExisting: async () => {
      const api = getOrdicabApi()
      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }
      const result = await api.template.applyCabinetDocxToAllExisting()
      if (result.success) {
        // Re-fetch templates so updatedAt and any visual indicators refresh.
        const refreshed = await api.template.list()
        if (refreshed.success) {
          set((state) => {
            state.templates = refreshed.data
          })
        }
      }
      return result
    },
    generate: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.generate.document(input)
    },
    tagifyAnalyze: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.template.tagifyAnalyze(input)
    },

    tagifyApply: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.template.tagifyApply(input)
    },

    preview: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.generate.preview(input)
    },
    previewDocx: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.generate.previewDocx(input)
    },
    selectOutputPath: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.generate.selectOutputPath(input)
    },
    saveGeneratedDocument: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        return {
          success: false as const,
          error: IPC_NOT_AVAILABLE_ERROR,
          code: IpcErrorCode.UNKNOWN
        }
      }

      return api.generate.save(input)
    },
    openGeneratedFile: async (path) => {
      const api = getOrdicabApi()

      if (!api) {
        return
      }

      await api.app.openFolder({ path })
    },
    copyToClipboard: async (input) => {
      const api = getOrdicabApi()
      if (!api) return
      await api.app.writeClipboard(input)
    },
    subscribeToDocxSynced: (listener) => {
      const api = getOrdicabApi()
      if (!api?.template?.onDocxSynced) {
        return () => undefined
      }
      return api.template.onDocxSynced(listener)
    }
  }))
)
