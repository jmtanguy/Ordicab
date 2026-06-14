import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  applyVatRate,
  computeBillingItemTotals,
  computeFeeAgreementBillingAmounts
} from '@shared/billingCalculations'
import { computeContactDisplayName } from '@shared/computeContactDisplayName'
import {
  BILLING_TYPE_VALUES,
  FEE_AGREEMENT_STATUS_VALUES,
  isCabinetServicePresetEligibleForFeeAgreement
} from '@shared/types'
import type {
  BillingType,
  ContactRecord,
  DocumentRecord,
  DossierBillingItem,
  DossierFeeAgreement,
  DossierFeeAgreementArchiveInput,
  DossierFeeAgreementDeleteInput,
  DossierFeeAgreementSetActiveInput,
  DossierFeeAgreementUpsertInput,
  FeeAgreementStatus,
  SourceFeeAgreementBillingKind,
  TemplateRecord
} from '@shared/types'

import {
  formatBasisPoints,
  formatEurosFromCents,
  parseEurosToCents,
  parsePercentToBasisPoints
} from '@renderer/lib/billingFormatters'
import { billingTypeLabel, feeAgreementStatusLabel } from '@renderer/lib/domainLabels'
import { useCabinetBillingStore, useTemplateStore } from '@renderer/stores'
import {
  AlertBanner,
  Button,
  DialogShell,
  Field,
  Input,
  Select,
  Textarea
} from '@renderer/components/ui'

import {
  ArchiveIcon,
  CheckIcon,
  DeleteConfirmTray,
  IconButton,
  PencilIcon,
  ReceiptIcon,
  SectionHeader,
  TrashIcon
} from './sectionLayout'
import {
  buildFeeAgreementUpsertInput,
  applyFeeAgreementPresetToEditor,
  createEmptyFeeAgreementEditor,
  createFeeAgreementEditorFromAgreement,
  createUpsertInputFromFeeAgreement,
  type FeeAgreementEditorState
} from './feeAgreementEditorModel'
import { computeBillingTotalsFromEditor } from './billingDiscountEditor'
import { DossierDiscountFields } from './DossierDiscountFields'

function formatDiscountLabel(
  agreement: DossierFeeAgreement,
  t: ReturnType<typeof useTranslation>['t']
): string | undefined {
  if (agreement.discountKind === 'percent') {
    return t('dossiers.fee_agreement_discount_value_percent', {
      defaultValue: '{{value}} de remise',
      value: formatBasisPoints(agreement.discountPercentBasisPoints)
    })
  }
  if (agreement.discountKind === 'amount') {
    return t('dossiers.fee_agreement_discount_value_amount', {
      defaultValue: '{{value}} de remise',
      value: formatEurosFromCents(agreement.discountAmountHtCents)
    })
  }
  return undefined
}

function resolveLinkedDocument(
  documents: DocumentRecord[],
  uuid?: string
): DocumentRecord | undefined {
  return uuid ? documents.find((entry) => entry.uuid === uuid) : undefined
}

export function DossierFeeAgreementSection({
  dossierId,
  dossierName,
  feeAgreements,
  billingItems,
  documents,
  contacts,
  disabled,
  onSave,
  onDelete,
  onArchive,
  onSetActive,
  onOpenDocumentFile,
  onConvertToBillingItem
}: {
  dossierId: string
  dossierName: string
  feeAgreements: DossierFeeAgreement[]
  billingItems: DossierBillingItem[]
  documents: DocumentRecord[]
  contacts: ContactRecord[]
  disabled: boolean
  onSave: (input: DossierFeeAgreementUpsertInput) => Promise<boolean>
  onDelete: (input: DossierFeeAgreementDeleteInput) => Promise<boolean>
  onArchive: (input: DossierFeeAgreementArchiveInput) => Promise<boolean>
  onSetActive: (input: DossierFeeAgreementSetActiveInput) => Promise<boolean>
  onOpenDocumentFile?: (input: { dossierId: string; documentPath: string }) => Promise<void>
  onConvertToBillingItem?: (
    agreement: DossierFeeAgreement,
    conversionKind: SourceFeeAgreementBillingKind
  ) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<FeeAgreementEditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState<string | null>(null)
  const [showSignedPicker, setShowSignedPicker] = useState<string | null>(null)
  const [templatePickerSearch, setTemplatePickerSearch] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [signedPickerSearch, setSignedPickerSearch] = useState('')
  const [selectedSignedDocumentUuid, setSelectedSignedDocumentUuid] = useState<string | null>(null)
  const [isPickerSubmitting, setIsPickerSubmitting] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [conversionMenuAgreementId, setConversionMenuAgreementId] = useState<string | null>(null)

  const catalog = useCabinetBillingStore((state) => state.catalog)
  const catalogError = useCabinetBillingStore((state) => state.error)
  const loadCatalog = useCabinetBillingStore((state) => state.load)

  const templates = useTemplateStore((state) => state.templates)
  const loadTemplates = useTemplateStore((state) => state.load)
  const generateTemplate = useTemplateStore((state) => state.generate)

  useEffect(() => {
    void loadCatalog()
    void loadTemplates()
  }, [loadCatalog, loadTemplates])

  const activePresets = useMemo(
    () =>
      (catalog?.services ?? [])
        .filter((preset) => isCabinetServicePresetEligibleForFeeAgreement(preset))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [catalog?.services]
  )

  const defaultPreset =
    activePresets.find((preset) => preset.uuid === catalog?.defaultServiceUuid) ?? activePresets[0]

  const sortedAgreements = useMemo(
    () =>
      [...feeAgreements].sort((left, right) => {
        if (left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1
        }
        return right.createdAt.localeCompare(left.createdAt)
      }),
    [feeAgreements]
  )

  const feeAgreementTemplates = useMemo(
    () => templates.filter((template) => template.tags?.includes('fee-agreement') ?? false),
    [templates]
  )
  const availableTemplates = feeAgreementTemplates.length > 0 ? feeAgreementTemplates : templates
  const sortedAvailableTemplates = useMemo(
    () => [...availableTemplates].sort((left, right) => left.name.localeCompare(right.name)),
    [availableTemplates]
  )
  const filteredTemplates = useMemo(() => {
    const query = templatePickerSearch.trim().toLowerCase()
    if (!query) return sortedAvailableTemplates
    return sortedAvailableTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        (template.description ?? '').toLowerCase().includes(query) ||
        (template.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
    )
  }, [sortedAvailableTemplates, templatePickerSearch])
  const selectableSignedDocuments = useMemo(
    () =>
      documents
        .filter((document): document is DocumentRecord & { uuid: string } => Boolean(document.uuid))
        .sort((left, right) => {
          const modified = right.modifiedAt.localeCompare(left.modifiedAt)
          return modified !== 0 ? modified : left.filename.localeCompare(right.filename)
        }),
    [documents]
  )
  const filteredSignedDocuments = useMemo(() => {
    const query = signedPickerSearch.trim().toLowerCase()
    if (!query) return selectableSignedDocuments
    return selectableSignedDocuments.filter(
      (document) =>
        document.filename.toLowerCase().includes(query) ||
        document.relativePath.toLowerCase().includes(query) ||
        (document.description ?? '').toLowerCase().includes(query) ||
        document.tags.some((tag) => tag.toLowerCase().includes(query))
    )
  }, [selectableSignedDocuments, signedPickerSearch])
  const selectedTemplateIsVisible = filteredTemplates.some(
    (template) => template.uuid === selectedTemplateId
  )
  const selectedSignedDocumentIsVisible = filteredSignedDocuments.some(
    (document) => document.uuid === selectedSignedDocumentUuid
  )

  const closeTemplatePicker = (): void => {
    setShowTemplatePicker(null)
    setTemplatePickerSearch('')
    setSelectedTemplateId(null)
  }

  const closeSignedPicker = (): void => {
    setShowSignedPicker(null)
    setSignedPickerSearch('')
    setSelectedSignedDocumentUuid(null)
  }

  const handleGenerate = async (
    feeAgreement: DossierFeeAgreement,
    templateUuid: string
  ): Promise<void> => {
    setGenerationError(null)
    const versionIndex =
      sortedAgreements.findIndex((entry) => entry.uuid === feeAgreement.uuid) + 1 ||
      sortedAgreements.length
    const description = t('dossiers.fee_agreement_generated_doc_description', {
      defaultValue: 'Convention d’honoraires v{{version}} — {{matter}}',
      version: versionIndex || 1,
      matter: feeAgreement.matterLabel
    })
    const result = await generateTemplate({
      dossierId,
      templateUuid,
      description,
      tags: ['fee-agreement', `convention:${feeAgreement.uuid}`]
    })
    if (!result.success) {
      setGenerationError(result.error)
      return
    }
    // Prefer the UUID returned by the IPC call: it is the authoritative
    // identifier from the just-persisted document metadata, so it is immune to
    // the race where `documents` (a store snapshot refreshed by the watcher)
    // does not yet contain the newly created file.
    const generatedRelativePath = result.data.outputPath
    const resolvedDocumentUuid =
      result.data.documentUuid ??
      documents.find(
        (doc) =>
          generatedRelativePath.endsWith(doc.relativePath) ||
          doc.relativePath === generatedRelativePath
      )?.uuid
    if (!resolvedDocumentUuid) {
      setGenerationError(
        t('dossiers.fee_agreement_generated_doc_link_failed', {
          defaultValue:
            'Le document a été généré mais n’a pas pu être rattaché automatiquement à la convention. Rafraîchissez le dossier puis liez-le manuellement.'
        })
      )
      setShowTemplatePicker(null)
      return
    }
    await onSave(
      createUpsertInputFromFeeAgreement(dossierId, feeAgreement, {
        generatedDocumentUuid: resolvedDocumentUuid
      })
    )
    setShowTemplatePicker(null)
  }

  const handleAttachSigned = async (
    feeAgreement: DossierFeeAgreement,
    documentUuid: string
  ): Promise<void> => {
    const today = new Date().toISOString().slice(0, 10)
    await onSave(
      createUpsertInputFromFeeAgreement(dossierId, feeAgreement, {
        status: 'signed',
        signedAt: feeAgreement.signedAt || today,
        signedDocumentUuid: documentUuid
      })
    )
    setShowSignedPicker(null)
  }

  const startNewAvenant = (): void => {
    setEditor(createEmptyFeeAgreementEditor(defaultPreset))
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('dossiers.fee_agreement_badge', { defaultValue: 'Convention' })}
          badgeTitle={t('dossiers.fee_agreement_summary', {
            defaultValue:
              'Convention d’honoraires du dossier, avec avenants si nécessaire. Une seule version est active à la fois.'
          })}
          count={sortedAgreements.length || null}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={startNewAvenant}
            >
              {sortedAgreements.length === 0
                ? t('dossiers.fee_agreement_create_action', { defaultValue: 'Créer la convention' })
                : t('dossiers.fee_agreement_new_amendment_action', {
                    defaultValue: 'Nouvel avenant'
                  })}
            </Button>
          }
        />

        {catalogError ? <AlertBanner tone="error">{catalogError}</AlertBanner> : null}
        {generationError ? <AlertBanner tone="error">{generationError}</AlertBanner> : null}

        {sortedAgreements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline-strong bg-white p-5 text-sm text-ink-muted">
            {t('dossiers.fee_agreement_empty', {
              defaultValue:
                'Aucune convention d’honoraires enregistrée pour ce dossier. Cliquez sur « Créer la convention » pour démarrer.'
            })}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {sortedAgreements.map((agreement) => {
              const clientName = agreement.clientContactUuid
                ? contacts.find((entry) => entry.uuid === agreement.clientContactUuid)
                : undefined
              const signatoryName = agreement.signatoryContactUuid
                ? contacts.find((entry) => entry.uuid === agreement.signatoryContactUuid)
                : undefined
              const generatedDoc = resolveLinkedDocument(documents, agreement.generatedDocumentUuid)
              const signedDoc = resolveLinkedDocument(documents, agreement.signedDocumentUuid)
              const feeAgreementBillingAmounts = computeFeeAgreementBillingAmounts(agreement)
              const hasRetainerBillingItem = billingItems.some(
                (item) =>
                  item.status !== 'cancelled' &&
                  item.sourceFeeAgreementUuid === agreement.uuid &&
                  item.sourceFeeAgreementBillingKind === 'retainer'
              )
              const hasFinalBalanceBillingItem = billingItems.some(
                (item) =>
                  item.status !== 'cancelled' &&
                  item.sourceFeeAgreementUuid === agreement.uuid &&
                  item.sourceFeeAgreementBillingKind === 'finalBalance'
              )
              const linkedBillingItemCount = billingItems.filter(
                (item) => item.sourceFeeAgreementUuid === agreement.uuid
              ).length
              const deleteBlockedByLinks = linkedBillingItemCount > 0
              const deleteBlockedTooltip = deleteBlockedByLinks
                ? t('dossiers.fee_agreement_delete_blocked', {
                    defaultValue:
                      '{{count}} prestation(s) rattachée(s) — archivez la convention ou supprimez d’abord les prestations.',
                    count: linkedBillingItemCount
                  })
                : undefined
              const flatFeeTotals =
                typeof agreement.flatFeeHtCents === 'number' && agreement.flatFeeHtCents > 0
                  ? computeBillingItemTotals({
                      quantity: 1,
                      unitPriceHtCents: agreement.flatFeeHtCents,
                      vatRateBasisPoints: agreement.vatRateBasisPoints,
                      discountKind: agreement.discountKind,
                      discountPercentBasisPoints: agreement.discountPercentBasisPoints,
                      discountAmountHtCents: agreement.discountAmountHtCents
                    })
                  : undefined
              const hasFlatFeeDiscount = (flatFeeTotals?.discountHtCents ?? 0) > 0

              return (
                <div
                  key={agreement.uuid}
                  className={`group space-y-3 rounded-2xl border p-4 shadow-[0_1px_2px_rgba(15,122,138,0.04)] ${
                    agreement.isActive
                      ? 'border-aurora bg-white'
                      : 'border-hairline bg-parchment-bright'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-ink">
                        {agreement.matterLabel || dossierName}
                      </h3>
                      <div className="flex flex-wrap gap-2 text-[11px] font-medium">
                        <span className="rounded-full bg-parchment px-2.5 py-1 text-ink-muted">
                          {billingTypeLabel(agreement.billingType, t)}
                        </span>
                        <span className="rounded-full bg-aurora/12 px-2.5 py-1 text-aurora">
                          {feeAgreementStatusLabel(agreement.status, t)}
                        </span>
                        {agreement.isActive ? (
                          <span className="rounded-full bg-aurora px-2.5 py-1 text-white">
                            {t('dossiers.fee_agreement_active_badge', { defaultValue: 'Active' })}
                          </span>
                        ) : (
                          <span className="rounded-full bg-hairline-strong px-2.5 py-1 text-ink-muted">
                            {t('dossiers.fee_agreement_archived_badge', {
                              defaultValue: 'Archivée'
                            })}
                          </span>
                        )}
                        {hasRetainerBillingItem ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                            {t('dossiers.fee_agreement_retainer_billing_created_badge', {
                              defaultValue: 'Provision créée'
                            })}
                          </span>
                        ) : null}
                        {hasFinalBalanceBillingItem ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                            {t('dossiers.fee_agreement_final_billing_created_badge', {
                              defaultValue: 'Solde créé'
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="relative flex flex-wrap items-center gap-1">
                      <div
                        className={
                          confirmingDeleteId === agreement.uuid
                            ? 'invisible flex flex-wrap items-center gap-1'
                            : 'flex flex-wrap items-center gap-1'
                        }
                      >
                        {onConvertToBillingItem ? (
                          <div className="relative">
                            <IconButton
                              label={t('dossiers.fee_agreement_convert_action', {
                                defaultValue: 'Transformer en prestation'
                              })}
                              alwaysVisible
                              disabled={disabled}
                              aria-expanded={conversionMenuAgreementId === agreement.uuid}
                              onClick={() => {
                                setConfirmingDeleteId(null)
                                setConversionMenuAgreementId((current) =>
                                  current === agreement.uuid ? null : agreement.uuid
                                )
                              }}
                            >
                              <ReceiptIcon />
                            </IconButton>
                            {conversionMenuAgreementId === agreement.uuid ? (
                              <div
                                role="menu"
                                className="absolute right-0 top-8 z-30 w-80 overflow-hidden rounded-xl border border-hairline bg-white shadow-lg"
                              >
                                <FeeAgreementConversionMenuItem
                                  label={t('dossiers.fee_agreement_convert_retainer_action', {
                                    defaultValue: 'Facturer la provision'
                                  })}
                                  amount={formatEurosFromCents(
                                    feeAgreementBillingAmounts.retainerHtCents
                                  )}
                                  disabled={
                                    disabled ||
                                    feeAgreementBillingAmounts.retainerHtCents <= 0 ||
                                    hasRetainerBillingItem
                                  }
                                  disabledLabel={
                                    hasRetainerBillingItem
                                      ? t('dossiers.fee_agreement_convert_retainer_created_hint', {
                                          defaultValue: 'Provision déjà créée'
                                        })
                                      : feeAgreementBillingAmounts.retainerHtCents <= 0
                                        ? t('dossiers.fee_agreement_convert_retainer_empty_hint', {
                                            defaultValue: 'Aucune provision à facturer'
                                          })
                                        : undefined
                                  }
                                  onClick={() => {
                                    setConversionMenuAgreementId(null)
                                    onConvertToBillingItem(agreement, 'retainer')
                                  }}
                                />
                                <FeeAgreementConversionMenuItem
                                  label={t('dossiers.fee_agreement_convert_final_action', {
                                    defaultValue: 'Facturer le solde final'
                                  })}
                                  amount={formatEurosFromCents(
                                    feeAgreementBillingAmounts.finalBalanceHtCents
                                  )}
                                  disabled={
                                    disabled ||
                                    feeAgreementBillingAmounts.finalBalanceHtCents <= 0 ||
                                    hasFinalBalanceBillingItem
                                  }
                                  disabledLabel={
                                    hasFinalBalanceBillingItem
                                      ? t('dossiers.fee_agreement_convert_final_created_hint', {
                                          defaultValue: 'Solde déjà créé'
                                        })
                                      : feeAgreementBillingAmounts.finalBalanceHtCents <= 0
                                        ? t('dossiers.fee_agreement_convert_final_empty_hint', {
                                            defaultValue: 'Aucun solde à facturer'
                                          })
                                        : undefined
                                  }
                                  onClick={() => {
                                    setConversionMenuAgreementId(null)
                                    onConvertToBillingItem(agreement, 'finalBalance')
                                  }}
                                />
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <IconButton
                          label={t('dossiers.fee_agreement_edit_action', {
                            defaultValue: 'Modifier'
                          })}
                          alwaysVisible
                          disabled={disabled}
                          onClick={() => {
                            setConfirmingDeleteId(null)
                            setEditor(createFeeAgreementEditorFromAgreement(agreement))
                          }}
                        >
                          <PencilIcon />
                        </IconButton>
                        {!agreement.isActive ? (
                          <IconButton
                            label={t('dossiers.fee_agreement_activate_action', {
                              defaultValue: 'Activer'
                            })}
                            alwaysVisible
                            disabled={disabled}
                            onClick={async () => {
                              setConfirmingDeleteId(null)
                              await onSetActive({ dossierId, feeAgreementUuid: agreement.uuid })
                            }}
                          >
                            <CheckIcon />
                          </IconButton>
                        ) : null}
                        {agreement.isActive && sortedAgreements.length > 1 ? (
                          <IconButton
                            label={t('dossiers.fee_agreement_archive_action', {
                              defaultValue: 'Archiver'
                            })}
                            alwaysVisible
                            disabled={disabled}
                            onClick={async () => {
                              setConfirmingDeleteId(null)
                              await onArchive({ dossierId, feeAgreementUuid: agreement.uuid })
                            }}
                          >
                            <ArchiveIcon />
                          </IconButton>
                        ) : null}
                        <IconButton
                          label={
                            deleteBlockedTooltip ??
                            t('dossiers.fee_agreement_delete_action', {
                              defaultValue: 'Supprimer'
                            })
                          }
                          tone="danger"
                          alwaysVisible
                          disabled={disabled || deleteBlockedByLinks}
                          onClick={() => setConfirmingDeleteId(agreement.uuid)}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                      {confirmingDeleteId === agreement.uuid ? (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2">
                          <DeleteConfirmTray
                            label={t('dossiers.fee_agreement_delete_confirm_label', {
                              defaultValue: 'Supprimer cette convention ?'
                            })}
                            confirmLabel={t('dossiers.fee_agreement_delete_confirm_action', {
                              defaultValue: 'Confirmer'
                            })}
                            cancelLabel={t('dossiers.fee_agreement_delete_cancel_action', {
                              defaultValue: 'Annuler'
                            })}
                            disabled={disabled}
                            onConfirm={async () => {
                              await onDelete({ dossierId, feeAgreementUuid: agreement.uuid })
                              setConfirmingDeleteId(null)
                            }}
                            onCancel={() => setConfirmingDeleteId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <DetailField
                      label={t('dossiers.fee_agreement_client_label', {
                        defaultValue: 'Client contractant'
                      })}
                      value={clientName ? computeContactDisplayName(clientName) : undefined}
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_signatory_label', {
                        defaultValue: 'Signataire'
                      })}
                      value={signatoryName ? computeContactDisplayName(signatoryName) : undefined}
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_flat_fee_short', {
                        defaultValue: 'Forfait HT'
                      })}
                      value={
                        <DiscountedAgreementAmount
                          value={formatEurosFromCents(
                            flatFeeTotals?.totalHtCents ?? agreement.flatFeeHtCents
                          )}
                          originalValue={
                            hasFlatFeeDiscount
                              ? formatEurosFromCents(agreement.flatFeeHtCents)
                              : undefined
                          }
                        />
                      }
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_flat_ttc_label', {
                        defaultValue: 'Forfait TTC'
                      })}
                      value={
                        <DiscountedAgreementAmount
                          value={formatEurosFromCents(
                            flatFeeTotals?.totalTtcCents ??
                              applyVatRate(agreement.flatFeeHtCents, agreement.vatRateBasisPoints)
                          )}
                          originalValue={
                            hasFlatFeeDiscount
                              ? formatEurosFromCents(
                                  applyVatRate(
                                    agreement.flatFeeHtCents,
                                    agreement.vatRateBasisPoints
                                  )
                                )
                              : undefined
                          }
                        />
                      }
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_hourly_rate_short', {
                        defaultValue: 'Taux horaire HT'
                      })}
                      value={formatEurosFromCents(agreement.hourlyRateHtCents)}
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_retainer_short', {
                        defaultValue: 'Provision HT'
                      })}
                      value={formatEurosFromCents(agreement.retainerHtCents)}
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_vat_label', { defaultValue: 'TVA' })}
                      value={formatBasisPoints(agreement.vatRateBasisPoints)}
                    />
                    <DetailField
                      label={t('cabinet.success_fee_label', {
                        defaultValue: 'Honoraires de résultat'
                      })}
                      value={formatBasisPoints(agreement.successFeePercentBasisPoints)}
                    />
                    <DetailField
                      label={t('dossiers.fee_agreement_discount_label', {
                        defaultValue: 'Remise commerciale'
                      })}
                      value={formatDiscountLabel(agreement, t)}
                    />
                  </div>

                  <DetailField
                    label={t('dossiers.fee_agreement_scope_label', {
                      defaultValue: 'Périmètre de mission'
                    })}
                    value={agreement.scopeDescription}
                  />

                  <div className="grid gap-3 md:grid-cols-2">
                    <DocumentSlot
                      label={t('dossiers.fee_agreement_generated_doc_label', {
                        defaultValue: 'Document généré'
                      })}
                      document={generatedDoc}
                      missing={Boolean(agreement.generatedDocumentUuid && !generatedDoc)}
                      onOpen={
                        generatedDoc && onOpenDocumentFile
                          ? () => onOpenDocumentFile({ dossierId, documentPath: generatedDoc.path })
                          : undefined
                      }
                      actionLabel={
                        generatedDoc
                          ? t('dossiers.fee_agreement_regenerate_action', {
                              defaultValue: 'Régénérer'
                            })
                          : t('dossiers.fee_agreement_generate_action', {
                              defaultValue: 'Générer la convention'
                            })
                      }
                      onAction={() => {
                        setTemplatePickerSearch('')
                        setSelectedTemplateId(sortedAvailableTemplates[0]?.uuid ?? null)
                        setShowTemplatePicker(agreement.uuid)
                      }}
                      disabled={disabled || availableTemplates.length === 0}
                    />
                    <DocumentSlot
                      label={t('dossiers.fee_agreement_signed_doc_label', {
                        defaultValue: 'Document signé'
                      })}
                      document={signedDoc}
                      missing={Boolean(agreement.signedDocumentUuid && !signedDoc)}
                      onOpen={
                        signedDoc && onOpenDocumentFile
                          ? () => onOpenDocumentFile({ dossierId, documentPath: signedDoc.path })
                          : undefined
                      }
                      actionLabel={
                        signedDoc
                          ? t('dossiers.fee_agreement_replace_signed_action', {
                              defaultValue: 'Remplacer'
                            })
                          : t('dossiers.fee_agreement_attach_signed_action', {
                              defaultValue: 'Lier le document signé'
                            })
                      }
                      onAction={() => {
                        setSignedPickerSearch('')
                        setSelectedSignedDocumentUuid(
                          agreement.signedDocumentUuid ?? selectableSignedDocuments[0]?.uuid ?? null
                        )
                        setShowSignedPicker(agreement.uuid)
                      }}
                      disabled={disabled || selectableSignedDocuments.length === 0}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showTemplatePicker
        ? (() => {
            const agreement = feeAgreements.find((entry) => entry.uuid === showTemplatePicker)
            if (!agreement) return null
            return (
              <DialogShell
                size="lg"
                aria-label={t('dossiers.fee_agreement_template_picker_title', {
                  defaultValue: 'Générer la convention'
                })}
                onDismiss={() => {
                  if (!isPickerSubmitting) closeTemplatePicker()
                }}
              >
                <div>
                  <h3 className="text-lg font-semibold text-ink">
                    {t('dossiers.fee_agreement_template_picker_title', {
                      defaultValue: 'Générer la convention'
                    })}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('dossiers.fee_agreement_template_picker_hint', {
                      defaultValue: 'Sélectionnez le modèle à utiliser pour générer la convention.'
                    })}
                  </p>
                </div>
                <Input
                  value={templatePickerSearch}
                  onChange={(event) => setTemplatePickerSearch(event.target.value)}
                  placeholder={t('dossiers.fee_agreement_template_picker_search', {
                    defaultValue: 'Filtrer les modèles...'
                  })}
                  disabled={isPickerSubmitting}
                />
                <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-hairline bg-white">
                  {filteredTemplates.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-ink-subtle">
                      {availableTemplates.length === 0
                        ? t('dossiers.fee_agreement_no_templates', {
                            defaultValue: 'Aucun modèle disponible.'
                          })
                        : t('dossiers.fee_agreement_no_templates_match', {
                            defaultValue: 'Aucun modèle ne correspond à votre recherche.'
                          })}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#eeede8]">
                      {filteredTemplates.map((template) => {
                        const selected = selectedTemplateId === template.uuid
                        return (
                          <TemplatePickerItem
                            key={template.uuid}
                            template={template}
                            selected={selected}
                            disabled={isPickerSubmitting}
                            onSelect={() => setSelectedTemplateId(template.uuid)}
                          />
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
                  <p className="text-sm text-ink-muted">
                    {t('dossiers.fee_agreement_template_picker_count', {
                      defaultValue: '{{count}} modèle(s)',
                      count: filteredTemplates.length
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPickerSubmitting}
                      onClick={closeTemplatePicker}
                    >
                      {t('common.cancel', { defaultValue: 'Annuler' })}
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        disabled ||
                        isPickerSubmitting ||
                        !selectedTemplateId ||
                        !selectedTemplateIsVisible
                      }
                      onClick={async () => {
                        if (!selectedTemplateId || !selectedTemplateIsVisible) return
                        setIsPickerSubmitting(true)
                        try {
                          await handleGenerate(agreement, selectedTemplateId)
                        } finally {
                          setIsPickerSubmitting(false)
                        }
                      }}
                    >
                      {isPickerSubmitting
                        ? t('dossiers.fee_agreement_generating_action', {
                            defaultValue: 'Génération...'
                          })
                        : t('dossiers.fee_agreement_generate_confirm_action', {
                            defaultValue: 'Générer'
                          })}
                    </Button>
                  </div>
                </div>
              </DialogShell>
            )
          })()
        : null}

      {showSignedPicker
        ? (() => {
            const agreement = feeAgreements.find((entry) => entry.uuid === showSignedPicker)
            if (!agreement) return null
            return (
              <DialogShell
                size="lg"
                aria-label={t('dossiers.fee_agreement_signed_picker_title', {
                  defaultValue: 'Lier un document signé'
                })}
                onDismiss={() => {
                  if (!isPickerSubmitting) closeSignedPicker()
                }}
              >
                <div>
                  <h3 className="text-lg font-semibold text-ink">
                    {t('dossiers.fee_agreement_signed_picker_title', {
                      defaultValue: 'Lier un document signé'
                    })}
                  </h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('dossiers.fee_agreement_signed_picker_hint', {
                      defaultValue:
                        'Sélectionnez le scan signé parmi les documents du dossier. Le statut passera à « Signée ».'
                    })}
                  </p>
                </div>
                <Input
                  value={signedPickerSearch}
                  onChange={(event) => setSignedPickerSearch(event.target.value)}
                  placeholder={t('dossiers.fee_agreement_signed_picker_search', {
                    defaultValue: 'Filtrer les documents...'
                  })}
                  disabled={isPickerSubmitting}
                />
                <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-hairline bg-white">
                  {filteredSignedDocuments.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-ink-subtle">
                      {selectableSignedDocuments.length === 0
                        ? t('dossiers.fee_agreement_no_documents', {
                            defaultValue: 'Aucun document dans ce dossier.'
                          })
                        : t('dossiers.fee_agreement_no_documents_match', {
                            defaultValue: 'Aucun document ne correspond à votre recherche.'
                          })}
                    </p>
                  ) : (
                    <ul className="divide-y divide-[#eeede8]">
                      {filteredSignedDocuments.map((document) => {
                        const selected = selectedSignedDocumentUuid === document.uuid
                        return (
                          <DocumentPickerItem
                            key={document.uuid}
                            document={document}
                            selected={selected}
                            disabled={isPickerSubmitting}
                            onSelect={() => setSelectedSignedDocumentUuid(document.uuid)}
                          />
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
                  <p className="text-sm text-ink-muted">
                    {t('dossiers.fee_agreement_signed_picker_count', {
                      defaultValue: '{{count}} document(s)',
                      count: filteredSignedDocuments.length
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPickerSubmitting}
                      onClick={closeSignedPicker}
                    >
                      {t('common.cancel', { defaultValue: 'Annuler' })}
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        disabled ||
                        isPickerSubmitting ||
                        !selectedSignedDocumentUuid ||
                        !selectedSignedDocumentIsVisible
                      }
                      onClick={async () => {
                        if (!selectedSignedDocumentUuid || !selectedSignedDocumentIsVisible) return
                        setIsPickerSubmitting(true)
                        try {
                          await handleAttachSigned(agreement, selectedSignedDocumentUuid)
                        } finally {
                          setIsPickerSubmitting(false)
                        }
                      }}
                    >
                      {isPickerSubmitting
                        ? t('dossiers.fee_agreement_linking_action', {
                            defaultValue: 'Liaison...'
                          })
                        : t('common.select', { defaultValue: 'Sélectionner' })}
                    </Button>
                  </div>
                </div>
              </DialogShell>
            )
          })()
        : null}

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={t('dossiers.fee_agreement_dialog_title', {
            defaultValue: 'Convention d’honoraires'
          })}
          onDismiss={() => {
            setEditor(null)
            setEditorError(null)
          }}
        >
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
              <span>
                {t('dossiers.fee_agreement_dialog_title', {
                  defaultValue: 'Convention d’honoraires'
                })}
              </span>
              <FeeAgreementTooltip
                message={t('dossiers.fee_agreement_dialog_reassurance_tooltip', {
                  defaultValue:
                    'Commencez par l’essentiel : objet, mission, parties et honoraires. Les autres champs précisent le document généré ou le suivi du dossier.'
                })}
              />
            </h3>
            <p className="mt-1 text-sm text-ink-muted">{dossierName}</p>
          </div>

          <form
            className="flex flex-col gap-5"
            onSubmit={async (event) => {
              event.preventDefault()
              const setActive = editor.id ? undefined : true
              const payload = buildFeeAgreementUpsertInput(dossierId, editor, setActive)

              if (!payload) {
                setEditorError(
                  t('dossiers.fee_agreement_validation', {
                    defaultValue:
                      'Complétez l’objet, le périmètre et un taux de TVA valide avant d’enregistrer.'
                  })
                )
                return
              }

              setEditorError(null)
              setIsSaving(true)
              try {
                const saved = await onSave(payload)
                if (saved) {
                  setEditor(null)
                }
              } finally {
                setIsSaving(false)
              }
            }}
          >
            {editorError ? <AlertBanner tone="error">{editorError}</AlertBanner> : null}

            <FeeAgreementDialogSection
              badge={t('dossiers.fee_agreement_section_essential_badge', {
                defaultValue: 'Essentiel'
              })}
              title={t('dossiers.fee_agreement_section_scope_title', {
                defaultValue: 'Convention et mission'
              })}
              tooltip={t('dossiers.fee_agreement_section_scope_hint', {
                defaultValue:
                  'Ces informations alimentent directement l’objet et le périmètre de la convention.'
              })}
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <Field
                  label={
                    <FeeAgreementLabelWithTooltip
                      label={t('dossiers.fee_agreement_source_preset_label', {
                        defaultValue: 'Prestation cabinet'
                      })}
                      tooltip={t('dossiers.fee_agreement_source_preset_hint', {
                        defaultValue:
                          'Remplit les tarifs et clauses types, puis vous gardez la main.'
                      })}
                    />
                  }
                >
                  <div className="flex gap-2">
                    <Select
                      value={editor.sourceServicePresetUuid}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? { ...current, sourceServicePresetUuid: event.target.value }
                            : current
                        )
                      }
                    >
                      <option value="">
                        {t('dossiers.fee_agreement_source_preset_empty', {
                          defaultValue: 'Aucune'
                        })}
                      </option>
                      {activePresets.map((preset) => (
                        <option key={preset.uuid} value={preset.uuid}>
                          {preset.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!editor.sourceServicePresetUuid}
                      onClick={() => {
                        const preset = activePresets.find(
                          (entry) => entry.uuid === editor.sourceServicePresetUuid
                        )
                        if (!preset) {
                          return
                        }
                        setEditor((current) =>
                          current ? applyFeeAgreementPresetToEditor(current, preset) : current
                        )
                      }}
                    >
                      {t('dossiers.fee_agreement_apply_preset_action', {
                        defaultValue: 'Appliquer'
                      })}
                    </Button>
                  </div>
                </Field>
                <Field label={t('dossiers.fee_agreement_status_label', { defaultValue: 'Statut' })}>
                  <Select
                    value={editor.status}
                    onChange={(event) =>
                      setEditor((current) =>
                        current
                          ? { ...current, status: event.target.value as FeeAgreementStatus }
                          : current
                      )
                    }
                  >
                    {FEE_AGREEMENT_STATUS_VALUES.map((status) => (
                      <option key={status} value={status}>
                        {feeAgreementStatusLabel(status, t)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4">
                <Field
                  label={
                    <FeeAgreementLabelWithTooltip
                      label={t('dossiers.fee_agreement_matter_label', { defaultValue: 'Objet' })}
                      tooltip={t('dossiers.fee_agreement_matter_hint', {
                        defaultValue: 'Titre court de la convention.'
                      })}
                    />
                  }
                >
                  <Input
                    value={editor.matterLabel}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, matterLabel: event.target.value } : current
                      )
                    }
                  />
                </Field>
              </div>

              <Field
                label={
                  <FeeAgreementLabelWithTooltip
                    label={t('dossiers.fee_agreement_scope_label', {
                      defaultValue: 'Périmètre de mission'
                    })}
                    tooltip={t('dossiers.fee_agreement_scope_reassurance', {
                      defaultValue:
                        'Un périmètre concis suffit. Les exclusions, frais ou résiliation se règlent plus bas si nécessaire.'
                    })}
                  />
                }
              >
                <Textarea
                  rows={3}
                  value={editor.scopeDescription}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, scopeDescription: event.target.value } : current
                    )
                  }
                />
              </Field>
            </FeeAgreementDialogSection>

            <FeeAgreementDialogSection
              badge={t('dossiers.fee_agreement_section_parties_badge', {
                defaultValue: 'Parties'
              })}
              title={t('dossiers.fee_agreement_section_parties_title', {
                defaultValue: 'Client et signataire'
              })}
              tooltip={t('dossiers.fee_agreement_section_parties_hint', {
                defaultValue:
                  'Le signataire peut rester vide s’il s’agit du même contact que le client contractant.'
              })}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t('dossiers.fee_agreement_client_label', {
                    defaultValue: 'Client contractant'
                  })}
                >
                  <Select
                    value={editor.clientContactUuid}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, clientContactUuid: event.target.value } : current
                      )
                    }
                  >
                    <option value="">
                      {t('dossiers.fee_agreement_contact_empty', {
                        defaultValue: 'Sélectionner un contact'
                      })}
                    </option>
                    {contacts.map((contact) => (
                      <option key={contact.uuid} value={contact.uuid}>
                        {computeContactDisplayName(contact)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('dossiers.fee_agreement_signatory_label', {
                    defaultValue: 'Signataire'
                  })}
                >
                  <Select
                    value={editor.signatoryContactUuid}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, signatoryContactUuid: event.target.value } : current
                      )
                    }
                  >
                    <option value="">
                      {t('dossiers.fee_agreement_signatory_fallback', {
                        defaultValue: 'Même contact que le client'
                      })}
                    </option>
                    {contacts.map((contact) => (
                      <option key={contact.uuid} value={contact.uuid}>
                        {computeContactDisplayName(contact)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </FeeAgreementDialogSection>

            <FeeAgreementDialogSection
              badge={t('dossiers.fee_agreement_section_fees_badge', {
                defaultValue: 'Honoraires'
              })}
              title={t('dossiers.fee_agreement_section_fees_title', {
                defaultValue: 'Montants et mode de facturation'
              })}
              tooltip={t('dossiers.fee_agreement_section_fees_hint', {
                defaultValue:
                  'Renseignez uniquement les montants applicables. Les montants TTC sont recalculés automatiquement.'
              })}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={t('cabinet.billing_type_label', { defaultValue: 'Facturation' })}>
                    <Select
                      value={editor.billingType}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? { ...current, billingType: event.target.value as BillingType }
                            : current
                        )
                      }
                    >
                      {BILLING_TYPE_VALUES.map((type) => (
                        <option key={type} value={type}>
                          {billingTypeLabel(type, t)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('cabinet.vat_rate_label', { defaultValue: 'TVA (%)' })}>
                    <Input
                      inputMode="decimal"
                      value={editor.vatRate}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, vatRate: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field label={t('cabinet.flat_fee_label', { defaultValue: 'Forfait HT (€)' })}>
                    <Input
                      inputMode="decimal"
                      value={editor.flatFeeHt}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, flatFeeHt: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={t('cabinet.hourly_rate_label', {
                      defaultValue: 'Taux horaire HT (€)'
                    })}
                  >
                    <Input
                      inputMode="decimal"
                      value={editor.hourlyRateHt}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, hourlyRateHt: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field label={t('cabinet.retainer_label', { defaultValue: 'Provision HT (€)' })}>
                    <Input
                      inputMode="decimal"
                      value={editor.retainerHt}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, retainerHt: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={t('cabinet.estimated_hours_label', { defaultValue: 'Heures estimées' })}
                  >
                    <Input
                      inputMode="decimal"
                      value={editor.estimatedHours}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, estimatedHours: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="rounded-xl border border-hairline bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                    {t('dossiers.fee_agreement_amount_preview_title', {
                      defaultValue: 'Aperçu TTC'
                    })}
                  </p>
                  <dl className="mt-3 space-y-3 text-sm">
                    <FeeAgreementPreviewAmount
                      label={t('dossiers.fee_agreement_flat_ttc_label', {
                        defaultValue: 'Forfait TTC'
                      })}
                      value={formatEurosFromCents(
                        applyVatRate(
                          parseEurosToCents(editor.flatFeeHt),
                          parsePercentToBasisPoints(editor.vatRate) ?? 0
                        )
                      )}
                    />
                    <FeeAgreementPreviewAmount
                      label={t('dossiers.fee_agreement_hourly_ttc_label', {
                        defaultValue: 'Taux horaire TTC'
                      })}
                      value={formatEurosFromCents(
                        applyVatRate(
                          parseEurosToCents(editor.hourlyRateHt),
                          parsePercentToBasisPoints(editor.vatRate) ?? 0
                        )
                      )}
                    />
                    <FeeAgreementPreviewAmount
                      label={t('dossiers.fee_agreement_retainer_ttc_label', {
                        defaultValue: 'Provision TTC'
                      })}
                      value={formatEurosFromCents(
                        applyVatRate(
                          parseEurosToCents(editor.retainerHt),
                          parsePercentToBasisPoints(editor.vatRate) ?? 0
                        )
                      )}
                    />
                    {editor.discountMode !== 'none' &&
                      (() => {
                        const flatHt = parseEurosToCents(editor.flatFeeHt) ?? 0
                        if (flatHt <= 0) return null
                        const totals = computeBillingTotalsFromEditor({
                          quantity: 1,
                          unitPriceHt: editor.flatFeeHt,
                          vatRate: editor.vatRate,
                          discount: editor
                        })
                        return (
                          <>
                            <FeeAgreementPreviewAmount
                              label={t('dossiers.fee_agreement_discount_preview_label', {
                                defaultValue: 'Remise HT'
                              })}
                              value={`−${formatEurosFromCents(totals.discountHtCents)}`}
                            />
                            <FeeAgreementPreviewAmount
                              label={t('dossiers.fee_agreement_flat_after_discount_ttc_label', {
                                defaultValue: 'Forfait remisé TTC'
                              })}
                              value={formatEurosFromCents(totals.totalTtcCents)}
                            />
                          </>
                        )
                      })()}
                  </dl>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <DossierDiscountFields
                  mode={editor.discountMode}
                  percent={editor.discountPercent}
                  amount={editor.discountAmount}
                  modeLabel={
                    <FeeAgreementLabelWithTooltip
                      label={t('dossiers.fee_agreement_discount_mode_label', {
                        defaultValue: 'Remise commerciale'
                      })}
                      tooltip={t('dossiers.fee_agreement_discount_mode_hint', {
                        defaultValue:
                          'La remise est mentionnée dans la convention et reportée automatiquement quand vous la transformez en prestation à facturer.'
                      })}
                    />
                  }
                  noneLabel={t('dossiers.fee_agreement_discount_mode_none', {
                    defaultValue: 'Aucune'
                  })}
                  percentModeLabel={t('dossiers.fee_agreement_discount_mode_percent', {
                    defaultValue: 'En pourcentage'
                  })}
                  amountModeLabel={t('dossiers.fee_agreement_discount_mode_amount', {
                    defaultValue: 'Montant fixe'
                  })}
                  percentLabel={t('dossiers.fee_agreement_discount_percent_label', {
                    defaultValue: 'Remise (%)'
                  })}
                  amountLabel={t('dossiers.fee_agreement_discount_amount_label', {
                    defaultValue: 'Remise (€ HT)'
                  })}
                  onModeChange={(discountMode) =>
                    setEditor((current) => (current ? { ...current, discountMode } : current))
                  }
                  onPercentChange={(discountPercent) =>
                    setEditor((current) => (current ? { ...current, discountPercent } : current))
                  }
                  onAmountChange={(discountAmount) =>
                    setEditor((current) => (current ? { ...current, discountAmount } : current))
                  }
                />
              </div>

              <details className="rounded-xl border border-hairline bg-parchment-bright p-4">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  {t('dossiers.fee_agreement_success_fee_summary', {
                    defaultValue: 'Honoraires de résultat, si prévus'
                  })}
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
                  <Field
                    label={t('dossiers.fee_agreement_success_fee_percent_label', {
                      defaultValue: 'Pourcentage (%)'
                    })}
                  >
                    <Input
                      inputMode="decimal"
                      value={editor.successFeePercent}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, successFeePercent: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={t('dossiers.fee_agreement_success_clause_label', {
                      defaultValue: 'Clause de résultat'
                    })}
                  >
                    <Input
                      value={editor.successFeeClause}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, successFeeClause: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                </div>
              </details>
            </FeeAgreementDialogSection>

            <FeeAgreementDialogSection
              badge={t('dossiers.fee_agreement_section_clauses_badge', {
                defaultValue: 'Clauses'
              })}
              title={t('dossiers.fee_agreement_section_clauses_title', {
                defaultValue: 'Conditions à reprendre dans le document'
              })}
              tooltip={t('dossiers.fee_agreement_section_clauses_hint', {
                defaultValue:
                  'Ces textes complètent la convention. Ils peuvent être laissés tels quels si la prestation cabinet est déjà conforme.'
              })}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  label={t('dossiers.fee_agreement_payment_terms_short', {
                    defaultValue: 'Paiement'
                  })}
                >
                  <Textarea
                    rows={3}
                    value={editor.paymentTerms}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, paymentTerms: event.target.value } : current
                      )
                    }
                  />
                </Field>
                <Field label={t('cabinet.expense_terms_label', { defaultValue: 'Frais' })}>
                  <Textarea
                    rows={3}
                    value={editor.expenseTerms}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, expenseTerms: event.target.value } : current
                      )
                    }
                  />
                </Field>
                <Field
                  label={t('cabinet.termination_terms_label', {
                    defaultValue: 'Résiliation'
                  })}
                >
                  <Textarea
                    rows={3}
                    value={editor.terminationTerms}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, terminationTerms: event.target.value } : current
                      )
                    }
                  />
                </Field>
              </div>
            </FeeAgreementDialogSection>

            <details className="rounded-xl border border-hairline bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {t('dossiers.fee_agreement_tracking_summary', {
                  defaultValue: 'Suivi interne et notes'
                })}
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field
                  label={t('dossiers.fee_agreement_sent_at_label', {
                    defaultValue: 'Date d’envoi'
                  })}
                >
                  <Input
                    type="date"
                    value={editor.sentAt}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, sentAt: event.target.value } : current
                      )
                    }
                  />
                </Field>
                <Field
                  label={t('dossiers.fee_agreement_signed_at_label', {
                    defaultValue: 'Date de signature'
                  })}
                >
                  <Input
                    type="date"
                    value={editor.signedAt}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, signedAt: event.target.value } : current
                      )
                    }
                  />
                </Field>
                <Field
                  className="md:col-span-2"
                  label={t('dossiers.fee_agreement_notes_label', { defaultValue: 'Notes' })}
                >
                  <Textarea
                    rows={3}
                    value={editor.notes}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, notes: event.target.value } : current
                      )
                    }
                  />
                </Field>
              </div>
            </details>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={() => {
                  setEditor(null)
                  setEditorError(null)
                }}
              >
                {t('common.cancel', { defaultValue: 'Annuler' })}
              </Button>
              <Button type="submit" disabled={disabled || isSaving}>
                {t('common.save', { defaultValue: 'Enregistrer' })}
              </Button>
            </div>
          </form>
        </DialogShell>
      ) : null}
    </>
  )
}

function FeeAgreementDialogSection({
  badge,
  title,
  tooltip,
  children
}: {
  badge: string
  title: string
  tooltip: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-hairline bg-parchment-bright p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <span>{title}</span>
            <FeeAgreementTooltip message={tooltip} />
          </h4>
        </div>
        <span className="rounded-full bg-aurora/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-aurora">
          {badge}
        </span>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function FeeAgreementLabelWithTooltip({
  label,
  tooltip
}: {
  label: string
  tooltip: string
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <FeeAgreementTooltip message={tooltip} />
    </span>
  )
}

function FeeAgreementTooltip({ message }: { message: string }): React.JSX.Element {
  return (
    <span className="group relative inline-flex align-middle" title={message}>
      <span
        tabIndex={0}
        aria-label={message}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#c4c2ba] bg-white text-[10px] font-semibold leading-none text-ink-muted outline-none transition hover:border-aurora hover:text-aurora focus-visible:border-aurora focus-visible:ring-2 focus-visible:ring-aurora/35"
      >
        {'i'}
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-50 hidden w-64 -translate-x-1/2 rounded-lg border border-hairline-strong bg-ink px-3 py-2 text-left text-xs font-normal leading-snug text-white shadow-lg group-hover:block group-focus-within:block">
        {message}
      </span>
    </span>
  )
}

function FeeAgreementPreviewAmount({
  label,
  value
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">{value || '—'}</dd>
    </div>
  )
}

function FeeAgreementConversionMenuItem({
  label,
  amount,
  disabled,
  disabledLabel,
  onClick
}: {
  label: string
  amount: string
  disabled: boolean
  disabledLabel?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-parchment-bright disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-white"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {disabledLabel ? (
          <span className="mt-0.5 block text-xs text-ink-subtle">{disabledLabel}</span>
        ) : null}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-muted">{amount}</span>
    </button>
  )
}

function TemplatePickerItem({
  template,
  selected,
  disabled,
  onSelect
}: {
  template: TemplateRecord
  selected: boolean
  disabled: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
          selected ? 'bg-aurora/8' : 'hover:bg-parchment-bright'
        }`}
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-aurora bg-aurora' : 'border-[#c4c2ba] bg-white'
          }`}
        >
          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-2">
            {template.hasDocxSource ? (
              <span className="shrink-0 rounded-full bg-aurora/10 px-2 py-0.5 text-[10px] font-medium text-aurora">
                {'DOCX'}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-[#f4f1e8] px-2 py-0.5 text-[10px] font-medium text-[#6b5d3a]">
                {'TEXTE'}
              </span>
            )}
            <span className="wrap-break-word text-sm font-medium text-ink">{template.name}</span>
          </span>
          {template.description ? (
            <span className="mt-0.5 block wrap-break-word text-xs text-ink-subtle">
              {template.description}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5">
            {(template.tags ?? []).slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-medium text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  )
}

function DocumentPickerItem({
  document,
  selected,
  disabled,
  onSelect
}: {
  document: DocumentRecord & { uuid: string }
  selected: boolean
  disabled: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
          selected ? 'bg-aurora/8' : 'hover:bg-parchment-bright'
        }`}
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-aurora bg-aurora' : 'border-[#c4c2ba] bg-white'
          }`}
        >
          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block wrap-break-word text-sm font-medium text-ink">
            {document.filename}
          </span>
          <span className="mt-0.5 block wrap-break-word text-xs text-ink-subtle">
            {document.relativePath}
          </span>
          {document.description ? (
            <span className="mt-0.5 block wrap-break-word text-xs text-ink-muted">
              {document.description}
            </span>
          ) : null}
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-medium text-ink-muted">
              {document.modifiedAt.slice(0, 10)}
            </span>
            {document.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-medium text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        </span>
      </button>
    </li>
  )
}

function DocumentSlot({
  label,
  document,
  missing,
  onOpen,
  actionLabel,
  onAction,
  disabled
}: {
  label: string
  document?: DocumentRecord
  missing: boolean
  onOpen?: () => void | Promise<void>
  actionLabel: string
  onAction: () => void
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm text-ink">
          {document ? (
            <span className="truncate">{document.filename}</span>
          ) : missing ? (
            <span className="text-rose-600">
              {t('dossiers.document_slot_missing', { defaultValue: 'Document introuvable' })}
            </span>
          ) : (
            <span className="text-ink-subtle">—</span>
          )}
        </div>
        <div className="flex gap-2">
          {document && onOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void onOpen()
              }}
            >
              {t('common.open_action', { defaultValue: 'Ouvrir' })}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DetailField({
  label,
  value
}: {
  label: string
  value?: React.ReactNode
}): React.JSX.Element | null {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      <div className="whitespace-pre-wrap text-sm text-ink">{value}</div>
    </div>
  )
}

function DiscountedAgreementAmount({
  value,
  originalValue
}: {
  value: string
  originalValue?: string
}): React.JSX.Element {
  if (!originalValue) {
    return <span>{value}</span>
  }

  return (
    <span className="flex flex-col items-start tabular-nums">
      <span>{value}</span>
      <span className="text-[10px] text-ink-subtle line-through">{originalValue}</span>
    </span>
  )
}
