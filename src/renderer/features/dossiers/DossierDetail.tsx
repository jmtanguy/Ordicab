import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type {
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
  DossierDetail as DossierDetailRecord,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierNoteDeleteInput,
  DossierNoteUpsertInput
} from '@shared/types'
import {
  buildBillingItemFromFeeAgreement,
  buildBillingItemFromKeyDate
} from '@shared/billingCalculations'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'

import { AlertBanner } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { AiPage } from '@renderer/features/ai/AiPage'
import { CoworkPage } from '@renderer/features/delegated/CoworkPage'
import { DocumentList } from '@renderer/features/documents/DocumentList'
import { SemanticSearchPanel } from '@renderer/features/documents/SemanticSearchPanel'
import { LegalSearchPanel } from '@renderer/features/legal-search/LegalSearchPanel'
import { GenerateDocumentPanel } from '@renderer/features/templates/GenerateDocumentPanel'
import { PiecesSection } from '@renderer/features/pieces/PiecesSection'
import { CompareSection } from '@renderer/features/compare/CompareSection'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'

import { DossierBillingItemsSection } from './DossierBillingItemsSection'
import { DossierInvoicesSection } from './DossierInvoicesSection'
import { DossierKeyDatesSection } from './DossierKeyDatesSection'
import { DossierContactsSection } from './DossierContactsSection'
import { DossierFeeAgreementSection } from './DossierFeeAgreementSection'
import { DossierKeyReferencesSection } from './DossierKeyReferencesSection'
import { DossierNotesSection } from './DossierNotesSection'
import { DossierLegalAidSection } from './DossierLegalAidSection'
import { useUiStore } from '@renderer/stores/uiStore'

export interface DossierDetailNotice {
  kind:
    | 'contact-added'
    | 'contact-updated'
    | 'contact-deleted'
    | 'key-date-saved'
    | 'key-date-deleted'
    | 'fee-agreement-saved'
    | 'fee-agreement-deleted'
    | 'fee-agreement-archived'
    | 'fee-agreement-activated'
    | 'billing-item-saved'
    | 'billing-item-deleted'
    | 'key-reference-saved'
    | 'key-reference-deleted'
    | 'note-saved'
    | 'note-deleted'
    | 'dossier-saved'
    | 'legal-aid-saved'
    | 'legal-aid-configured'
  dossierName: string
}

export type DossierSection =
  | 'contacts'
  | 'convention'
  | 'aide-juridictionnelle'
  | 'prestations'
  | 'factures'
  | 'echeances'
  | 'references'
  | 'notes'
  | 'documents'
  | 'pieces'
  | 'compare'
  | 'search'
  | 'legal'
  | 'legal-verify'
  | 'generate'
  | 'ai-assistant'
  | 'cowork'

const NOTICE_TRANSLATIONS: Record<
  DossierDetailNotice['kind'],
  { key: string; defaultValue?: string }
> = {
  'contact-added': { key: 'contacts.toast.added' },
  'contact-updated': { key: 'contacts.toast.updated' },
  'contact-deleted': { key: 'contacts.toast.deleted' },
  'key-date-saved': {
    key: 'dossiers.detail_notice_key_date_saved',
    defaultValue: '{{name}} : échéance enregistrée.'
  },
  'key-date-deleted': {
    key: 'dossiers.detail_notice_key_date_deleted',
    defaultValue: '{{name}} : échéance supprimée.'
  },
  'fee-agreement-saved': {
    key: 'dossiers.detail_notice_fee_agreement_saved',
    defaultValue: '{{name}} : convention enregistrée.'
  },
  'fee-agreement-deleted': {
    key: 'dossiers.detail_notice_fee_agreement_deleted',
    defaultValue: '{{name}} : convention supprimée.'
  },
  'fee-agreement-archived': {
    key: 'dossiers.detail_notice_fee_agreement_archived',
    defaultValue: '{{name}} : convention archivée.'
  },
  'fee-agreement-activated': {
    key: 'dossiers.detail_notice_fee_agreement_activated',
    defaultValue: '{{name}} : convention activée.'
  },
  'billing-item-saved': {
    key: 'dossiers.detail_notice_billing_item_saved',
    defaultValue: '{{name}} : prestation enregistrée.'
  },
  'billing-item-deleted': {
    key: 'dossiers.detail_notice_billing_item_deleted',
    defaultValue: '{{name}} : prestation supprimée.'
  },
  'key-reference-saved': {
    key: 'dossiers.detail_notice_key_reference_saved',
    defaultValue: '{{name}} : référence enregistrée.'
  },
  'key-reference-deleted': {
    key: 'dossiers.detail_notice_key_reference_deleted',
    defaultValue: '{{name}} : référence supprimée.'
  },
  'note-saved': {
    key: 'dossiers.detail_notice_note_saved',
    defaultValue: '{{name}} : note enregistrée.'
  },
  'note-deleted': {
    key: 'dossiers.detail_notice_note_deleted',
    defaultValue: '{{name}} : note supprimée.'
  },
  'dossier-saved': {
    key: 'dossiers.detail_notice_dossier_saved',
    defaultValue: '{{name}} : dossier enregistré.'
  },
  'legal-aid-saved': {
    key: 'dossiers.detail_notice_legal_aid_saved',
    defaultValue: '{{name}} : aide juridictionnelle enregistrée.'
  },
  'legal-aid-configured': {
    key: 'dossiers.detail_notice_legal_aid_configured',
    defaultValue: '{{name}} : aide juridictionnelle configurée automatiquement.'
  }
}

function formatNoticeToast(
  notice: DossierDetailNotice,
  t: ReturnType<typeof useTranslation>['t']
): string {
  const translation = NOTICE_TRANSLATIONS[notice.kind]
  return t(translation.key, {
    name: notice.dossierName,
    defaultValue: translation.defaultValue
  })
}

interface DossierDetailProps {
  dossier: DossierDetailRecord | null
  entityName?: string | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  notice: DossierDetailNotice | null
  activeSection: DossierSection
  onChangeSection: (section: DossierSection) => void
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
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  onDeleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  onArchiveFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<boolean>
  onSetActiveFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<boolean>
  onUpsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  onDeleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<boolean>
  onUpsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  onUpsertNote: (input: DossierNoteUpsertInput) => Promise<boolean>
  onDeleteNote: (input: DossierNoteDeleteInput) => Promise<boolean>
  onSaveDocumentMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  onOpenDocumentPreview: (input: { dossierId: string; documentPath: string }) => Promise<void>
  onOpenDocumentFile: (input: { dossierId: string; documentPath: string }) => Promise<void>
  onExtractDocumentContent: (input: { dossierId: string; documentPath: string }) => Promise<boolean>
  onCloseDocumentPreview?: () => void
}

export function DossierDetail({
  dossier,
  entityName = null,
  isLoading,
  isSaving,
  error,
  notice,
  activeSection,
  onChangeSection,
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
  onUpsertContact,
  onDeleteContact,
  onUpsertKeyDate,
  onDeleteKeyDate,
  onUpsertFeeAgreement,
  onDeleteFeeAgreement,
  onArchiveFeeAgreement,
  onSetActiveFeeAgreement,
  onUpsertBillingItem,
  onDeleteBillingItem,
  onUpsertKeyReference,
  onDeleteKeyReference,
  onUpsertNote,
  onDeleteNote,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent
}: DossierDetailProps): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading && !dossier) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
          {t('dossiers.detail_badge')}
        </p>
        <p className="text-sm text-ink">{t('dossiers.detail_loading')}</p>
      </div>
    )
  }

  if (!dossier) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
          {t('dossiers.detail_badge')}
        </p>
        <h3 className="text-2xl font-semibold text-ink">{t('dossiers.detail_empty_title')}</h3>
        <p className="text-sm text-ink">{t('dossiers.detail_empty_body')}</p>
      </div>
    )
  }

  return (
    <DossierDetailLayout
      key={dossier.slug}
      dossier={dossier}
      entityName={entityName}
      isSaving={isSaving}
      error={error}
      notice={notice}
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
      onUpsertKeyDate={onUpsertKeyDate}
      onDeleteKeyDate={onDeleteKeyDate}
      onUpsertFeeAgreement={onUpsertFeeAgreement}
      onDeleteFeeAgreement={onDeleteFeeAgreement}
      onArchiveFeeAgreement={onArchiveFeeAgreement}
      onSetActiveFeeAgreement={onSetActiveFeeAgreement}
      onUpsertBillingItem={onUpsertBillingItem}
      onDeleteBillingItem={onDeleteBillingItem}
      onUpsertKeyReference={onUpsertKeyReference}
      onDeleteKeyReference={onDeleteKeyReference}
      onUpsertNote={onUpsertNote}
      onDeleteNote={onDeleteNote}
      onSaveDocumentMetadata={onSaveDocumentMetadata}
      onOpenDocumentPreview={onOpenDocumentPreview}
      onOpenDocumentFile={onOpenDocumentFile}
      onExtractDocumentContent={onExtractDocumentContent}
    />
  )
}

function DossierDetailLayout({
  dossier,
  entityName,
  isSaving,
  error,
  notice,
  activeSection,
  onChangeSection,
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
  onUpsertContact,
  onDeleteContact,
  onUpsertKeyDate,
  onDeleteKeyDate,
  onUpsertFeeAgreement,
  onDeleteFeeAgreement,
  onArchiveFeeAgreement,
  onSetActiveFeeAgreement,
  onUpsertBillingItem,
  onDeleteBillingItem,
  onUpsertKeyReference,
  onDeleteKeyReference,
  onUpsertNote,
  onDeleteNote,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent
}: {
  dossier: DossierDetailRecord
  entityName: string | null
  isSaving: boolean
  error: string | null
  notice: DossierDetailNotice | null
  activeSection: DossierSection
  onChangeSection: (section: DossierSection) => void
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
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertFeeAgreement: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  onDeleteFeeAgreement: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  onArchiveFeeAgreement: (input: DossierFeeAgreementArchiveInput) => Promise<boolean>
  onSetActiveFeeAgreement: (input: DossierFeeAgreementSetActiveInput) => Promise<boolean>
  onUpsertBillingItem: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  onDeleteBillingItem: (input: DossierBillingItemDeleteInput) => Promise<boolean>
  onUpsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
  onUpsertNote: (input: DossierNoteUpsertInput) => Promise<boolean>
  onDeleteNote: (input: DossierNoteDeleteInput) => Promise<boolean>
  onSaveDocumentMetadata: (input: DocumentMetadataUpdate) => Promise<boolean>
  onOpenDocumentPreview: (input: { dossierId: string; documentPath: string }) => Promise<void>
  onOpenDocumentFile: (input: { dossierId: string; documentPath: string }) => Promise<void>
  onExtractDocumentContent: (input: { dossierId: string; documentPath: string }) => Promise<boolean>
}): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()

  const pendingConversion = useUiStore((state) => state.pendingBillingConversion)
  useEffect(() => {
    if (
      pendingConversion &&
      pendingConversion.dossierId === dossier.slug &&
      activeSection !== 'prestations'
    ) {
      onChangeSection('prestations')
    }
  }, [pendingConversion, dossier.slug, activeSection, onChangeSection])

  useEffect(() => {
    if (!notice) return
    const message = formatNoticeToast(notice, t)
    if (!message) return
    showToast(message)
  }, [notice, showToast, t])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {error ? (
        <AlertBanner tone="error" className="mb-4 shrink-0 p-4">
          {error}
        </AlertBanner>
      ) : null}

      {activeSection === 'contacts' && (
        <DossierSectionPane>
          <DossierContactsSection
            dossierId={dossier.slug}
            entries={contacts}
            error={contactsError}
            isLoading={contactsIsLoading}
            disabled={isSaving || contactsIsLoading}
            onSave={async (input) => {
              const saved = await onUpsertContact(input)

              if (saved) {
                const displayName = computeContactDisplayName(input)
                showToast(
                  t(input.uuid ? 'contacts.toast.updated' : 'contacts.toast.added', {
                    name: displayName
                  })
                )
              }

              return saved
            }}
            onDelete={async (input) => {
              const deletedContact = contacts.find((entry) => entry.uuid === input.contactUuid)
              const deletedContactName = deletedContact
                ? computeContactDisplayName(deletedContact)
                : input.contactUuid
              const deleted = await onDeleteContact(input)

              if (deleted) {
                showToast(t('contacts.toast.deleted', { name: deletedContactName }))
              }

              return deleted
            }}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'convention' && (
        <DossierSectionPane>
          <DossierFeeAgreementSection
            dossierId={dossier.slug}
            dossierName={dossier.name}
            feeAgreements={dossier.feeAgreements}
            billingItems={dossier.billingItems}
            documents={documents}
            contacts={contacts}
            disabled={isSaving}
            onSave={onUpsertFeeAgreement}
            onDelete={onDeleteFeeAgreement}
            onArchive={onArchiveFeeAgreement}
            onSetActive={onSetActiveFeeAgreement}
            onOpenDocumentFile={onOpenDocumentFile}
            onConvertToBillingItem={(agreement, feeAgreementConversionKind) => {
              useUiStore.getState().requestBillingConversion({
                dossierId: dossier.slug,
                source: 'feeAgreement',
                agreement,
                feeAgreementConversionKind
              })
              onChangeSection('prestations')
            }}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'aide-juridictionnelle' && (
        <DossierSectionPane>
          <DossierLegalAidSection key={dossier.slug} dossier={dossier} disabled={isSaving} />
        </DossierSectionPane>
      )}

      {activeSection === 'prestations' && (
        <DossierSectionPane>
          <DossierBillingItemsSectionWithPrefill
            dossierId={dossier.slug}
            entries={dossier.billingItems}
            disabled={isSaving}
            onSave={onUpsertBillingItem}
            onDelete={onDeleteBillingItem}
            onChangeSection={onChangeSection}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'factures' && (
        <DossierSectionPane>
          <DossierInvoicesSection dossierId={dossier.slug} onChangeSection={onChangeSection} />
        </DossierSectionPane>
      )}

      {activeSection === 'echeances' && (
        <DossierSectionPane>
          <DossierKeyDatesSection
            dossierId={dossier.slug}
            dossierName={dossier.name}
            entries={dossier.keyDates}
            disabled={isSaving}
            billedKeyDateIds={
              new Set(
                dossier.billingItems
                  .map((item) => item.sourceKeyDateUuid)
                  .filter((value): value is string => Boolean(value))
              )
            }
            onSave={async (input) => {
              return onUpsertKeyDate(input)
            }}
            onDelete={async (input) => {
              return onDeleteKeyDate(input)
            }}
            onConvertToBillingItem={(keyDate) => {
              useUiStore.getState().requestBillingConversion({
                dossierId: dossier.slug,
                source: 'keyDate',
                keyDate
              })
              onChangeSection('prestations')
            }}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'references' && (
        <DossierSectionPane>
          <DossierKeyReferencesSection
            dossierId={dossier.slug}
            dossierName={dossier.name}
            entries={dossier.keyReferences}
            disabled={isSaving}
            onSave={async (input) => {
              return onUpsertKeyReference(input)
            }}
            onDelete={async (input) => {
              return onDeleteKeyReference(input)
            }}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'notes' && (
        <DossierSectionPane>
          <DossierNotesSection
            dossierId={dossier.slug}
            dossierName={dossier.name}
            entries={dossier.notes}
            disabled={isSaving}
            onSave={async (input) => {
              return onUpsertNote(input)
            }}
            onDelete={async (input) => {
              return onDeleteNote(input)
            }}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'search' && (
        <DossierSectionPane>
          <SemanticSearchPanel dossierId={dossier.slug} onOpenDocument={onOpenDocumentPreview} />
        </DossierSectionPane>
      )}

      {activeSection === 'legal' && (
        <DossierSectionPane>
          <LegalSearchPanel key={`legal-${dossier.slug}`} dossierId={dossier.slug} mode="search" />
        </DossierSectionPane>
      )}

      {activeSection === 'legal-verify' && (
        <DossierSectionPane>
          <LegalSearchPanel
            key={`legal-verify-${dossier.slug}`}
            dossierId={dossier.slug}
            mode="verify"
          />
        </DossierSectionPane>
      )}

      {activeSection === 'documents' && (
        <DossierSectionPane>
          <DocumentList
            dossierId={dossier.slug}
            documents={documents}
            error={documentError}
            isLoading={documentIsLoading}
            isSavingMetadata={documentIsSaving}
            watchStatus={documentWatchStatus}
            activePreviewDocumentId={activePreviewDocumentId}
            previewState={documentPreviewState}
            contentState={documentContentState}
            onSaveMetadata={onSaveDocumentMetadata}
            onOpenPreview={onOpenDocumentPreview}
            onOpenFile={onOpenDocumentFile}
            onExtractContent={onExtractDocumentContent}
            onNavigateToGenerate={() => onChangeSection('generate')}
          />
        </DossierSectionPane>
      )}

      {activeSection === 'pieces' && (
        <DossierSectionPane>
          <PiecesSection dossier={dossier} />
        </DossierSectionPane>
      )}

      {activeSection === 'compare' && (
        <DossierSectionPane>
          <CompareSection key={`compare-${dossier.slug}`} dossier={dossier} />
        </DossierSectionPane>
      )}

      {activeSection === 'generate' && (
        <DossierSectionPane>
          <GenerateDocumentPanel dossierId={dossier.slug} />
        </DossierSectionPane>
      )}

      {activeSection === 'ai-assistant' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <AiPage dossierId={dossier.slug} />
        </div>
      )}

      {activeSection === 'cowork' && (
        <DossierSectionPane>
          <CoworkPage
            dossierId={dossier.slug}
            entityName={entityName}
            sampleDossierName={dossier.name}
          />
        </DossierSectionPane>
      )}
    </div>
  )
}

function DossierSectionPane({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="min-h-0 flex-1 overflow-hidden pt-1">{children}</div>
}

function DossierBillingItemsSectionWithPrefill(props: {
  dossierId: string
  entries: DossierDetailRecord['billingItems']
  disabled: boolean
  onSave: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  onDelete: (input: DossierBillingItemDeleteInput) => Promise<boolean>
  onChangeSection: (section: DossierSection) => void
}): React.JSX.Element {
  const pendingConversion = useUiStore((state) => state.pendingBillingConversion)
  const consumeConversion = useUiStore((state) => state.consumePendingBillingConversion)
  const prefillReturnSectionRef = useRef<DossierSection | null>(null)
  const matchingPendingConversion =
    pendingConversion && pendingConversion.dossierId === props.dossierId ? pendingConversion : null

  useEffect(() => {
    if (!matchingPendingConversion) return
    prefillReturnSectionRef.current =
      matchingPendingConversion.source === 'keyDate' ? 'echeances' : 'convention'
  }, [matchingPendingConversion])

  const prefillInput =
    matchingPendingConversion !== null
      ? matchingPendingConversion.source === 'keyDate'
        ? buildBillingItemFromKeyDate(matchingPendingConversion.keyDate)
        : buildBillingItemFromFeeAgreement(matchingPendingConversion.agreement, {
            dossierId: props.dossierId,
            today: new Date().toISOString().slice(0, 10),
            conversionKind: matchingPendingConversion.feeAgreementConversionKind
          })
      : null

  return (
    <DossierBillingItemsSection
      dossierId={props.dossierId}
      entries={props.entries}
      disabled={props.disabled}
      prefillItem={prefillInput}
      onConsumePrefill={() => {
        consumeConversion()
      }}
      onPrefillCancel={() => {
        const returnTo = prefillReturnSectionRef.current
        prefillReturnSectionRef.current = null
        if (returnTo) {
          props.onChangeSection(returnTo)
        }
      }}
      onSave={props.onSave}
      onDelete={props.onDelete}
    />
  )
}
