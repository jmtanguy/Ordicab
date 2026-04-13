import type {
  AppLocale,
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DocumentMetadataUpdate,
  DocumentRecord,
  DocumentWatchStatus,
  DossierAiExportAnalyzeResult,
  DossierAiExportResult,
  DossierAiImportAnalyzeResult,
  DossierAiImportResult,
  DossierDetail,
  DossierEligibleFolder,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierStatus,
  DossierSummary,
  DomainStatusSnapshot,
  IpcErrorCode
} from '@shared/types'

import type { AsyncLocaleAction, AsyncVoidAction } from '@renderer/features/actions'
import {
  DossierDetail as DossierDetailPanel,
  type DossierDetailNotice
} from '@renderer/features/dossiers/DossierDetail'
import { DashboardGrid } from '@renderer/features/dossiers/DashboardGrid'
import { TemplatesPanel } from '@renderer/features/templates/TemplatesPanel'
import { AiPage } from '@renderer/features/ai/AiPage'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'
import type { DossierSortMode, DossierStatusFilter } from '@renderer/stores/dossierStore'
import type { TopNavTab } from '@renderer/components/shell/TopNav'

import { SettingsPanel } from './SettingsPanel'

interface DomainDashboardProps {
  activeTab: TopNavTab
  templatesInitialDossierId?: string | null
  status: DomainStatusSnapshot
  isLoading: boolean
  isDossierLoading: boolean
  isDossierDetailLoading: boolean
  isDossierSaving: boolean
  isSavingLocale: boolean
  activeDashboardPanel: 'grid' | 'detail'
  activeDossierId: string | null
  currentLocale: AppLocale
  dossiers: DossierSummary[]
  eligibleFolders: DossierEligibleFolder[]
  activeDossier: DossierDetail | null
  dossierError: string | null
  dossierErrorCode: IpcErrorCode | null
  dossierNotice: { kind: 'registered' | 'unregistered'; dossierName: string } | null
  dossierDetailError: string | null
  dossierDetailNotice: DossierDetailNotice | null
  contacts: ContactRecord[]
  contactsIsLoading: boolean
  contactsError: string | null
  documents: DocumentRecord[]
  documentIsLoading: boolean
  documentIsSaving: boolean
  documentError: string | null
  documentWatchStatus: DocumentWatchStatus | null
  activePreviewDocumentId: string | null
  documentPreviewState: DocumentPreviewState
  documentContentState: DocumentContentState
  dossierSortMode: DossierSortMode
  dossierStatusFilter: DossierStatusFilter
  entityName: string | null
  onChangeDomain: AsyncVoidAction
  onChangeLocale: AsyncLocaleAction
  onLoadEligibleFolders: AsyncVoidAction
  onOpenDossier: (id: string) => Promise<void>
  onRegisterDossier: (id: string) => Promise<boolean>
  onSaveDossier: (input: { id: string; status: DossierStatus; type: string }) => Promise<boolean>
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertDossierKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteDossierKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertDossierKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteDossierKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  onCloseDossier: () => void
  onNavigateToGenerate?: (dossierId: string) => void
  onSaveDocumentMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  onOpenDocumentPreview: (input: { dossierId: string; documentId: string }) => Promise<void>
  onOpenDocumentFile: (input: { dossierId: string; documentId: string }) => Promise<void>
  onExtractDocumentContent: (input: { dossierId: string; documentId: string }) => Promise<boolean>
  onExtractPendingDocumentContent: (input: { dossierId: string }) => Promise<{
    attempted: number
    succeeded: number
    failed: number
  }>
  onClearDocumentContentCache?: (input: { dossierId: string }) => Promise<boolean>
  dossierTransferError: string | null
  dossierTransferIsLoading: boolean
  exportRootPath: string | null
  exportAnalysis: DossierAiExportAnalyzeResult | null
  importAnalysis: DossierAiImportAnalyzeResult | null
  exportResult: DossierAiExportResult | null
  importResult: DossierAiImportResult | null
  selectedImportFiles: Set<string>
  isExporting: boolean
  isImporting: boolean
  onPickExportRoot: () => Promise<string | null>
  onAnalyzeAiExport: (dossierId: string) => Promise<DossierAiExportAnalyzeResult | null>
  onExportForAi: (input: {
    dossierId: string
    rootPath: string
    anonymize: boolean
  }) => Promise<boolean>
  onPickAndAnalyzeImport: (dossierId: string) => Promise<DossierAiImportAnalyzeResult | null>
  onToggleImportFile: (relativePath: string) => void
  onSetAllImportFiles: (paths: string[], selected: boolean) => void
  onImportAiProduction: (dossierId: string) => Promise<boolean>
  onCloseDocumentPreview: () => void
  onSetDossierSortMode: (mode: DossierSortMode) => void
  onSetDossierStatusFilter: (filter: DossierStatusFilter) => void
  onUnregisterDossier: (id: string) => Promise<boolean>
  onClearDossierNotice: () => void
}

export function DomainDashboard({
  activeTab,
  templatesInitialDossierId,
  status,
  isLoading,
  isDossierLoading,
  isDossierDetailLoading,
  isDossierSaving,
  isSavingLocale,
  activeDashboardPanel,
  activeDossierId,
  currentLocale,
  dossiers,
  eligibleFolders,
  activeDossier,
  dossierError,
  dossierErrorCode,
  dossierNotice,
  dossierDetailError,
  dossierDetailNotice,
  contacts,
  contactsIsLoading,
  contactsError,
  documents,
  documentIsLoading,
  documentIsSaving,
  documentError,
  documentWatchStatus,
  activePreviewDocumentId,
  documentPreviewState,
  documentContentState,
  dossierSortMode,
  dossierStatusFilter,
  entityName,
  onChangeDomain,
  onChangeLocale,
  onLoadEligibleFolders,
  onOpenDossier,
  onRegisterDossier,
  onSaveDossier,
  onUpsertContact,
  onDeleteContact,
  onUpsertDossierKeyDate,
  onDeleteDossierKeyDate,
  onUpsertDossierKeyReference,
  onDeleteDossierKeyReference,
  onCloseDossier,
  onNavigateToGenerate,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent,
  onExtractPendingDocumentContent,
  onClearDocumentContentCache,
  dossierTransferError,
  dossierTransferIsLoading,
  exportRootPath,
  exportAnalysis,
  importAnalysis,
  exportResult,
  importResult,
  selectedImportFiles,
  isExporting,
  isImporting,
  onPickExportRoot,
  onAnalyzeAiExport,
  onExportForAi,
  onPickAndAnalyzeImport,
  onToggleImportFile,
  onSetAllImportFiles,
  onImportAiProduction,
  onCloseDocumentPreview,
  onSetDossierSortMode,
  onSetDossierStatusFilter,
  onUnregisterDossier,
  onClearDossierNotice
}: DomainDashboardProps): React.JSX.Element {
  if (activeTab === 'parametres') {
    return (
      <SettingsPanel
        status={status}
        isLoading={isLoading}
        isSavingLocale={isSavingLocale}
        currentLocale={currentLocale}
        onChangeDomain={onChangeDomain}
        onChangeLocale={onChangeLocale}
      />
    )
  }

  if (activeTab === 'modeles') {
    return (
      <TemplatesPanel
        domainPath={status.registeredDomainPath}
        initialDossierId={templatesInitialDossierId}
      />
    )
  }

  if (activeTab === 'delegated') {
    return (
      <AiPage
        entityName={entityName}
        sampleDossierName={activeDossier?.name ?? dossiers[0]?.name ?? null}
        dossierId={activeDossierId ?? undefined}
      />
    )
  }

  // Dossiers tab
  if (activeDashboardPanel === 'detail') {
    return (
      <DossierDetailPanel
        dossier={activeDossier}
        isLoading={isDossierDetailLoading}
        isSaving={isDossierSaving}
        error={dossierDetailError}
        notice={dossierDetailNotice}
        contacts={contacts}
        contactsIsLoading={contactsIsLoading}
        contactsError={contactsError}
        documents={documents}
        documentIsLoading={documentIsLoading}
        documentIsSaving={documentIsSaving}
        documentError={documentError}
        documentWatchStatus={documentWatchStatus}
        activePreviewDocumentId={activePreviewDocumentId}
        documentPreviewState={documentPreviewState}
        documentContentState={documentContentState}
        onClose={onCloseDossier}
        onUnregister={onUnregisterDossier}
        onSave={onSaveDossier}
        onUpsertContact={onUpsertContact}
        onDeleteContact={onDeleteContact}
        onUpsertKeyDate={onUpsertDossierKeyDate}
        onDeleteKeyDate={onDeleteDossierKeyDate}
        onUpsertKeyReference={onUpsertDossierKeyReference}
        onDeleteKeyReference={onDeleteDossierKeyReference}
        onSaveDocumentMetadata={onSaveDocumentMetadata}
        onOpenDocumentPreview={onOpenDocumentPreview}
        onOpenDocumentFile={onOpenDocumentFile}
        onExtractDocumentContent={onExtractDocumentContent}
        onExtractPendingDocumentContent={onExtractPendingDocumentContent}
        onClearDocumentContentCache={onClearDocumentContentCache}
        onCloseDocumentPreview={onCloseDocumentPreview}
        onNavigateToGenerate={
          activeDossierId && onNavigateToGenerate
            ? () => onNavigateToGenerate(activeDossierId)
            : undefined
        }
        dossierTransferError={dossierTransferError}
        dossierTransferIsLoading={dossierTransferIsLoading}
        exportRootPath={exportRootPath}
        exportAnalysis={exportAnalysis}
        importAnalysis={importAnalysis}
        exportResult={exportResult}
        importResult={importResult}
        selectedImportFiles={selectedImportFiles}
        isExporting={isExporting}
        isImporting={isImporting}
        onPickExportRoot={onPickExportRoot}
        onAnalyzeAiExport={onAnalyzeAiExport}
        onExportForAi={onExportForAi}
        onPickAndAnalyzeImport={onPickAndAnalyzeImport}
        onToggleImportFile={onToggleImportFile}
        onSetAllImportFiles={onSetAllImportFiles}
        onImportAiProduction={onImportAiProduction}
      />
    )
  }

  return (
    <DashboardGrid
      dossiers={dossiers}
      eligibleFolders={eligibleFolders}
      isLoading={isDossierLoading}
      error={dossierError}
      errorCode={dossierErrorCode}
      notice={dossierNotice}
      activeDossierId={activeDossierId}
      statusFilter={dossierStatusFilter}
      sortMode={dossierSortMode}
      onLoadEligibleFolders={onLoadEligibleFolders}
      onOpenDetail={onOpenDossier}
      onRegister={onRegisterDossier}
      onSetStatusFilter={onSetDossierStatusFilter}
      onSetSortMode={onSetDossierSortMode}
      onClearNotice={onClearDossierNotice}
    />
  )
}
