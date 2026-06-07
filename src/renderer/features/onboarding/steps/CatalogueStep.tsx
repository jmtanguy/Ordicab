import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { ServiceLibraryDialog } from '@renderer/features/domain/CabinetPanel'
import {
  allServiceLibraryEntries,
  serviceLibraryEntryToUpsert
} from '@renderer/features/domain/serviceLibrary'
import { useCabinetBillingStore } from '@renderer/stores'

import { StepShell } from './StepShell'

interface CatalogueStepProps {
  /** Called once at least one service has been imported into the catalogue. */
  onComplete: () => void
}

/**
 * Step 3 — seed the billing catalogue. Reuses the exported {@link ServiceLibraryDialog}
 * for a curated import, plus a one-click "import everything" path. The service catalogue
 * is otherwise not auto-installed, so this is the only guided entry point for new users.
 */
export function CatalogueStep({ onComplete }: CatalogueStepProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const catalog = useCabinetBillingStore((state) => state.catalog)
  const loadCatalog = useCabinetBillingStore((state) => state.load)
  const upsertService = useCabinetBillingStore((state) => state.upsertService)

  const [libraryOpen, setLibraryOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const serviceCount = catalog?.services.length ?? 0
  const hasServices = serviceCount > 0

  const importAll = async (): Promise<void> => {
    setIsImporting(true)
    try {
      const entries = allServiceLibraryEntries()
      for (const entry of entries) {
        await upsertService(serviceLibraryEntryToUpsert(entry))
      }
      showToast(
        t('onboarding.catalogue_imported_toast', {
          count: entries.length,
          defaultValue: `${entries.length} prestations importées.`
        })
      )
      onComplete()
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <StepShell
      title={t('onboarding.catalogue_step_title', { defaultValue: 'Catalogue de prestations' })}
      description={t('onboarding.catalogue_step_hint', {
        defaultValue:
          "Importez des prestations types prêtes à l'emploi. Vous pourrez les modifier ensuite."
      })}
    >
      <Card className="space-y-4 p-5">
        {hasServices ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#f1f7ec] px-2 py-0.5 text-xs font-medium text-[#3c6132]">
              ✓
            </span>
            <p className="text-sm text-[#1a1a1a]">
              {t('onboarding.catalogue_count', {
                count: serviceCount,
                defaultValue: `${serviceCount} prestation(s) dans votre catalogue.`
              })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[#5c5c5a]">
            {t('cabinet.library_dialog_description', {
              defaultValue:
                "Prestations types prêtes à l'emploi. Importez celles qui vous intéressent — elles seront copiées dans votre catalogue et resteront éditables. Tarifs indicatifs 2026."
            })}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void importAll()} disabled={isImporting}>
            {t('onboarding.catalogue_import_all', { defaultValue: 'Tout importer' })}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setLibraryOpen(true)}>
            {t('onboarding.catalogue_open_library', {
              defaultValue: 'Choisir dans la bibliothèque'
            })}
          </Button>
        </div>
      </Card>

      {libraryOpen ? (
        <ServiceLibraryDialog
          onDismiss={() => setLibraryOpen(false)}
          onImport={async (entries) => {
            for (const entry of entries) {
              await upsertService(serviceLibraryEntryToUpsert(entry))
            }
            showToast(
              t('onboarding.catalogue_imported_toast', {
                count: entries.length,
                defaultValue: `${entries.length} prestations importées.`
              })
            )
            onComplete()
          }}
        />
      ) : null}
    </StepShell>
  )
}
