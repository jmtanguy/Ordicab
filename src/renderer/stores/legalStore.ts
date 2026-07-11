import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

import type {
  JudilibreJurisdiction,
  JudilibreSearchInput,
  JudilibreSort,
  LegalConnectionStatus,
  LegalConnectionStatusInput,
  LegalConsultResponse,
  LegalReferenceCheckInput,
  LegalReferenceCheckResult,
  LegalSearchResponse,
  LegalSettingsResponse,
  LegalSettingsSaveInput,
  LegifranceFond,
  LegifranceSearchInput,
  LegifranceSort
} from '@shared/types'

import { getOrdicabApi, IPC_NOT_AVAILABLE_ERROR } from './ipc'

export interface JudilibreTaxonomyOption {
  code: string
  label: string
}

type LegalSourceKind = 'all' | 'legifrance' | 'judilibre'

/**
 * Scope key for the global (non-dossier) legal search panel. Dossier scopes use
 * the dossier id directly; this sentinel keeps the global panel isolated from
 * any real dossier id.
 */
export const GLOBAL_LEGAL_SCOPE = '_global'

/**
 * Hard ceiling on the "Tester PISTE" probe. The main-process service already
 * bounds each network call (token + Légifrance + Judilibre, ~15–20 s each), but
 * if the handler itself stalls (e.g. an OS keychain prompt that never returns)
 * the IPC promise never settles and the button would stay on "Vérification..."
 * forever. This guarantees the UI always recovers.
 */
const CONNECTION_CHECK_TIMEOUT_MS = 60_000

class ConnectionCheckTimeoutError extends Error {
  constructor() {
    super('PISTE connection check timed out.')
    this.name = 'ConnectionCheckTimeoutError'
  }
}

/** Reject with {@link ConnectionCheckTimeoutError} if `promise` outlives `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ConnectionCheckTimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * Per-scope legal search state: both the form snapshot (so the panel can rehydrate
 * after being unmounted on navigation) and the search/consult/verify results. The
 * global search and each dossier own an independent entry keyed in `searchByScope`.
 */
export interface LegalSearchScopeState {
  // form snapshot
  source: LegalSourceKind
  query: string
  referenceText: string
  showFilters: boolean
  fond: LegifranceFond
  legifranceSort: LegifranceSort
  juridiction: JudilibreJurisdiction | ''
  chambre: string
  theme: string
  judilibreSort: JudilibreSort
  dateDebut: string
  dateFin: string
  // results
  isSearching: boolean
  searchResult: LegalSearchResponse | null
  searchError: string | null
  // token of the in-flight search (its `recherche` string); used to drop stale responses
  searchToken: string | null
  isConsulting: boolean
  consultResult: LegalConsultResponse | null
  consultError: string | null
  isVerifying: boolean
  verificationResult: LegalReferenceCheckResult | null
  verificationError: string | null
}

function createDefaultLegalSearchScopeState(): LegalSearchScopeState {
  return {
    source: 'all',
    query: '',
    referenceText: '',
    showFilters: false,
    fond: 'ALL',
    legifranceSort: 'PERTINENCE',
    juridiction: '',
    chambre: '',
    theme: '',
    judilibreSort: 'scorepub',
    dateDebut: '',
    dateFin: '',
    isSearching: false,
    searchResult: null,
    searchError: null,
    searchToken: null,
    isConsulting: false,
    consultResult: null,
    consultError: null,
    isVerifying: false,
    verificationResult: null,
    verificationError: null
  }
}

/**
 * Judilibre taxonomy results come in two shapes: a code→label map
 * (chambers, jurisdictions) or a flat array of labels (themes). Normalize both
 * to a {code,label} list for use in select inputs.
 */
function parseTaxonomyOptions(payload: unknown): JudilibreTaxonomyOption[] {
  const result =
    typeof payload === 'object' && payload !== null && 'result' in payload
      ? (payload as { result: unknown }).result
      : payload
  if (Array.isArray(result)) {
    return result
      .filter((value): value is string => typeof value === 'string')
      .map((value) => ({ code: value, label: value }))
  }
  if (typeof result === 'object' && result !== null) {
    return Object.entries(result as Record<string, unknown>).map(([code, label]) => ({
      code,
      label: typeof label === 'string' ? label : code
    }))
  }
  return []
}

interface LegalStoreState {
  settings: LegalSettingsResponse | null
  isLoadingSettings: boolean
  isSavingSettings: boolean
  settingsError: string | null
  connectionStatus: 'idle' | 'checking' | 'connected' | 'unreachable'
  connection: LegalConnectionStatus | null
  connectionError: string | null
  searchByScope: Record<string, LegalSearchScopeState>
  chambers: JudilibreTaxonomyOption[]
  themes: JudilibreTaxonomyOption[]
  isLoadingTaxonomy: boolean
}

interface LegalStoreActions {
  loadSettings: () => Promise<void>
  saveSettings: (input: LegalSettingsSaveInput) => Promise<boolean>
  deleteCredentials: () => Promise<boolean>
  checkConnection: (input?: LegalConnectionStatusInput) => Promise<void>
  searchLegifrance: (scope: string, input: LegifranceSearchInput) => Promise<void>
  searchJudilibre: (scope: string, input: JudilibreSearchInput) => Promise<void>
  searchAll: (
    scope: string,
    inputs: { legifrance: LegifranceSearchInput; judilibre: JudilibreSearchInput }
  ) => Promise<void>
  consultLegifrance: (scope: string, id: string) => Promise<void>
  consultJudilibre: (scope: string, decisionId: string) => Promise<void>
  verifyReferences: (scope: string, input: LegalReferenceCheckInput) => Promise<void>
  loadJudilibreTaxonomy: () => Promise<void>
  saveScopeForm: (scope: string, form: Partial<LegalSearchScopeState>) => void
  clearSearch: (scope: string) => void
  clearConsult: (scope: string) => void
  resetSearchScopes: () => void
}

type LegalStore = LegalStoreState & LegalStoreActions

function setBridgeUnavailable(set: (fn: (state: LegalStoreState) => void) => void): void {
  set((state) => {
    state.settingsError = IPC_NOT_AVAILABLE_ERROR
  })
}

/**
 * Return the scope's state entry (an immer draft), creating it with defaults if
 * it does not exist yet. Call at the start of every scoped action so mutations
 * always have a target.
 */
function ensureScope(state: LegalStoreState, scope: string): LegalSearchScopeState {
  state.searchByScope[scope] ??= createDefaultLegalSearchScopeState()
  return state.searchByScope[scope]
}

export const useLegalStore = create<LegalStore>()(
  immer((set, get) => ({
    settings: null,
    isLoadingSettings: false,
    isSavingSettings: false,
    settingsError: null,
    connectionStatus: 'idle',
    connection: null,
    connectionError: null,
    searchByScope: {},
    chambers: [],
    themes: [],
    isLoadingTaxonomy: false,

    loadSettings: async () => {
      const api = getOrdicabApi()
      if (!api) {
        setBridgeUnavailable(set)
        return
      }
      set((state) => {
        state.isLoadingSettings = true
        state.settingsError = null
      })
      try {
        const result = await api.legalSearch.getSettings()
        set((state) => {
          if (result.success) {
            state.settings = result.data
          } else {
            state.settingsError = result.error
          }
        })
      } finally {
        set((state) => {
          state.isLoadingSettings = false
        })
      }
    },

    saveSettings: async (input) => {
      const api = getOrdicabApi()
      if (!api) {
        setBridgeUnavailable(set)
        return false
      }
      set((state) => {
        state.isSavingSettings = true
        state.settingsError = null
      })
      try {
        const result = await api.legalSearch.saveSettings(input)
        if (!result.success) {
          set((state) => {
            state.settingsError = result.error
          })
          return false
        }
        await get().loadSettings()
        return true
      } finally {
        set((state) => {
          state.isSavingSettings = false
        })
      }
    },

    deleteCredentials: async () => {
      const api = getOrdicabApi()
      if (!api) {
        setBridgeUnavailable(set)
        return false
      }
      const result = await api.legalSearch.deleteCredentials()
      if (!result.success) {
        set((state) => {
          state.settingsError = result.error
        })
        return false
      }
      await get().loadSettings()
      return true
    },

    checkConnection: async (input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          state.connectionStatus = 'unreachable'
          state.connectionError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      set((state) => {
        state.connectionStatus = 'checking'
        state.connectionError = null
      })
      try {
        const result = await withTimeout(
          api.legalSearch.connectionStatus(input),
          CONNECTION_CHECK_TIMEOUT_MS
        )
        set((state) => {
          if (result.success && result.data.reachable) {
            state.connectionStatus = 'connected'
            state.connection = result.data
            state.connectionError = null
            return
          }
          state.connectionStatus = 'unreachable'
          state.connection = result.success ? result.data : null
          state.connectionError = result.success
            ? (result.data.error ?? 'PISTE is unreachable.')
            : result.error
        })
      } catch (error) {
        // A rejected IPC call (stale preload, unexpected throw…) must not leave
        // the button stuck on "Vérification..." with no feedback: surface it.
        set((state) => {
          state.connectionStatus = 'unreachable'
          state.connection = null
          state.connectionError = error instanceof Error ? error.message : 'PISTE is unreachable.'
        })
      }
    },

    searchLegifrance: async (scope, input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          ensureScope(state, scope).searchError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      set((state) => {
        const s = ensureScope(state, scope)
        s.isSearching = true
        s.searchError = null
        s.searchResult = null
        s.consultResult = null
        s.searchToken = input.recherche
      })
      try {
        const result = await api.legalSearch.searchLegifrance(input)
        set((state) => {
          const s = state.searchByScope[scope]
          // Drop the outcome if a newer search has started since we began.
          if (!s || s.searchToken !== input.recherche) return
          if (result.success) s.searchResult = result.data
          else s.searchError = result.error
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isSearching = false
        })
      }
    },

    searchJudilibre: async (scope, input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          ensureScope(state, scope).searchError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      const token = input.recherche ?? ''
      set((state) => {
        const s = ensureScope(state, scope)
        s.isSearching = true
        s.searchError = null
        s.searchResult = null
        s.consultResult = null
        s.searchToken = token
      })
      try {
        const result = await api.legalSearch.searchJudilibre(input)
        set((state) => {
          const s = state.searchByScope[scope]
          // Drop the outcome if a newer search has started since we began.
          if (!s || s.searchToken !== token) return
          if (result.success) s.searchResult = result.data
          else s.searchError = result.error
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isSearching = false
        })
      }
    },

    searchAll: async (scope, inputs) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          ensureScope(state, scope).searchError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      // Both sources share the same `recherche` string; use it as the stale-response token.
      const token = inputs.legifrance.recherche
      set((state) => {
        const s = ensureScope(state, scope)
        s.isSearching = true
        s.searchError = null
        s.searchResult = null
        s.consultResult = null
        s.searchToken = token
      })
      try {
        const [legifrance, judilibre] = await Promise.all([
          api.legalSearch.searchLegifrance(inputs.legifrance),
          api.legalSearch.searchJudilibre(inputs.judilibre)
        ])
        set((state) => {
          const s = state.searchByScope[scope]
          // Drop the outcome if a newer search has started since we began.
          if (!s || s.searchToken !== token) return
          const responses = [legifrance, judilibre]
          const ok = responses
            .filter((r) => r.success)
            .map((r) => (r as Extract<typeof r, { success: true }>).data)
          // Surface an error only when BOTH sources fail; otherwise show whatever responded.
          if (ok.length === 0) {
            s.searchError = responses
              .map((r) => (r.success ? null : r.error))
              .filter((message): message is string => Boolean(message))
              .join(' ')
            return
          }
          s.searchResult = {
            source: 'legifrance',
            page: 1,
            pageSize: ok.reduce((sum, r) => sum + r.pageSize, 0),
            total: ok.reduce((sum, r) => (r.total === undefined ? sum : sum + r.total), 0),
            results: ok.flatMap((r) => r.results)
          }
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isSearching = false
        })
      }
    },

    consultLegifrance: async (scope, id) => {
      const api = getOrdicabApi()
      if (!api) return
      set((state) => {
        const s = ensureScope(state, scope)
        s.isConsulting = true
        s.consultError = null
      })
      try {
        const result = await api.legalSearch.consultLegifrance({ id })
        set((state) => {
          const s = state.searchByScope[scope]
          if (!s) return
          if (result.success) s.consultResult = result.data
          else s.consultError = result.error
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isConsulting = false
        })
      }
    },

    consultJudilibre: async (scope, decisionId) => {
      const api = getOrdicabApi()
      if (!api) return
      set((state) => {
        const s = ensureScope(state, scope)
        s.isConsulting = true
        s.consultError = null
      })
      try {
        const result = await api.legalSearch.consultJudilibre({ decisionId })
        set((state) => {
          const s = state.searchByScope[scope]
          if (!s) return
          if (result.success) s.consultResult = result.data
          else s.consultError = result.error
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isConsulting = false
        })
      }
    },

    verifyReferences: async (scope, input) => {
      const api = getOrdicabApi()
      if (!api) {
        set((state) => {
          ensureScope(state, scope).verificationError = IPC_NOT_AVAILABLE_ERROR
        })
        return
      }
      set((state) => {
        const s = ensureScope(state, scope)
        s.isVerifying = true
        s.verificationError = null
        s.verificationResult = null
      })
      try {
        const result = await api.legalSearch.verifyReferences(input)
        set((state) => {
          const s = state.searchByScope[scope]
          if (!s) return
          if (result.success) s.verificationResult = result.data
          else s.verificationError = result.error
        })
      } finally {
        set((state) => {
          const s = state.searchByScope[scope]
          if (s) s.isVerifying = false
        })
      }
    },

    loadJudilibreTaxonomy: async () => {
      const api = getOrdicabApi()
      if (!api) return
      if (get().isLoadingTaxonomy) return
      // Already loaded — taxonomy is stable reference data, fetch once.
      if (get().chambers.length > 0 && get().themes.length > 0) return
      set((state) => {
        state.isLoadingTaxonomy = true
      })
      try {
        const [chambersResult, themesResult] = await Promise.all([
          api.legalSearch.taxonomyJudilibre({
            taxonomyId: 'chamber',
            contextValue: 'cc'
          }),
          api.legalSearch.taxonomyJudilibre({ taxonomyId: 'theme' })
        ])
        set((state) => {
          if (chambersResult.success) state.chambers = parseTaxonomyOptions(chambersResult.data)
          if (themesResult.success) state.themes = parseTaxonomyOptions(themesResult.data)
        })
      } finally {
        set((state) => {
          state.isLoadingTaxonomy = false
        })
      }
    },

    saveScopeForm: (scope, form) => {
      set((state) => {
        Object.assign(ensureScope(state, scope), form)
      })
    },

    clearSearch: (scope) => {
      set((state) => {
        const s = state.searchByScope[scope]
        if (!s) return
        s.searchResult = null
        s.searchError = null
      })
    },

    clearConsult: (scope) => {
      set((state) => {
        const s = state.searchByScope[scope]
        if (!s) return
        s.consultResult = null
        s.consultError = null
      })
    },

    resetSearchScopes: () => {
      set((state) => {
        state.searchByScope = {}
      })
    }
  }))
)
