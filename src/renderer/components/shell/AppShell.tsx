import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AppLocale, IpcErrorCode, type OrdicabDataChangedEvent } from '@shared/types'

import { normalizeAppLocale } from '@renderer/i18n'
import { useDeadlineReminders } from '@renderer/features/reminders/useDeadlineReminders'
import { DomainDashboard } from '@renderer/features/domain/DomainDashboard'
import { FolderPickerDialog } from '@renderer/features/dossiers/FolderPickerDialog'
import { EulaDialog } from '@renderer/features/legal/EulaDialog'
import { ModelDownloadDialog } from '@renderer/features/settings/ModelDownloadDialog'
import { OnboardingPage } from '@renderer/features/onboarding/OnboardingPage'
import { AlertBanner } from '@renderer/components/ui'
import {
  useCabinetBillingStore,
  useContactStore,
  type DocumentContentState,
  type DocumentPreviewState,
  useDocumentStore,
  selectVisibleDossiers,
  useDomainStore,
  useDossierStore,
  useEntityStore,
  useOnboardingStore,
  resolveOnboardingComplete,
  useReminderStore,
  useTemplateStore,
  useUiStore
} from '@renderer/stores'

import { AuroraBackground } from './AuroraBackground'
import { Sidebar, type DossierSection, type SidebarDestination } from './Sidebar'
import { UpdateBanner } from './UpdateBanner'

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
  error: null,
  progress: null
}
const ORDICAB_WARNING_TIMEOUT_MS = 6_000
const DEFAULT_DOSSIER_SECTION: DossierSection = 'echeances'

export default function AppShell(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [activeDestination, setActiveDestination] = useState<SidebarDestination>('dossiers')
  const [activeSection, setActiveSection] = useState<DossierSection>(DEFAULT_DOSSIER_SECTION)
  const [searchQuery, setSearchQuery] = useState('')
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [ordicabSyncWarning, setOrdicabSyncWarning] = useState<string | null>(null)
  const [domainReadyNotice, setDomainReadyNotice] = useState<string | null>(null)
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
  const getEulaStatus = useUiStore((state) => state.getEulaStatus)
  const acceptEula = useUiStore((state) => state.acceptEula)
  const subscribeToOrdicabDataChanged = useUiStore((state) => state.subscribeToOrdicabDataChanged)
  const subscribeToNotificationClicked = useReminderStore(
    (state) => state.subscribeToNotificationClicked
  )
  const domainSnapshot = useDomainStore((state) => state.snapshot)
  const domainLoading = useDomainStore((state) => state.isLoading)
  const domainHasLoadedOnce = useDomainStore((state) => state.hasLoadedOnce)
  const domainError = useDomainStore((state) => state.error)
  const refreshStatus = useDomainStore((state) => state.refreshStatus)
  const selectDomain = useDomainStore((state) => state.selectDomain)
  const rawDossiers = useDossierStore((state) => state.dossiers)
  const eligibleFolders = useDossierStore((state) => state.eligibleFolders)
  const dossierLoading = useDossierStore((state) => state.isLoading)
  const eligibleLoading = useDossierStore((state) => state.isEligibleLoading)
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
  const loadChronology = useDossierStore((state) => state.loadChronology)
  const openDossierRecord = useDossierStore((state) => state.openDetail)
  const loadDossierDetail = useDossierStore((state) => state.loadDetail)
  const loadEligibleFolders = useDossierStore((state) => state.loadEligibleFolders)
  const registerDossier = useDossierStore((state) => state.register)
  const createDossier = useDossierStore((state) => state.create)
  const upsertDossierKeyDate = useDossierStore((state) => state.upsertKeyDate)
  const deleteDossierKeyDate = useDossierStore((state) => state.deleteKeyDate)
  const upsertDossierFeeAgreement = useDossierStore((state) => state.upsertFeeAgreement)
  const deleteDossierFeeAgreement = useDossierStore((state) => state.deleteFeeAgreement)
  const archiveDossierFeeAgreement = useDossierStore((state) => state.archiveFeeAgreement)
  const setActiveDossierFeeAgreement = useDossierStore((state) => state.setActiveFeeAgreement)
  const upsertDossierBillingItem = useDossierStore((state) => state.upsertBillingItem)
  const deleteDossierBillingItem = useDossierStore((state) => state.deleteBillingItem)
  const upsertDossierKeyReference = useDossierStore((state) => state.upsertKeyReference)
  const deleteDossierKeyReference = useDossierStore((state) => state.deleteKeyReference)
  const upsertDossierNote = useDossierStore((state) => state.upsertNote)
  const deleteDossierNote = useDossierStore((state) => state.deleteNote)
  const setDossierSortMode = useDossierStore((state) => state.setSortMode)
  const setDossierStatusFilter = useDossierStore((state) => state.setStatusFilter)
  const unregisterDossier = useDossierStore((state) => state.unregister)
  const clearDossierNotice = useDossierStore((state) => state.clearNotice)
  const clearDossierError = useDossierStore((state) => state.clearError)
  const resetDossiers = useDossierStore((state) => state.reset)
  const entityProfile = useEntityStore((state) => state.profile)
  const loadCabinetBillingCatalog = useCabinetBillingStore((state) => state.load)
  const resetCabinetBillingCatalog = useCabinetBillingStore((state) => state.reset)
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

  useDeadlineReminders()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    let isCancelled = false

    void (async () => {
      const locale = normalizeAppLocale(i18n.resolvedLanguage)
      const status = await getEulaStatus(locale)
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
  }, [i18n.resolvedLanguage, getEulaStatus])

  const refreshAndApplyDomainStatus = useCallback(async () => {
    const status = await refreshStatus()
    if (!useUiStore.getState().isPendingDomainChange) {
      applyDomainStatus(status)
    }
  }, [applyDomainStatus, refreshStatus])

  const handleChangeDomain = useCallback(async () => {
    setActiveDestination('dossiers')
    goToOnboarding()
  }, [goToOnboarding])

  useEffect(() => {
    void refreshAndApplyDomainStatus()
  }, [refreshAndApplyDomainStatus])

  useEffect(() => {
    if (activeView === 'dashboard' && domainHasLoadedOnce && domainSnapshot.registeredDomainPath) {
      void (async () => {
        await loadDossiers()
        void loadChronology()
      })()
      void loadEntityProfile()
      return
    }

    resetDossiers()
    resetCabinetBillingCatalog()
  }, [
    activeView,
    domainHasLoadedOnce,
    domainSnapshot.registeredDomainPath,
    loadEntityProfile,
    loadChronology,
    loadDossiers,
    resetCabinetBillingCatalog,
    resetDossiers
  ])

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

  useEffect(() => {
    if (!domainReadyNotice) {
      return
    }

    const timer = setTimeout(() => {
      setDomainReadyNotice(null)
    }, ORDICAB_WARNING_TIMEOUT_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [domainReadyNotice])

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

  const activeDossierIdRef = useRef(activeDossierId)
  const activeDestinationRef = useRef(activeDestination)
  useEffect(() => {
    activeDossierIdRef.current = activeDossierId
  }, [activeDossierId])
  useEffect(() => {
    activeDestinationRef.current = activeDestination
  }, [activeDestination])

  useEffect(() => {
    const handleOrdicabDataChanged = async (event: OrdicabDataChangedEvent): Promise<void> => {
      if (event.type === 'contacts') {
        if (!event.dossierId) {
          return
        }

        if (event.dossierId !== activeDossierIdRef.current) {
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
        await loadDossiers()
        void loadChronology()

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

      if (event.type === 'cabinet-billing') {
        await loadCabinetBillingCatalog()

        if (useCabinetBillingStore.getState().errorCode === IpcErrorCode.VALIDATION_FAILED) {
          showOrdicabValidationWarning()
        }

        return
      }

      await loadTemplates()

      if (useTemplateStore.getState().errorCode === IpcErrorCode.VALIDATION_FAILED) {
        showOrdicabValidationWarning()
      }
    }

    return subscribeToOrdicabDataChanged((event) => {
      void handleOrdicabDataChanged(event)
    })
  }, [
    invalidateContacts,
    loadCabinetBillingCatalog,
    loadChronology,
    loadContacts,
    loadDossierDetail,
    loadDossiers,
    loadEntityProfile,
    loadTemplates,
    showOrdicabValidationWarning,
    subscribeToOrdicabDataChanged
  ])

  const handleDomainSelection = useCallback(async () => {
    // Whether the user had explicitly finished onboarding before this selection.
    // Distinguishes a returning user (re-pointing their domain) from a brand-new
    // setup that lands on an already-populated folder (fail-open below).
    const wasOnboardingExplicitlyComplete =
      useOnboardingStore.getState().progress.completedAt != null

    const selection = await selectDomain()
    clearPendingDomainChange()
    const snapshot = useDomainStore.getState().snapshot
    applyDomainStatus(snapshot)

    if (!selection.selectedPath || !snapshot.isAvailable) {
      return
    }

    await loadEntityProfile()
    await Promise.all([loadDossiers(), loadEligibleFolders()])

    // A returning user merely re-pointing their domain (onboarding already complete,
    // or the newly selected domain already holds dossiers) goes straight to the
    // dashboard — applyDomainStatus has already routed them there via the same
    // fail-open rule. Only a brand-new, empty setup continues into the wizard.
    const onboardingComplete = resolveOnboardingComplete(
      useOnboardingStore.getState().progress,
      useDomainStore.getState().snapshot.dossierCount
    )
    if (onboardingComplete) {
      // Mid-onboarding the user picked a folder that already holds Ordicab cases:
      // setup is effectively done, so reassure them why the wizard closed early.
      if (!wasOnboardingExplicitlyComplete) {
        setDomainReadyNotice(t('onboarding.domain_already_configured'))
      }
      return
    }

    // Fresh setup: the guided wizard owns the remaining steps. Advance from the
    // Drive step (now satisfied) to the Cabinet step.
    useOnboardingStore.getState().next()
  }, [
    t,
    applyDomainStatus,
    clearPendingDomainChange,
    loadDossiers,
    loadEligibleFolders,
    loadEntityProfile,
    selectDomain
  ])

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
    if (!eulaVersion) {
      return
    }

    setIsAcceptingEula(true)
    setEulaError(null)
    const locale = normalizeAppLocale(i18n.resolvedLanguage)
    const result = await acceptEula({ version: eulaVersion, locale })
    setIsAcceptingEula(false)

    if (!result.success) {
      setEulaError(result.error)
      return
    }

    setIsEulaRequired(result.data.required)
    setEulaContent(result.data.content)
  }, [eulaVersion, i18n.resolvedLanguage, acceptEula])

  const handleOpenDossier = useCallback(
    async (id: string) => {
      setActiveDestination('dossiers')
      setActiveSection(DEFAULT_DOSSIER_SECTION)
      openDossierDetail(id)
      await Promise.all([
        openDossierRecord(id),
        loadContacts({ dossierId: id }),
        openDocumentSession({ dossierId: id })
      ])
    },
    [loadContacts, openDossierDetail, openDossierRecord, openDocumentSession]
  )

  const handleCloseDossier = useCallback(() => {
    closeDossierDetail()
    setActiveSection(DEFAULT_DOSSIER_SECTION)
    void closeActiveDocumentSession()
  }, [closeActiveDocumentSession, closeDossierDetail])

  // Clicking a native deadline-reminder notification jumps to the dossier (or
  // the home chronology when the notification was a multi-dossier summary).
  useEffect(() => {
    const unsubscribe = subscribeToNotificationClicked((event) => {
      if (event.dossierId) {
        void handleOpenDossier(event.dossierId)
        return
      }
      setActiveDestination('dossiers')
    })
    return unsubscribe
  }, [handleOpenDossier, subscribeToNotificationClicked])

  const handleSelectDestination = useCallback((destination: SidebarDestination) => {
    setActiveDestination(destination)
  }, [])

  const handleUnregisterDossier = useCallback(
    async (id: string) => {
      const ok = await unregisterDossier(id)
      if (ok) {
        handleCloseDossier()
      }
      return ok
    },
    [unregisterDossier, handleCloseDossier]
  )

  const handleOpenPicker = useCallback(() => {
    setIsPickerOpen(true)
  }, [])

  const handleClosePicker = useCallback(() => {
    setIsPickerOpen(false)
  }, [])

  const handleRegisterDossier = useCallback(
    async (id: string) => {
      return registerDossier(id)
    },
    [registerDossier]
  )

  const handleCreateDossier = useCallback(
    async (name: string) => {
      return createDossier(name)
    },
    [createDossier]
  )

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

  const isDashboardView = domainHasLoadedOnce && activeView === 'dashboard'
  const domainStatus = mapDomainStatus({
    activeView,
    hasLoadedOnce: domainHasLoadedOnce,
    registeredDomainPath: domainSnapshot.registeredDomainPath
  })

  // suppress unused warning — kept for potential future use
  void mapStatus(versionStatus)

  return (
    <main className="relative flex h-screen overflow-hidden bg-deep-space text-[#1a1a1a]">
      <AuroraBackground />

      <UpdateBanner />

      <EulaDialog
        open={isEulaRequired}
        title={t('legal.eula_title')}
        summary={t('legal.eula_summary')}
        acceptLabel={t('legal.eula_accept_action')}
        loadingLabel={t('legal.eula_accept_loading')}
        content={eulaContent}
        versionLabel={t('legal.eula_version_label', { version: eulaVersion })}
        error={eulaError}
        isSubmitting={isAcceptingEula}
        onAccept={handleAcceptEula}
      />

      <ModelDownloadDialog />

      <FolderPickerDialog
        open={isPickerOpen}
        isLoading={eligibleLoading}
        eligibleFolders={eligibleFolders}
        onLoadEligibleFolders={loadEligibleFolders}
        onRegister={handleRegisterDossier}
        onCreate={handleCreateDossier}
        createError={dossierError}
        createErrorCode={dossierErrorCode}
        onClearError={clearDossierError}
        onDismiss={handleClosePicker}
      />

      {isDashboardView ? (
        <>
          <Sidebar
            destination={activeDestination}
            activeDossier={activeDossier}
            activeDossierId={activeDossierId}
            activeSection={activeSection}
            isDetailLoading={dossierDetailLoading}
            versionLabel={versionLabel}
            dossiers={dossiers}
            isDossierLoading={dossierLoading}
            statusFilter={dossierStatusFilter}
            sortMode={dossierSortMode}
            searchQuery={searchQuery}
            onSelectDestination={handleSelectDestination}
            onOpenDossier={handleOpenDossier}
            onOpenPicker={handleOpenPicker}
            onSetStatusFilter={setDossierStatusFilter}
            onSetSortMode={setDossierSortMode}
            onSetSearchQuery={setSearchQuery}
            onCloseDossier={handleCloseDossier}
            onSelectSection={setActiveSection}
            onUnregisterDossier={handleUnregisterDossier}
          />

          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {ordicabSyncWarning ? (
              <AlertBanner role="status" tone="warning" className="m-4 mb-0">
                {ordicabSyncWarning}
              </AlertBanner>
            ) : null}
            {domainReadyNotice ? (
              <AlertBanner role="status" tone="success" className="m-4 mb-0">
                {domainReadyNotice}
              </AlertBanner>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden p-6 xl:p-8">
              <DomainDashboard
                activeDestination={activeDestination}
                activeDashboardPanel={activeDashboardPanel}
                activeDossierId={activeDossierId}
                activeSection={activeSection}
                onChangeSection={setActiveSection}
                status={domainSnapshot}
                isLoading={domainLoading}
                isDossierDetailLoading={dossierDetailLoading}
                isDossierSaving={dossierSaving}
                isSavingLocale={isSavingLocale}
                currentLocale={normalizeAppLocale(i18n.resolvedLanguage)}
                activeDossier={activeDossier}
                dossierError={dossierError}
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
                entityName={entityProfile?.firmName ?? null}
                onChangeDomain={handleChangeDomain}
                onChangeLocale={handleLocaleChange}
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
                onUpsertDossierFeeAgreement={upsertDossierFeeAgreement}
                onDeleteDossierFeeAgreement={deleteDossierFeeAgreement}
                onArchiveDossierFeeAgreement={archiveDossierFeeAgreement}
                onSetActiveDossierFeeAgreement={setActiveDossierFeeAgreement}
                onUpsertDossierBillingItem={upsertDossierBillingItem}
                onDeleteDossierBillingItem={deleteDossierBillingItem}
                onUpsertDossierKeyReference={upsertDossierKeyReference}
                onDeleteDossierKeyReference={deleteDossierKeyReference}
                onUpsertDossierNote={upsertDossierNote}
                onDeleteDossierNote={deleteDossierNote}
                onSaveDocumentMetadata={saveDocumentMetadata}
                onOpenDocumentPreview={openDocumentPreview}
                onOpenDocumentFile={openDocumentFile}
                onExtractDocumentContent={extractDocumentContent}
                onCloseDocumentPreview={() => {
                  if (activeDossierId) {
                    closeDocumentPreview(activeDossierId)
                  }
                }}
                onClearDossierNotice={clearDossierNotice}
                onOpenDossier={handleOpenDossier}
              />
            </div>
          </div>
        </>
      ) : (
        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center px-5 py-8 md:px-8 md:py-12">
          <OnboardingPage
            versionLabel={versionLabel}
            domainStatus={domainStatus}
            isLoading={domainLoading || !domainHasLoadedOnce}
            error={domainError}
            onSelectDomain={handleDomainSelection}
          />
        </div>
      )}
    </main>
  )
}
