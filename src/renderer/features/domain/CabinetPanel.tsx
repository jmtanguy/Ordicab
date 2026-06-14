import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BILLING_TYPE_VALUES,
  CABINET_SERVICE_USAGE_VALUES,
  DEFAULT_CABINET_SERVICE_GROUP
} from '@shared/types'
import { ENTITY_TITLE_SHORT } from '@shared/validation'
import type {
  BillingType,
  CabinetServiceUsage,
  CabinetServicePreset,
  CabinetServicePresetUpsertInput
} from '@shared/types'
import { cabinetServicePresetUpsertInputSchema } from '@shared/validation'
import { buildAddressFields } from '@shared/addressFormatting'

import { useToast } from '@renderer/contexts/ToastContext'
import {
  formatBasisPoints,
  formatEurosFromCents,
  formatMoneyInput,
  formatNumberInput,
  formatPercentInput,
  parseDecimalInput,
  parseEurosToCents,
  parsePercentToBasisPoints
} from '@renderer/lib/billingFormatters'
import { billingTypeLabel } from '@renderer/lib/domainLabels'
import { useCabinetBillingStore, useEntityStore, useTemplateStore } from '@renderer/stores'
import {
  AlertBanner,
  Button,
  DialogShell,
  Field,
  Input,
  Select,
  Textarea
} from '@renderer/components/ui'

import { EntityDialog } from './EntityPanel'
import { serviceLibraryEntryToUpsert, type ServiceLibraryImportEntry } from './serviceLibrary'
import {
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  SearchField,
  SectionHeader,
  TrashIcon
} from '../dossiers/sectionLayout'
import { SERVICE_LIBRARY_THEMES, type ServiceLibraryItem } from '@shared/serviceCatalogLibrary'

interface ServicePresetEditorState {
  id?: string
  name: string
  description: string
  group: string
  usage: CabinetServiceUsage
  billingType: BillingType
  flatFeeHt: string
  hourlyRateHt: string
  estimatedHours: string
  retainerHt: string
  successFeePercent: string
  successFeeClause: string
  vatRate: string
  paymentTerms: string
  expenseTerms: string
  terminationTerms: string
}

function DetailField({
  label,
  value
}: {
  label: string
  value?: string
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      <span className="whitespace-pre-wrap text-sm text-ink">{value}</span>
    </div>
  )
}

function createEmptyEditorState(): ServicePresetEditorState {
  return {
    name: '',
    description: '',
    group: DEFAULT_CABINET_SERVICE_GROUP,
    usage: 'feeAgreement',
    billingType: 'mixed',
    flatFeeHt: '',
    hourlyRateHt: '',
    estimatedHours: '',
    retainerHt: '',
    successFeePercent: '',
    successFeeClause: '',
    vatRate: '20',
    paymentTerms: '',
    expenseTerms: '',
    terminationTerms: ''
  }
}

function createEditorState(service?: CabinetServicePreset | null): ServicePresetEditorState {
  if (!service) {
    return createEmptyEditorState()
  }

  return {
    id: service.uuid,
    name: service.name,
    description: service.description ?? '',
    group: service.group?.trim() || DEFAULT_CABINET_SERVICE_GROUP,
    usage: service.usage ?? 'feeAgreement',
    billingType: service.billingType,
    flatFeeHt: formatMoneyInput(service.flatFeeHtCents),
    hourlyRateHt: formatMoneyInput(service.hourlyRateHtCents),
    estimatedHours: formatNumberInput(service.estimatedHours),
    retainerHt: formatMoneyInput(service.retainerHtCents),
    successFeePercent: formatPercentInput(service.successFeePercentBasisPoints),
    successFeeClause: service.successFeeClause ?? '',
    vatRate: formatPercentInput(service.vatRateBasisPoints),
    paymentTerms: service.paymentTerms ?? '',
    expenseTerms: service.expenseTerms ?? '',
    terminationTerms: service.terminationTerms ?? ''
  }
}

function buildUpsertInputFromEditor(
  state: ServicePresetEditorState
): CabinetServicePresetUpsertInput | null {
  const candidate = {
    uuid: state.id,
    name: state.name.trim(),
    description: state.description.trim() || undefined,
    group: state.group.trim() || DEFAULT_CABINET_SERVICE_GROUP,
    usage: state.usage,
    billingType: state.billingType,
    flatFeeHtCents: parseEurosToCents(state.flatFeeHt),
    hourlyRateHtCents: parseEurosToCents(state.hourlyRateHt),
    estimatedHours: parseDecimalInput(state.estimatedHours),
    retainerHtCents: parseEurosToCents(state.retainerHt),
    successFeePercentBasisPoints: parsePercentToBasisPoints(state.successFeePercent),
    successFeeClause: state.successFeeClause.trim() || undefined,
    vatRateBasisPoints: parsePercentToBasisPoints(state.vatRate),
    paymentTerms: state.paymentTerms.trim() || undefined,
    expenseTerms: state.expenseTerms.trim() || undefined,
    terminationTerms: state.terminationTerms.trim() || undefined
  }

  const parsed = cabinetServicePresetUpsertInputSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function serviceUsageLabel(
  value: CabinetServiceUsage,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (value === 'billing') {
    return t('cabinet.service_usage.billing', { defaultValue: 'Facturation seulement' })
  }
  if (value === 'both') {
    return t('cabinet.service_usage.both', { defaultValue: 'Convention et facturation' })
  }
  return t('cabinet.service_usage.feeAgreement', { defaultValue: 'Convention d’honoraires' })
}

function readServiceUsage(
  value: FormDataEntryValue | null,
  fallback: CabinetServiceUsage
): CabinetServiceUsage {
  if (
    typeof value === 'string' &&
    CABINET_SERVICE_USAGE_VALUES.includes(value as CabinetServiceUsage)
  ) {
    return value as CabinetServiceUsage
  }
  return fallback
}

function formatLibraryItemPrice(item: ServiceLibraryItem): string {
  const parts: string[] = []
  if (item.flatFeeHtCents) parts.push(`Forfait ${formatEurosFromCents(item.flatFeeHtCents)}`)
  if (item.hourlyRateHtCents) parts.push(`${formatEurosFromCents(item.hourlyRateHtCents)}/h`)
  if (item.successFeePercentBasisPoints)
    parts.push(`+${formatBasisPoints(item.successFeePercentBasisPoints)} résultat`)
  return parts.join(' · ')
}

function formatServicePricing(service: CabinetServicePreset): string[] {
  const parts: string[] = []
  if (typeof service.flatFeeHtCents === 'number') {
    parts.push(`Forfait ${formatEurosFromCents(service.flatFeeHtCents)}`)
  }
  if (typeof service.hourlyRateHtCents === 'number') {
    const hours = service.estimatedHours ? ` (${service.estimatedHours} h est.)` : ''
    parts.push(`${formatEurosFromCents(service.hourlyRateHtCents)}/h${hours}`)
  }
  if (typeof service.retainerHtCents === 'number') {
    parts.push(`Provision ${formatEurosFromCents(service.retainerHtCents)}`)
  }
  return parts
}

interface ServiceLibraryDialogProps {
  onDismiss: () => void
  onImport: (entries: ServiceLibraryImportEntry[]) => Promise<void>
}

export function ServiceLibraryDialog({
  onDismiss,
  onImport
}: ServiceLibraryDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [isImporting, setIsImporting] = useState(false)

  const filteredThemes = useMemo(() => {
    if (!search.trim()) return SERVICE_LIBRARY_THEMES
    const q = search.toLowerCase()
    return SERVICE_LIBRARY_THEMES.map((theme) => ({
      ...theme,
      items: theme.items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) || (item.description ?? '').toLowerCase().includes(q)
      )
    })).filter((theme) => theme.items.length > 0)
  }, [search])

  const toggleItem = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTheme = (theme: { items: ServiceLibraryItem[] }): void => {
    const allSelected = theme.items.every((item) => selected.has(item.id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        theme.items.forEach((item) => next.delete(item.id))
      } else {
        theme.items.forEach((item) => next.add(item.id))
      }
      return next
    })
  }

  const handleImport = async (): Promise<void> => {
    const entriesToImport: ServiceLibraryImportEntry[] = SERVICE_LIBRARY_THEMES.flatMap((theme) =>
      theme.items
        .filter((item) => selected.has(item.id))
        .map((item) => ({ item, group: theme.label }))
    )
    if (entriesToImport.length === 0) return
    setIsImporting(true)
    try {
      await onImport(entriesToImport)
      onDismiss()
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <DialogShell
      size="lg"
      aria-label={t('cabinet.library_dialog_title', {
        defaultValue: 'Bibliothèque de prestations'
      })}
      onDismiss={onDismiss}
    >
      <div className="flex max-h-[80vh] flex-col gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-ink">
            {t('cabinet.library_dialog_title', { defaultValue: 'Bibliothèque de prestations' })}
          </h3>
          <p className="text-sm text-ink-muted">
            {t('cabinet.library_dialog_description', {
              defaultValue:
                "Prestations types prêtes à l'emploi. Importez celles qui vous intéressent — elles seront copiées dans votre catalogue et resteront éditables. Tarifs indicatifs 2026."
            })}
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher dans la bibliothèque…"
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm"
        />

        <div className="flex-1 overflow-y-auto pr-1">
          {filteredThemes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline bg-white p-4 text-sm text-ink-muted">
              {t('cabinet.library_dialog_no_results', {
                defaultValue: 'Aucune prestation ne correspond.'
              })}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredThemes.map((theme) => {
                const selectedInTheme = theme.items.filter((i) => selected.has(i.id)).length
                const allSelected = theme.items.every((item) => selected.has(item.id))
                return (
                  <div key={theme.id} className="rounded-lg border border-hairline bg-white p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{theme.label}</p>
                      <button
                        type="button"
                        onClick={() => toggleTheme(theme)}
                        className="text-xs text-ink-muted hover:text-ink"
                      >
                        {allSelected
                          ? 'Tout désélectionner'
                          : selectedInTheme > 0
                            ? `Tout sélectionner (${selectedInTheme}/${theme.items.length})`
                            : `Tout sélectionner (${theme.items.length})`}
                      </button>
                    </div>
                    <ul className="divide-y divide-hairline">
                      {theme.items.map((item) => {
                        const checked = selected.has(item.id)
                        const price = formatLibraryItemPrice(item)
                        return (
                          <li key={item.id} className="py-2">
                            <label className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                onChange={() => toggleItem(item.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-sm font-medium text-ink">{item.name}</span>
                                  <span className="rounded-full bg-parchment px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                                    {billingTypeLabel(item.billingType, t)}
                                  </span>
                                  <span className="rounded-full bg-aurora/10 px-2 py-0.5 text-[11px] font-medium text-aurora">
                                    {serviceUsageLabel(item.usage, t)}
                                  </span>
                                  {price ? (
                                    <span className="text-[11px] font-medium text-aurora">
                                      {price}
                                    </span>
                                  ) : null}
                                </div>
                                {item.description ? (
                                  <p className="mt-0.5 text-xs text-ink-muted">
                                    {item.description}
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline pt-3">
          <p className="text-xs text-ink-muted">
            {t('cabinet.library_selected_count', {
              count: selected.size,
              defaultValue: '{{count}} sélectionnée(s)'
            })}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onDismiss} disabled={isImporting}>
              {t('common.cancel', { defaultValue: 'Annuler' })}
            </Button>
            <Button
              type="button"
              onClick={() => void handleImport()}
              disabled={selected.size === 0 || isImporting}
            >
              {isImporting ? 'Import en cours…' : 'Importer la sélection'}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}

export function CabinetPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [entityOpen, setEntityOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [editor, setEditor] = useState<ServicePresetEditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [serviceSearch, setServiceSearch] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  const entityProfile = useEntityStore((state) => state.profile)
  const loadEntity = useEntityStore((state) => state.load)
  const importDefaultTemplate = useEntityStore((state) => state.importDefaultTemplate)
  const openDefaultTemplate = useEntityStore((state) => state.openDefaultTemplate)
  const removeDefaultTemplate = useEntityStore((state) => state.removeDefaultTemplate)
  const templates = useTemplateStore((state) => state.templates)
  const applyCabinetDocxToAllExisting = useTemplateStore(
    (state) => state.applyCabinetDocxToAllExisting
  )
  const [isTemplateBusy, setIsTemplateBusy] = useState(false)
  const [confirmingTemplateRemove, setConfirmingTemplateRemove] = useState(false)
  const stampDataUrl = useEntityStore((state) => state.stampDataUrl)
  const loadStampPreview = useEntityStore((state) => state.loadStampPreview)
  const importStamp = useEntityStore((state) => state.importStamp)
  const removeStamp = useEntityStore((state) => state.removeStamp)
  const saveEntity = useEntityStore((state) => state.save)
  const [isStampBusy, setIsStampBusy] = useState(false)
  const [confirmingStampRemove, setConfirmingStampRemove] = useState(false)
  const [propagateConfirm, setPropagateConfirm] = useState<{ count: number } | null>(null)
  const [isPropagating, setIsPropagating] = useState(false)

  function countPropagationCandidates(): number {
    return templates.filter(
      (tpl) =>
        tpl.hasDocxSource && !(tpl.tags ?? []).some((tag) => tag.trim().toLowerCase() === 'email')
    ).length
  }

  function maybeOpenPropagateDialog(): void {
    const count = countPropagationCandidates()
    if (count > 0) {
      setPropagateConfirm({ count })
    }
  }

  async function handlePropagateCabinetDocx(): Promise<void> {
    if (!propagateConfirm) return
    setIsPropagating(true)
    try {
      const result = await applyCabinetDocxToAllExisting()
      if (result.success) {
        const { updated, failed } = result.data
        if (failed.length > 0) {
          showToast(
            t('cabinet.default_template_propagate_partial', {
              defaultValue:
                '{{updated}} modèle(s) mis à jour, {{failed}} échec(s) — voir la console.',
              updated,
              failed: failed.length
            })
          )
        } else {
          showToast(
            t('cabinet.default_template_propagate_done', {
              defaultValue: '{{count}} modèle(s) mis à jour.',
              count: updated
            })
          )
        }
      } else {
        showToast(result.error)
      }
    } finally {
      setIsPropagating(false)
      setPropagateConfirm(null)
    }
  }
  const catalog = useCabinetBillingStore((state) => state.catalog)
  const isLoading = useCabinetBillingStore((state) => state.isLoading)
  const error = useCabinetBillingStore((state) => state.error)
  const loadCatalog = useCabinetBillingStore((state) => state.load)
  const upsertService = useCabinetBillingStore((state) => state.upsertService)
  const deleteService = useCabinetBillingStore((state) => state.deleteService)

  const handleImportFromLibrary = async (entries: ServiceLibraryImportEntry[]): Promise<void> => {
    for (const entry of entries) {
      await upsertService(serviceLibraryEntryToUpsert(entry))
    }
    showToast(
      entries.length === 1
        ? '1 prestation importée depuis la bibliothèque.'
        : `${entries.length} prestations importées depuis la bibliothèque.`
    )
  }

  useEffect(() => {
    void loadEntity()
    void loadCatalog()
    void loadStampPreview()
  }, [loadCatalog, loadEntity, loadStampPreview])

  const services = useMemo(() => {
    const entries = [...(catalog?.services ?? [])]
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return entries
  }, [catalog?.services])

  const filteredServices = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase()
    if (!query) return services
    return services.filter(
      (service) =>
        service.name.toLowerCase().includes(query) ||
        (service.description ?? '').toLowerCase().includes(query) ||
        (service.group ?? '').toLowerCase().includes(query)
    )
  }, [services, serviceSearch])

  const groupedFilteredServices = useMemo(() => {
    const buckets = new Map<string, CabinetServicePreset[]>()
    for (const service of filteredServices) {
      const groupName = service.group?.trim() || DEFAULT_CABINET_SERVICE_GROUP
      const bucket = buckets.get(groupName)
      if (bucket) {
        bucket.push(service)
      } else {
        buckets.set(groupName, [service])
      }
    }
    return Array.from(buckets.entries())
      .map(([label, items]) => ({ label, items }))
      .sort((left, right) => {
        if (left.label === DEFAULT_CABINET_SERVICE_GROUP) return -1
        if (right.label === DEFAULT_CABINET_SERVICE_GROUP) return 1
        return left.label.localeCompare(right.label)
      })
  }, [filteredServices])

  const servicesCountLabel = serviceSearch.trim()
    ? t('cabinet.services_count_filtered', {
        count: filteredServices.length,
        total: services.length,
        defaultValue: '{{count}} sur {{total}}'
      })
    : services.length

  const entityDisplayName = entityProfile
    ? [ENTITY_TITLE_SHORT, entityProfile.firstName, entityProfile.lastName]
        .filter(Boolean)
        .join(' ')
    : ''

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-hidden pb-2">
      {error ? <AlertBanner tone="error">{error}</AlertBanner> : null}

      <div className="shrink-0 space-y-2">
        <SectionHeader
          badge={t('entity.section_title')}
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => setEntityOpen(true)}>
              {t('entity.editButton')}
            </Button>
          }
        />
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-ink">
              {entityProfile?.firmName ?? t('entity.emptyHint')}
            </p>
          </div>

          {entityProfile ? (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[#eeede5] pt-3 md:grid-cols-4 xl:grid-cols-5">
              {entityDisplayName ? (
                <DetailField label={t('entity.form.name')} value={entityDisplayName} />
              ) : null}
              <DetailField label={t('entity.form.phone')} value={entityProfile.phone} />
              <DetailField label={t('entity.form.email')} value={entityProfile.email} />
              <DetailField label={t('entity.form.vatNumber')} value={entityProfile.vatNumber} />
              <DetailField label={t('entity.form.siren')} value={entityProfile.siren} />
              <DetailField label={t('entity.form.siret')} value={entityProfile.siret} />
              <DetailField label={t('entity.form.legalForm')} value={entityProfile.legalForm} />
              <DetailField
                label={t('entity.form.shareCapital')}
                value={entityProfile.shareCapital}
              />
              <DetailField label={t('entity.form.rcsNumber')} value={entityProfile.rcsNumber} />
              <DetailField label={t('entity.form.rcsCity')} value={entityProfile.rcsCity} />
              <DetailField label={t('entity.form.iban')} value={entityProfile.iban} />
              <DetailField label={t('entity.form.bic')} value={entityProfile.bic} />
              <DetailField label={t('entity.form.carpaIban')} value={entityProfile.carpaIban} />
              {(entityProfile.addressLine ??
              entityProfile.zipCode ??
              entityProfile.city ??
              entityProfile.address) ? (
                <DetailField
                  label={t('entity.form.address')}
                  value={
                    (entityProfile.addressLine ?? entityProfile.zipCode ?? entityProfile.city)
                      ? buildAddressFields(entityProfile).addressFormatted
                      : buildAddressFields({ addressLine: entityProfile.address }).addressFormatted
                  }
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <SectionHeader
          badge={t('cabinet.default_template_section_title', {
            defaultValue: 'Modèle Word par défaut'
          })}
          actions={
            entityProfile?.defaultTemplateFileName ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isTemplateBusy}
                  onClick={async () => {
                    const result = await openDefaultTemplate()
                    if (!result.ok && result.error) {
                      showToast(result.error)
                    }
                  }}
                >
                  {t('cabinet.default_template_open', { defaultValue: 'Ouvrir' })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isTemplateBusy || !entityProfile}
                  onClick={async () => {
                    setIsTemplateBusy(true)
                    try {
                      const result = await importDefaultTemplate()
                      if (result.imported) {
                        showToast(
                          t('cabinet.default_template_toast_replaced', {
                            defaultValue: 'Modèle Word remplacé.'
                          })
                        )
                        maybeOpenPropagateDialog()
                      } else if (result.error) {
                        showToast(result.error)
                      }
                    } finally {
                      setIsTemplateBusy(false)
                    }
                  }}
                >
                  {t('cabinet.default_template_replace', { defaultValue: 'Remplacer' })}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isTemplateBusy || !entityProfile}
                onClick={async () => {
                  setIsTemplateBusy(true)
                  try {
                    const result = await importDefaultTemplate()
                    if (result.imported) {
                      showToast(
                        t('cabinet.default_template_toast_imported', {
                          defaultValue: 'Modèle Word importé.'
                        })
                      )
                      maybeOpenPropagateDialog()
                    } else if (result.error) {
                      showToast(result.error)
                    }
                  } finally {
                    setIsTemplateBusy(false)
                  }
                }}
              >
                {t('cabinet.default_template_import', { defaultValue: 'Importer un .docx' })}
              </Button>
            )
          }
        />
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
          {entityProfile?.defaultTemplateFileName ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {entityProfile.defaultTemplateFileName}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {entityProfile.defaultTemplateImportedAt
                    ? t('cabinet.default_template_imported_at', {
                        defaultValue: 'Importé le {{date}}',
                        date: new Date(entityProfile.defaultTemplateImportedAt).toLocaleString()
                      })
                    : t('cabinet.default_template_helper', {
                        defaultValue:
                          'Sert de référence pour les en-têtes, pieds de page, polices et tailles.'
                      })}
                </p>
              </div>
              <div className="relative flex items-center gap-2">
                {confirmingTemplateRemove ? (
                  <DeleteConfirmTray
                    label={t('cabinet.default_template_remove_confirm_label', {
                      defaultValue: 'Supprimer ce modèle ?'
                    })}
                    confirmLabel={t('common.confirm', { defaultValue: 'Confirmer' })}
                    cancelLabel={t('common.cancel', { defaultValue: 'Annuler' })}
                    onConfirm={async () => {
                      setIsTemplateBusy(true)
                      try {
                        const result = await removeDefaultTemplate()
                        setConfirmingTemplateRemove(false)
                        if (result.ok) {
                          showToast(
                            t('cabinet.default_template_toast_removed', {
                              defaultValue: 'Modèle Word supprimé.'
                            })
                          )
                        } else if (result.error) {
                          showToast(result.error)
                        }
                      } finally {
                        setIsTemplateBusy(false)
                      }
                    }}
                    onCancel={() => setConfirmingTemplateRemove(false)}
                  />
                ) : (
                  <IconButton
                    label={t('common.delete', { defaultValue: 'Supprimer' })}
                    tone="danger"
                    onClick={() => setConfirmingTemplateRemove(true)}
                  >
                    <TrashIcon />
                  </IconButton>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              {entityProfile
                ? t('cabinet.default_template_empty', {
                    defaultValue:
                      'Importez un document Word qui servira de référence pour les en-têtes, pieds de page, polices et tailles.'
                  })
                : t('cabinet.default_template_requires_entity', {
                    defaultValue:
                      'Renseignez d’abord les informations du cabinet pour importer un modèle Word.'
                  })}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <SectionHeader
          badge={t('cabinet.stamp_section_title', { defaultValue: 'Tampon de cotation' })}
          actions={
            <Button
              type="button"
              variant={entityProfile?.stampImageFileName ? 'ghost' : 'default'}
              size="sm"
              disabled={isStampBusy || !entityProfile}
              onClick={async () => {
                setIsStampBusy(true)
                try {
                  const result = await importStamp()
                  if (result.imported) {
                    showToast(
                      t('cabinet.stamp_toast_imported', { defaultValue: 'Tampon importé.' })
                    )
                  } else if (result.error) {
                    showToast(result.error)
                  }
                } finally {
                  setIsStampBusy(false)
                }
              }}
            >
              {entityProfile?.stampImageFileName
                ? t('cabinet.stamp_replace', { defaultValue: 'Remplacer' })
                : t('cabinet.stamp_import', { defaultValue: 'Importer une image' })}
            </Button>
          }
        />
        <div className="rounded-2xl border border-hairline bg-white p-4 shadow-[0_1px_2px_rgba(15,122,138,0.04)]">
          <div className="flex flex-wrap items-center gap-4">
            {stampDataUrl ? (
              <img
                src={stampDataUrl}
                alt={t('cabinet.stamp_preview_alt', { defaultValue: 'Aperçu du tampon' })}
                className="h-20 w-20 shrink-0 rounded-full border border-hairline object-contain"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline-strong text-[10px] text-ink-subtle">
                {t('cabinet.stamp_generated_badge', { defaultValue: 'Généré' })}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {entityProfile?.stampImageFileName ??
                  t('cabinet.stamp_generated_title', {
                    defaultValue: 'Tampon généré automatiquement'
                  })}
              </p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {entityProfile?.stampImageFileName
                  ? t('cabinet.stamp_helper_imported', {
                      defaultValue:
                        'Apposé sur la première page de chaque pièce cotée, avec le numéro au centre.'
                    })
                  : t('cabinet.stamp_helper_generated', {
                      defaultValue:
                        'Sans image importée, un tampon rond (cabinet, barreau, toque) est dessiné automatiquement. Importez une image PNG/JPG de votre vrai tampon pour le remplacer.'
                    })}
              </p>
              <label className="mt-2 inline-flex items-center gap-2 text-xs text-ink-muted">
                {t('cabinet.stamp_position_label', { defaultValue: 'Position sur la page :' })}
                <select
                  className="rounded-lg border border-hairline-strong bg-white px-2 py-1 text-xs text-ink outline-none focus:border-aurora"
                  value={entityProfile?.stampPosition ?? 'top-right'}
                  disabled={!entityProfile || isStampBusy}
                  onChange={(event) => {
                    if (!entityProfile) return
                    void saveEntity({
                      ...entityProfile,
                      stampPosition: event.target.value as NonNullable<
                        typeof entityProfile.stampPosition
                      >
                    })
                  }}
                >
                  <option value="top-right">
                    {t('cabinet.stamp_position_top_right', { defaultValue: 'Haut droite' })}
                  </option>
                  <option value="top-left">
                    {t('cabinet.stamp_position_top_left', { defaultValue: 'Haut gauche' })}
                  </option>
                  <option value="bottom-right">
                    {t('cabinet.stamp_position_bottom_right', { defaultValue: 'Bas droite' })}
                  </option>
                  <option value="bottom-left">
                    {t('cabinet.stamp_position_bottom_left', { defaultValue: 'Bas gauche' })}
                  </option>
                </select>
              </label>
            </div>
            {entityProfile?.stampImageFileName ? (
              <div className="relative flex items-center gap-2">
                {confirmingStampRemove ? (
                  <DeleteConfirmTray
                    label={t('cabinet.stamp_remove_confirm_label', {
                      defaultValue: 'Supprimer ce tampon ?'
                    })}
                    confirmLabel={t('common.confirm', { defaultValue: 'Confirmer' })}
                    cancelLabel={t('common.cancel', { defaultValue: 'Annuler' })}
                    onConfirm={async () => {
                      setIsStampBusy(true)
                      try {
                        const result = await removeStamp()
                        setConfirmingStampRemove(false)
                        if (result.ok) {
                          showToast(
                            t('cabinet.stamp_toast_removed', { defaultValue: 'Tampon supprimé.' })
                          )
                        } else if (result.error) {
                          showToast(result.error)
                        }
                      } finally {
                        setIsStampBusy(false)
                      }
                    }}
                    onCancel={() => setConfirmingStampRemove(false)}
                  />
                ) : (
                  <IconButton
                    label={t('common.delete', { defaultValue: 'Supprimer' })}
                    tone="danger"
                    onClick={() => setConfirmingStampRemove(true)}
                  >
                    <TrashIcon />
                  </IconButton>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <SectionHeader
          badge={t('cabinet.services_section_title', { defaultValue: 'Prestations et tarifs' })}
          count={servicesCountLabel}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setLibraryOpen(true)}>
                {t('cabinet.library_action', { defaultValue: 'Bibliothèque' })}
              </Button>
              <Button type="button" size="sm" onClick={() => setEditor(createEmptyEditorState())}>
                {t('cabinet.services_add_action', { defaultValue: 'Ajouter une prestation' })}
              </Button>
            </>
          }
        />

        {isLoading ? (
          <p className="text-sm text-ink-muted">
            {t('cabinet.services_loading', { defaultValue: 'Chargement des prestations...' })}
          </p>
        ) : services.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-hairline-strong bg-white px-6 py-12 text-center">
            <div className="space-y-5">
              <p className="text-sm text-ink-muted">
                {t('cabinet.services_empty', {
                  defaultValue:
                    'Votre catalogue est vide. Importez depuis la bibliothèque de prestations types ou créez une prestation personnalisée.'
                })}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button type="button" onClick={() => setLibraryOpen(true)}>
                  {t('cabinet.library_action_long', {
                    defaultValue: 'Bibliothèque de prestations'
                  })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditor(createEmptyEditorState())}
                >
                  {t('cabinet.services_add_action', { defaultValue: 'Ajouter une prestation' })}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <SearchField
                id="cabinet-services-search"
                value={serviceSearch}
                onChange={setServiceSearch}
                placeholder={t('cabinet.services_search_placeholder', {
                  defaultValue: 'Filtrer par nom ou description…'
                })}
                ariaLabel={t('cabinet.services_search_label', {
                  defaultValue: 'Filtrer les prestations'
                })}
              />
            </div>
            {filteredServices.length === 0 ? (
              <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink">
                {t('cabinet.services_no_results', {
                  defaultValue: 'Aucune prestation ne correspond à votre recherche.'
                })}
              </p>
            ) : (
              <ListContainer>
                <div className="h-full overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-deep-space bg-parchment-bright text-left text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
                        <th className="px-4 py-2.5">
                          {t('cabinet.column.service', { defaultValue: 'Prestation' })}
                        </th>
                        <th className="px-3 py-2.5">
                          {t('cabinet.column.type', { defaultValue: 'Type' })}
                        </th>
                        <th className="px-3 py-2.5">
                          {t('cabinet.column.pricing', { defaultValue: 'Tarification H.T.' })}
                        </th>
                        <th
                          className="px-4 py-2.5 text-right"
                          aria-label={t('cabinet.column.actions', { defaultValue: 'Actions' })}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {groupedFilteredServices.flatMap((group) => [
                        <tr key={`group-${group.label}`} className="bg-parchment">
                          <td
                            colSpan={4}
                            className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
                          >
                            <span>{group.label}</span>
                            <span className="ml-2 text-[10px] font-normal text-ink-subtle">
                              {group.items.length}
                            </span>
                          </td>
                        </tr>,
                        ...group.items.map((service) => {
                          const pricing = formatServicePricing(service)
                          if (typeof service.successFeePercentBasisPoints === 'number') {
                            pricing.push(
                              `${t('cabinet.success_fee_label', { defaultValue: 'Honoraires de résultat' })} ${formatBasisPoints(service.successFeePercentBasisPoints)}`
                            )
                          }
                          return (
                            <tr
                              key={service.uuid}
                              className="group border-b border-[#eeede5] align-top transition-colors last:border-b-0 hover:bg-parchment-bright"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0">
                                    <div className="font-medium text-ink">{service.name}</div>
                                    {service.description ? (
                                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                                        {service.description}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-col items-start gap-1">
                                  <span className="inline-flex rounded-full bg-parchment px-2.5 py-1 text-[11px] font-medium text-ink-muted">
                                    {billingTypeLabel(service.billingType, t)}
                                  </span>
                                  <span className="inline-flex rounded-full bg-aurora/10 px-2.5 py-1 text-[11px] font-medium text-aurora">
                                    {serviceUsageLabel(service.usage, t)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                {pricing.length === 0 ? (
                                  <span className="text-xs text-ink-subtle">—</span>
                                ) : (
                                  <ul className="space-y-0.5 text-[13px] text-ink">
                                    {pricing.map((line) => (
                                      <li key={line}>{line}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="relative flex items-center justify-end gap-1">
                                  <div
                                    className={
                                      confirmingDeleteId === service.uuid
                                        ? 'invisible flex items-center gap-1'
                                        : 'flex items-center gap-1'
                                    }
                                  >
                                    <IconButton
                                      label={t('common.edit', { defaultValue: 'Modifier' })}
                                      onClick={() => {
                                        setEditor(createEditorState(service))
                                        setEditorError(null)
                                      }}
                                    >
                                      <PencilIcon />
                                    </IconButton>
                                    <IconButton
                                      label={t('common.delete', { defaultValue: 'Supprimer' })}
                                      tone="danger"
                                      onClick={() => setConfirmingDeleteId(service.uuid)}
                                    >
                                      <TrashIcon />
                                    </IconButton>
                                  </div>
                                  {confirmingDeleteId === service.uuid ? (
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
                                      <DeleteConfirmTray
                                        label={t('cabinet.service_delete_confirm_label', {
                                          defaultValue: 'Supprimer cette prestation ?'
                                        })}
                                        confirmLabel={t('cabinet.service_delete_confirm_action', {
                                          defaultValue: 'Confirmer'
                                        })}
                                        cancelLabel={t('cabinet.service_delete_cancel_action', {
                                          defaultValue: 'Annuler'
                                        })}
                                        onConfirm={async () => {
                                          const ok = await deleteService({ uuid: service.uuid })
                                          setConfirmingDeleteId(null)
                                          if (ok) {
                                            showToast(
                                              t('cabinet.toast.deleted', {
                                                defaultValue: 'Prestation supprimée.'
                                              })
                                            )
                                          }
                                        }}
                                        onCancel={() => setConfirmingDeleteId(null)}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      ])}
                    </tbody>
                  </table>
                </div>
              </ListContainer>
            )}
          </>
        )}
      </div>

      <EntityDialog open={entityOpen} onClose={() => setEntityOpen(false)} />

      {libraryOpen ? (
        <ServiceLibraryDialog
          onDismiss={() => setLibraryOpen(false)}
          onImport={handleImportFromLibrary}
        />
      ) : null}

      {editor ? (
        <DialogShell
          size="xl"
          aria-label={t('cabinet.editor_title', { defaultValue: 'Prestation cabinet' })}
          onDismiss={() => {
            setEditor(null)
            setEditorError(null)
          }}
        >
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {editor.id
                ? t('cabinet.editor_edit_title', { defaultValue: 'Modifier la prestation' })
                : t('cabinet.editor_create_title', { defaultValue: 'Créer une prestation' })}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {t('cabinet.editor_summary', {
                defaultValue:
                  'Définissez les montants et clauses qui seront proposés par défaut dans les nouveaux dossiers.'
              })}
            </p>
          </div>

          <form
            className="flex flex-col gap-5"
            onSubmit={async (event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              const payload = buildUpsertInputFromEditor({
                ...editor,
                usage: readServiceUsage(formData.get('usage'), editor.usage)
              })

              if (!payload) {
                setEditorError(
                  t('cabinet.editor_validation', {
                    defaultValue:
                      'Complétez au minimum le nom, le type de facturation et un taux de TVA valide.'
                  })
                )
                return
              }

              setEditorError(null)
              setIsSaving(true)
              try {
                const ok = await upsertService(payload)
                if (ok) {
                  showToast(
                    t('cabinet.toast.saved', {
                      defaultValue: 'Prestation cabinet enregistrée.'
                    })
                  )
                  setEditor(null)
                }
              } finally {
                setIsSaving(false)
              }
            }}
          >
            {editorError ? <AlertBanner tone="error">{editorError}</AlertBanner> : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label={t('cabinet.service_name_label', { defaultValue: 'Nom de la prestation' })}
              >
                <Input
                  value={editor.name}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, name: event.target.value } : current
                    )
                  }
                  placeholder={t('cabinet.service_name_placeholder', {
                    defaultValue: 'Convention forfait + résultat'
                  })}
                />
              </Field>

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

              <Field label={t('cabinet.service_usage_label', { defaultValue: 'Usage' })}>
                <Select
                  name="usage"
                  value={editor.usage}
                  onChange={(event) =>
                    setEditor((current) =>
                      current
                        ? { ...current, usage: event.target.value as CabinetServiceUsage }
                        : current
                    )
                  }
                >
                  <option value="feeAgreement">
                    {t('cabinet.service_usage.feeAgreement', {
                      defaultValue: 'Convention d’honoraires'
                    })}
                  </option>
                  <option value="billing">
                    {t('cabinet.service_usage.billing', {
                      defaultValue: 'Facturation seulement'
                    })}
                  </option>
                  <option value="both">
                    {t('cabinet.service_usage.both', {
                      defaultValue: 'Convention et facturation'
                    })}
                  </option>
                </Select>
              </Field>

              <Field label={t('cabinet.service_group_label', { defaultValue: 'Groupe' })}>
                <Input
                  list="cabinet-service-groups"
                  value={editor.group}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, group: event.target.value } : current
                    )
                  }
                  placeholder={DEFAULT_CABINET_SERVICE_GROUP}
                />
                <datalist id="cabinet-service-groups">
                  {Array.from(
                    new Set([
                      DEFAULT_CABINET_SERVICE_GROUP,
                      ...services
                        .map((service) => service.group?.trim())
                        .filter((value): value is string => Boolean(value))
                    ])
                  ).map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </Field>

              <Field
                className="md:col-span-2"
                label={t('cabinet.service_description_label', { defaultValue: 'Description' })}
              >
                <Textarea
                  rows={3}
                  value={editor.description}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, description: event.target.value } : current
                    )
                  }
                  placeholder={t('cabinet.service_description_placeholder', {
                    defaultValue: 'Résumé interne de la mission proposée.'
                  })}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                label={t('cabinet.hourly_rate_label', { defaultValue: 'Taux horaire HT (€)' })}
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
                label={t('cabinet.success_fee_percent_label', {
                  defaultValue: 'Honoraires de résultat (%)'
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
              <Field
                className="lg:col-span-2"
                label={t('cabinet.success_fee_clause_label', {
                  defaultValue: 'Clause d’honoraires de résultat'
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

            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label={t('cabinet.payment_terms_label', {
                  defaultValue: 'Conditions de paiement'
                })}
              >
                <Textarea
                  rows={4}
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
                  rows={4}
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
                  rows={4}
                  value={editor.terminationTerms}
                  onChange={(event) =>
                    setEditor((current) =>
                      current ? { ...current, terminationTerms: event.target.value } : current
                    )
                  }
                />
              </Field>
            </div>

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
              <Button type="submit" disabled={isSaving}>
                {editor.id
                  ? t('common.save', { defaultValue: 'Enregistrer' })
                  : t('cabinet.create_action', { defaultValue: 'Créer' })}
              </Button>
            </div>
          </form>
        </DialogShell>
      ) : null}

      {propagateConfirm ? (
        <DialogShell
          size="md"
          aria-label={t('cabinet.default_template_propagate_title', {
            defaultValue: 'Mettre à jour les modèles existants ?'
          })}
          onDismiss={() => (isPropagating ? undefined : setPropagateConfirm(null))}
        >
          <div className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-ink">
              {t('cabinet.default_template_propagate_title', {
                defaultValue: 'Mettre à jour les modèles existants ?'
              })}
            </h3>
            <p className="text-sm text-ink-muted">
              {t('cabinet.default_template_propagate_body', {
                defaultValue:
                  '{{count}} modèle(s) non-email utilisent l’ancien modèle Word du cabinet. Voulez-vous appliquer le nouveau modèle à tous ? Les contenus actuels (y compris vos modifications dans Word) seront préservés ; seul l’en-tête, le pied de page et la mise en page seront remplacés.',
                count: propagateConfirm.count
              })}
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isPropagating}
                onClick={() => setPropagateConfirm(null)}
              >
                {t('cabinet.default_template_propagate_later', { defaultValue: 'Plus tard' })}
              </Button>
              <Button
                type="button"
                disabled={isPropagating}
                onClick={() => void handlePropagateCabinetDocx()}
              >
                {isPropagating
                  ? t('cabinet.default_template_propagate_in_progress', {
                      defaultValue: 'Application…'
                    })
                  : t('cabinet.default_template_propagate_action', {
                      defaultValue: 'Appliquer à tous'
                    })}
              </Button>
            </div>
          </div>
        </DialogShell>
      ) : null}
    </section>
  )
}
