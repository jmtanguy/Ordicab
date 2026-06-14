import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BILLING_ITEM_STATUS_VALUES,
  DEFAULT_CABINET_SERVICE_GROUP,
  isCabinetServicePresetEligibleForBilling
} from '@shared/types'
import type {
  BillingItemQuantityUnit,
  BillingItemStatus,
  CabinetServicePreset,
  DossierBillingItem,
  DossierBillingItemDeleteInput,
  DossierBillingItemUpsertInput,
  SourceFeeAgreementBillingKind
} from '@shared/types'
import { dossierBillingItemUpsertInputSchema } from '@shared/validation'

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
import { billingItemStatusLabel } from '@renderer/lib/domainLabels'
import { useCabinetBillingStore, useDossierStore } from '@renderer/stores'
import {
  formatElapsed,
  useTimerElapsedMs,
  useTimerStore,
  type RunningTimer
} from '@renderer/stores/timerStore'
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
  ColumnHeader,
  DeleteConfirmTray,
  IconButton,
  ListContainer,
  PencilIcon,
  SectionHeader,
  TrashIcon
} from './sectionLayout'
import {
  computeBillingTotalsFromEditor,
  createDiscountEditorFields,
  createEmptyDiscountEditorFields,
  parseDiscountEditorFields,
  type DiscountMode
} from './billingDiscountEditor'
import { DossierDiscountFields } from './DossierDiscountFields'
import { InvoiceCreationDialog } from '../invoices/InvoiceCreationDialog'

interface BillingItemEditorState {
  id?: string
  date: string
  label: string
  description: string
  sourceServicePresetUuid: string
  quantity: string
  quantityUnit: BillingItemQuantityUnit
  unitPriceHt: string
  discountMode: DiscountMode
  discountPercent: string
  discountAmount: string
  vatRate: string
  status: BillingItemStatus
  sourceKeyDateUuid?: string
  sourceFeeAgreementUuid?: string
  sourceFeeAgreementBillingKind?: SourceFeeAgreementBillingKind
}

function createEmptyEditor(): BillingItemEditorState {
  const today = new Date().toISOString().slice(0, 10)
  return {
    date: today,
    label: '',
    description: '',
    sourceServicePresetUuid: '',
    quantity: '1',
    quantityUnit: 'hours',
    unitPriceHt: '',
    ...createEmptyDiscountEditorFields(),
    vatRate: '20',
    status: 'draft'
  }
}

function createEditorFromItem(item: DossierBillingItem): BillingItemEditorState {
  return {
    id: item.uuid,
    date: item.date,
    label: item.label,
    description: item.description ?? '',
    sourceServicePresetUuid: item.sourceServicePresetUuid ?? '',
    quantity: formatNumberInput(item.quantity),
    quantityUnit: item.quantityUnit,
    unitPriceHt: formatMoneyInput(item.unitPriceHtCents),
    ...createDiscountEditorFields(item),
    vatRate: formatPercentInput(item.vatRateBasisPoints),
    status: item.status,
    sourceKeyDateUuid: item.sourceKeyDateUuid,
    sourceFeeAgreementUuid: item.sourceFeeAgreementUuid,
    sourceFeeAgreementBillingKind: item.sourceFeeAgreementBillingKind
  }
}

function createEditorFromPrefill(
  input: DossierBillingItemUpsertInput,
  defaultPreset?: CabinetServicePreset
): BillingItemEditorState {
  const presetId = input.sourceServicePresetUuid ?? defaultPreset?.uuid ?? ''
  return {
    date: input.date,
    label: input.label,
    description: input.description ?? '',
    sourceServicePresetUuid: presetId,
    quantity: formatNumberInput(input.quantity),
    quantityUnit: input.quantityUnit,
    unitPriceHt: formatMoneyInput(input.unitPriceHtCents),
    ...createDiscountEditorFields(input),
    vatRate: formatPercentInput(input.vatRateBasisPoints),
    status: input.status,
    sourceKeyDateUuid: input.sourceKeyDateUuid,
    sourceFeeAgreementUuid: input.sourceFeeAgreementUuid,
    sourceFeeAgreementBillingKind: input.sourceFeeAgreementBillingKind
  }
}

function applyPresetToEditor(
  current: BillingItemEditorState,
  preset: CabinetServicePreset,
  previousPreset?: CabinetServicePreset
): BillingItemEditorState {
  const labelFromPrevious = !!previousPreset && current.label.trim() === previousPreset.name.trim()
  const descriptionFromPrevious =
    !!previousPreset && current.description.trim() === (previousPreset.description ?? '').trim()
  const labelIsUserInput = current.label.trim().length > 0 && !labelFromPrevious
  const descriptionIsUserInput = current.description.trim().length > 0 && !descriptionFromPrevious
  return {
    ...current,
    sourceServicePresetUuid: preset.uuid,
    label: labelIsUserInput ? current.label : preset.name,
    description: descriptionIsUserInput ? current.description : (preset.description ?? ''),
    quantityUnit: preset.billingType === 'flat' ? 'units' : 'hours',
    unitPriceHt: formatMoneyInput(preset.hourlyRateHtCents ?? preset.flatFeeHtCents),
    vatRate: formatPercentInput(preset.vatRateBasisPoints) || current.vatRate
  }
}

function buildUpsertInput(
  dossierId: string,
  state: BillingItemEditorState
): DossierBillingItemUpsertInput | null {
  const quantity = parseDecimalInput(state.quantity)
  const unitPriceHtCents = parseEurosToCents(state.unitPriceHt)
  const vatRateBasisPoints = parsePercentToBasisPoints(state.vatRate)
  const discount = parseDiscountEditorFields(state)
  const candidate = {
    dossierId,
    uuid: state.id,
    date: state.date,
    label: state.label.trim(),
    description: state.description.trim() || undefined,
    sourceServicePresetUuid: state.sourceServicePresetUuid || undefined,
    quantity: typeof quantity === 'number' ? quantity : 0,
    quantityUnit: state.quantityUnit,
    unitPriceHtCents: typeof unitPriceHtCents === 'number' ? unitPriceHtCents : 0,
    ...discount,
    vatRateBasisPoints: typeof vatRateBasisPoints === 'number' ? vatRateBasisPoints : 0,
    status: state.status,
    sourceKeyDateUuid: state.sourceKeyDateUuid,
    sourceFeeAgreementUuid: state.sourceFeeAgreementUuid,
    sourceFeeAgreementBillingKind: state.sourceFeeAgreementBillingKind
  }

  const parsed = dossierBillingItemUpsertInputSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function quantityUnitLabel(
  unit: BillingItemQuantityUnit,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (unit === 'hours') return t('dossiers.billing_item_unit_hours', { defaultValue: 'h' })
  return t('dossiers.billing_item_unit_units', { defaultValue: 'u.' })
}

function presetPriceHint(preset: CabinetServicePreset): string {
  if (preset.billingType === 'hourly') {
    return `${formatEurosFromCents(preset.hourlyRateHtCents)}/h HT`
  }
  if (preset.billingType === 'flat') {
    return `${formatEurosFromCents(preset.flatFeeHtCents)} HT`
  }
  const hourly = preset.hourlyRateHtCents
    ? `${formatEurosFromCents(preset.hourlyRateHtCents)}/h`
    : null
  const flat = preset.flatFeeHtCents ? formatEurosFromCents(preset.flatFeeHtCents) : null
  return [hourly, flat].filter(Boolean).join(' · ') + ' HT'
}

function PresetCombobox({
  value,
  presets,
  onSelect,
  freeEntryLabel,
  searchPlaceholder
}: {
  value: string
  presets: CabinetServicePreset[]
  onSelect: (preset: CabinetServicePreset | null) => void
  freeEntryLabel: string
  searchPlaceholder: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const selected = presets.find((preset) => preset.uuid === value) ?? null

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return presets
    return presets.filter((preset) => {
      const haystack =
        `${preset.name} ${preset.description ?? ''} ${preset.group ?? ''}`.toLowerCase()
      return haystack.includes(trimmed)
    })
  }, [presets, query])

  const grouped = useMemo(() => {
    const map = new Map<string, CabinetServicePreset[]>()
    for (const preset of filtered) {
      const key = preset.group?.trim() || DEFAULT_CABINET_SERVICE_GROUP
      const bucket = map.get(key)
      if (bucket) bucket.push(preset)
      else map.set(key, [preset])
    }
    return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right))
  }, [filtered])

  const flatItems = useMemo(() => grouped.flatMap(([, items]) => items), [grouped])

  useEffect(() => {
    if (!open) return
    const handle = window.requestAnimationFrame(() => {
      setActiveIndex(0)
      setQuery('')
      searchRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(handle)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const commit = (preset: CabinetServicePreset | null): void => {
    onSelect(preset)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-hairline-strong bg-white px-4 py-2.5 text-left text-sm text-ink outline-none transition hover:border-[#a8a59a] focus:border-aurora focus:ring-2 focus:ring-aurora/45"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{selected ? selected.name : freeEntryLabel}</span>
          {selected ? (
            <span className="truncate text-xs text-ink-subtle">
              {(selected.group?.trim() || DEFAULT_CABINET_SERVICE_GROUP) +
                ' · ' +
                presetPriceHint(selected)}
            </span>
          ) : null}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-ink-subtle transition ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4 4 4-4" />
        </svg>
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-hairline-strong bg-white shadow-lg">
          <div className="border-b border-[#ece9df] p-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActiveIndex((idx) => Math.min(idx + 1, flatItems.length - 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActiveIndex((idx) => Math.max(idx - 1, 0))
                } else if (event.key === 'Enter') {
                  event.preventDefault()
                  const item = flatItems[activeIndex]
                  if (item) commit(item)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setOpen(false)
                }
              }}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm outline-none focus:border-aurora focus:ring-2 focus:ring-aurora/45"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {flatItems.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-ink-subtle">—</div>
            ) : (
              grouped.map(([groupName, items]) => (
                <div key={groupName} className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                    {groupName}
                  </div>
                  {items.map((preset) => {
                    const flatIndex = flatItems.indexOf(preset)
                    const isActive = flatIndex === activeIndex
                    const isSelected = preset.uuid === value
                    return (
                      <button
                        key={preset.uuid}
                        type="button"
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          commit(preset)
                        }}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                          isActive ? 'bg-aurora/10' : 'bg-transparent'
                        } ${isSelected ? 'font-semibold text-aurora' : 'text-ink'}`}
                      >
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate">{preset.name}</span>
                          {preset.description ? (
                            <span className="truncate text-xs text-ink-subtle">
                              {preset.description}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-ink-subtle">
                          {presetPriceHint(preset)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault()
              commit(null)
            }}
            className={`flex w-full items-center gap-2 border-t border-[#ece9df] px-3 py-2 text-left text-sm transition hover:bg-[#f5f3ec] ${
              !value ? 'font-semibold text-aurora' : 'text-ink'
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 13.5V16h2.5L15 7.5 12.5 5 4 13.5z"
              />
            </svg>
            {freeEntryLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function PlayIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3.5v9l7.5-4.5L5 3.5z" />
    </svg>
  )
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 3.5v9" />
      <path d="M10.5 3.5v9" />
    </svg>
  )
}

function StopIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="8" height="8" rx="1" />
    </svg>
  )
}

function TimerControls({
  dossierId,
  dossierName,
  disabled,
  onStop
}: {
  dossierId: string
  dossierName: string
  disabled: boolean
  onStop: (timer: RunningTimer) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const timer = useTimerStore((state) => state.timer)
  const start = useTimerStore((state) => state.start)
  const pause = useTimerStore((state) => state.pause)
  const resume = useTimerStore((state) => state.resume)
  const discard = useTimerStore((state) => state.discard)
  const elapsedMs = useTimerElapsedMs()

  if (!timer || timer.dossierId !== dossierId) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || timer !== null}
        title={
          timer !== null
            ? t('timer.start_blocked_other_dossier', {
                defaultValue: 'Un chronomètre est déjà en cours sur {{name}}.',
                name: timer.dossierName
              })
            : undefined
        }
        onClick={() => start(dossierId, dossierName)}
      >
        {t('timer.start_action', { defaultValue: 'Démarrer le chrono' })}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-hairline bg-parchment py-1 pl-3 pr-1">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          timer.isPaused ? 'bg-[#c4c2b8]' : 'animate-pulse bg-aurora'
        }`}
      />
      <span className="text-sm tabular-nums text-ink">{formatElapsed(elapsedMs ?? 0)}</span>
      {timer.isPaused ? (
        <IconButton
          alwaysVisible
          label={t('timer.resume_action', { defaultValue: 'Reprendre le chrono' })}
          onClick={resume}
        >
          <PlayIcon />
        </IconButton>
      ) : (
        <IconButton
          alwaysVisible
          label={t('timer.pause_action', { defaultValue: 'Mettre en pause' })}
          onClick={pause}
        >
          <PauseIcon />
        </IconButton>
      )}
      <IconButton
        alwaysVisible
        label={t('timer.stop_action', { defaultValue: 'Arrêter et facturer' })}
        disabled={disabled}
        onClick={() => onStop(timer)}
      >
        <StopIcon />
      </IconButton>
      <IconButton
        alwaysVisible
        tone="danger"
        label={t('timer.discard_action', { defaultValue: 'Abandonner le chrono' })}
        onClick={discard}
      >
        <TrashIcon />
      </IconButton>
    </div>
  )
}

function formatDisplayDate(value: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(value + 'T12:00:00')
    )
  } catch {
    return value
  }
}

export function DossierBillingItemsSection({
  dossierId,
  entries,
  disabled,
  prefillItem,
  onConsumePrefill,
  onPrefillCancel,
  onSave,
  onDelete
}: {
  dossierId: string
  entries: DossierBillingItem[]
  disabled: boolean
  prefillItem?: DossierBillingItemUpsertInput | null
  onConsumePrefill?: () => void
  onPrefillCancel?: () => void
  onSave: (input: DossierBillingItemUpsertInput) => Promise<boolean>
  onDelete: (input: DossierBillingItemDeleteInput) => Promise<boolean>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'fr-FR'
  const [editor, setEditor] = useState<BillingItemEditorState | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editorFromPrefill, setEditorFromPrefill] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [selectedInvoiceItemIds, setSelectedInvoiceItemIds] = useState<Set<string>>(new Set())
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false)

  function toggleInvoiceSelection(id: string): void {
    setSelectedInvoiceItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const closeEditorFromCancel = (): void => {
    const wasPrefill = editorFromPrefill
    setEditor(null)
    setEditorError(null)
    setEditorFromPrefill(false)
    if (wasPrefill) {
      onPrefillCancel?.()
    }
  }

  const catalog = useCabinetBillingStore((state) => state.catalog)
  const catalogError = useCabinetBillingStore((state) => state.error)
  const loadCatalog = useCabinetBillingStore((state) => state.load)

  const activeDossier = useDossierStore((state) => state.activeDossier)
  const timerDossierName = activeDossier?.slug === dossierId ? activeDossier.name : dossierId
  const activeAgreementHourlyRateHtCents =
    activeDossier?.slug === dossierId
      ? activeDossier.feeAgreements.find((agreement) => agreement.isActive)?.hourlyRateHtCents
      : undefined

  const handleTimerStop = (timer: RunningTimer): void => {
    const minutes = useTimerStore.getState().stop()
    if (minutes === null) return
    // Minutes are already rounded up to whole minutes by the store (min 1);
    // hours are then rounded to 2 decimals, so the minimum quantity is 0.02.
    const quantityHours = Math.round((minutes / 60) * 100) / 100
    setEditor({
      ...createEmptyEditor(),
      label: timer.label ?? '',
      quantity: formatNumberInput(quantityHours),
      unitPriceHt: formatMoneyInput(activeAgreementHourlyRateHtCents)
    })
    setEditorError(null)
    setEditorFromPrefill(false)
  }

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const activePresets = useMemo(
    () =>
      (catalog?.services ?? [])
        .filter((preset) => isCabinetServicePresetEligibleForBilling(preset))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [catalog?.services]
  )

  const defaultPreset =
    activePresets.find((preset) => preset.uuid === catalog?.defaultServiceUuid) ?? activePresets[0]

  useEffect(() => {
    if (prefillItem && editor === null) {
      setEditor(createEditorFromPrefill(prefillItem, defaultPreset))
      setEditorFromPrefill(true)
      onConsumePrefill?.()
    }
  }, [prefillItem, defaultPreset, editor, onConsumePrefill])

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.date.localeCompare(left.date)),
    [entries]
  )

  const totals = useMemo(() => {
    let subtotalHt = 0
    let discountHt = 0
    let totalHt = 0
    let totalTtc = 0
    for (const item of sortedEntries) {
      if (item.status === 'cancelled') continue
      subtotalHt += item.subtotalHtCents
      discountHt += item.discountHtCents
      totalHt += item.totalHtCents
      totalTtc += item.totalTtcCents
    }
    return { subtotalHt, discountHt, totalHt, totalTtc }
  }, [sortedEntries])

  const hasAnyDiscount = totals.discountHt > 0

  const selectedInvoiceItems = useMemo(
    () => sortedEntries.filter((item) => selectedInvoiceItemIds.has(item.uuid)),
    [sortedEntries, selectedInvoiceItemIds]
  )
  const selectionTotalTtc = selectedInvoiceItems.reduce((acc, item) => acc + item.totalTtcCents, 0)

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader
          badge={t('dossiers.billing_items_badge', { defaultValue: 'Prestations' })}
          count={sortedEntries.length || null}
          actions={
            <>
              <TimerControls
                dossierId={dossierId}
                dossierName={timerDossierName}
                disabled={disabled}
                onStop={handleTimerStop}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => setEditor(createEmptyEditor())}
              >
                {t('dossiers.billing_items_create_action', {
                  defaultValue: 'Nouvelle prestation'
                })}
              </Button>
            </>
          }
        />

        {catalogError ? <AlertBanner tone="error">{catalogError}</AlertBanner> : null}

        {selectedInvoiceItems.length > 0 ? (
          <div className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-aurora/30 bg-aurora/5 px-3 py-2 text-sm">
            <span className="text-ink">
              {t('dossiers.billing_items_selection_summary', {
                count: selectedInvoiceItems.length,
                total: formatEurosFromCents(selectionTotalTtc),
                defaultValue: '{{count}} prestation(s) sélectionnée(s) — {{total}} TTC'
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedInvoiceItemIds(new Set())}
                className="text-xs text-ink-muted underline-offset-2 hover:underline"
              >
                {t('dossiers.billing_items_deselect_all', { defaultValue: 'Tout désélectionner' })}
              </button>
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => setIsInvoiceDialogOpen(true)}
              >
                {t('dossiers.billing_items_generate_invoice', {
                  defaultValue: 'Générer une facture'
                })}
              </Button>
            </div>
          </div>
        ) : null}

        {sortedEntries.length === 0 ? (
          <p className="shrink-0 rounded-2xl border border-dashed border-hairline bg-white p-4 text-sm text-ink-muted">
            {t('dossiers.billing_items_empty', {
              defaultValue:
                'Aucune prestation enregistrée pour ce dossier. Ajoutez-en une ou convertissez une échéance.'
            })}
          </p>
        ) : (
          <ListContainer>
            <div className="flex h-full flex-col">
              <ColumnHeader>
                <span className="w-8 shrink-0" aria-hidden="true" />
                <span className="w-24 shrink-0">
                  {t('dossiers.billing_items_col_date', { defaultValue: 'Date' })}
                </span>
                <span className="min-w-0 flex-1">
                  {t('dossiers.billing_items_col_label', { defaultValue: 'Libellé' })}
                </span>
                <span className="w-20 shrink-0 text-right">
                  {t('dossiers.billing_items_col_qty', { defaultValue: 'Qté' })}
                </span>
                <span className="w-24 shrink-0 text-right">
                  {t('dossiers.billing_items_col_unit_price', { defaultValue: 'PU HT' })}
                </span>
                <span className="w-24 shrink-0 text-right">
                  {t('dossiers.billing_items_col_discount', { defaultValue: 'Remise' })}
                </span>
                <span className="w-24 shrink-0 text-right">
                  {t('dossiers.billing_items_col_total_ht', { defaultValue: 'Total HT' })}
                </span>
                <span className="w-28 shrink-0 text-right">
                  {t('dossiers.billing_items_col_total_ttc', { defaultValue: 'Total TTC' })}
                </span>
                <span className="w-24 shrink-0">
                  {t('dossiers.billing_items_col_status', { defaultValue: 'Statut' })}
                </span>
                <span className="w-28 shrink-0">
                  {t('dossiers.billing_items_col_invoice', { defaultValue: 'Facture' })}
                </span>
                <span className="w-16 shrink-0" aria-hidden="true" />
              </ColumnHeader>

              <ul className="min-h-0 flex-1 divide-y divide-deep-space overflow-y-auto">
                {sortedEntries.map((item) => (
                  <li
                    key={item.uuid}
                    className={`group flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-parchment-bright ${
                      item.status === 'cancelled' ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex w-8 shrink-0 items-center justify-center">
                      {item.status === 'draft' ? (
                        <input
                          type="checkbox"
                          checked={selectedInvoiceItemIds.has(item.uuid)}
                          onChange={() => toggleInvoiceSelection(item.uuid)}
                          aria-label="Inclure dans la facture"
                          className="h-4 w-4 cursor-pointer accent-aurora"
                        />
                      ) : null}
                    </div>
                    <div className="w-24 shrink-0">
                      <p className="text-sm tabular-nums text-ink">
                        {formatDisplayDate(item.date, locale)}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                      {item.description ? (
                        <p className="truncate text-xs text-ink-subtle">{item.description}</p>
                      ) : null}
                    </div>
                    <div className="w-20 shrink-0 text-right text-sm tabular-nums text-ink">
                      {item.quantity.toLocaleString(locale, { maximumFractionDigits: 2 })}{' '}
                      {quantityUnitLabel(item.quantityUnit, t)}
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm tabular-nums text-ink">
                      {formatEurosFromCents(item.unitPriceHtCents)}
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm tabular-nums text-ink">
                      {item.discountKind ? (
                        <div className="flex flex-col items-end">
                          <span>−{formatEurosFromCents(item.discountHtCents)}</span>
                          {item.discountKind === 'percent' ? (
                            <span className="text-[10px] text-ink-subtle">
                              {formatBasisPoints(item.discountPercentBasisPoints)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-ink-subtle">
                              {t('dossiers.billing_items_discount_amount_short', {
                                defaultValue: 'Montant'
                              })}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#c4c2b8]">—</span>
                      )}
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm tabular-nums text-ink">
                      {item.discountHtCents > 0 ? (
                        <div className="flex flex-col items-end">
                          <span>{formatEurosFromCents(item.totalHtCents)}</span>
                          <span className="text-[10px] text-ink-subtle line-through">
                            {formatEurosFromCents(item.subtotalHtCents)}
                          </span>
                        </div>
                      ) : (
                        formatEurosFromCents(item.totalHtCents)
                      )}
                    </div>
                    <div className="w-28 shrink-0 text-right text-sm tabular-nums text-ink">
                      <div>{formatEurosFromCents(item.totalTtcCents)}</div>
                      <div className="text-[10px] text-ink-subtle">
                        {t('dossiers.billing_items_vat_short', { defaultValue: 'TVA' })}{' '}
                        {formatBasisPoints(item.vatRateBasisPoints)}
                      </div>
                    </div>
                    <div className="w-24 shrink-0">
                      <span className="inline-flex rounded-full bg-parchment px-2 py-1 text-[11px] font-medium text-ink-muted">
                        {billingItemStatusLabel(item.status, t)}
                      </span>
                    </div>
                    <div className="w-28 shrink-0 text-sm">
                      {item.invoiceNumber ? (
                        <span
                          title={t('dossiers.billing_item_invoice_reference_title', {
                            defaultValue: 'Facturé sur {{number}}',
                            number: item.invoiceNumber
                          })}
                          className="inline-flex max-w-full rounded-full bg-aurora/10 px-2 py-1 text-[11px] font-medium tabular-nums text-aurora"
                        >
                          <span className="truncate">{item.invoiceNumber}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-[#c4c2b8]">—</span>
                      )}
                    </div>
                    <div className="relative flex w-16 shrink-0 justify-end gap-1">
                      {item.status !== 'billed' ? (
                        <div
                          className={
                            confirmingDeleteId === item.uuid ? 'invisible flex gap-1' : 'flex gap-1'
                          }
                        >
                          <IconButton
                            label={t('common.edit', { defaultValue: 'Modifier' })}
                            disabled={disabled}
                            onClick={() => {
                              setConfirmingDeleteId(null)
                              setEditor(createEditorFromItem(item))
                            }}
                          >
                            <PencilIcon />
                          </IconButton>
                          <IconButton
                            label={t('common.delete', { defaultValue: 'Supprimer' })}
                            tone="danger"
                            disabled={disabled}
                            onClick={() => setConfirmingDeleteId(item.uuid)}
                          >
                            <TrashIcon />
                          </IconButton>
                        </div>
                      ) : null}
                      {confirmingDeleteId === item.uuid ? (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2">
                          <DeleteConfirmTray
                            label={t('dossiers.billing_item_delete_confirm_label', {
                              defaultValue: 'Supprimer cette prestation ?'
                            })}
                            confirmLabel={t('dossiers.billing_item_delete_confirm_action', {
                              defaultValue: 'Confirmer'
                            })}
                            cancelLabel={t('dossiers.billing_item_delete_cancel_action', {
                              defaultValue: 'Annuler'
                            })}
                            disabled={disabled}
                            onConfirm={async () => {
                              await onDelete({ dossierId, billingItemUuid: item.uuid })
                              setConfirmingDeleteId(null)
                            }}
                            onCancel={() => setConfirmingDeleteId(null)}
                          />
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="shrink-0 border-t border-deep-space bg-parchment-bright">
                {hasAnyDiscount ? (
                  <>
                    <div className="flex items-center gap-3 px-4 py-1 text-xs text-ink-subtle">
                      <span className="w-8 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-right uppercase tracking-[0.08em]">
                        {t('dossiers.billing_items_subtotal_label', {
                          defaultValue: 'Sous-total HT'
                        })}
                      </span>
                      <span className="w-20 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        {formatEurosFromCents(totals.subtotalHt)}
                      </span>
                      <span className="w-28 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-28 shrink-0" aria-hidden="true" />
                      <span className="w-16 shrink-0" aria-hidden="true" />
                    </div>
                    <div className="flex items-center gap-3 px-4 py-1 text-xs text-ink-subtle">
                      <span className="w-8 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 text-right uppercase tracking-[0.08em]">
                        {t('dossiers.billing_items_discount_total_label', {
                          defaultValue: 'Remises'
                        })}
                      </span>
                      <span className="w-20 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        −{formatEurosFromCents(totals.discountHt)}
                      </span>
                      <span className="w-28 shrink-0" aria-hidden="true" />
                      <span className="w-24 shrink-0" aria-hidden="true" />
                      <span className="w-28 shrink-0" aria-hidden="true" />
                      <span className="w-16 shrink-0" aria-hidden="true" />
                    </div>
                  </>
                ) : null}
                <div className="flex items-center gap-3 border-t-2 border-hairline-strong px-4 py-2 text-sm font-semibold">
                  <span className="w-8 shrink-0" aria-hidden="true" />
                  <span className="w-24 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-right uppercase tracking-[0.08em] text-ink-muted">
                    {t('dossiers.billing_items_total_label', { defaultValue: 'Total' })}
                  </span>
                  <span className="w-20 shrink-0" aria-hidden="true" />
                  <span className="w-24 shrink-0" aria-hidden="true" />
                  <span className="w-24 shrink-0" aria-hidden="true" />
                  <span className="w-24 shrink-0 text-right tabular-nums">
                    {formatEurosFromCents(totals.totalHt)}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums">
                    {formatEurosFromCents(totals.totalTtc)}
                  </span>
                  <span className="w-24 shrink-0" aria-hidden="true" />
                  <span className="w-28 shrink-0" aria-hidden="true" />
                  <span className="w-16 shrink-0" aria-hidden="true" />
                </div>
              </div>
            </div>
          </ListContainer>
        )}
      </div>

      {editor ? (
        <DialogShell
          size="lg"
          panelClassName="max-w-4xl"
          aria-label={t('dossiers.billing_item_dialog_title', { defaultValue: 'Prestation' })}
          onDismiss={() => {
            closeEditorFromCancel()
          }}
        >
          <div>
            <h3 className="text-lg font-semibold text-ink">
              {editor.id
                ? t('dossiers.billing_item_dialog_title_edit', {
                    defaultValue: 'Modifier la prestation'
                  })
                : t('dossiers.billing_item_dialog_title_create', {
                    defaultValue: 'Nouvelle prestation'
                  })}
            </h3>
          </div>

          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              const payload = buildUpsertInput(dossierId, editor)
              if (!payload) {
                setEditorError(
                  t('dossiers.billing_item_validation', {
                    defaultValue: 'Complétez le libellé, la date, la quantité et le prix unitaire.'
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
                  setEditorFromPrefill(false)
                }
              } finally {
                setIsSaving(false)
              }
            }}
          >
            {editorError ? <AlertBanner tone="error">{editorError}</AlertBanner> : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
              <section className="flex min-w-0 flex-col gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-subtle">
                  {t('dossiers.billing_item_section_service', { defaultValue: 'Prestation' })}
                </h4>
                <Field
                  density="compact"
                  label={t('dossiers.billing_item_source_preset_label', {
                    defaultValue: 'Prestation cabinet'
                  })}
                >
                  <PresetCombobox
                    value={editor.sourceServicePresetUuid}
                    presets={activePresets}
                    onSelect={(preset) =>
                      setEditor((current) => {
                        if (!current) return current
                        if (!preset) return { ...current, sourceServicePresetUuid: '' }
                        const previous = activePresets.find(
                          (entry) => entry.uuid === current.sourceServicePresetUuid
                        )
                        return applyPresetToEditor(current, preset, previous)
                      })
                    }
                    freeEntryLabel={t('dossiers.billing_item_source_preset_empty', {
                      defaultValue: 'Saisie libre'
                    })}
                    searchPlaceholder={t('dossiers.billing_item_source_preset_search', {
                      defaultValue: 'Rechercher une prestation…'
                    })}
                  />
                </Field>
                <Field
                  density="compact"
                  label={t('dossiers.billing_item_label_label', { defaultValue: 'Libellé' })}
                >
                  <Input
                    density="compact"
                    value={editor.label}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, label: event.target.value } : current
                      )
                    }
                  />
                </Field>
                <Field
                  density="compact"
                  className="flex-1"
                  label={t('dossiers.billing_item_description_label', {
                    defaultValue: 'Description'
                  })}
                >
                  <Textarea
                    density="compact"
                    rows={2}
                    className="min-h-32 flex-1 resize-none"
                    value={editor.description}
                    onChange={(event) =>
                      setEditor((current) =>
                        current ? { ...current, description: event.target.value } : current
                      )
                    }
                  />
                </Field>
              </section>

              <section className="flex min-w-0 flex-col gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-subtle">
                  {t('dossiers.billing_item_section_pricing', { defaultValue: 'Tarification' })}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    density="compact"
                    label={t('dossiers.billing_item_quantity_label', { defaultValue: 'Quantité' })}
                  >
                    <Input
                      density="compact"
                      inputMode="decimal"
                      value={editor.quantity}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, quantity: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    density="compact"
                    label={t('dossiers.billing_item_unit_label', { defaultValue: 'Unité' })}
                  >
                    <Select
                      density="compact"
                      value={editor.quantityUnit}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? {
                                ...current,
                                quantityUnit: event.target.value as BillingItemQuantityUnit
                              }
                            : current
                        )
                      }
                    >
                      <option value="hours">
                        {t('dossiers.billing_item_unit_option_hours', { defaultValue: 'Heures' })}
                      </option>
                      <option value="units">
                        {t('dossiers.billing_item_unit_option_units', { defaultValue: 'Unités' })}
                      </option>
                    </Select>
                  </Field>
                  <Field
                    density="compact"
                    label={t('dossiers.billing_item_unit_price_label', {
                      defaultValue: 'PU HT (€)'
                    })}
                  >
                    <Input
                      density="compact"
                      inputMode="decimal"
                      value={editor.unitPriceHt}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, unitPriceHt: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    density="compact"
                    label={t('cabinet.vat_rate_label', { defaultValue: 'TVA (%)' })}
                  >
                    <Input
                      density="compact"
                      inputMode="decimal"
                      value={editor.vatRate}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, vatRate: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-3 border-t border-[#ece9df] pt-3">
                  <DossierDiscountFields
                    density="compact"
                    mode={editor.discountMode}
                    percent={editor.discountPercent}
                    amount={editor.discountAmount}
                    modeLabel={t('dossiers.billing_item_discount_mode_label', {
                      defaultValue: 'Remise commerciale'
                    })}
                    noneLabel={t('dossiers.billing_item_discount_mode_none', {
                      defaultValue: 'Aucune'
                    })}
                    percentModeLabel={t('dossiers.billing_item_discount_mode_percent', {
                      defaultValue: 'En pourcentage'
                    })}
                    amountModeLabel={t('dossiers.billing_item_discount_mode_amount', {
                      defaultValue: 'Montant fixe'
                    })}
                    percentLabel={t('dossiers.billing_item_discount_percent_label', {
                      defaultValue: 'Remise (%)'
                    })}
                    amountLabel={t('dossiers.billing_item_discount_amount_label', {
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

                <div className="grid gap-3 border-t border-[#ece9df] pt-3 sm:grid-cols-2">
                  <Field
                    density="compact"
                    label={t('dossiers.billing_item_date_label', { defaultValue: 'Date' })}
                  >
                    <Input
                      density="compact"
                      type="date"
                      value={editor.date}
                      onChange={(event) =>
                        setEditor((current) =>
                          current ? { ...current, date: event.target.value } : current
                        )
                      }
                    />
                  </Field>
                  <Field
                    density="compact"
                    label={t('dossiers.billing_item_status_label', { defaultValue: 'Statut' })}
                  >
                    <Select
                      density="compact"
                      value={editor.status}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? { ...current, status: event.target.value as BillingItemStatus }
                            : current
                        )
                      }
                    >
                      {BILLING_ITEM_STATUS_VALUES.map((status) => (
                        <option key={status} value={status}>
                          {billingItemStatusLabel(status, t)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </section>
            </div>

            {(() => {
              const totals = computeBillingTotalsFromEditor({
                quantity: editor.quantity,
                unitPriceHt: editor.unitPriceHt,
                vatRate: editor.vatRate,
                discount: editor
              })
              const hasDiscount = totals.discountHtCents > 0
              return (
                <div className="my-3 flex flex-wrap items-baseline justify-end gap-x-6 gap-y-2 border-t border-[#ece9df] py-4 tabular-nums">
                  {hasDiscount ? (
                    <>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="text-xs text-ink-subtle">
                          {t('dossiers.billing_item_preview_subtotal', {
                            defaultValue: 'Sous-total HT'
                          })}
                        </span>
                        <span className="text-ink">
                          {formatEurosFromCents(totals.subtotalHtCents)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 text-sm">
                        <span className="text-xs text-ink-subtle">
                          {t('dossiers.billing_item_preview_discount', {
                            defaultValue: 'Remise'
                          })}
                        </span>
                        <span className="text-[#b23a3a]">
                          -{formatEurosFromCents(totals.discountHtCents)}
                        </span>
                      </div>
                    </>
                  ) : null}
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="text-xs text-ink-subtle">
                      {t('dossiers.billing_item_preview_total_ht', { defaultValue: 'Total HT' })}
                    </span>
                    <span className="text-ink">{formatEurosFromCents(totals.totalHtCents)}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-muted">
                      {t('dossiers.billing_item_preview_total_ttc', { defaultValue: 'Total TTC' })}
                    </span>
                    <span className="text-lg font-semibold text-ink">
                      {formatEurosFromCents(totals.totalTtcCents)}
                    </span>
                  </div>
                </div>
              )
            })()}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isSaving}
                onClick={() => {
                  closeEditorFromCancel()
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

      {isInvoiceDialogOpen ? (
        <InvoiceCreationDialog
          dossierId={dossierId}
          selectedItems={selectedInvoiceItems}
          onClose={() => setIsInvoiceDialogOpen(false)}
          onCreated={() => {
            setSelectedInvoiceItemIds(new Set())
          }}
        />
      ) : null}
    </>
  )
}
