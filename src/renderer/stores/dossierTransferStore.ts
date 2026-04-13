import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DossierAiExportAnalyzeResult,
  DossierAiExportResult,
  DossierAiImportAnalyzeResult,
  DossierAiImportResult
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

interface DossierTransferState {
  exportRootPath: string | null
  importSourcePath: string | null
  exportAnalysis: DossierAiExportAnalyzeResult | null
  importAnalysis: DossierAiImportAnalyzeResult | null
  exportResult: DossierAiExportResult | null
  importResult: DossierAiImportResult | null
  selectedImportFiles: Set<string>
  isLoading: boolean
  isExporting: boolean
  isImporting: boolean
  error: string | null
}

interface DossierTransferActions {
  reset: () => void
  pickExportRoot: () => Promise<string | null>
  analyzeExport: (dossierId: string) => Promise<DossierAiExportAnalyzeResult | null>
  exportForAi: (input: {
    dossierId: string
    rootPath: string
    anonymize: boolean
  }) => Promise<boolean>
  pickAndAnalyzeImport: (dossierId: string) => Promise<DossierAiImportAnalyzeResult | null>
  toggleImportFile: (relativePath: string) => void
  setAllImportFiles: (paths: string[], selected: boolean) => void
  importProduction: (dossierId: string) => Promise<boolean>
}

type DossierTransferStore = DossierTransferState & DossierTransferActions

export const useDossierTransferStore = create<DossierTransferStore>()(
  immer((set, get) => ({
    exportRootPath: null,
    importSourcePath: null,
    exportAnalysis: null,
    importAnalysis: null,
    exportResult: null,
    importResult: null,
    selectedImportFiles: new Set(),
    isLoading: false,
    isExporting: false,
    isImporting: false,
    error: null,
    reset: () => {
      set((state) => {
        state.exportRootPath = null
        state.importSourcePath = null
        state.exportAnalysis = null
        state.importAnalysis = null
        state.exportResult = null
        state.importResult = null
        state.selectedImportFiles = new Set()
        state.isLoading = false
        state.isExporting = false
        state.isImporting = false
        state.error = null
      })
    },
    pickExportRoot: async () => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return null
      }

      const result = await api.dossier.pickExportRoot()
      set((state) => {
        state.error = result.success ? null : result.error
        if (result.success) {
          state.exportRootPath = result.data
        }
      })
      return result.success ? result.data : null
    },
    analyzeExport: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return null
      }

      set((state) => {
        state.isLoading = true
        state.error = null
      })
      const result = await api.dossier.analyzeAiExport({ dossierId })
      set((state) => {
        state.isLoading = false
        state.error = result.success ? null : result.error
        state.exportAnalysis = result.success ? result.data : null
      })
      return result.success ? result.data : null
    },
    exportForAi: async (input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }

      set((state) => {
        state.isExporting = true
        state.error = null
      })
      const result = await api.dossier.exportForAi(input)
      set((state) => {
        state.isExporting = false
        state.error = result.success ? null : result.error
        state.exportResult = result.success ? result.data : null
      })
      return result.success
    },
    pickAndAnalyzeImport: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return null
      }

      const pickResult = await api.dossier.pickImportSource()
      if (!pickResult.success || !pickResult.data) {
        set((state) => {
          state.error = pickResult.success ? null : pickResult.error
        })
        return null
      }

      const sourcePath = pickResult.data
      set((state) => {
        state.importSourcePath = sourcePath
        state.importAnalysis = null
        state.importResult = null
        state.selectedImportFiles = new Set()
        state.isLoading = true
        state.error = null
      })

      const result = await api.dossier.analyzeAiImport({ dossierId, sourcePath })
      set((state) => {
        state.isLoading = false
        state.error = result.success ? null : result.error
        state.importAnalysis = result.success ? result.data : null
        if (result.success && result.data) {
          state.selectedImportFiles = new Set(result.data.files.map((f) => f.relativePath))
        }
      })
      return result.success ? result.data : null
    },
    toggleImportFile: (relativePath) => {
      set((state) => {
        if (state.selectedImportFiles.has(relativePath)) {
          state.selectedImportFiles.delete(relativePath)
        } else {
          state.selectedImportFiles.add(relativePath)
        }
      })
    },
    setAllImportFiles: (paths, selected) => {
      set((state) => {
        if (selected) {
          for (const p of paths) state.selectedImportFiles.add(p)
        } else {
          for (const p of paths) state.selectedImportFiles.delete(p)
        }
      })
    },
    importProduction: async (dossierId) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.error = IPC_NOT_AVAILABLE_ERROR
        })
        return false
      }

      const { importAnalysis, selectedImportFiles } = get()
      if (!importAnalysis) return false

      set((state) => {
        state.isImporting = true
        state.error = null
      })
      const result = await api.dossier.importAiProduction({
        dossierId,
        sourcePath: importAnalysis.sourcePath,
        selectedRelativePaths: [...selectedImportFiles]
      })
      set((state) => {
        state.isImporting = false
        state.error = result.success ? null : result.error
        state.importResult = result.success ? result.data : null
      })
      return result.success
    }
  }))
)
