import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelDownloadStatus, ModelReadiness } from '@shared/types'

import { Button, DialogShell } from '@renderer/components/ui'
import { getOrdicabApi } from '@renderer/stores/ipc'

function ModelLine({
  label,
  why,
  state,
  fraction
}: {
  label: string
  why: string
  state: ModelReadiness
  fraction: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const pct = state === 'ready' ? 100 : fraction !== null ? Math.round(fraction * 100) : null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-[#1a1a1a]">{label}</p>
        <span className="shrink-0 text-xs text-[#5c5c5a]">{t(`models.status_${state}`)}</span>
      </div>
      <p className="text-xs leading-relaxed text-[#8a8a85]">{why}</p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5e3da]">
        <div
          className={`h-full rounded-full transition-all ${state === 'error' ? 'bg-[#9c2f2f]' : 'bg-aurora'}`}
          style={{ width: `${state === 'ready' ? 100 : (pct ?? (state === 'downloading' ? 6 : 0))}%` }}
        />
      </div>
    </div>
  )
}

/**
 * First-launch modal that explains why Ordicab downloads its local AI models
 * and shows live progress. It appears automatically while a model is missing or
 * downloading, reassures the user it's a one-time step, and lets them dismiss it
 * to continue in the background. It never reappears once both models are ready.
 */
export function ModelDownloadDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ModelDownloadStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const api = getOrdicabApi()
    if (!api?.models) return
    void api.models.getStatus().then((res) => {
      if (res.success) setStatus(res.data)
    })
    return api.models.onStatusChanged((next) => setStatus(next))
  }, [])

  const allReady = status?.ner === 'ready' && status?.embedding === 'ready'

  // The progress fraction applies to whichever model is currently downloading.
  const progressFraction = useMemo(() => {
    const p = status?.progress
    if (!p || !p.totalBytes || p.totalBytes <= 0) return null
    // Blend file index with in-file bytes for a smoother per-model bar.
    const perFile = p.receivedBytes / p.totalBytes
    return (p.fileIndex + perFile) / p.fileCount
  }, [status?.progress])

  const downloadingModelId = status?.progress?.modelId ?? null

  if (!status || allReady || dismissed) return null
  // Only surface the dialog when there's actually work to show.
  const hasWork =
    status.ner !== 'ready' || status.embedding !== 'ready' || status.progress !== null
  if (!hasWork) return null

  const readyCount = [status.ner, status.embedding].filter((s) => s === 'ready').length

  return (
    <DialogShell size="lg" panelClassName="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[#1a1a1a]">{t('models.dialog_title')}</h2>
        <p className="text-sm leading-relaxed text-[#1a1a1a]">{t('models.dialog_intro')}</p>
        <p className="text-sm font-medium leading-relaxed text-aurora">{t('models.dialog_once')}</p>
      </div>

      <div className="space-y-4">
        <ModelLine
          label={t('models.ner_label')}
          why={t('models.dialog_ner_why')}
          state={status.ner}
          fraction={
            downloadingModelId && status.ner === 'downloading' ? progressFraction : null
          }
        />
        <ModelLine
          label={t('models.embedding_label')}
          why={t('models.dialog_embedding_why')}
          state={status.embedding}
          fraction={
            downloadingModelId && status.embedding === 'downloading' ? progressFraction : null
          }
        />
      </div>

      {status.error ? <p className="text-xs text-[#9c2f2f]">{status.error}</p> : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[#5c5c5a]">
          {t('models.dialog_overall', { done: readyCount, total: 2 })}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          {t('models.dialog_continue')}
        </Button>
      </div>
    </DialogShell>
  )
}
