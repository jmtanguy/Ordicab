import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  ContactDeleteInput,
  ContactRecord,
  ContactUpsertInput,
  DossierAiExportAnalyzeResult,
  DossierAiExportResult,
  DossierAiImportAnalyzeResult,
  DossierAiImportResult,
  DocumentMetadataUpdate,
  DocumentRecord,
  DocumentWatchStatus,
  DossierDetail as DossierDetailRecord,
  DossierKeyDateDeleteInput,
  DossierKeyDateUpsertInput,
  DossierKeyReferenceDeleteInput,
  DossierKeyReferenceUpsertInput,
  DossierStatus,
  DossierUpdateInput
} from '@shared/types'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'

import {
  AlertBanner,
  Button,
  Card,
  DialogShell,
  Field,
  Input,
  Select,
  Textarea
} from '@renderer/components/ui'
import { DelegatedPrompt } from '@renderer/components/shell/DelegatedPrompt'
import { useToast } from '@renderer/contexts/ToastContext'
import { buildPrompt } from '@renderer/features/delegated/promptTemplates'
import { DocumentList } from '@renderer/features/documents/DocumentList'
import { SemanticSearchPanel } from '@renderer/features/documents/SemanticSearchPanel'
import { cn } from '@renderer/lib/utils'
import type { DocumentContentState, DocumentPreviewState } from '@renderer/stores'

import { DossierKeyDatesSection } from './DossierKeyDatesSection'
import { DossierContactsSection } from './DossierContactsSection'
import { DossierKeyReferencesSection } from './DossierKeyReferencesSection'

export interface DossierDetailNotice {
  kind:
    | 'saved'
    | 'contact-added'
    | 'contact-updated'
    | 'contact-deleted'
    | 'key-date-saved'
    | 'key-date-deleted'
    | 'key-reference-saved'
    | 'key-reference-deleted'
  dossierName: string
}

type SidebarSection =
  | 'contacts'
  | 'informations'
  | 'echeances'
  | 'references'
  | 'documents'
  | 'search'
  | 'export'
  | 'import'

type ExportExtractionDialogPhase = 'idle' | 'confirm' | 'running' | 'done'

interface DossierDetailProps {
  dossier: DossierDetailRecord | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  notice: DossierDetailNotice | null
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
  onClose: () => void
  onUnregister: (id: string) => Promise<boolean>
  onSave: (input: DossierUpdateInput) => Promise<boolean>
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
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
  onCloseDocumentPreview?: () => void
  onNavigateToGenerate?: () => void
  dossierTransferError?: string | null
  dossierTransferIsLoading?: boolean
  exportRootPath?: string | null
  exportAnalysis?: DossierAiExportAnalyzeResult | null
  importAnalysis?: DossierAiImportAnalyzeResult | null
  exportResult?: DossierAiExportResult | null
  importResult?: DossierAiImportResult | null
  selectedImportFiles?: Set<string>
  isExporting?: boolean
  isImporting?: boolean
  onPickExportRoot?: () => Promise<string | null>
  onAnalyzeAiExport?: (dossierId: string) => Promise<DossierAiExportAnalyzeResult | null>
  onExportForAi?: (input: {
    dossierId: string
    rootPath: string
    anonymize: boolean
  }) => Promise<boolean>
  onPickAndAnalyzeImport?: (dossierId: string) => Promise<DossierAiImportAnalyzeResult | null>
  onToggleImportFile?: (relativePath: string) => void
  onSetAllImportFiles?: (paths: string[], selected: boolean) => void
  onImportAiProduction?: (dossierId: string) => Promise<boolean>
}

export function DossierDetail({
  dossier,
  isLoading,
  isSaving,
  error,
  notice,
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
  onClose,
  onUnregister,
  onSave,
  onUpsertContact,
  onDeleteContact,
  onUpsertKeyDate,
  onDeleteKeyDate,
  onUpsertKeyReference,
  onDeleteKeyReference,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent,
  onExtractPendingDocumentContent,
  onClearDocumentContentCache,
  onNavigateToGenerate,
  dossierTransferError = null,
  dossierTransferIsLoading = false,
  exportRootPath = null,
  exportAnalysis = null,
  importAnalysis = null,
  exportResult = null,
  importResult = null,
  selectedImportFiles = new Set<string>(),
  isExporting = false,
  isImporting = false,
  onPickExportRoot = async () => null,
  onAnalyzeAiExport = async () => null,
  onExportForAi = async () => false,
  onPickAndAnalyzeImport = async () => null,
  onToggleImportFile = () => undefined,
  onSetAllImportFiles = () => undefined,
  onImportAiProduction = async () => false
}: DossierDetailProps): React.JSX.Element {
  const { t } = useTranslation()

  if (isLoading && !dossier) {
    return (
      <Card className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
          {t('dossiers.detail_badge')}
        </p>
        <p className="text-sm text-slate-300">{t('dossiers.detail_loading')}</p>
      </Card>
    )
  }

  if (!dossier) {
    return (
      <Card className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-aurora-soft">
          {t('dossiers.detail_badge')}
        </p>
        <h3 className="text-2xl font-semibold text-slate-50">{t('dossiers.detail_empty_title')}</h3>
        <p className="text-sm text-slate-300">{t('dossiers.detail_empty_body')}</p>
      </Card>
    )
  }

  return (
    <DossierDetailLayout
      key={dossier.id}
      dossier={dossier}
      isSaving={isSaving}
      error={error}
      notice={notice}
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
      onClose={onClose}
      onUnregister={onUnregister}
      onSave={onSave}
      onUpsertContact={onUpsertContact}
      onDeleteContact={onDeleteContact}
      onUpsertKeyDate={onUpsertKeyDate}
      onDeleteKeyDate={onDeleteKeyDate}
      onUpsertKeyReference={onUpsertKeyReference}
      onDeleteKeyReference={onDeleteKeyReference}
      onSaveDocumentMetadata={onSaveDocumentMetadata}
      onOpenDocumentPreview={onOpenDocumentPreview}
      onOpenDocumentFile={onOpenDocumentFile}
      onExtractDocumentContent={onExtractDocumentContent}
      onExtractPendingDocumentContent={onExtractPendingDocumentContent}
      onClearDocumentContentCache={onClearDocumentContentCache}
      onNavigateToGenerate={onNavigateToGenerate}
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

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso)
    )
  } catch {
    return iso
  }
}

function DossierDetailLayout({
  dossier,
  isSaving,
  error,
  notice,
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
  onClose,
  onUnregister,
  onSave,
  onUpsertContact,
  onDeleteContact,
  onUpsertKeyDate,
  onDeleteKeyDate,
  onUpsertKeyReference,
  onDeleteKeyReference,
  onSaveDocumentMetadata,
  onOpenDocumentPreview,
  onOpenDocumentFile,
  onExtractDocumentContent,
  onExtractPendingDocumentContent,
  onClearDocumentContentCache,
  onNavigateToGenerate,
  dossierTransferError,
  dossierTransferIsLoading,
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
  onImportAiProduction
}: {
  dossier: DossierDetailRecord
  isSaving: boolean
  error: string | null
  notice: DossierDetailNotice | null
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
  onClose: () => void
  onUnregister: (id: string) => Promise<boolean>
  onSave: (input: DossierUpdateInput) => Promise<boolean>
  onUpsertContact: (input: ContactUpsertInput) => Promise<boolean>
  onDeleteContact: (input: ContactDeleteInput) => Promise<boolean>
  onUpsertKeyDate: (input: DossierKeyDateUpsertInput) => Promise<boolean>
  onDeleteKeyDate: (input: DossierKeyDateDeleteInput) => Promise<boolean>
  onUpsertKeyReference: (input: DossierKeyReferenceUpsertInput) => Promise<boolean>
  onDeleteKeyReference: (input: DossierKeyReferenceDeleteInput) => Promise<boolean>
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
  onNavigateToGenerate?: () => void
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
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { showToast } = useToast()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [activeSection, setActiveSection] = useState<SidebarSection>('documents')
  const [status, setStatus] = useState<DossierStatus>(dossier.status)
  const [type, setType] = useState(dossier.type)
  const [information, setInformation] = useState(dossier.information ?? '')
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)
  const [confirmingUnregister, setConfirmingUnregister] = useState(false)
  const [isUnregistering, setIsUnregistering] = useState(false)
  const [anonymizeExport, setAnonymizeExport] = useState(true)
  const [exportExtractionDialogPhase, setExportExtractionDialogPhase] =
    useState<ExportExtractionDialogPhase>('idle')
  const [exportExtractionProgress, setExportExtractionProgress] = useState<{
    current: number
    total: number
    succeeded: number
    failed: number
    currentFilename: string | null
    wasAborted: boolean
  }>({ current: 0, total: 0, succeeded: 0, failed: 0, currentFilename: null, wasAborted: false })
  const exportExtractionAbortRequestedRef = useRef(false)
  const isDirty =
    status !== dossier.status ||
    type !== dossier.type ||
    information !== (dossier.information ?? '')

  useEffect(() => {
    if (activeSection === 'export') {
      void onAnalyzeAiExport(dossier.id)
    }
  }, [activeSection]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notice) return
    const key =
      notice.kind === 'contact-added'
        ? 'contacts.toast.added'
        : notice.kind === 'contact-updated'
          ? 'contacts.toast.updated'
          : notice.kind === 'contact-deleted'
            ? 'contacts.toast.deleted'
            : notice.kind === 'key-date-saved'
              ? 'dossiers.detail_notice_key_date_saved'
              : notice.kind === 'key-date-deleted'
                ? 'dossiers.detail_notice_key_date_deleted'
                : notice.kind === 'key-reference-saved'
                  ? 'dossiers.detail_notice_key_reference_saved'
                  : notice.kind === 'key-reference-deleted'
                    ? 'dossiers.detail_notice_key_reference_deleted'
                    : 'dossiers.detail_notice_saved'
    showToast(t(key, { name: notice.dossierName }))
  }, [notice, showToast, t])

  const handleFinishMissingExtractions = async (): Promise<void> => {
    if (!exportAnalysis || exportAnalysis.missingExtractionDocuments.length === 0) {
      return
    }

    const pendingDocuments = exportAnalysis.missingExtractionDocuments
    exportExtractionAbortRequestedRef.current = false
    setExportExtractionProgress({
      current: 0,
      total: pendingDocuments.length,
      succeeded: 0,
      failed: 0,
      currentFilename: null,
      wasAborted: false
    })
    setExportExtractionDialogPhase('running')

    let succeeded = 0
    let failed = 0
    let aborted = false

    for (let index = 0; index < pendingDocuments.length; index += 1) {
      if (exportExtractionAbortRequestedRef.current) {
        aborted = true
        break
      }

      const document = pendingDocuments[index]!
      setExportExtractionProgress((previous) => ({
        ...previous,
        current: index + 1,
        currentFilename: document.filename
      }))

      const ok = await onExtractDocumentContent({
        dossierId: dossier.id,
        documentId: document.documentId
      })

      if (ok) {
        succeeded += 1
      } else {
        failed += 1
      }

      setExportExtractionProgress((previous) => ({
        ...previous,
        succeeded,
        failed
      }))
    }

    await onAnalyzeAiExport(dossier.id)

    setExportExtractionProgress((previous) => ({
      ...previous,
      currentFilename: null,
      wasAborted: aborted
    }))
    setExportExtractionDialogPhase('done')
  }

  const sidebarItems: { id: SidebarSection; label: string }[] = [
    { id: 'documents', label: t('documents.section_title') },
    { id: 'search', label: t('documents.semantic_search_nav_label') },
    { id: 'contacts', label: t('contacts.sectionTitle') },
    { id: 'echeances', label: t('dossiers.key_dates_title') },
    { id: 'references', label: t('dossiers.key_references_title') },
    { id: 'informations', label: t('dossiers.detail_badge') },
    { id: 'export', label: t('dossiers.ai_export_title') },
    { id: 'import', label: t('dossiers.ai_import_title') }
  ]

  return (
    <div className="flex h-[calc(100vh-8.5rem)] overflow-hidden rounded-[1.5rem] border border-white/8 bg-[rgba(8,15,28,0.5)] shadow-[var(--shadow-panel)]">
      <aside className="flex w-48 shrink-0 flex-col border-r border-white/8 bg-[rgba(8,15,28,0.78)] p-4 xl:w-60 2xl:w-[17.5rem] 2xl:p-5">
        <button
          type="button"
          onClick={onClose}
          className="mb-5 flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
        >
          <span aria-hidden>←</span>
          <span>{t('dossiers.detail_close_action')}</span>
        </button>

        {/* Dossier identity */}
        <div className="mb-5 space-y-1">
          <p className="text-xs uppercase tracking-[0.18em] text-aurora-soft">
            {t('dossiers.card_badge')}
          </p>
          <h3 className="text-sm font-semibold leading-snug text-slate-50">{dossier.name}</h3>
          {dossier.type.trim() ? <p className="text-xs text-slate-400">{dossier.type}</p> : null}
        </div>

        <nav className="space-y-0.5">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition',
                activeSection === item.id
                  ? 'border-l-2 border-aurora bg-aurora/10 pl-2.5 text-aurora'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-4">
          {!confirmingUnregister ? (
            <button
              type="button"
              onClick={() => setConfirmingUnregister(true)}
              className="flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-white/5 hover:text-rose-400"
            >
              {t('dossiers.unregister_action')}
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-rose-400/30 bg-rose-400/8 p-3">
              <p className="text-xs font-semibold text-rose-300">
                {t('dossiers.unregister_confirm_title')}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isUnregistering}
                  onClick={async () => {
                    setIsUnregistering(true)
                    await onUnregister(dossier.id)
                    setIsUnregistering(false)
                    setConfirmingUnregister(false)
                  }}
                  className="rounded-lg bg-rose-500/20 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                >
                  {t('dossiers.unregister_confirm_action')}
                </button>
                <button
                  type="button"
                  disabled={isUnregistering}
                  onClick={() => setConfirmingUnregister(false)}
                  className="rounded-lg px-2.5 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 disabled:opacity-50"
                >
                  {t('dossiers.unregister_cancel_action')}
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[rgba(10,18,32,0.68)] p-5 xl:p-6 2xl:p-7">
        {error ? (
          <AlertBanner tone="error" className="mb-5 shrink-0 p-4">
            {error}
          </AlertBanner>
        ) : null}

        {activeSection === 'contacts' && (
          <div className="min-h-0 flex-1">
            <DossierContactsSection
              dossierId={dossier.id}
              dossierName={dossier.name}
              entries={contacts}
              error={contactsError}
              isLoading={contactsIsLoading}
              disabled={isSaving || contactsIsLoading}
              onSave={async (input) => {
                const saved = await onUpsertContact(input)

                if (saved) {
                  const displayName = computeContactDisplayName(input)
                  showToast(
                    t(input.id ? 'contacts.toast.updated' : 'contacts.toast.added', {
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
          </div>
        )}

        {activeSection === 'informations' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Card className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {t('dossiers.detail_badge')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => setShowDetailsDialog(true)}
                >
                  {t('dossiers.detail_edit_action')}
                </Button>
              </div>

              <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {t('dossiers.detail_status_label')}
                  </p>
                  <p className="mt-1 font-medium text-slate-100">
                    {t(`dossiers.status_${dossier.status}`)}
                  </p>
                </div>
                {dossier.type.trim() ? (
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                      {t('dossiers.detail_type_label')}
                    </p>
                    <p className="mt-1 font-medium text-slate-100">{dossier.type}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {t('dossiers.detail_registered_label')}
                  </p>
                  <p className="mt-1 text-slate-300">{formatDate(dossier.registeredAt, locale)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    {t('dossiers.detail_updated_label')}
                  </p>
                  <p className="mt-1 text-slate-300">{formatDate(dossier.updatedAt, locale)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {t('dossiers.detail_information_label')}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-slate-300">
                  {dossier.information?.trim() || t('dossiers.detail_information_empty')}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {t('dossiers.card_next_date_label')}
                </p>
                <p className="mt-2 font-medium text-slate-100">
                  {dossier.nextUpcomingKeyDate ?? t('dossiers.card_next_date_empty')}
                </p>
              </div>

              <DelegatedPrompt
                prompt={buildPrompt('dossierSetup', { dossierName: dossier.name })}
              />
            </Card>
          </div>
        )}

        {showDetailsDialog ? (
          <DialogShell
            size="md"
            aria-label={t('dossiers.detail_edit_action')}
            onDismiss={() => setShowDetailsDialog(false)}
          >
            <div>
              <h3 className="text-lg font-semibold text-slate-50">
                {t('dossiers.detail_edit_action')}
              </h3>
              <p className="mt-1 text-sm text-slate-300">{dossier.name}</p>
            </div>

            <form
              className="flex flex-col gap-0"
              onSubmit={async (event) => {
                event.preventDefault()
                const saved = await onSave({ id: dossier.id, status, type, information })
                if (saved) setShowDetailsDialog(false)
              }}
            >
              <div className="grid gap-4 py-5">
                <Field label={t('dossiers.detail_status_label')} htmlFor="dossier-detail-status">
                  <Select
                    id="dossier-detail-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as DossierStatus)}
                  >
                    <option value="active">{t('dossiers.status_active')}</option>
                    <option value="pending">{t('dossiers.status_pending')}</option>
                    <option value="completed">{t('dossiers.status_completed')}</option>
                    <option value="archived">{t('dossiers.status_archived')}</option>
                  </Select>
                </Field>

                <Field label={t('dossiers.detail_type_label')} htmlFor="dossier-detail-type">
                  <Input
                    id="dossier-detail-type"
                    type="text"
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    placeholder={t('dossiers.detail_type_placeholder')}
                  />
                </Field>

                <Field
                  label={t('dossiers.detail_information_label')}
                  htmlFor="dossier-detail-information"
                >
                  <Textarea
                    id="dossier-detail-information"
                    rows={8}
                    value={information}
                    onChange={(event) => setInformation(event.target.value)}
                    placeholder={t('dossiers.detail_information_placeholder')}
                  />
                </Field>
              </div>

              <div className="mt-auto flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={() => setShowDetailsDialog(false)}
                >
                  {t('dossiers.detail_cancel_action')}
                </Button>
                <Button type="submit" disabled={isSaving || !isDirty}>
                  {t('dossiers.detail_save_action')}
                </Button>
              </div>
            </form>
          </DialogShell>
        ) : null}

        {activeSection === 'echeances' && (
          <div className="min-h-0 flex-1">
            <DossierKeyDatesSection
              dossierId={dossier.id}
              dossierName={dossier.name}
              entries={dossier.keyDates}
              disabled={isSaving}
              onSave={async (input) => {
                return onUpsertKeyDate(input)
              }}
              onDelete={async (input) => {
                return onDeleteKeyDate(input)
              }}
            />
          </div>
        )}

        {activeSection === 'references' && (
          <div className="min-h-0 flex-1">
            <DossierKeyReferencesSection
              dossierId={dossier.id}
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
          </div>
        )}

        {activeSection === 'search' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SemanticSearchPanel dossierId={dossier.id} onOpenDocument={onOpenDocumentPreview} />
          </div>
        )}

        {activeSection === 'documents' && (
          <DocumentList
            dossierId={dossier.id}
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
            onExtractPendingContent={onExtractPendingDocumentContent}
            onClearContentCache={onClearDocumentContentCache}
            onNavigateToGenerate={onNavigateToGenerate}
          />
        )}

        {activeSection === 'export' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Card className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {t('dossiers.ai_export_title')}
                </p>
                <h3 className="text-lg font-semibold text-slate-50">{dossier.name}</h3>
                <p className="text-sm leading-6 text-slate-400">
                  {t('dossiers.ai_export_description')}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-400">
                <p className="mb-2 font-medium text-slate-300">
                  {t('dossiers.ai_export_steps_title')}
                </p>
                <ol className="list-decimal space-y-1 pl-4">
                  {(['step1', 'step2', 'step3', 'step4', 'step5'] as const).map((step) => (
                    <li key={step}>{t(`dossiers.ai_export_${step}`)}</li>
                  ))}
                </ol>
              </div>

              {dossierTransferError ? (
                <AlertBanner tone="error">{dossierTransferError}</AlertBanner>
              ) : null}

              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={anonymizeExport}
                  onChange={(event) => setAnonymizeExport(event.target.checked)}
                />
                <span>{t('dossiers.ai_export_anonymize_label')}</span>
              </label>

              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                {exportAnalysis ? (
                  <>
                    <p>
                      {t('dossiers.ai_export_analysis_counts', {
                        extracted: exportAnalysis.extractedDocumentCount,
                        extractable: exportAnalysis.extractableDocumentCount,
                        total: exportAnalysis.totalDocumentCount
                      })}
                    </p>
                    {exportAnalysis.missingExtractionCount > 0 ? (
                      <div className="mt-3 space-y-3">
                        <AlertBanner tone="warning">
                          {t('dossiers.ai_export_missing_extraction', {
                            count: exportAnalysis.missingExtractionCount
                          })}
                        </AlertBanner>
                        <Button
                          type="button"
                          size="sm"
                          disabled={exportExtractionDialogPhase !== 'idle'}
                          onClick={() => {
                            setExportExtractionDialogPhase('confirm')
                          }}
                        >
                          {t('dossiers.ai_export_finish_extraction')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-slate-400">
                    {dossierTransferIsLoading
                      ? t('dossiers.ai_analyzing')
                      : t('dossiers.ai_path_empty')}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={isExporting}
                  onClick={async () => {
                    const path = await onPickExportRoot()
                    if (!path) return
                    void onExportForAi({
                      dossierId: dossier.id,
                      rootPath: path,
                      anonymize: anonymizeExport
                    })
                  }}
                >
                  {t('dossiers.ai_export_run_action')}
                </Button>
              </div>

              {exportResult ? (
                <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/8 p-4 text-sm text-emerald-100">
                  <p>{t('dossiers.ai_export_done', { path: exportResult.aiPath })}</p>
                </div>
              ) : null}

              {exportExtractionDialogPhase !== 'idle' ? (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm">
                  <div
                    role="dialog"
                    aria-modal="true"
                    className="flex w-full max-w-md flex-col gap-5 rounded-[28px] border border-sky-200/18 bg-[rgba(16,26,44,0.985)] p-6 shadow-[0_32px_100px_rgba(2,6,23,0.62)]"
                  >
                    <p className="text-sm font-semibold text-slate-100">
                      {t('documents.extract_all_dialog_title')}
                    </p>

                    {exportExtractionDialogPhase === 'confirm' ? (
                      <>
                        <p className="text-sm text-slate-300">
                          {t('documents.extract_all_dialog_confirm_body', {
                            count: exportAnalysis?.missingExtractionDocuments.length ?? 0
                          })}
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExportExtractionDialogPhase('idle')}
                          >
                            {t('documents.extract_all_dialog_cancel_action')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void handleFinishMissingExtractions()
                            }}
                          >
                            {t('documents.extract_all_dialog_confirm_action')}
                          </Button>
                        </div>
                      </>
                    ) : null}

                    {exportExtractionDialogPhase === 'running' ? (
                      <>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span>
                              {t('documents.extract_all_dialog_progress', {
                                current: exportExtractionProgress.current,
                                total: exportExtractionProgress.total
                              })}
                            </span>
                            <span>
                              {Math.round(
                                (exportExtractionProgress.current /
                                  Math.max(exportExtractionProgress.total, 1)) *
                                  100
                              )}
                              %
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-aurora transition-all duration-300"
                              style={{
                                width: `${(exportExtractionProgress.current / Math.max(exportExtractionProgress.total, 1)) * 100}%`
                              }}
                            />
                          </div>
                          {exportExtractionProgress.currentFilename ? (
                            <p className="truncate text-xs text-slate-400">
                              {t('documents.extract_all_dialog_current_file', {
                                name: exportExtractionProgress.currentFilename
                              })}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              exportExtractionAbortRequestedRef.current = true
                            }}
                          >
                            {t('documents.extract_all_dialog_abort_action')}
                          </Button>
                        </div>
                      </>
                    ) : null}

                    {exportExtractionDialogPhase === 'done' ? (
                      <>
                        <p className="text-sm text-slate-300">
                          {exportExtractionProgress.wasAborted
                            ? t('documents.extract_all_dialog_aborted_body', {
                                succeeded: exportExtractionProgress.succeeded,
                                failed: exportExtractionProgress.failed,
                                attempted: exportExtractionProgress.current
                              })
                            : t('documents.extract_all_dialog_done_body', {
                                succeeded: exportExtractionProgress.succeeded,
                                failed: exportExtractionProgress.failed,
                                attempted: exportExtractionProgress.total
                              })}
                        </p>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExportExtractionDialogPhase('idle')}
                          >
                            {t('documents.extract_all_dialog_close_action')}
                          </Button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        )}

        {activeSection === 'import' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Card className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {t('dossiers.ai_import_title')}
                </p>
                <h3 className="text-lg font-semibold text-slate-50">{dossier.name}</h3>
                <p className="text-sm leading-6 text-slate-400">
                  {t('dossiers.ai_import_description')}
                </p>
              </div>

              {dossierTransferError ? (
                <AlertBanner tone="error">{dossierTransferError}</AlertBanner>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={dossierTransferIsLoading || isImporting}
                  onClick={() => void onPickAndAnalyzeImport(dossier.id)}
                >
                  {dossierTransferIsLoading
                    ? t('dossiers.ai_analyzing')
                    : t('dossiers.ai_import_pick_action')}
                </Button>
              </div>

              {importAnalysis && importAnalysis.files.length > 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4 text-sm text-slate-300">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-100">
                      {t('dossiers.ai_import_analysis_counts', { count: importAnalysis.fileCount })}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-slate-200"
                        onClick={() =>
                          onSetAllImportFiles(
                            importAnalysis.files.map((f) => f.relativePath),
                            true
                          )
                        }
                      >
                        {t('dossiers.ai_import_select_all')}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-slate-200"
                        onClick={() =>
                          onSetAllImportFiles(
                            importAnalysis.files.map((f) => f.relativePath),
                            false
                          )
                        }
                      >
                        {t('dossiers.ai_import_deselect_all')}
                      </button>
                    </div>
                  </div>
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {importAnalysis.files.map((file) => (
                      <li key={file.relativePath}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
                          <input
                            type="checkbox"
                            className="accent-aurora-soft"
                            checked={selectedImportFiles.has(file.relativePath)}
                            onChange={() => onToggleImportFile(file.relativePath)}
                          />
                          <span className="break-all text-slate-300">{file.relativePath}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importAnalysis ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={selectedImportFiles.size === 0 || isImporting}
                    onClick={() => void onImportAiProduction(dossier.id)}
                  >
                    {t('dossiers.ai_import_run_action_count', { count: selectedImportFiles.size })}
                  </Button>
                </div>
              ) : null}

              {importResult ? (
                <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/8 p-4 text-sm text-emerald-100">
                  <p>
                    {t('dossiers.ai_import_done', {
                      imported: importResult.importedCount,
                      failed: importResult.failedCount
                    })}
                  </p>
                </div>
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
