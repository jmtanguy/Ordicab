import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  DossierBillingItem,
  InvoiceArtifactIntegrity,
  InvoiceCancelInput,
  InvoiceCreateCorrectiveInput,
  InvoiceCreateCreditNoteInput,
  InvoiceCreateInput,
  InvoiceExportCsvInput,
  InvoiceExportCsvResult,
  InvoiceExportFecInput,
  InvoiceExportFecResult,
  InvoiceMarkPaidInput,
  InvoicePaymentDeleteInput,
  InvoicePaymentInput,
  InvoicePaymentUpdateInput,
  InvoiceRecord,
  InvoiceSettings,
  InvoiceSettingsUpdateInput
} from '@shared/types'
import { IpcErrorCode } from '@shared/types'

export interface UnbilledDossierGroup {
  dossierId: string
  dossierName: string
  items: DossierBillingItem[]
  totalHtCents: number
  totalTtcCents: number
}

import { requireApi } from './ipc'

interface InvoiceStoreState {
  invoices: InvoiceRecord[] | null
  settings: InvoiceSettings | null
  unbilledGroups: UnbilledDossierGroup[] | null
  isLoading: boolean
  isLoadingUnbilled: boolean
  error: string | null
  errorCode: IpcErrorCode | null
}

interface InvoiceStoreActions {
  load: () => Promise<void>
  loadSettings: () => Promise<void>
  loadUnbilled: () => Promise<void>
  create: (input: InvoiceCreateInput) => Promise<InvoiceRecord | null>
  cancel: (input: InvoiceCancelInput) => Promise<boolean>
  markPaid: (input: InvoiceMarkPaidInput) => Promise<boolean>
  createCreditNote: (input: InvoiceCreateCreditNoteInput) => Promise<InvoiceRecord | null>
  createCorrectiveInvoice: (input: InvoiceCreateCorrectiveInput) => Promise<InvoiceRecord | null>
  addPayment: (input: InvoicePaymentInput) => Promise<InvoiceRecord | null>
  updatePayment: (input: InvoicePaymentUpdateInput) => Promise<InvoiceRecord | null>
  deletePayment: (input: InvoicePaymentDeleteInput) => Promise<InvoiceRecord | null>
  exportCsv: (input: InvoiceExportCsvInput) => Promise<InvoiceExportCsvResult | null>
  exportFec: (input: InvoiceExportFecInput) => Promise<InvoiceExportFecResult | null>
  openDocument: (input: {
    invoiceUuid: string
  }) => Promise<{ integrity: InvoiceArtifactIntegrity } | null>
  openPdf: (input: {
    invoiceUuid: string
  }) => Promise<{ integrity: InvoiceArtifactIntegrity } | null>
  updateSettings: (input: InvoiceSettingsUpdateInput) => Promise<boolean>
  reset: () => void
}

type InvoiceStore = InvoiceStoreState & InvoiceStoreActions

export const useInvoiceStore = create<InvoiceStore>()(
  immer((set, get) => ({
    invoices: null,
    settings: null,
    unbilledGroups: null,
    isLoading: false,
    isLoadingUnbilled: false,
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
      const result = await api.invoice.list()
      set((state) => {
        state.isLoading = false
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }
        state.invoices = result.data
      })
    },

    loadUnbilled: async () => {
      const api = requireApi(set)
      if (!api) return
      set((state) => {
        state.isLoadingUnbilled = true
      })
      const summaries = await api.dossier.list()
      if (!summaries.success) {
        set((state) => {
          state.isLoadingUnbilled = false
          state.error = summaries.error
          state.errorCode = summaries.code
        })
        return
      }
      const groups: UnbilledDossierGroup[] = []
      for (const summary of summaries.data) {
        const detail = await api.dossier.get({ dossierId: summary.slug })
        if (!detail.success) continue
        const draftItems = detail.data.billingItems.filter((item) => item.status === 'draft')
        if (draftItems.length === 0) continue
        groups.push({
          dossierId: summary.slug,
          dossierName: detail.data.name,
          items: draftItems,
          totalHtCents: draftItems.reduce((acc, item) => acc + item.totalHtCents, 0),
          totalTtcCents: draftItems.reduce((acc, item) => acc + item.totalTtcCents, 0)
        })
      }
      set((state) => {
        state.isLoadingUnbilled = false
        state.unbilledGroups = groups
      })
    },

    loadSettings: async () => {
      const api = requireApi(set)
      if (!api) return
      const result = await api.invoice.getSettings()
      set((state) => {
        if (!result.success) {
          state.error = result.error
          state.errorCode = result.code
          return
        }
        state.settings = result.data
      })
    },

    create: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.create(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = [result.data, ...(state.invoices ?? [])]
      })
      // Reload settings so the displayed nextSequence updates.
      await get().loadSettings()
      return result.data
    },

    cancel: async (input) => {
      const api = requireApi(set)
      if (!api) return false
      const result = await api.invoice.cancel(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return false
      }
      set((state) => {
        state.invoices = (state.invoices ?? []).map((entry) =>
          entry.uuid === result.data.uuid ? result.data : entry
        )
      })
      return true
    },

    markPaid: async (input) => {
      const api = requireApi(set)
      if (!api) return false
      const result = await api.invoice.markPaid(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return false
      }
      set((state) => {
        state.invoices = (state.invoices ?? []).map((entry) =>
          entry.uuid === result.data.uuid ? result.data : entry
        )
      })
      return true
    },

    createCreditNote: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.createCreditNote(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = [result.data, ...(state.invoices ?? [])]
      })
      await get().loadSettings()
      return result.data
    },

    createCorrectiveInvoice: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.createCorrectiveInvoice(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = [
          result.data,
          ...(state.invoices ?? []).map((entry) =>
            entry.uuid === input.originalInvoiceUuid
              ? { ...entry, status: 'corrected' as const }
              : entry
          )
        ]
      })
      await get().loadSettings()
      return result.data
    },

    addPayment: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.addPayment(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = (state.invoices ?? []).map((entry) =>
          entry.uuid === result.data.uuid ? result.data : entry
        )
      })
      return result.data
    },

    updatePayment: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.updatePayment(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = (state.invoices ?? []).map((entry) =>
          entry.uuid === result.data.uuid ? result.data : entry
        )
      })
      return result.data
    },

    deletePayment: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.deletePayment(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      set((state) => {
        state.invoices = (state.invoices ?? []).map((entry) =>
          entry.uuid === result.data.uuid ? result.data : entry
        )
      })
      return result.data
    },

    exportCsv: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.exportCsv(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      return result.data
    },

    exportFec: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.exportFec(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      return result.data
    },

    openDocument: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.openDocument(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      return result.data
    },

    openPdf: async (input) => {
      const api = requireApi(set)
      if (!api) return null
      const result = await api.invoice.openPdf(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return null
      }
      return result.data
    },

    updateSettings: async (input) => {
      const api = requireApi(set)
      if (!api) return false
      const result = await api.invoice.updateSettings(input)
      if (!result.success) {
        set((state) => {
          state.error = result.error
          state.errorCode = result.code
        })
        return false
      }
      set((state) => {
        state.settings = result.data
      })
      return true
    },

    reset: () => {
      set((state) => {
        state.invoices = null
        state.settings = null
        state.unbilledGroups = null
        state.isLoading = false
        state.isLoadingUnbilled = false
        state.error = null
        state.errorCode = null
      })
    }
  }))
)
