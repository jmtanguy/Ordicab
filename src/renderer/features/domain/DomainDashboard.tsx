import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  AppLocale,
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  DocumentMetadataUpdate,
  DocumentRecord,
  DocumentWatchStatus,
  DossierDetail,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DomainStatusSnapshot
} from '@shared/types'

import { useToast } from '@renderer/contexts/ToastContext'
import type { AsyncLocaleAction, AsyncVoidAction } from '@renderer/features/actions'
import {
  DossierDetail as DossierDetailPanel,
  type DossierDetailNotice,
  type DossierSection
} from '@renderer/features/dossiers/DossierDetail'
import { TemplatesPanel } from '@renderer/features/templates/TemplatesPanel'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'
import type { SidebarDestination } from '@renderer/components/shell/Sidebar'

import { HomeChronologyPanel } from './HomeChronologyPanel'
import { SettingsPanel } from './SettingsPanel'
import { CabinetPanel } from './CabinetPanel'
import { InvoicesDashboard } from '@renderer/features/invoices/InvoicesDashboard'

interface DomainDashboardProps {
  activeDestination: SidebarDestination
  activeDashboardPanel: 'grid' | 'detail'
  activeDossierId: string | null
  activeSection: DossierSection
  onChangeSection: (section: DossierSection) => void
  status: DomainStatusSnapshot
  isLoading: boolean
  isDossierDetailLoading: boolean
  isDossierSaving: boolean
  isSavingLocale: boolean
  currentLocale: AppLocale
  activeDossier: DossierDetail | null
  dossierError: string | null
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
  entityName: string | null
  onChangeDomain: AsyncVoidAction
  onChangeLocale: AsyncLocaleAction
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertDossierKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteDossierKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertDossierFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  onDeleteDossierFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  onArchiveDossierFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<boolean>
  onSetActiveDossierFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<boolean>
  onUpsertDossierBillingItem: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  onDeleteDossierBillingItem: (input: DossierBillingItemDeleteInput) => Promise<boolean>
  onUpsertDossierKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteDossierKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  onSaveDocumentMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  onOpenDocumentPreview: (input: { dossierId: string; documentId: string }) => Promise<void>
  onOpenDocumentFile: (input: { dossierId: string; documentId: string }) => Promise<void>
  onExtractDocumentContent: (input: { dossierId: string; documentId: string }) => Promise<boolean>
  onClearDocumentContentCache?: (input: { dossierId: string }) => Promise<boolean>
  onCloseDocumentPreview: () => void
  onClearDossierNotice: () => void
  onOpenDossier: (id: string) => Promise<void>
}

export function DomainDashboard({
  activeDestination,
  activeDashboardPanel,
  activeDossierId,
  activeSection,
  onChangeSection,
  status,
  isLoading,
  isDossierDetailLoading,
  isDossierSaving,
  isSavingLocale,
  currentLocale,
  activeDossier,
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
  entityName,
  onChangeDomain,
  onChangeLocale,
  onUpsertContact,
  onDeleteContact,
  onUpsertDossierKeyDate,
  onDeleteDossierKeyDate,
  onUpsertDossierFeeAgreement,
  onDeleteDossierFeeAgreement,
  onArchiveDossierFeeAgreement,
  onSetActiveDossierFeeAgreement,
  onUpsertDossierBillingItem,
  onDeleteDossierBillingItem,
  onUpsertDossierKeyReference,
  onDeleteDossierKeyReference,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent,
  onClearDossierNotice,
  onOpenDossier
}: DomainDashboardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()

  // Surface register / unregister toasts even though the grid is gone — the
  // sidebar triggers these mutations and the user needs feedback.
  useEffect(() => {
    if (!dossierNotice) return
    const message =
      dossierNotice.kind === 'registered'
        ? t('dossiers.notice_registered', { name: dossierNotice.dossierName })
        : t('dossiers.notice_unregistered', { name: dossierNotice.dossierName })
    showToast(message)
    onClearDossierNotice()
  }, [dossierNotice, onClearDossierNotice, showToast, t])

  if (activeDashboardPanel === 'detail' && activeDossierId) {
    return (
      <DossierDetailPanel
        dossier={activeDossier}
        entityName={entityName}
        isLoading={isDossierDetailLoading}
        isSaving={isDossierSaving}
        error={dossierDetailError}
        notice={dossierDetailNotice}
        activeSection={activeSection}
        onChangeSection={onChangeSection}
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
        onUpsertContact={onUpsertContact}
        onDeleteContact={onDeleteContact}
        onUpsertKeyDate={onUpsertDossierKeyDate}
        onDeleteKeyDate={onDeleteDossierKeyDate}
        onUpsertFeeAgreement={onUpsertDossierFeeAgreement}
        onDeleteFeeAgreement={onDeleteDossierFeeAgreement}
        onArchiveFeeAgreement={onArchiveDossierFeeAgreement}
        onSetActiveFeeAgreement={onSetActiveDossierFeeAgreement}
        onUpsertBillingItem={onUpsertDossierBillingItem}
        onDeleteBillingItem={onDeleteDossierBillingItem}
        onUpsertKeyReference={onUpsertDossierKeyReference}
        onDeleteKeyReference={onDeleteDossierKeyReference}
        onSaveDocumentMetadata={onSaveDocumentMetadata}
        onOpenDocumentPreview={onOpenDocumentPreview}
        onOpenDocumentFile={onOpenDocumentFile}
        onExtractDocumentContent={onExtractDocumentContent}
      />
    )
  }

  if (activeDestination === 'parametres') {
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

  if (activeDestination === 'modeles') {
    return <TemplatesPanel domainPath={status.registeredDomainPath} />
  }

  if (activeDestination === 'cabinet') {
    return <CabinetPanel />
  }

  if (activeDestination === 'factures') {
    return <InvoicesDashboard onOpenDossier={onOpenDossier} />
  }

  // 'dossiers' destination, no dossier opened: show chronology.
  return <HomeChronologyPanel onOpenDossier={onOpenDossier} />
}
