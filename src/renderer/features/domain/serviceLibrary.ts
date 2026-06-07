import { DEFAULT_CABINET_SERVICE_GROUP } from '@shared/types'
import type { CabinetServicePresetUpsertInput } from '@shared/types'
import { SERVICE_LIBRARY_THEMES, type ServiceLibraryItem } from '@shared/serviceCatalogLibrary'

export interface ServiceLibraryImportEntry {
  item: ServiceLibraryItem
  group: string
}

/** All library services as import entries, used for a one-click "import everything". */
export function allServiceLibraryEntries(): ServiceLibraryImportEntry[] {
  return SERVICE_LIBRARY_THEMES.flatMap((theme) =>
    theme.items.map((item) => ({ item, group: theme.label }))
  )
}

/** Maps a library item to a cabinet-service upsert payload. Shared by the cabinet panel and the onboarding wizard. */
export function serviceLibraryEntryToUpsert(
  entry: ServiceLibraryImportEntry
): CabinetServicePresetUpsertInput {
  const { item, group } = entry
  return {
    name: item.name,
    description: item.description,
    group: group || DEFAULT_CABINET_SERVICE_GROUP,
    usage: item.usage,
    billingType: item.billingType,
    flatFeeHtCents: item.flatFeeHtCents,
    hourlyRateHtCents: item.hourlyRateHtCents,
    estimatedHours: item.estimatedHours,
    retainerHtCents: item.retainerHtCents,
    successFeePercentBasisPoints: item.successFeePercentBasisPoints,
    vatRateBasisPoints: item.vatRateBasisPoints,
    paymentTerms: item.paymentTerms,
    expenseTerms: item.expenseTerms
  }
}
