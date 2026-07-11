import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui'
import { useUpdaterStore } from '@renderer/stores'

function Spinner(): React.JSX.Element {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  )
}

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
  const [isInstalling, setIsInstalling] = useState(false)

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
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-[rgba(15,23,42,0.32)] px-4 backdrop-blur-sm">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-hairline bg-white p-4 shadow-[0_24px_60px_rgba(0,0,0,0.18)]">
        {status.kind === 'available' ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {t('updater.available_title', { version: status.version })}
              </p>
              <p className="mt-1 text-xs text-ink-muted">{t('updater.available_body')}</p>
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
            <p className="text-sm font-semibold text-ink">
              {t('updater.downloading_title', { version: status.version })}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-[#e9e8e0]">
              <div
                className="h-full bg-aurora transition-all duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-ink-muted">
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
              <p className="text-sm font-semibold text-ink">
                {t('updater.ready_title', { version: status.version })}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {isInstalling ? t('updater.installing_body') : t('updater.ready_body')}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={isInstalling}
                onClick={() => void installOnQuit()}
              >
                {t('updater.install_on_quit_action')}
              </Button>
              <Button
                size="sm"
                disabled={isInstalling}
                onClick={() => {
                  setIsInstalling(true)
                  // installNow() triggers quitAndInstall() in the main process,
                  // which tears the window down within a few milliseconds. Wait
                  // for the browser to actually paint the spinner (double rAF =
                  // after the next frame is rendered) before starting the
                  // install, otherwise the loading state never becomes visible.
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      void installNow().catch(() => {
                        setIsInstalling(false)
                      })
                    })
                  })
                }}
              >
                {isInstalling ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    {t('updater.installing_action')}
                  </span>
                ) : (
                  t('updater.install_now_action')
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {status.kind === 'error' ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-destructive">{t('updater.error_title')}</p>
            <p className="text-xs text-destructive/85">{status.message}</p>
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
