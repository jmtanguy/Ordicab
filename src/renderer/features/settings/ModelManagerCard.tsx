import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelDownloadStatus, ModelReadiness } from '@shared/types'

import { Button, Card } from '@renderer/components/ui'
import { getOrdicabApi } from '@renderer/stores/ipc'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ReadinessBadge({ state }: { state: ModelReadiness }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t(`models.status_${state}`)
  const tone =
    state === 'ready'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : state === 'error'
        ? 'border-destructive-border bg-destructive-tint text-destructive'
        : state === 'downloading'
          ? 'border-sky-300 bg-sky-50 text-sky-700'
          : 'border-hairline bg-white text-ink-muted'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  )
}

function ModelRow({
  label,
  help,
  state
}: {
  label: string
  help: string
  state: ModelReadiness
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-hairline bg-white px-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">{help}</p>
      </div>
      <ReadinessBadge state={state} />
    </div>
  )
}

export function ModelManagerCard(): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ModelDownloadStatus | null>(null)

  useEffect(() => {
    const api = getOrdicabApi()
    if (!api?.models) return

    let cancelled = false
    void api.models.getStatus().then((res) => {
      if (!cancelled && res.success) setStatus(res.data)
    })

    // Live progress + readiness changes pushed from the main process.
    const unsubscribe = api.models.onStatusChanged((next) => setStatus(next))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const handleDownload = useCallback(async () => {
    const api = getOrdicabApi()
    if (!api?.models) return
    await api.models.download()
  }, [])

  const isDownloading = status?.ner === 'downloading' || status?.embedding === 'downloading'
  const allReady = status?.ner === 'ready' && status?.embedding === 'ready'

  const progressText = (() => {
    const p = status?.progress
    if (!p) return null
    const received = formatBytes(p.receivedBytes)
    if (p.totalBytes && p.totalBytes > 0) {
      return t('models.progress_label', {
        file: p.file,
        received,
        total: formatBytes(p.totalBytes)
      })
    }
    return t('models.progress_unknown_total', { file: p.file, received })
  })()

  return (
    <Card className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-ink">{t('models.section_title')}</h3>
        <p className="text-sm text-ink">{t('models.section_summary')}</p>
      </div>

      <div className="space-y-2">
        <ModelRow
          label={t('models.ner_label')}
          help={t('models.ner_help')}
          state={status?.ner ?? 'missing'}
        />
        <ModelRow
          label={t('models.embedding_label')}
          help={t('models.embedding_help')}
          state={status?.embedding ?? 'missing'}
        />
      </div>

      {progressText ? <p className="text-xs text-ink-muted">{progressText}</p> : null}
      {status?.error ? <p className="text-xs text-destructive">{status.error}</p> : null}

      {!allReady ? (
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={handleDownload} disabled={isDownloading}>
            {isDownloading ? t('models.downloading_action') : t('models.download_action')}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
