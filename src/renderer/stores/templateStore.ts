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
  TemplateUpdate
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

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
  pickDocxFile: () => Promise<IpcResult<{ filePath: string; html: string } | null>>
  importDocx: (id: string, filePath?: string) => Promise<void>
  openDocx: (id: string) => Promise<IpcResult<null>>
  removeDocx: (id: string) => Promise<void>
  generate: (input: GenerateDocumentInput) => Promise<IpcResult<GeneratedDocumentResult>>
  preview: (input: GeneratePreviewInput) => Promise<IpcResult<GeneratedDraftResult>>
  previewDocx: (input: GeneratePreviewInput) => Promise<IpcResult<DocxPreviewResult>>
  selectOutputPath: (input: SelectOutputPathInput) => Promise<IpcResult<string | null>>
  saveGeneratedDocument: (
    input: SaveGeneratedDocumentInput
  ) => Promise<IpcResult<GeneratedDocumentResult>>
  openGeneratedFile: (path: string) => Promise<void>
}

type TemplateStore = TemplateStoreState & TemplateStoreActions

function replaceTemplate(
  templates: TemplateRecord[],
  nextTemplate: TemplateRecord
): TemplateRecord[] {
  const index = templates.findIndex((entry) => entry.id === nextTemplate.id)

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
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

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

      return api.template.getContent({ id })
    },
    create: async (input) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

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
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

      const result = await api.template.update(input)

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        const index = state.templates.findIndex((entry) => entry.id === result.data.id)
        if (index >= 0) {
          state.templates[index] = result.data
        }
        state.error = null
        state.errorCode = null
      })
    },
    remove: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

      const result = await api.template.delete({ id })

      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }

        state.templates = state.templates.filter((entry) => entry.id !== id)
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
    importDocx: async (id, filePath) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

      const result = await api.template.importDocx(filePath ? { id, filePath } : { id })

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

      return api.template.openDocx({ id } satisfies TemplateDocxInput)
    },
    removeDocx: async (id) => {
      const api = getOrdicabApi()

      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
          state.errorCode = null
        })
        return
      }

      const result = await api.template.removeDocx({ id } satisfies TemplateDocxInput)

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
    }
  }))
)
