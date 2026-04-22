import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui'
import { useUpdaterStore } from '@renderer/stores'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

export function UpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useUpdaterStore((state) => state.status)
  const progress = useUpdaterStore((state) => state.progress)
  const subscribe = useUpdaterStore((state) => state.subscribe)
  const unsubscribe = useUpdaterStore((state) => state.unsubscribe)
  const startDownload = useUpdaterStore((state) => state.startDownload)
  const installNow = useUpdaterStore((state) => state.installNow)
  const installOnQuit = useUpdaterStore((state) => state.installOnQuit)
  const dismiss = useUpdaterStore((state) => state.dismiss)

  useEffect(() => {
    subscribe()
    return () => {
      unsubscribe()
    }
  }, [subscribe, unsubscribe])

  if (status.kind === 'idle' || status.kind === 'checking') {
    return null
  }

  const percent =
    status.kind === 'downloading' && progress ? Math.min(100, Math.max(0, progress.percent)) : 0

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-sky-400/40 bg-slate-950/90 p-4 shadow-[0_20px_60px_rgba(2,6,23,0.6)] backdrop-blur">
        {status.kind === 'available' ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-sky-100">
                {t('updater.available_title', { version: status.version })}
              </p>
              <p className="mt-1 text-xs text-slate-300">{t('updater.available_body')}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => void dismiss()}>
                {t('updater.later_action')}
              </Button>
              <Button size="sm" onClick={() => void startDownload()}>
                {t('updater.download_action')}
              </Button>
            </div>
          </div>
        ) : null}

        {status.kind === 'downloading' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-sky-100">
              {t('updater.downloading_title', { version: status.version })}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-sky-400 transition-all duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              {progress
                ? t('updater.progress_body', {
                    percent: percent.toFixed(0),
                    transferred: formatBytes(progress.transferred),
                    total: formatBytes(progress.total),
                    speed: formatBytes(progress.bytesPerSecond)
                  })
                : t('updater.progress_starting')}
            </p>
          </div>
        ) : null}

        {status.kind === 'downloaded' ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-sky-100">
                {t('updater.ready_title', { version: status.version })}
              </p>
              <p className="mt-1 text-xs text-slate-300">{t('updater.ready_body')}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => void installOnQuit()}>
                {t('updater.install_on_quit_action')}
              </Button>
              <Button size="sm" onClick={() => void installNow()}>
                {t('updater.install_now_action')}
              </Button>
            </div>
          </div>
        ) : null}

        {status.kind === 'error' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-rose-200">{t('updater.error_title')}</p>
            <p className="text-xs text-rose-100/80">{status.message}</p>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => void dismiss()}>
                {t('updater.dismiss_action')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
