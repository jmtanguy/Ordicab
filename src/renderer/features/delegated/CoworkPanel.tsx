/**
 * CoworkPanel — one-click pseudonymized export of the active dossier to its
 * Cowork/ workspace, plus re-import of Claude Cowork deliverables with the
 * original identities restored. Hosted by CoworkPage (the dedicated dossier
 * section); independent of the active AI mode — remote API and Claude Cowork
 * can both be active at the same time.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '@renderer/components/ui'
import { useToast } from '@renderer/contexts/ToastContext'
import { useCoworkStore } from '@renderer/stores/coworkStore'
import { useUiStore } from '@renderer/stores/uiStore'

interface CoworkPanelProps {
  dossierId: string
}

export function CoworkPanel({ dossierId }: CoworkPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const openFolder = useUiStore((state) => state.openFolder)

  const status = useCoworkStore((state) => state.statusByDossier[dossierId])
  const isExporting = useCoworkStore((state) => state.isExporting)
  const isReimporting = useCoworkStore((state) => state.isReimporting)
  const progress = useCoworkStore((state) => state.progress)
  const error = useCoworkStore((state) => state.error)
  const refreshStatus = useCoworkStore((state) => state.refreshStatus)
  const exportDossier = useCoworkStore((state) => state.exportDossier)
  const reimportResults = useCoworkStore((state) => state.reimportResults)
  const subscribeToExportProgress = useCoworkStore((state) => state.subscribeToExportProgress)
  const clearError = useCoworkStore((state) => state.clearError)

  useEffect(() => {
    void refreshStatus(dossierId)
  }, [dossierId, refreshStatus])

  useEffect(() => subscribeToExportProgress(), [subscribeToExportProgress])

  useEffect(() => {
    if (error) {
      showToast(error, 'error')
      clearError()
    }
  }, [error, showToast, clearError])

  const pendingCount = status?.pendingResultCount ?? 0
  const lastExportAt = status?.lastExportAt ?? null

  const handleExport = async (): Promise<void> => {
    const result = await exportDossier(dossierId)
    if (result) {
      showToast(
        t('cowork.exportDone', {
          count: result.documentCount,
          skipped: result.unextractedCount
        }),
        'success'
      )
    }
  }

  const handleReimport = async (): Promise<void> => {
    const result = await reimportResults(dossierId)
    if (result) {
      if (result.imported.length === 0 && result.manual.length === 0) {
        showToast(t('cowork.reimportEmpty'), 'warning')
        return
      }
      showToast(t('cowork.reimportDone', { count: result.imported.length }), 'success')
      if (result.manual.length > 0) {
        showToast(
          t('cowork.reimportManual', {
            files: result.manual.map((entry) => entry.filename).join(', ')
          }),
          'warning'
        )
      }
    }
  }

  const handleOpenFolder = (): void => {
    const path = status?.exportPath
    if (!path) return
    void openFolder(path).then((result) => {
      if (!result.success) showToast(result.error, 'error')
    })
  }

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('cowork.title')}</h3>
          <p className="text-xs text-ink-muted">
            {isExporting && progress
              ? t('cowork.exportProgress', {
                  current: progress.current,
                  total: progress.total,
                  filename: progress.filename
                })
              : lastExportAt
                ? t('cowork.lastExport', {
                    date: new Date(lastExportAt).toLocaleString()
                  })
                : t('cowork.neverExported')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={isExporting || isReimporting}
            onClick={() => void handleExport()}
          >
            {isExporting ? t('cowork.exporting') : t('cowork.exportButton')}
          </Button>
          {lastExportAt && (
            <Button size="sm" variant="ghost" onClick={handleOpenFolder}>
              {t('cowork.openFolder')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pendingCount === 0 || isExporting || isReimporting}
            onClick={() => void handleReimport()}
          >
            {isReimporting
              ? t('cowork.reimporting')
              : t('cowork.reimportButton', { count: pendingCount })}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{t('cowork.description')}</p>
    </Card>
  )
}
