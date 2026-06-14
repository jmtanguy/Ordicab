import type {
  BillingItemDiscountKind,
  CabinetServicePreset,
  DossierBillingItemUpsertInput,
  DossierFeeAgreement,
  KeyDate,
  SourceFeeAgreementBillingKind
} from './types'

export function applyVatRate(
  amountCents: number | undefined,
  vatRateBasisPoints: number | undefined
): number | undefined {
  if (typeof amountCents !== 'number') {
    return undefined
  }

  const rate = typeof vatRateBasisPoints === 'number' ? vatRateBasisPoints : 0
  return Math.round(amountCents * (1 + rate / 10_000))
}

interface BillingItemTotals {
  subtotalHtCents: number
  discountHtCents: number
  totalHtCents: number
  totalTtcCents: number
}

export function computeBillingItemTotals(input: {
  quantity: number
  unitPriceHtCents: number
  vatRateBasisPoints: number
  discountKind?: BillingItemDiscountKind
  discountPercentBasisPoints?: number
  discountAmountHtCents?: number
}): BillingItemTotals {
  const subtotalHtCents = Math.max(0, Math.round(input.quantity * input.unitPriceHtCents))

  let discountHtCents = 0
  if (input.discountKind === 'percent') {
    const bp = input.discountPercentBasisPoints ?? 0
    const clampedBp = Math.min(10_000, Math.max(0, bp))
    discountHtCents = Math.round((subtotalHtCents * clampedBp) / 10_000)
  } else if (input.discountKind === 'amount') {
    discountHtCents = Math.max(0, Math.round(input.discountAmountHtCents ?? 0))
  }

  discountHtCents = Math.min(discountHtCents, subtotalHtCents)
  const totalHtCents = subtotalHtCents - discountHtCents
  const totalTtcCents = applyVatRate(totalHtCents, input.vatRateBasisPoints) ?? totalHtCents

  return { subtotalHtCents, discountHtCents, totalHtCents, totalTtcCents }
}

export interface LegalAidPartialAmounts {
  /** Part prise en charge par l'État, en centimes HT. */
  stateRetributionHtCents: number
  /** Complément d'honoraires effectivement facturable au client (plafonné), en centimes HT. */
  negotiatedComplementHtCents: number
  /** Plafond du complément, en centimes HT. */
  complementCapHtCents: number
  /** Indique si le complément demandé a été écrêté au plafond. */
  complementCapped: boolean
  /** Mention légale à reporter sur la convention/facture (sous réserve de validation juridique). */
  legalNote: string
}

/**
 * Calcule les parts d'une AJ partielle : part État (fixée), complément négocié
 * facturé au client, plafonné par défaut à `total honoraires − rétribution État`.
 *
 * ⚠️ Le plafond et la mention légale sont des hypothèses à valider juridiquement.
 */
export function computeLegalAidPartialAmounts(input: {
  totalHonorairesHtCents: number
  shareBasisPoints: number
  stateRetributionHtCents: number
  requestedComplementHtCents: number
}): LegalAidPartialAmounts {
  const stateRetributionHtCents = Math.max(0, Math.round(input.stateRetributionHtCents))
  const complementCapHtCents = Math.max(
    0,
    Math.round(input.totalHonorairesHtCents) - stateRetributionHtCents
  )
  const requested = Math.max(0, Math.round(input.requestedComplementHtCents))
  const negotiatedComplementHtCents = Math.min(requested, complementCapHtCents)
  const complementCapped = requested > complementCapHtCents
  const sharePercent = (input.shareBasisPoints / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: input.shareBasisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })
  const legalNote =
    `Bénéficiaire de l'aide juridictionnelle partielle (prise en charge de ${sharePercent} % ` +
    `par l'État). Un complément d'honoraires de ${formatEurosCents(negotiatedComplementHtCents)} HT, ` +
    `librement négocié, reste à la charge du client conformément à l'article 35 de la loi n° 91-647 du 10 juillet 1991.`
  return {
    stateRetributionHtCents,
    negotiatedComplementHtCents,
    complementCapHtCents,
    complementCapped,
    legalNote
  }
}

function joinDescription(parts: Array<string | undefined>): string | undefined {
  const cleaned = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
  return cleaned.length > 0 ? cleaned.join('\n') : undefined
}

function formatEurosCents(amountCents: number): string {
  const euros = amountCents / 100
  return `${euros.toLocaleString('fr-FR', {
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })} €`
}

function formatBasisPointsPercent(basisPoints: number): string {
  const percent = basisPoints / 100
  return `${percent.toLocaleString('fr-FR', {
    minimumFractionDigits: basisPoints % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })} %`
}

function formatFeeAgreementPricingLine(agreement: DossierFeeAgreement): string | undefined {
  const tokens: string[] = []
  if (typeof agreement.flatFeeHtCents === 'number' && agreement.flatFeeHtCents > 0) {
    tokens.push(`forfait ${formatEurosCents(agreement.flatFeeHtCents)} HT`)
  }
  if (typeof agreement.hourlyRateHtCents === 'number' && agreement.hourlyRateHtCents > 0) {
    const rate = `taux horaire ${formatEurosCents(agreement.hourlyRateHtCents)} HT`
    if (typeof agreement.estimatedHours === 'number' && agreement.estimatedHours > 0) {
      const hoursLabel = agreement.estimatedHours.toLocaleString('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      })
      tokens.push(`${rate} (${hoursLabel} h estimées)`)
    } else {
      tokens.push(rate)
    }
  }
  if (typeof agreement.retainerHtCents === 'number' && agreement.retainerHtCents > 0) {
    tokens.push(`provision ${formatEurosCents(agreement.retainerHtCents)} HT`)
  }
  if (
    typeof agreement.successFeePercentBasisPoints === 'number' &&
    agreement.successFeePercentBasisPoints > 0
  ) {
    tokens.push(
      `honoraires de résultat ${formatBasisPointsPercent(agreement.successFeePercentBasisPoints)}`
    )
  }
  if (agreement.discountKind === 'percent') {
    tokens.push(`remise ${formatBasisPointsPercent(agreement.discountPercentBasisPoints ?? 0)}`)
  } else if (agreement.discountKind === 'amount') {
    tokens.push(`remise ${formatEurosCents(agreement.discountAmountHtCents ?? 0)} HT`)
  }
  return tokens.length > 0 ? `Convention : ${tokens.join(' · ')}` : undefined
}

function getFeeAgreementBillingBase(agreement: DossierFeeAgreement): {
  quantity: number
  unitPriceHtCents: number
} {
  const hasFlat = typeof agreement.flatFeeHtCents === 'number' && agreement.flatFeeHtCents > 0
  const quantity = hasFlat
    ? 1
    : typeof agreement.estimatedHours === 'number' && agreement.estimatedHours > 0
      ? agreement.estimatedHours
      : 1
  const unitPriceHtCents = hasFlat
    ? (agreement.flatFeeHtCents ?? 0)
    : (agreement.hourlyRateHtCents ?? 0)

  return { quantity, unitPriceHtCents }
}

interface FeeAgreementBillingAmounts {
  subtotalHtCents: number
  discountHtCents: number
  totalAfterDiscountHtCents: number
  retainerHtCents: number
  finalBalanceHtCents: number
}

export function computeFeeAgreementBillingAmounts(
  agreement: DossierFeeAgreement
): FeeAgreementBillingAmounts {
  const base = getFeeAgreementBillingBase(agreement)
  const totals = computeBillingItemTotals({
    quantity: base.quantity,
    unitPriceHtCents: base.unitPriceHtCents,
    vatRateBasisPoints: agreement.vatRateBasisPoints,
    discountKind: agreement.discountKind,
    discountPercentBasisPoints: agreement.discountPercentBasisPoints,
    discountAmountHtCents: agreement.discountAmountHtCents
  })
  const retainerHtCents = Math.max(0, agreement.retainerHtCents ?? 0)
  const finalBalanceHtCents = Math.max(0, totals.totalHtCents - retainerHtCents)

  return {
    subtotalHtCents: totals.subtotalHtCents,
    discountHtCents: totals.discountHtCents,
    totalAfterDiscountHtCents: totals.totalHtCents,
    retainerHtCents,
    finalBalanceHtCents
  }
}

function formatFeeAgreementRetainerLine(amounts: FeeAgreementBillingAmounts): string {
  return `Facture de provision : provision ${formatEurosCents(amounts.retainerHtCents)} HT.`
}

function formatFeeAgreementFinalBalanceLine(amounts: FeeAgreementBillingAmounts): string {
  const tokens = [`total ${formatEurosCents(amounts.subtotalHtCents)} HT`]
  if (amounts.discountHtCents > 0) {
    tokens.push(`remise ${formatEurosCents(amounts.discountHtCents)} HT`)
  }
  if (amounts.retainerHtCents > 0) {
    tokens.push(`provision ${formatEurosCents(amounts.retainerHtCents)} HT`)
  }
  return `Facture finale : ${tokens.join(' - ')} = solde ${formatEurosCents(
    amounts.finalBalanceHtCents
  )} HT.`
}

function formatKeyDateContextLine(keyDate: KeyDate): string | undefined {
  const tokens: string[] = []
  if (keyDate.time) {
    tokens.push(keyDate.time)
  }
  if (typeof keyDate.duration === 'number' && keyDate.duration > 0) {
    const hours = Math.floor(keyDate.duration / 60)
    const minutes = keyDate.duration % 60
    if (hours > 0 && minutes > 0) {
      tokens.push(`${hours}h${String(minutes).padStart(2, '0')}`)
    } else if (hours > 0) {
      tokens.push(`${hours}h`)
    } else {
      tokens.push(`${minutes} min`)
    }
  }
  const tagList = (keyDate.tags ?? []).filter((tag) => tag && tag.length > 0)
  if (tagList.length > 0) {
    tokens.push(tagList.join(', '))
  }
  return tokens.length > 0 ? tokens.join(' · ') : undefined
}

export function buildBillingItemFromKeyDate(
  keyDate: KeyDate,
  defaultPreset?: CabinetServicePreset
): DossierBillingItemUpsertInput {
  const quantityHours = keyDate.duration ? Math.max(0, keyDate.duration / 60) : 1
  const description = joinDescription([keyDate.note, formatKeyDateContextLine(keyDate)])
  return {
    dossierId: keyDate.dossierId,
    date: keyDate.date,
    label: keyDate.label,
    description,
    sourceServicePresetUuid: defaultPreset?.uuid,
    quantity: quantityHours,
    quantityUnit: 'hours',
    unitPriceHtCents: defaultPreset?.hourlyRateHtCents ?? defaultPreset?.flatFeeHtCents ?? 0,
    vatRateBasisPoints: defaultPreset?.vatRateBasisPoints ?? 2000,
    status: 'draft',
    sourceKeyDateUuid: keyDate.uuid
  }
}

export function buildBillingItemFromFeeAgreement(
  agreement: DossierFeeAgreement,
  options: {
    dossierId: string
    today: string
    conversionKind?: SourceFeeAgreementBillingKind
  }
): DossierBillingItemUpsertInput {
  const conversionKind = options.conversionKind ?? 'finalBalance'

  // Parts d'aide juridictionnelle : rétribution État et complément client,
  // facturées séparément (deux items distincts).
  if (conversionKind === 'stateRetribution') {
    const stateRetributionHtCents = Math.max(0, agreement.stateRetributionHtCents ?? 0)
    const vatRateBasisPoints = agreement.legalAidVatExempt ? 0 : agreement.vatRateBasisPoints
    return {
      dossierId: options.dossierId,
      date: options.today,
      label: `Rétribution AJ - État - ${agreement.matterLabel}`,
      description: joinDescription([
        agreement.scopeDescription,
        agreement.notes,
        `Rétribution au titre de l'aide juridictionnelle : ${formatEurosCents(
          stateRetributionHtCents
        )} HT.`,
        agreement.legalAidVatExempt ? 'Rétribution exonérée de TVA.' : undefined
      ]),
      sourceServicePresetUuid: agreement.sourceServicePresetUuid,
      quantity: 1,
      quantityUnit: 'units',
      unitPriceHtCents: stateRetributionHtCents,
      vatRateBasisPoints,
      status: 'draft',
      sourceFeeAgreementUuid: agreement.uuid,
      sourceFeeAgreementBillingKind: conversionKind
    }
  }

  if (conversionKind === 'legalAidComplement') {
    const complementHtCents = Math.max(0, agreement.complementHtCents ?? 0)
    return {
      dossierId: options.dossierId,
      date: options.today,
      label: `Complément d'honoraires - AJ partielle - ${agreement.matterLabel}`,
      description: joinDescription([
        agreement.scopeDescription,
        agreement.notes,
        `Complément d'honoraires librement négocié : ${formatEurosCents(complementHtCents)} HT.`
      ]),
      sourceServicePresetUuid: agreement.sourceServicePresetUuid,
      quantity: 1,
      quantityUnit: 'units',
      unitPriceHtCents: complementHtCents,
      vatRateBasisPoints: agreement.vatRateBasisPoints,
      status: 'draft',
      sourceFeeAgreementUuid: agreement.uuid,
      sourceFeeAgreementBillingKind: conversionKind
    }
  }

  const amounts = computeFeeAgreementBillingAmounts(agreement)
  const unitPriceHtCents =
    conversionKind === 'retainer' ? amounts.retainerHtCents : amounts.finalBalanceHtCents
  const description = joinDescription([
    agreement.scopeDescription,
    agreement.notes,
    formatFeeAgreementPricingLine(agreement),
    conversionKind === 'retainer'
      ? formatFeeAgreementRetainerLine(amounts)
      : formatFeeAgreementFinalBalanceLine(amounts)
  ])

  return {
    dossierId: options.dossierId,
    date: options.today,
    label:
      conversionKind === 'retainer'
        ? `Provision - ${agreement.matterLabel}`
        : `Solde final - ${agreement.matterLabel}`,
    description,
    sourceServicePresetUuid: agreement.sourceServicePresetUuid,
    quantity: 1,
    quantityUnit: 'units',
    unitPriceHtCents,
    vatRateBasisPoints: agreement.vatRateBasisPoints,
    status: 'draft',
    sourceFeeAgreementUuid: agreement.uuid,
    sourceFeeAgreementBillingKind: conversionKind
  }
}
