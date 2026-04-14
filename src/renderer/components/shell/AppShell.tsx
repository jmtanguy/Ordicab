import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AppLocale, IpcErrorCode, type OrdicabDataChangedEvent } from '@shared/types'

import { normalizeAppLocale } from '@renderer/i18n'
import { DomainDashboard } from '@renderer/features/domain/DomainDashboard'
import { EntityDialog } from '@renderer/features/domain/EntityPanel'
import { EulaDialog } from '@renderer/features/legal/EulaDialog'
import { OnboardingPage } from '@renderer/features/onboarding/OnboardingPage'
import { AlertBanner } from '@renderer/components/ui'
import {
  useContactStore,
  type DocumentContentState,
  type DocumentPreviewState,
  useDocumentStore,
  useDossierTransferStore,
  selectVisibleDossiers,
  useDomainStore,
  useDossierStore,
  useEntityStore,
  useTemplateStore,
  useUiStore
} from '@renderer/stores'
import { getOrdicabApi } from '@renderer/stores/ipc'

import { AuroraBackground } from './AuroraBackground'
import { TopNav, type TopNavTab } from './TopNav'

function mapStatus(status: 'idle' | 'loading' | 'ready' | 'error'): 'loading' | 'ready' | 'error' {
  if (status === 'ready') {
    return 'ready'
  }

  if (status === 'error') {
    return 'error'
  }

  return 'loading'
}

function mapDomainStatus(options: {
  activeView: 'onboarding' | 'dashboard'
  hasLoadedOnce: boolean
  registeredDomainPath: string | null
}): 'loading' | 'ready' | 'error' {
  if (!options.hasLoadedOnce) {
    return 'loading'
  }

  if (options.activeView === 'dashboard') {
    return 'ready'
  }

  if (options.registeredDomainPath) {
    return 'error'
  }

  return 'loading'
}

const DOMAIN_STATUS_POLL_INTERVAL_MS = 4_000
const IDLE_DOCUMENT_PREVIEW_STATE: DocumentPreviewState = {
  status: 'idle',
  preview: null,
  error: null
}
const IDLE_DOCUMENT_CONTENT_STATE: DocumentContentState = {
  status: 'idle',
  content: null,
  error: null
}
const ORDICAB_WARNING_TIMEOUT_MS = 6_000

export default function AppShell(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<TopNavTab>('dossiers')
  const [generateDossierId, setGenerateDossierId] = useState<string | null>(null)
  const [ordicabSyncWarning, setOrdicabSyncWarning] = useState<string | null>(null)
  const [showEntityOnboardingDialog, setShowEntityOnboardingDialog] = useState(false)
  const [isEulaRequired, setIsEulaRequired] = useState(false)
  const [eulaContent, setEulaContent] = useState('')
  const [eulaVersion, setEulaVersion] = useState('')
  const [eulaError, setEulaError] = useState<string | null>(null)
  const [isAcceptingEula, setIsAcceptingEula] = useState(false)

  const versionStatus = useUiStore((state) => state.versionStatus)
  const versionLabel = useUiStore((state) => state.versionLabel)
  const activeView = useUiStore((state) => state.activeView)
  const activeDashboardPanel = useUiStore((state) => state.activeDashboardPanel)
  const activeDossierId = useUiStore((state) => state.activeDossierId)
  const isSavingLocale = useUiStore((state) => state.isSavingLocale)
  const applyDomainStatus = useUiStore((state) => state.applyDomainStatus)
  const goToOnboarding = useUiStore((state) => state.goToOnboarding)
  const clearPendingDomainChange = useUiStore((state) => state.clearPendingDomainChange)
  const bootstrap = useUiStore((state) => state.bootstrap)
  const closeDossierDetail = useUiStore((state) => state.closeDossierDetail)
  const openDossierDetail = useUiStore((state) => state.openDossierDetail)
  const persistLocale = useUiStore((state) => state.persistLocale)
  const domainSnapshot = useDomainStore((state) => state.snapshot)
  const domainLoading = useDomainStore((state) => state.isLoading)
  const domainHasLoadedOnce = useDomainStore((state) => state.hasLoadedOnce)
  const domainError = useDomainStore((state) => state.error)
  const refreshStatus = useDomainStore((state) => state.refreshStatus)
  const selectDomain = useDomainStore((state) => state.selectDomain)
  const rawDossiers = useDossierStore((state) => state.dossiers)
  const eligibleFolders = useDossierStore((state) => state.eligibleFolders)
  const dossierLoading = useDossierStore((state) => state.isLoading)
  const dossierDetailLoading = useDossierStore((state) => state.isDetailLoading)
  const dossierSaving = useDossierStore((state) => state.isSavingDetail)
  const dossierError = useDossierStore((state) => state.error)
  const dossierErrorCode = useDossierStore((state) => state.errorCode)
  const dossierNotice = useDossierStore((state) => state.notice)
  const activeDossier = useDossierStore((state) => state.activeDossier)
  const dossierDetailError = useDossierStore((state) => state.detailError)
  const dossierDetailNotice = useDossierStore((state) => state.detailNotice)
  const dossierSortMode = useDossierStore((state) => state.sortMode)
  const dossierStatusFilter = useDossierStore((state) => state.statusFilter)
  const loadDossiers = useDossierStore((state) => state.load)
  const openDossierRecord = useDossierStore((state) => state.openDetail)
  const loadDossierDetail = useDossierStore((state) => state.loadDetail)
  const loadEligibleFolders = useDossierStore((state) => state.loadEligibleFolders)
  const registerDossier = useDossierStore((state) => state.register)
  const saveDossierDetail = useDossierStore((state) => state.saveDetail)
  const upsertDossierKeyDate = useDossierStore((state) => state.upsertKeyDate)
  const deleteDossierKeyDate = useDossierStore((state) => state.deleteKeyDate)
  const upsertDossierKeyReference = useDossierStore((state) => state.upsertKeyReference)
  const deleteDossierKeyReference = useDossierStore((state) => state.deleteKeyReference)
  const setDossierSortMode = useDossierStore((state) => state.setSortMode)
  const setDossierStatusFilter = useDossierStore((state) => state.setStatusFilter)
  const unregisterDossier = useDossierStore((state) => state.unregister)
  const clearDossierNotice = useDossierStore((state) => state.clearNotice)
  const resetDossiers = useDossierStore((state) => state.reset)
  const entityProfile = useEntityStore((state) => state.profile)
  const contactsByDossierId = useContactStore((state) => state.contactsByDossierId)
  const isContactLoading = useContactStore((state) => state.isLoading)
  const contactError = useContactStore((state) => state.error)
  const loadContacts = useContactStore((state) => state.load)
  const invalidateContacts = useContactStore((state) => state.invalidate)
  const upsertContact = useContactStore((state) => state.upsert)
  const deleteContact = useContactStore((state) => state.remove)
  const loadEntityProfile = useEntityStore((state) => state.load)
  const loadTemplates = useTemplateStore((state) => state.load)
  const documentsByDossierId = useDocumentStore((state) => state.documentsByDossierId)
  const documentWatchStatusByDossierId = useDocumentStore((state) => state.watchStatusByDossierId)
  const previewStatesByDossierId = useDocumentStore((state) => state.previewStatesByDossierId)
  const contentStatesByDossierId = useDocumentStore((state) => state.contentStatesByDossierId)
  const activePreviewDocumentIdByDossierId = useDocumentStore(
    (state) => state.activePreviewDocumentIdByDossierId
  )
  const isDocumentLoading = useDocumentStore((state) => state.isLoading)
  const isSavingDocumentMetadata = useDocumentStore((state) => state.isSavingMetadata)
  const documentError = useDocumentStore((state) => state.error)
  const openDocumentSession = useDocumentStore((state) => state.open)
  const closeActiveDocumentSession = useDocumentStore((state) => state.closeActive)
  const openDocumentPreview = useDocumentStore((state) => state.openPreview)
  const closeDocumentPreview = useDocumentStore((state) => state.closePreview)
  const saveDocumentMetadata = useDocumentStore((state) => state.saveMetadata)
  const openDocumentFile = useDocumentStore((state) => state.openFile)
  const extractDocumentContent = useDocumentStore((state) => state.extractContent)
  const extractPendingDocumentContent = useDocumentStore((state) => state.extractPendingContent)
  const clearDocumentContentCache = useDocumentStore((state) => state.clearContentCache)
  const dossierTransferError = useDossierTransferStore((state) => state.error)
  const dossierTransferLoading = useDossierTransferStore((state) => state.isLoading)
  const exportRootPath = useDossierTransferStore((state) => state.exportRootPath)
  const exportAnalysis = useDossierTransferStore((state) => state.exportAnalysis)
  const importAnalysis = useDossierTransferStore((state) => state.importAnalysis)
  const exportResult = useDossierTransferStore((state) => state.exportResult)
  const importResult = useDossierTransferStore((state) => state.importResult)
  const selectedImportFiles = useDossierTransferStore((state) => state.selectedImportFiles)
  const isExporting = useDossierTransferStore((state) => state.isExporting)
  const isImporting = useDossierTransferStore((state) => state.isImporting)
  const pickExportRoot = useDossierTransferStore((state) => state.pickExportRoot)
  const analyzeAiExport = useDossierTransferStore((state) => state.analyzeExport)
  const exportForAi = useDossierTransferStore((state) => state.exportForAi)
  const pickAndAnalyzeImport = useDossierTransferStore((state) => state.pickAndAnalyzeImport)
  const toggleImportFile = useDossierTransferStore((state) => state.toggleImportFile)
  const setAllImportFiles = useDossierTransferStore((state) => state.setAllImportFiles)
  const importAiProduction = useDossierTransferStore((state) => state.importProduction)
  const resetDossierTransfer = useDossierTransferStore((state) => state.reset)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const api = getOrdicabApi()

    if (!api?.app?.eulaStatus) {
      return
    }

    let isCancelled = false

    void (async () => {
      const locale = normalizeAppLocale(i18n.resolvedLanguage)
      const status = await api.app.eulaStatus({ locale })
      if (isCancelled) {
        return
      }

      if (!status.success) {
        setEulaError(status.error)
        setIsEulaRequired(true)
        return
      }

      setIsEulaRequired(status.data.required)
      setEulaVersion(status.data.version)
      setEulaContent(status.data.content)
      setEulaError(null)
    })()

    return () => {
      isCancelled = true
    }
  }, [i18n.resolvedLanguage])

  const refreshAndApplyDomainStatus = useCallback(async () => {
    const status = await refreshStatus()
    if (!useUiStore.getState().isPendingDomainChange) {
      applyDomainStatus(status)
    }
  }, [applyDomainStatus, refreshStatus])

  const handleChangeDomain = useCallback(async () => {
    setActiveTab('dossiers')
    goToOnboarding()
  }, [goToOnboarding])

  useEffect(() => {
    void refreshAndApplyDomainStatus()
  }, [refreshAndApplyDomainStatus])

  useEffect(() => {
    if (activeView === 'dashboard' && domainHasLoadedOnce && domainSnapshot.registeredDomainPath) {
      void loadDossiers()
      void loadEntityProfile()
      return
    }

    resetDossiers()
  }, [
    activeView,
    domainHasLoadedOnce,
    domainSnapshot.registeredDomainPath,
    loadEntityProfile,
    loadDossiers,
    resetDossiers
  ])

  useEffect(() => {
    resetDossierTransfer()
  }, [activeDossierId, resetDossierTransfer])

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshAndApplyDomainStatus()
    }, DOMAIN_STATUS_POLL_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [refreshAndApplyDomainStatus])

  useEffect(() => {
    if (!ordicabSyncWarning) {
      return
    }

    const timer = setTimeout(() => {
      setOrdicabSyncWarning(null)
    }, ORDICAB_WARNING_TIMEOUT_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [ordicabSyncWarning])

  // Clear stale warning when the active dossier changes (H1 fix)
  useEffect(() => {
    if (!ordicabSyncWarning) {
      return
    }

    const timer = setTimeout(() => {
      setOrdicabSyncWarning(null)
    }, 0)

    return () => {
      clearTimeout(timer)
    }
  }, [activeDossierId, ordicabSyncWarning])

  const showOrdicabValidationWarning = useCallback(() => {
    setOrdicabSyncWarning(t('ordicab.sync.validation_failed'))
  }, [t])

  // Use refs so the subscription is created once and reads current values
  // without being torn down and recreated on every dossier/tab change (M3 fix)
  const activeDossierIdRef = useRef(activeDossierId)
  const activeTabRef = useRef(activeTab)
  useEffect(() => {
    activeDossierIdRef.current = activeDossierId
  }, [activeDossierId])
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    const api = getOrdicabApi()

    if (!api) {
      return
    }

    const handleOrdicabDataChanged = async (event: OrdicabDataChangedEvent): Promise<void> => {
      if (event.type === 'contacts') {
        if (!event.dossierId) {
          return
        }

        if (event.dossierId !== activeDossierIdRef.current) {
          // Invalider le cache pour forcer un rechargement frais au prochain open
          invalidateContacts(event.dossierId)
          return
        }

        await loadContacts({ dossierId: event.dossierId })

        if (useContactStore.getState().errorCode === IpcErrorCode.VALIDATION_FAILED) {
          showOrdicabValidationWarning()
        }

        return
      }

      if (event.type === 'dossier') {
        // Toujours rafraîchir la liste (nom, statut, dates clés dans la sidebar)
        await loadDossiers()

        if (!event.dossierId || event.dossierId !== activeDossierIdRef.current) {
          return
        }

        await loadDossierDetail(event.dossierId)

        if (useDossierStore.getState().detailErrorCode === IpcErrorCode.VALIDATION_FAILED) {
          showOrdicabValidationWarning()
        }

        return
      }

      if (event.type === 'entity') {
        await loadEntityProfile()

        if (useEntityStore.getState().errorCode === IpcErrorCode.VALIDATION_FAILED) {
          showOrdicabValidationWarning()
        }

        return
      }

      // Templates are domain-level — reload regardless of active tab (M1 fix)
      await loadTemplates()

      if (useTemplateStore.getState().errorCode === IpcErrorCode.VALIDATION_FAILED) {
        showOrdicabValidationWarning()
      }
    }

    return api.ordicab.onDataChanged((event) => {
      void handleOrdicabDataChanged(event)
    })
  }, [
    invalidateContacts,
    loadContacts,
    loadDossierDetail,
    loadDossiers,
    loadEntityProfile,
    loadTemplates,
    showOrdicabValidationWarning
  ])

  const handleDomainSelection = useCallback(async () => {
    await selectDomain()
    clearPendingDomainChange()
    applyDomainStatus(useDomainStore.getState().snapshot)

    await loadEntityProfile()
    const profile = useEntityStore.getState().profile
    if (!profile?.firmName) {
      setShowEntityOnboardingDialog(true)
    }
  }, [applyDomainStatus, clearPendingDomainChange, loadEntityProfile, selectDomain])

  const handleLocaleChange = useCallback(
    async (locale: AppLocale) => {
      const normalizedLocale = normalizeAppLocale(locale)
      const persisted = await persistLocale(normalizedLocale)

      if (persisted) {
        await i18n.changeLanguage(normalizedLocale)
      }
    },
    [i18n, persistLocale]
  )

  const handleAcceptEula = useCallback(async () => {
    const api = getOrdicabApi()
    if (!api?.app?.eulaAccept || !eulaVersion) {
      return
    }

    setIsAcceptingEula(true)
    setEulaError(null)
    const locale = normalizeAppLocale(i18n.resolvedLanguage)
    const result = await api.app.eulaAccept({ version: eulaVersion, locale })
    setIsAcceptingEula(false)

    if (!result.success) {
      setEulaError(result.error)
      return
    }

    setIsEulaRequired(result.data.required)
    setEulaContent(result.data.content)
  }, [eulaVersion, i18n.resolvedLanguage])

  const handleOpenDossier = useCallback(
    async (id: string) => {
      openDossierDetail(id)
      await Promise.all([
        openDossierRecord(id),
        loadContacts({ dossierId: id }),
        openDocumentSession({ dossierId: id })
      ])
    },
    [loadContacts, openDossierDetail, openDossierRecord, openDocumentSession]
  )
  const handleNavigateToGenerate = useCallback((dossierId: string) => {
    setGenerateDossierId(dossierId)
    setActiveTab('modeles')
  }, [])

  const handleTabChange = useCallback((tab: TopNavTab) => {
    if (tab !== 'modeles') {
      setGenerateDossierId(null)
    }
    setActiveTab(tab)
  }, [])

  const handleCloseDossier = useCallback(() => {
    closeDossierDetail()
    void closeActiveDocumentSession()
  }, [closeActiveDocumentSession, closeDossierDetail])

  useEffect(() => {
    if (activeDashboardPanel === 'detail' && activeDossierId) {
      return
    }

    void closeActiveDocumentSession()
  }, [activeDashboardPanel, activeDossierId, closeActiveDocumentSession])

  const dossiers = selectVisibleDossiers({
    dossiers: rawDossiers,
    statusFilter: dossierStatusFilter,
    sortMode: dossierSortMode
  })
  const contacts = activeDossierId ? (contactsByDossierId?.[activeDossierId] ?? []) : []
  const documents = activeDossierId ? (documentsByDossierId?.[activeDossierId] ?? []) : []
  const documentWatchStatus = activeDossierId
    ? (documentWatchStatusByDossierId?.[activeDossierId] ?? null)
    : null
  const activePreviewDocumentId = activeDossierId
    ? (activePreviewDocumentIdByDossierId?.[activeDossierId] ?? null)
    : null
  const documentPreviewState =
    activeDossierId && activePreviewDocumentId
      ? (previewStatesByDossierId?.[activeDossierId]?.[activePreviewDocumentId] ??
        IDLE_DOCUMENT_PREVIEW_STATE)
      : IDLE_DOCUMENT_PREVIEW_STATE
  const documentContentState =
    activeDossierId && activePreviewDocumentId
      ? (contentStatesByDossierId?.[activeDossierId]?.[activePreviewDocumentId] ??
        IDLE_DOCUMENT_CONTENT_STATE)
      : IDLE_DOCUMENT_CONTENT_STATE

  const domainStatusLabel =
    activeView === 'dashboard'
      ? t('domain.status_value_available')
      : domainHasLoadedOnce && domainSnapshot.registeredDomainPath
        ? t('domain.status_value_unavailable')
        : t('domain.status_value_unconfigured')

  const isDashboardView = domainHasLoadedOnce && activeView === 'dashboard'
  const domainStatus = mapDomainStatus({
    activeView,
    hasLoadedOnce: domainHasLoadedOnce,
    registeredDomainPath: domainSnapshot.registeredDomainPath
  })

  // suppress unused warning — kept for potential future use
  void mapStatus(versionStatus)

  return (
    <main className="relative min-h-screen overflow-hidden bg-deep-space text-slate-100">
      <AuroraBackground />

      <EulaDialog
        open={isEulaRequired}
        title={t('legal.eula_title')}
        summary={t('legal.eula_summary')}
        acceptLabel={t('legal.eula_accept_action')}
        loadingLabel={t('legal.eula_accept_loading')}
        content={eulaContent}
        version={eulaVersion}
        error={eulaError}
        isSubmitting={isAcceptingEula}
        onAccept={handleAcceptEula}
      />

      <EntityDialog
        open={showEntityOnboardingDialog}
        onClose={() => setShowEntityOnboardingDialog(false)}
      />

      {isDashboardView ? (
        <TopNav
          activeTab={activeTab}
          domainStatus={domainStatus}
          domainStatusLabel={domainStatusLabel}
          versionLabel={versionLabel}
          onTabChange={handleTabChange}
        />
      ) : null}

      <div
        className={`relative w-full ${
          isDashboardView && activeTab === 'delegated'
            ? 'flex flex-col overflow-hidden'
            : isDashboardView
              ? 'px-6 py-6 xl:py-8'
              : 'mx-auto max-w-7xl px-5 md:px-8 flex min-h-screen flex-col justify-center py-8 md:py-12'
        }`}
        style={
          isDashboardView && activeTab === 'delegated'
            ? { height: 'calc(100vh - 3.5rem)' }
            : undefined
        }
      >
        {isDashboardView && ordicabSyncWarning ? (
          <AlertBanner role="status" tone="warning" className="mb-4">
            {ordicabSyncWarning}
          </AlertBanner>
        ) : null}
        {isDashboardView ? (
          <DomainDashboard
            activeTab={activeTab}
            templatesInitialDossierId={generateDossierId}
            onNavigateToGenerate={handleNavigateToGenerate}
            status={domainSnapshot}
            isLoading={domainLoading}
            isDossierLoading={dossierLoading}
            isDossierDetailLoading={dossierDetailLoading}
            isDossierSaving={dossierSaving}
            isSavingLocale={isSavingLocale}
            activeDashboardPanel={activeDashboardPanel}
            activeDossierId={activeDossierId}
            currentLocale={normalizeAppLocale(i18n.resolvedLanguage)}
            dossiers={dossiers}
            eligibleFolders={eligibleFolders}
            activeDossier={activeDossier}
            dossierError={dossierError}
            dossierErrorCode={dossierErrorCode}
            dossierNotice={dossierNotice}
            dossierDetailError={dossierDetailError}
            dossierDetailNotice={dossierDetailNotice}
            contacts={contacts}
            contactsIsLoading={isContactLoading}
            contactsError={contactError}
            documents={documents}
            documentIsLoading={isDocumentLoading}
            documentIsSaving={isSavingDocumentMetadata}
            documentError={documentError}
            documentWatchStatus={documentWatchStatus}
            activePreviewDocumentId={activePreviewDocumentId}
            documentPreviewState={documentPreviewState}
            documentContentState={documentContentState}
            dossierSortMode={dossierSortMode}
            dossierStatusFilter={dossierStatusFilter}
            entityName={entityProfile?.firmName ?? null}
            onChangeDomain={handleChangeDomain}
            onChangeLocale={handleLocaleChange}
            onLoadEligibleFolders={loadEligibleFolders}
            onOpenDossier={handleOpenDossier}
            onRegisterDossier={registerDossier}
            onSaveDossier={saveDossierDetail}
            onUpsertContact={async (input) => {
              await upsertContact(input)
              return useContactStore.getState().error === null
            }}
            onDeleteContact={async (input) => {
              await deleteContact(input)
              return useContactStore.getState().error === null
            }}
            onUpsertDossierKeyDate={upsertDossierKeyDate}
            onDeleteDossierKeyDate={deleteDossierKeyDate}
            onUpsertDossierKeyReference={upsertDossierKeyReference}
            onDeleteDossierKeyReference={deleteDossierKeyReference}
            onCloseDossier={handleCloseDossier}
            onSaveDocumentMetadata={saveDocumentMetadata}
            onOpenDocumentPreview={openDocumentPreview}
            onOpenDocumentFile={openDocumentFile}
            onExtractDocumentContent={extractDocumentContent}
            onExtractPendingDocumentContent={extractPendingDocumentContent}
            onClearDocumentContentCache={clearDocumentContentCache}
            onCloseDocumentPreview={() => {
              if (activeDossierId) {
                closeDocumentPreview(activeDossierId)
              }
            }}
            dossierTransferError={dossierTransferError}
            dossierTransferIsLoading={dossierTransferLoading}
            exportRootPath={exportRootPath}
            exportAnalysis={exportAnalysis}
            importAnalysis={importAnalysis}
            exportResult={exportResult}
            importResult={importResult}
            selectedImportFiles={selectedImportFiles}
            isExporting={isExporting}
            isImporting={isImporting}
            onPickExportRoot={pickExportRoot}
            onAnalyzeAiExport={analyzeAiExport}
            onExportForAi={exportForAi}
            onPickAndAnalyzeImport={pickAndAnalyzeImport}
            onToggleImportFile={toggleImportFile}
            onSetAllImportFiles={setAllImportFiles}
            onImportAiProduction={importAiProduction}
            onSetDossierSortMode={setDossierSortMode}
            onSetDossierStatusFilter={setDossierStatusFilter}
            onUnregisterDossier={unregisterDossier}
            onClearDossierNotice={clearDossierNotice}
          />
        ) : (
          <OnboardingPage
            versionLabel={versionLabel}
            domainStatus={domainStatus}
            isLoading={domainLoading || !domainHasLoadedOnce}
            error={domainError}
            onSelectDomain={handleDomainSelection}
          />
        )}
      </div>
    </main>
  )
}
